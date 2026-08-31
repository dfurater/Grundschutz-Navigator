import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import * as ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import {
  computeManifestSignature,
  guardCatalogSyncPullRequest,
  isRegistryPreviewArtifactExpansion,
  isRegistryLifecycleOnlyMigration,
  isRegistryOscalVersionMigration,
  loadSourceRegistryAtRef,
  REGISTRY_MODULE_CHAIN,
  parseNameStatusDiff,
  validateCatalogSyncManifest,
  validateCatalogSyncPullRequest,
  verifySnapshotProgress,
} from './catalog-sync-guard.mjs';
import { OFFICIAL_BSI_REPOSITORY_URL } from './security-guards.mjs';
import {
  SOURCE_REGISTRY,
  ENTRY_CATALOG,
} from '../src/domain/sourceRegistry.mjs';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';

const execFileAsync = promisify(execFile);

const OLD_SHA = '1'.repeat(40);
const NEW_SHA = '2'.repeat(40);
const RESULT_NAMESPACE_PATH = 'documentation/namespaces/result.csv';
const RESULT_NAMESPACE_URL = `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/${RESULT_NAMESPACE_PATH}`;
const UNREFERENCED_NAMESPACE_PATH =
  'documentation/namespaces/security_targets_levels.csv';
const PRACTICES_NAMESPACE_PATH = 'documentation/namespaces/practices.csv';
const PRACTICE_ALT_IDENTIFIER = '33333333-3333-4333-8333-333333333333';
const TOPICS_NAMESPACE_PATH = 'documentation/namespaces/topics.csv';
const TOPIC_ALT_IDENTIFIER = '22222222-2222-4222-8222-222222222222';
const UNCLASSIFIED_PATH = 'control_layer/Kernel/unclassified.csv';

interface ManifestFile {
  artifactKey: string;
  rootType: string;
  lifecycle: string;
  path: string;
  gitBlobSha: string;
  contentSha256: string;
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size: number;
}

interface GuardFixture {
  manifest: ReturnType<typeof buildUpstreamManifest>;
  contentsByBlobSha: Map<string, Buffer>;
  treeEntries: TreeEntry[];
  unclassifiedBlobSha: string;
}

function gitBlobSha(contents: Buffer) {
  return createHash('sha1')
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest('hex');
}

// Liest artifactKey-Literale aus den Objektliteralen VOR dem `.map()`-Aufruf,
// nicht dessen Rückgabewert — setzt voraus, dass der `.map()`-Callback in
// sourceRegistry.mjs (aktuell `(entry) => Object.freeze(entry)`) artifactKey
// unverändert durchreicht. Würde der Callback artifactKey künftig ableiten
// oder überschreiben, veraltet diese Extraktion, ohne dass der Grund aus dem
// Fehlerbild ersichtlich wäre — nur der Vergleich mit loadSourceRegistryAtRef
// (echter Import) würde als Diff auffallen.
function artifactKeysFromSourceRegistrySource(source: string, sourceName: string) {
  const sourceFile = ts.createSourceFile(
    sourceName,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  const registryDeclaration = sourceFile.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((declaration) =>
      ts.isIdentifier(declaration.name) && declaration.name.text === 'SOURCE_REGISTRY',
    );
  const frozenRegistry = registryDeclaration?.initializer;
  if (!frozenRegistry || !ts.isCallExpression(frozenRegistry)) {
    throw new Error(`SOURCE_REGISTRY declaration could not be located in ${sourceName}`);
  }
  const mappedRegistry = frozenRegistry.arguments[0];
  if (!mappedRegistry || !ts.isCallExpression(mappedRegistry)) {
    throw new Error(`SOURCE_REGISTRY array could not be located in ${sourceName}`);
  }
  const arrayExpression = ts.isPropertyAccessExpression(mappedRegistry.expression)
    ? mappedRegistry.expression.expression
    : undefined;
  if (!arrayExpression || !ts.isArrayLiteralExpression(arrayExpression)) {
    throw new Error(`SOURCE_REGISTRY array could not be read in ${sourceName}`);
  }

  return arrayExpression.elements.map((element) => {
    if (!ts.isObjectLiteralExpression(element)) {
      throw new Error(`SOURCE_REGISTRY contains a non-object entry in ${sourceName}`);
    }
    const keyProperty = element.properties.find(
      (property) =>
        ts.isPropertyAssignment(property)
        && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
        && property.name.text === 'artifactKey',
    );
    if (
      !keyProperty
      || !ts.isPropertyAssignment(keyProperty)
      || (!ts.isStringLiteral(keyProperty.initializer)
        && !ts.isNoSubstitutionTemplateLiteral(keyProperty.initializer))
    ) {
      throw new Error(`SOURCE_REGISTRY entry has no static artifactKey in ${sourceName}`);
    }
    return keyProperty.initializer.text;
  })
    .sort();
}

async function artifactKeysFromSourceRegistryAtRef(ref: string) {
  const { stdout: source } = await execFileAsync(
    'git',
    ['show', `${ref}:src/domain/sourceRegistry.mjs`],
    { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );

  return artifactKeysFromSourceRegistrySource(source, `sourceRegistry@${ref}.mjs`);
}

function contentSha256(contents: Buffer) {
  return createHash('sha256').update(contents).digest('hex');
}

function makeOscalContents(
  entry: (typeof SOURCE_REGISTRY)[number],
  catalogNamespaceUrls: string[],
  topicAltIdentifiers: string[],
) {
  if (entry.kind !== 'oscal') {
    throw new Error('Fixture requested OSCAL content for a vocabulary collection');
  }

  if (entry.artifactKey === ENTRY_CATALOG.artifactKey) {
    return Buffer.from(JSON.stringify({
      catalog: {
        uuid: 'supported-catalog-fixture',
        metadata: {
          title: 'Grundschutz++ Fixture',
          'oscal-version': entry.oscalVersion,
          namespaceReferences: catalogNamespaceUrls.map((ns) => ({ ns })),
        },
        controls: [
          {
            id: 'CTRL.1',
            props: [
              {
                name: 'alt-identifier',
                value: '11111111-1111-4111-8111-111111111111',
              },
            ],
          },
        ],
        groups: [{
          id: 'GC',
          props: [{
            name: 'alt-identifier',
            value: PRACTICE_ALT_IDENTIFIER,
          }],
          groups: topicAltIdentifiers.map((altIdentifier, index) => ({
            id: `GC.${index + 1}`,
            props: [{
              name: 'alt-identifier',
              value: altIdentifier,
            }],
          })),
        }],
      },
    }));
  }

  return Buffer.from(JSON.stringify({
    [entry.expectedRootType]: {
      uuid: `${entry.artifactKey}-fixture`,
      metadata: { 'oscal-version': entry.oscalVersion },
    },
  }));
}

function makeFixture({
  snapshotCommitSha = NEW_SHA,
  catalogNamespaceUrls = [RESULT_NAMESPACE_URL],
  manifestNamespacePaths = [
    RESULT_NAMESPACE_PATH,
    UNREFERENCED_NAMESPACE_PATH,
    PRACTICES_NAMESPACE_PATH,
    TOPICS_NAMESPACE_PATH,
  ],
  contentOverrides = new Map<string, Buffer>(),
  includeUnclassified = true,
} = {}): GuardFixture {
  const files: ManifestFile[] = [];
  const contentsByBlobSha = new Map<string, Buffer>();
  const treeEntries: TreeEntry[] = [];
  const topicAltIdentifiers = [TOPIC_ALT_IDENTIFIER];
  const topicsCsv = [
    'Begriff,Definition,UUID',
    ...[...new Set(topicAltIdentifiers)].map(
      (altIdentifier, index) => `Fixture ${index},Fixture definition,${altIdentifier}`,
    ),
    '',
  ].join('\n');

  for (const entry of SOURCE_REGISTRY) {
    if (entry.kind !== 'oscal') continue;
    const contents = contentOverrides.get(entry.upstreamPath) ??
      makeOscalContents(entry, catalogNamespaceUrls, topicAltIdentifiers);
    const blobSha = gitBlobSha(contents);
    files.push({
      artifactKey: entry.artifactKey,
      rootType: entry.expectedRootType,
      lifecycle: entry.lifecycle,
      path: entry.upstreamPath,
      gitBlobSha: blobSha,
      contentSha256: contentSha256(contents),
    });
    contentsByBlobSha.set(blobSha, contents);
    treeEntries.push({
      path: entry.upstreamPath,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
      size: contents.length,
    });
  }

  const vocabularyCollection = SOURCE_REGISTRY.find(
    (entry) => entry.kind === 'vocabulary-collection',
  );
  if (!vocabularyCollection) {
    throw new Error('Fixture requires the registered vocabulary collection');
  }

  for (const path of manifestNamespacePaths) {
    const contents = contentOverrides.get(path) ??
      (
        path === TOPICS_NAMESPACE_PATH
          ? Buffer.from(topicsCsv)
          : path === PRACTICES_NAMESPACE_PATH
            ? Buffer.from(
                `Kürzel,Begriff,Definition,UUID\nGC,Governance,Fixture definition,${PRACTICE_ALT_IDENTIFIER}\n`,
              )
            : Buffer.from('value,Definition\nfixture,Fixture definition\n')
      );
    const blobSha = gitBlobSha(contents);
    files.push({
      artifactKey: vocabularyCollection.artifactKey,
      rootType: 'vocabulary',
      lifecycle: vocabularyCollection.lifecycle,
      path,
      gitBlobSha: blobSha,
      contentSha256: contentSha256(contents),
    });
    contentsByBlobSha.set(blobSha, contents);
    treeEntries.push({
      path,
      mode: '100644',
      type: 'blob',
      sha: blobSha,
      size: contents.length,
    });
  }

  const unclassifiedContents = Buffer.from('0,low\n1,medium\n2,high\n');
  const unclassifiedBlobSha = gitBlobSha(unclassifiedContents);
  if (includeUnclassified && !manifestNamespacePaths.includes(UNCLASSIFIED_PATH)) {
    treeEntries.push({
      path: UNCLASSIFIED_PATH,
      mode: '100644',
      type: 'blob',
      sha: unclassifiedBlobSha,
      size: unclassifiedContents.length,
    });
  }

  return {
    manifest: buildUpstreamManifest({
      repository: OFFICIAL_BSI_REPOSITORY_URL,
      snapshotCommitSha,
      files,
    }),
    contentsByBlobSha,
    treeEntries,
    unclassifiedBlobSha,
  };
}

function makeResponse(body: unknown, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

function makeGitHubFetch(
  fixture: GuardFixture,
  {
    compareStatus = 'ahead',
    blobContentOverrides = new Map<string, Buffer>(),
    treeEntries = fixture.treeEntries,
  } = {},
) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);

    if (url.endsWith(`/commits/${fixture.manifest.snapshotCommitSha}`)) {
      return makeResponse({ sha: fixture.manifest.snapshotCommitSha });
    }
    if (url.includes('/compare/')) {
      return makeResponse({ status: compareStatus });
    }
    if (url.includes(`/git/trees/${fixture.manifest.snapshotCommitSha}?recursive=1`)) {
      return makeResponse({ truncated: false, tree: treeEntries });
    }

    const blobMatch = /\/git\/blobs\/([0-9a-f]{40})$/.exec(url);
    if (blobMatch) {
      const sha = blobMatch[1];
      const contents = blobContentOverrides.get(sha) ?? fixture.contentsByBlobSha.get(sha);
      if (!contents) {
        throw new Error(`Unexpected blob request: ${sha}`);
      }
      return makeResponse({
        sha,
        encoding: 'base64',
        content: contents.toString('base64'),
      });
    }

    throw new Error(`Unexpected GitHub request: ${url}`);
  });
}

function validShape(snapshotCommitSha = NEW_SHA) {
  const suffix = snapshotCommitSha.slice(0, 12);
  return {
    branch: `chore/catalog-sync-${suffix}`,
    title: `chore(ci): BSI-Katalog-Sync ${suffix}`,
    diffEntries: [{ status: 'M', path: 'upstream-manifest.json' }],
  };
}

function rebuildManifest(
  manifest: ReturnType<typeof buildUpstreamManifest>,
  files: ManifestFile[],
) {
  return buildUpstreamManifest({
    repository: manifest.repository,
    snapshotCommitSha: manifest.snapshotCommitSha,
    files,
  });
}

function makeLegacyV1Manifest() {
  return {
    repository: OFFICIAL_BSI_REPOSITORY_URL,
    snapshotCommitSha: OLD_SHA,
    catalogPath: 'legacy/catalog.json',
    files: [
      {
        kind: 'catalog',
        path: 'legacy/catalog.json',
        gitBlobSha: 'a'.repeat(40),
      },
    ],
    signatureSha256: 'b'.repeat(64),
  };
}

describe('validateCatalogSyncManifest v2', () => {
  it('accepts the complete registry contract and canonical signature', () => {
    const { manifest } = makeFixture();

    expect(validateCatalogSyncManifest(manifest)).toBe(manifest);
    expect(computeManifestSignature(manifest)).toBe(manifest.signatureSha256);
    expect(manifest.files.filter((file) => file.rootType !== 'vocabulary')).toHaveLength(
      SOURCE_REGISTRY.filter((entry) => entry.kind === 'oscal').length,
    );
  });

  it('rejects schema additions and a manipulated signature', () => {
    const { manifest } = makeFixture();
    expect(() => validateCatalogSyncManifest({ ...manifest, unexpected: true })).toThrow(
      'unexpected or missing fields',
    );
    expect(() => validateCatalogSyncManifest({
      ...manifest,
      signatureSha256: 'f'.repeat(64),
    })).toThrow('canonical payload');
  });

  it('rejects missing registry artifacts and registry metadata drift', () => {
    const { manifest } = makeFixture();
    const previewFile = manifest.files.find((file) => file.lifecycle === 'preview');
    expect(previewFile).toBeDefined();

    const missing = rebuildManifest(
      manifest,
      manifest.files.filter((file) => file.path !== previewFile!.path),
    );
    expect(() => validateCatalogSyncManifest(missing)).toThrow(
      `missing registered artifact: ${previewFile!.path}`,
    );

    const drifted = rebuildManifest(
      manifest,
      manifest.files.map((file) =>
        file.path === previewFile!.path ? { ...file, lifecycle: 'supported' } : file,
      ),
    );
    expect(() => validateCatalogSyncManifest(drifted)).toThrow(
      `metadata does not match sourceRegistry: ${previewFile!.path}`,
    );
  });

  it('accepts a manifest that omits a blocked-by-upstream registry artifact (ADR-7-Nachtrag)', () => {
    const { manifest } = makeFixture();
    const blockedFile = manifest.files.find((file) => file.lifecycle === 'blocked-by-upstream');
    expect(blockedFile).toBeDefined();

    const missingBlocked = rebuildManifest(
      manifest,
      manifest.files.filter((file) => file.path !== blockedFile!.path),
    );
    expect(validateCatalogSyncManifest(missingBlocked)).toBe(missingBlocked);
  });

  it('rejects unregistered manifest entries while leaving them eligible for tree reporting', () => {
    const fixture = makeFixture();
    const unregistered = rebuildManifest(fixture.manifest, [
      ...fixture.manifest.files,
      {
        artifactKey: 'unclassified-fixture',
        rootType: 'catalog',
        lifecycle: 'preview',
        path: 'control_layer/Kernel/unclassified.json',
        gitBlobSha: 'a'.repeat(40),
        contentSha256: 'b'.repeat(64),
      },
    ]);

    expect(() => validateCatalogSyncManifest(unregistered)).toThrow(
      'contains an unregistered path',
    );
  });
});

describe('catalog sync PR shape', () => {
  const shape = validShape();

  it('accepts exactly one modified manifest', () => {
    expect(() => validateCatalogSyncPullRequest(shape)).not.toThrow();
    expect(parseNameStatusDiff('M\tupstream-manifest.json\n')).toEqual(shape.diffEntries);
  });

  it('rejects an invalid branch', () => {
    expect(() => validateCatalogSyncPullRequest({
      ...shape,
      branch: 'feature/catalog-sync-222222222222',
    })).toThrow('branch must match');
  });

  it('requires the title suffix to match the branch suffix', () => {
    expect(() => validateCatalogSyncPullRequest({
      ...shape,
      title: 'chore(ci): BSI-Katalog-Sync aaaaaaaaaaaa',
    })).toThrow('PR title must be exactly');
  });

  it.each([
    [{ status: 'A', path: 'upstream-manifest.json' }],
    [{ status: 'D', path: 'upstream-manifest.json' }],
    [{ status: 'R100', path: 'upstream-manifest.json' }],
    [
      { status: 'M', path: 'upstream-manifest.json' },
      { status: 'A', path: 'scripts/extra.mjs' },
    ],
  ])('rejects added, deleted, renamed, or additional paths', (diffEntries) => {
    expect(() => validateCatalogSyncPullRequest({ ...shape, diffEntries })).toThrow(
      'must modify exactly upstream-manifest.json',
    );
  });

  it('lets a normal PR pass without manifest or network work', async () => {
    const fetchImpl = vi.fn();
    await expect(guardCatalogSyncPullRequest({
      branch: 'feature/ui-copy',
      title: 'feat: improve copy',
      diffEntries: [{ status: 'M', path: 'src/App.tsx' }],
      previousManifest: undefined,
      nextManifest: undefined,
      fetchImpl,
    })).resolves.toEqual({ catalogSync: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('allows only a signed registry lifecycle migration without catalog-sync network work', async () => {
    const next = makeFixture({ snapshotCommitSha: OLD_SHA });
    const previous = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file) =>
        file.lifecycle === 'blocked-by-upstream' ? { ...file, lifecycle: 'preview' } : file,
      ),
    );
    const diffEntries = [
      { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
      { status: 'M', path: 'upstream-manifest.json' },
    ];
    const fetchImpl = vi.fn();

    expect(isRegistryLifecycleOnlyMigration({ diffEntries, previousManifest: previous, nextManifest: next.manifest })).toBe(true);
    await expect(guardCatalogSyncPullRequest({
      branch: 'codex/gspp-336',
      title: 'feat(oscal): lifecycle migration',
      diffEntries,
      previousManifest: previous,
      nextManifest: next.manifest,
      fetchImpl,
    })).resolves.toEqual({ catalogSync: false, registryLifecycleMigration: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('permits only a fully verified same-snapshot expansion by internal preview catalogs', async () => {
    const next = makeFixture({ snapshotCommitSha: OLD_SHA });
    const previewSourcePaths = SOURCE_REGISTRY
      .filter(
        (entry) =>
          entry.kind === 'oscal' &&
          entry.expectedRootType === 'catalog' &&
          entry.lifecycle === 'preview' &&
          entry.catalogKey === undefined,
      )
      .map((entry) => entry.upstreamPath);
    const previous = rebuildManifest(
      next.manifest,
      next.manifest.files.filter((file) => !previewSourcePaths.includes(file.path)),
    );
    const diffEntries = [
      { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
      { status: 'M', path: 'upstream-manifest.json' },
    ];
    const fetchImpl = makeGitHubFetch(next);

    expect(isRegistryPreviewArtifactExpansion({
      diffEntries,
      previousManifest: previous,
      nextManifest: next.manifest,
    })).toBe(true);
    await expect(guardCatalogSyncPullRequest({
      branch: 'codex/gspp-241',
      title: 'feat(provenance): source lineage',
      diffEntries,
      previousManifest: previous,
      nextManifest: next.manifest,
      fetchImpl,
    })).resolves.toEqual({ catalogSync: false, registryPreviewArtifactExpansion: true });
    expect(fetchImpl).toHaveBeenCalled();
  });

  it('trägt eine Lifecycle-Promotion als Registry-Migration, ohne Netzwerkarbeit (GSPP-242)', async () => {
    // preview → supported: derselbe Snapshot, identische Content-Pins. Genau
    // der Fall der Auslieferung des Lieferkettenkatalogs.
    const next = makeFixture({ snapshotCommitSha: OLD_SHA });
    const promoted = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file, index) =>
        index === 0 ? { ...file, lifecycle: 'supported' } : file,
      ),
    );
    const previous = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file, index) =>
        index === 0 ? { ...file, lifecycle: 'preview' } : file,
      ),
    );
    const diffEntries = [
      { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
      { status: 'M', path: 'upstream-manifest.json' },
    ];
    const fetchImpl = vi.fn();

    expect(isRegistryLifecycleOnlyMigration({
      diffEntries,
      previousManifest: previous,
      nextManifest: promoted,
    })).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('entsperrt ein blocked-by-upstream-Artefakt nicht über die Ausnahme', () => {
    // Deeskalation aus blocked-by-upstream heraus gehört in die vollständige
    // Snapshot-Verifikation, nicht in die Registry-Ausnahme.
    const next = makeFixture({ snapshotCommitSha: OLD_SHA });
    const unblocked = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file) =>
        file.lifecycle === 'blocked-by-upstream' ? { ...file, lifecycle: 'preview' } : file,
      ),
    );

    expect(isRegistryLifecycleOnlyMigration({
      diffEntries: [
        { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
        { status: 'M', path: 'upstream-manifest.json' },
      ],
      previousManifest: next.manifest,
      nextManifest: unblocked,
    })).toBe(false);
  });

  it('weist einen undeklarierten Lifecycle-Wert fail-closed ab', () => {
    // Das Vormanifest liest die CLI per rohem JSON.parse, ohne Normalisierung.
    // Das Prädikat muss einen undeklarierten Wert deshalb selbst abweisen,
    // statt sich auf die Manifest-Shape-Prüfung zu verlassen.
    const next = makeFixture({ snapshotCommitSha: OLD_SHA });
    const previous = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file, index) =>
        index === 0 ? { ...file, lifecycle: 'preview' } : file,
      ),
    );
    const bogus = {
      ...next.manifest,
      files: next.manifest.files.map((file, index) =>
        index === 0 ? { ...file, lifecycle: 'experimental' } : file,
      ),
    };

    expect(isRegistryLifecycleOnlyMigration({
      diffEntries: [
        { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
        { status: 'M', path: 'upstream-manifest.json' },
      ],
      previousManifest: previous,
      nextManifest: bogus,
    })).toBe(false);
  });

  it('does not classify content or snapshot changes as a registry lifecycle migration', () => {
    const next = makeFixture({ snapshotCommitSha: OLD_SHA });
    const previous = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file) =>
        file.lifecycle === 'blocked-by-upstream' ? { ...file, lifecycle: 'preview' } : file,
      ),
    );
    const contentChanged = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file, index) =>
        index === 0 ? { ...file, contentSha256: 'f'.repeat(64) } : file,
      ),
    );

    expect(isRegistryLifecycleOnlyMigration({
      diffEntries: [
        { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
        { status: 'M', path: 'upstream-manifest.json' },
      ],
      previousManifest: previous,
      nextManifest: contentChanged,
    })).toBe(false);
    expect(isRegistryLifecycleOnlyMigration({
      diffEntries: [
        { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
        { status: 'M', path: 'upstream-manifest.json' },
      ],
      previousManifest: previous,
      nextManifest: { ...next.manifest, snapshotCommitSha: NEW_SHA },
    })).toBe(false);
  });
});

describe('catalog sync artifact verification', () => {
  it('accepts a sync when a blocked-by-upstream artifact is missing from both the manifest and the tree (ADR-7-Nachtrag)', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const full = makeFixture({ snapshotCommitSha: NEW_SHA });
    const blockedEntry = SOURCE_REGISTRY.find(
      (entry) => entry.kind === 'oscal' && entry.lifecycle === 'blocked-by-upstream',
    );
    expect(blockedEntry).toBeDefined();

    const next = rebuildManifest(
      full.manifest,
      full.manifest.files.filter((file) => file.path !== blockedEntry!.upstreamPath),
    );
    const treeEntries = full.treeEntries.filter((entry) => entry.path !== blockedEntry!.upstreamPath);
    const fetchImpl = makeGitHubFetch({ ...full, manifest: next }, { treeEntries });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next,
      fetchImpl,
    })).resolves.toEqual({ catalogSync: true, snapshotCommitSha: NEW_SHA });
  });

  it('rejects a manifest that omits a blocked-by-upstream artifact still present in the BSI snapshot (ADR-7-Nachtrag)', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const full = makeFixture({ snapshotCommitSha: NEW_SHA });
    const blockedEntry = SOURCE_REGISTRY.find(
      (entry) => entry.kind === 'oscal' && entry.lifecycle === 'blocked-by-upstream',
    );
    expect(blockedEntry).toBeDefined();

    const next = rebuildManifest(
      full.manifest,
      full.manifest.files.filter((file) => file.path !== blockedEntry!.upstreamPath),
    );
    // treeEntries stays at full.treeEntries: the blocked artifact is still present upstream.
    const fetchImpl = makeGitHubFetch({ ...full, manifest: next });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next,
      fetchImpl,
    })).rejects.toThrow(
      `Manifest omits blocked artifact that is still present in the BSI snapshot: ${blockedEntry!.upstreamPath}`,
    );
  });

  it('accepts unreferenced direct CSV members from the registered namespace directory', async () => {
    const previous = makeFixture({
      snapshotCommitSha: OLD_SHA,
      manifestNamespacePaths: [
        RESULT_NAMESPACE_PATH,
        UNREFERENCED_NAMESPACE_PATH,
        PRACTICES_NAMESPACE_PATH,
        TOPICS_NAMESPACE_PATH,
      ],
    });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      manifestNamespacePaths: [
        RESULT_NAMESPACE_PATH,
        UNREFERENCED_NAMESPACE_PATH,
        PRACTICES_NAMESPACE_PATH,
        TOPICS_NAMESPACE_PATH,
      ],
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).resolves.toEqual({ catalogSync: true, snapshotCommitSha: NEW_SHA });
  });

  it('verifies every registered blob and ignores unclassified tree files', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const fetchImpl = makeGitHubFetch(next);

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl,
    })).resolves.toEqual({ catalogSync: true, snapshotCommitSha: NEW_SHA });

    const requestedUrls = fetchImpl.mock.calls.map(([input]) => String(input));
    const blobRequests = requestedUrls.filter((url) => url.includes('/git/blobs/'));
    expect(blobRequests).toHaveLength(next.manifest.files.length);
    for (const file of next.manifest.files) {
      expect(blobRequests.some((url) => url.endsWith(`/git/blobs/${file.gitBlobSha}`))).toBe(true);
    }
    expect(requestedUrls.some((url) => url.includes(next.unclassifiedBlobSha))).toBe(false);
  });

  it('rejects a manifest that omits a direct CSV from the registered namespace directory', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      manifestNamespacePaths: [
        RESULT_NAMESPACE_PATH,
        PRACTICES_NAMESPACE_PATH,
        TOPICS_NAMESPACE_PATH,
      ],
      includeUnclassified: false,
    });
    const omittedContents = Buffer.from('Wert,Definition\n0,Keine Relevanz\n');
    const treeEntries = [
      ...next.treeEntries,
      {
        path: UNREFERENCED_NAMESPACE_PATH,
        mode: '100644',
        type: 'blob',
        sha: gitBlobSha(omittedContents),
        size: omittedContents.length,
      },
    ];

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next, { treeEntries }),
    })).rejects.toThrow('namespace inventory does not match');
  });

  it('rejects topic UUID drift for a future snapshot', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      contentOverrides: new Map([
        [
          TOPICS_NAMESPACE_PATH,
          Buffer.from(
            'Begriff,Definition,UUID\nVerwaist,Ohne Katalogtreffer,unmatched-topic-uuid\n',
          ),
        ],
      ]),
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('Topic-Coverage');
  });

  it('rejects duplicate Practice UUIDs for a future snapshot', async () => {
    const previous = makeFixture({
      snapshotCommitSha: OLD_SHA,
    });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      contentOverrides: new Map([
        [
          PRACTICES_NAMESPACE_PATH,
          Buffer.from(
            'Kürzel,Begriff,Definition,UUID\nGC,Governance,Definition,practice-uuid-1\nISMS,Management,Definition,practice-uuid-1\n',
          ),
        ],
      ]),
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('Practice-UUID-Integrität');
  });

  it('rejects missing or unmatched practices.csv coverage for a future snapshot', async () => {
    const manifestNamespacePaths = [
      RESULT_NAMESPACE_PATH,
      UNREFERENCED_NAMESPACE_PATH,
      TOPICS_NAMESPACE_PATH,
    ];
    const previous = makeFixture({
      snapshotCommitSha: OLD_SHA,
      manifestNamespacePaths,
    });
    const missing = makeFixture({
      snapshotCommitSha: NEW_SHA,
      manifestNamespacePaths,
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: missing.manifest,
      fetchImpl: makeGitHubFetch(missing),
    })).rejects.toThrow('practices.csv fehlt');

    const unmatched = makeFixture({
      snapshotCommitSha: NEW_SHA,
      contentOverrides: new Map([
        [
          PRACTICES_NAMESPACE_PATH,
          Buffer.from(
            'Kürzel,Begriff,Definition,UUID\nGC,Governance,Definition,unmatched-practice-uuid\n',
          ),
        ],
      ]),
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: makeFixture({ snapshotCommitSha: OLD_SHA }).manifest,
      nextManifest: unmatched.manifest,
      fetchImpl: makeGitHubFetch(unmatched),
    })).rejects.toThrow('Practice-UUID-Integrität');
  });

  it('rejects external namespace CSV references without requesting their host', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      catalogNamespaceUrls: [
        RESULT_NAMESPACE_URL,
        'https://external.example/namespaces/evil.csv',
      ],
    });
    const fetchImpl = makeGitHubFetch(next);

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl,
    })).rejects.toThrow('Externe oder nicht erlaubte Namespace-Quelle');
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('external.example'))).toBe(
      false,
    );
  });

  it('rejects nonregular tree modes for registered artifacts', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const previewPath = SOURCE_REGISTRY.find(
      (entry) => entry.kind === 'oscal' && entry.lifecycle === 'preview',
    )!.upstreamPath;
    const treeEntries = next.treeEntries.map((entry) =>
      entry.path === previewPath ? { ...entry, mode: '120000' } : entry,
    );

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next, { treeEntries }),
    })).rejects.toThrow('not a regular file');
  });

  it('rejects a root-type mismatch in a preview artifact', async () => {
    const previewProfile = SOURCE_REGISTRY.find(
      (entry) =>
        entry.kind === 'oscal' &&
        entry.lifecycle === 'preview' &&
        entry.expectedRootType === 'profile',
    );
    expect(previewProfile?.kind).toBe('oscal');
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      contentOverrides: new Map([
        [previewProfile!.upstreamPath, Buffer.from('{"catalog":{"uuid":"wrong-root"}}')],
      ]),
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('Profilwurzel');
  });

  it('rejects a declared version that deviates from the source registry', async () => {
    const previewComponent = SOURCE_REGISTRY.find(
      (entry) =>
        entry.kind === 'oscal' &&
        entry.lifecycle === 'preview' &&
        entry.expectedRootType === 'component-definition',
    );
    expect(previewComponent?.kind).toBe('oscal');
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      contentOverrides: new Map([
        [
          previewComponent!.upstreamPath,
          // Gepinnte, aber für dieses Artefakt falsche Version.
          Buffer.from(JSON.stringify({
            'component-definition': { uuid: 'x', metadata: { 'oscal-version': '1.2.1' } },
          })),
        ],
      ]),
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('Deklarierte OSCAL-Version weicht vom Quellregister ab');
  });

  it('rejects a present null $schema directive in a preview artifact', async () => {
    const previewComponent = SOURCE_REGISTRY.find(
      (entry) =>
        entry.kind === 'oscal' &&
        entry.lifecycle === 'preview' &&
        entry.expectedRootType === 'component-definition',
    );
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      contentOverrides: new Map([
        [
          previewComponent!.upstreamPath,
          Buffer.from(JSON.stringify({
            $schema: null,
            'component-definition': {
              uuid: 'x',
              metadata: { 'oscal-version': (previewComponent as { oscalVersion: string }).oscalVersion },
            },
          })),
        ],
      ]),
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('OSCAL_SCHEMA_DIRECTIVE_CONFLICT');
  });

  it('rejects content that does not match its Git blob SHA', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const target = next.manifest.files[0];
    const fetchImpl = makeGitHubFetch(next, {
      blobContentOverrides: new Map([
        [target.gitBlobSha, Buffer.from('tampered content')],
      ]),
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl,
    })).rejects.toThrow('content does not match its Git blob SHA');
  });

  it('rejects a manifest content hash that does not match verified blob bytes', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const target = next.manifest.files[0];
    next.manifest = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file) =>
        file.path === target.path ? { ...file, contentSha256: 'f'.repeat(64) } : file,
      ),
    );

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('contentSha256 does not match');
  });

  it('rejects a manifest blob SHA that differs from the selected tree', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const target = next.manifest.files[0];
    next.manifest = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file) =>
        file.path === target.path ? { ...file, gitBlobSha: 'f'.repeat(40) } : file,
      ),
    );

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('blob SHA does not match the BSI snapshot');
  });

  it('fails closed when GitHub returns a truncated snapshot tree', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const fetchImpl = makeGitHubFetch(next);
    fetchImpl.mockImplementation(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith(`/commits/${NEW_SHA}`)) return makeResponse({ sha: NEW_SHA });
      if (url.includes('/compare/')) return makeResponse({ status: 'ahead' });
      if (url.includes(`/git/trees/${NEW_SHA}?recursive=1`)) {
        return makeResponse({ truncated: true, tree: [] });
      }
      throw new Error(`Unexpected GitHub request: ${url}`);
    });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl,
    })).rejects.toThrow('truncated or incomplete');
  });
});

describe('snapshot progression', () => {
  it('accepts normal updates only when the next snapshot is ahead', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });

    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next, { compareStatus: 'ahead' }),
    })).resolves.toEqual({ catalogSync: true, snapshotCommitSha: NEW_SHA });
  });

  it.each(['behind', 'diverged', 'identical'])(
    'rejects normal updates with compare status %s',
    async (compareStatus) => {
      const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
      const next = makeFixture({ snapshotCommitSha: NEW_SHA });
      await expect(guardCatalogSyncPullRequest({
        ...validShape(),
        previousManifest: previous.manifest,
        nextManifest: next.manifest,
        fetchImpl: makeGitHubFetch(next, { compareStatus }),
      })).rejects.toThrow(`status=${compareStatus}`);
    },
  );

  it('rejects a legacy v1 base before network access', async () => {
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const fetchImpl = vi.fn();
    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: makeLegacyV1Manifest(),
      nextManifest: next.manifest,
      fetchImpl,
    })).rejects.toThrow('unexpected or missing fields');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a v2 signature change for an identical snapshot', async () => {
    const previous = makeFixture({ snapshotCommitSha: NEW_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    next.manifest = rebuildManifest(
      next.manifest,
      next.manifest.files.map((file, index) =>
        index === 0 ? { ...file, contentSha256: 'f'.repeat(64) } : file,
      ),
    );
    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next, { compareStatus: 'identical' }),
    })).rejects.toThrow('status=identical');
  });

  it('fails closed when snapshot lookup fails', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(makeResponse({}, { ok: false, status: 404 }));
    await expect(verifySnapshotProgress(OLD_SHA, NEW_SHA, { fetchImpl })).rejects.toThrow(
      'HTTP 404',
    );
  });

  it('fails closed on API and network errors', async () => {
    const apiFailure = vi.fn().mockResolvedValue(makeResponse({}, { ok: false, status: 503 }));
    const networkFailure = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(verifySnapshotProgress(OLD_SHA, NEW_SHA, { fetchImpl: apiFailure })).rejects.toThrow(
      'HTTP 503',
    );
    await expect(
      verifySnapshotProgress(OLD_SHA, NEW_SHA, { fetchImpl: networkFailure }),
    ).rejects.toThrow('offline');
  });

  it('binds the branch suffix to the next manifest snapshot', async () => {
    const previous = makeFixture({ snapshotCommitSha: OLD_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    await expect(guardCatalogSyncPullRequest({
      ...validShape('a'.repeat(40)),
      previousManifest: previous.manifest,
      nextManifest: next.manifest,
      fetchImpl: makeGitHubFetch(next),
    })).rejects.toThrow('must match the new snapshot');
  });
});


describe('OSCAL-Versionsmigration (GSPP-376)', () => {
  const MIGRATED_KEY = 'component-aws-security-hub';

  /**
   * Registerstand mit gesetzter Version für das migrierte Artefakt. Bewusst
   * über einen JSON-Roundtrip: Genau so kommt der Vorstand im Betrieb an —
   * frisch geparst und referenziell fremd zum eingefrorenen SOURCE_REGISTRY
   * dieses Prozesses.
   */
  function registryAtVersion(oscalVersion: string, overrides: Record<string, unknown> = {}) {
    const clone = JSON.parse(JSON.stringify(SOURCE_REGISTRY)) as Record<string, unknown>[];
    return clone.map((entry) =>
      entry.artifactKey === MIGRATED_KEY
        ? { ...entry, oscalVersion, ...overrides }
        : entry,
    );
  }

  const registryBefore = (overrides: Record<string, unknown> = {}) =>
    registryAtVersion('1.1.3', overrides);
  const migratedRegistry = () => registryAtVersion('1.2.2');

  function manifestPair(files?: ManifestFile[]) {
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const nextManifest = files
      ? rebuildManifest(next.manifest, files)
      : next.manifest;
    const previousManifest = buildUpstreamManifest({
      repository: nextManifest.repository,
      snapshotCommitSha: OLD_SHA,
      files: next.manifest.files,
    });
    return { fixture: next, previousManifest, nextManifest };
  }

  const REQUIRED_ENTRIES = [
    { status: 'M', path: 'upstream-manifest.json' },
    { status: 'M', path: 'src/domain/sourceRegistry.mjs' },
  ];

  function subject(diffEntries: { status: string; path: string }[], overrides = {}) {
    const { previousManifest, nextManifest } = manifestPair();
    return isRegistryOscalVersionMigration({
      diffEntries,
      previousManifest,
      nextManifest,
      previousSourceRegistry: registryBefore(),
      nextSourceRegistry: migratedRegistry(),
      ...overrides,
    });
  }

  it('erkennt die reine Versionsmigration aus Manifest und Quellregister', () => {
    expect(subject(REQUIRED_ENTRIES)).toBe(true);
  });

  it('lässt Begleitpfade unter src/ und docs/ zu', () => {
    expect(subject([
      ...REQUIRED_ENTRIES,
      { status: 'M', path: 'src/domain/sourceRegistry.test.ts' },
      { status: 'A', path: 'src/test/fixtures/neuerKorpus.ts' },
      { status: 'M', path: 'docs/DOMAIN_MODELS.md' },
    ])).toBe(true);
  });

  it.each([
    ['Workflow', '.github/workflows/deploy.yml'],
    ['Lane-Skript', 'scripts/catalog-sync-guard.mjs'],
    ['Lane-Test', 'scripts/catalog-sync-guard.test.ts'],
    ['Wurzeldatei', 'package.json'],
    ['unsicherer Pfad', 'src/../scripts/fetch-catalog.mjs'],
  ])('weist einen Zusatzpfad ausserhalb der Positivliste ab: %s', (_label, path) => {
    expect(subject([...REQUIRED_ENTRIES, { status: 'M', path }])).toBe(false);
  });

  it.each([
    ['ohne Manifest', [{ status: 'M', path: 'src/domain/sourceRegistry.mjs' }]],
    ['ohne Quellregister', [{ status: 'M', path: 'upstream-manifest.json' }]],
    ['Quellregister nur hinzugefügt statt geändert', [
      { status: 'M', path: 'upstream-manifest.json' },
      { status: 'A', path: 'src/domain/sourceRegistry.mjs' },
    ]],
  ])('verlangt beide Pflichtpfade als Änderung: %s', (_label, diffEntries) => {
    expect(subject(diffEntries)).toBe(false);
  });

  it('weist eine Registeränderung ab, die neben der Version ein weiteres Feld bewegt', () => {
    expect(subject(REQUIRED_ENTRIES, {
      previousSourceRegistry: registryBefore({ lifecycle: 'blocked-by-upstream' }),
    })).toBe(false);
  });

  it('weist eine mitgeführte Änderung an einem Nicht-OSCAL-Eintrag ab', () => {
    const previous = registryBefore().map((entry) =>
      entry.kind === 'vocabulary-collection'
        ? { ...entry, upstreamDirectory: 'documentation/andere-namespaces' }
        : entry,
    );
    expect(subject(REQUIRED_ENTRIES, { previousSourceRegistry: previous })).toBe(false);
  });

  it('verlangt mindestens eine tatsächliche Versionsänderung', () => {
    expect(subject(REQUIRED_ENTRIES, {
      previousSourceRegistry: registryAtVersion('1.1.3'),
      nextSourceRegistry: registryAtVersion('1.1.3'),
    })).toBe(false);
  });

  it('weist eine geänderte Artefaktmenge im Register ab', () => {
    expect(subject(REQUIRED_ENTRIES, {
      previousSourceRegistry: registryBefore().slice(1),
    })).toBe(false);
  });

  it('vergleicht Registerfelder strukturell, nicht per Referenz', () => {
    // Ein Objektfeld ist im Bestand heute nicht belegt. Käme eines hinzu,
    // wäre es per !== zwischen geparstem Vorstand und eingefrorenem Register
    // immer ungleich — die Ausnahme verschlösse sich still.
    const before = [
      { artifactKey: 'a', kind: 'oscal', oscalVersion: '1.1.3', meta: { pins: ['x'] } },
      { artifactKey: 'b', kind: 'vocabulary-collection', meta: { pins: ['y'] } },
    ];
    const after = [
      { artifactKey: 'a', kind: 'oscal', oscalVersion: '1.2.2', meta: { pins: ['x'] } },
      { artifactKey: 'b', kind: 'vocabulary-collection', meta: { pins: ['y'] } },
    ];
    expect(subject(REQUIRED_ENTRIES, {
      previousSourceRegistry: before,
      nextSourceRegistry: after,
    })).toBe(true);

    const diverging = after.map((entry) =>
      entry.artifactKey === 'b' ? { ...entry, meta: { pins: ['z'] } } : entry,
    );
    expect(subject(REQUIRED_ENTRIES, {
      previousSourceRegistry: before,
      nextSourceRegistry: diverging,
    })).toBe(false);
  });

  it('verlangt einen bewegten Snapshot', () => {
    const { nextManifest } = manifestPair();
    expect(isRegistryOscalVersionMigration({
      diffEntries: REQUIRED_ENTRIES,
      previousManifest: nextManifest,
      nextManifest,
      previousSourceRegistry: registryBefore(),
      nextSourceRegistry: migratedRegistry(),
    })).toBe(false);
  });

  it.each([
    ['hinzugefügten Pfad', (files: ManifestFile[]) => files.slice(1)],
    ['entfernten Pfad', (files: ManifestFile[]) => [...files, { ...files[0], path: 'control_layer/Neu/neu.json' }]],
    ['gewechselten Lifecycle', (files: ManifestFile[]) =>
      files.map((file, index) =>
        index === 0
          ? { ...file, lifecycle: file.lifecycle === 'supported' ? 'preview' : 'supported' }
          : file,
      )],
    ['umgehängten artifactKey', (files: ManifestFile[]) =>
      files.map((file, index) => (index === 0 ? { ...file, artifactKey: 'fremd' } : file))],
  ])('weist eine Manifestbewegung jenseits von Snapshot und Pins ab: %s', (_label, mutate) => {
    const { fixture, nextManifest } = manifestPair();
    const previousManifest = buildUpstreamManifest({
      repository: nextManifest.repository,
      snapshotCommitSha: OLD_SHA,
      files: mutate(fixture.manifest.files),
    });
    expect(isRegistryOscalVersionMigration({
      diffEntries: REQUIRED_ENTRIES,
      previousManifest,
      nextManifest,
      previousSourceRegistry: registryBefore(),
      nextSourceRegistry: migratedRegistry(),
    })).toBe(false);
  });

  it('prüft die Migration vollständig gegen Tree, Blobs und Snapshotfortschritt', async () => {
    const { fixture, previousManifest, nextManifest } = manifestPair();
    const fetchImpl = makeGitHubFetch(fixture);

    await expect(guardCatalogSyncPullRequest({
      branch: 'claude/gspp-377-snapshot-migration',
      title: 'fix(sync/oscal): BSI-Snapshot nachziehen',
      diffEntries: [
        ...REQUIRED_ENTRIES,
        { status: 'M', path: 'docs/DOMAIN_MODELS.md' },
      ],
      previousManifest,
      nextManifest,
      // Der Guard vergleicht gegen das echte SOURCE_REGISTRY des
      // Arbeitsbaums; der Vorstand muss dafür eine andere Version tragen.
      previousSourceRegistry: registryAtVersion('1.1.2'),
      fetchImpl,
    })).resolves.toEqual({
      catalogSync: false,
      registryOscalVersionMigration: true,
      snapshotCommitSha: NEW_SHA,
    });

    const requested = fetchImpl.mock.calls.map(([input]) => String(input));
    expect(requested.some((url) => url.includes('/compare/'))).toBe(true);
    expect(requested.some((url) => url.includes('/git/trees/'))).toBe(true);
    expect(requested.some((url) => url.includes('/git/blobs/'))).toBe(true);
  });

  it('liest Registry-Schlüssel strukturell trotz abweichender Literalschreibweise', () => {
    const source = `
export const SOURCE_REGISTRY = Object.freeze(
  [
    {
      "artifactKey": "catalog-double-quoted", // zulässiger Kommentar
    },
  ].map((entry) => Object.freeze(entry)),
);
`;
    expect(artifactKeysFromSourceRegistrySource(source, 'fixture-sourceRegistry.mjs'))
      .toEqual(['catalog-double-quoted']);
  });

  it('lädt den Registervorstand aus einem git-Ref, ohne den Quellbaum zu berühren', async () => {
    const before = await readdir('src/domain');
    const loaded = await loadSourceRegistryAtRef('HEAD');
    const after = await readdir('src/domain');

    // Der Vorstand ist ein vollwertiges, selbstvalidiertes Register: Der
    // Import im Kindprozess führt validateSourceRegistry mit aus.
    expect(Array.isArray(loaded)).toBe(true);
    expect(loaded.map((entry) => entry.artifactKey).sort()).toEqual(
      await artifactKeysFromSourceRegistryAtRef('HEAD'),
    );

    // Kern der Ablage ausserhalb des Quellbaums: Selbst im Erfolgsfall darf
    // in src/domain kein temporäres, importierbares Modul auftauchen.
    expect(after).toEqual(before);
  });

  it('deckt jeden relativen Import der Registerkette ab', async () => {
    // Die Kette wird flach in ein Temp-Verzeichnis materialisiert. Bekommt ein
    // Kettenglied einen weiteren relativen Import, der hier nicht gelistet ist,
    // scheitert der Kindprozess-Import mit einem irreführenden
    // Modulauflösungsfehler und blockiert Migrationen still (Gitar-Befund).
    const declared = new Set(REGISTRY_MODULE_CHAIN.map((path) => path.split('/').pop()));

    for (const modulePath of REGISTRY_MODULE_CHAIN) {
      const source = await readFile(modulePath, 'utf8');
      const relativeImports = [...source.matchAll(/from\s+'(\.[^']+)'/g)].map((match) => match[1]);
      for (const specifier of relativeImports) {
        expect(
          declared.has(specifier.split('/').pop()),
          `${modulePath} importiert ${specifier}, das nicht in REGISTRY_MODULE_CHAIN steht`,
        ).toBe(true);
      }
    }
  });

  it('materialisiert die Kette flach, ohne Namenskollision', () => {
    const baseNames = REGISTRY_MODULE_CHAIN.map((path) => path.split('/').pop());
    expect(new Set(baseNames).size).toBe(baseNames.length);
  });

  it('scheitert fail-closed an einem Ref ohne Quellregister', async () => {
    await expect(loadSourceRegistryAtRef('4'.repeat(40))).rejects.toThrow();
  });

  it('fällt ohne geladenen Registervorstand auf den regulären Sync-Pfad zurück', async () => {
    const { previousManifest, nextManifest } = manifestPair();
    const fetchImpl = vi.fn();

    // Kein previousSourceRegistry: Das Prädikat greift nicht, der Guard
    // behandelt die PR als gewöhnlichen Sync-Kandidaten und lehnt sie an der
    // Branchnamensregel ab statt sie durchzulassen.
    await expect(guardCatalogSyncPullRequest({
      branch: 'claude/gspp-377-snapshot-migration',
      title: 'fix(sync/oscal): BSI-Snapshot nachziehen',
      diffEntries: REQUIRED_ENTRIES,
      previousManifest,
      nextManifest,
      fetchImpl,
    })).rejects.toThrow(/Catalog sync branch must match/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
