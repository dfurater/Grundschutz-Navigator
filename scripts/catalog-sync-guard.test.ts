import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  computeManifestSignature,
  guardCatalogSyncPullRequest,
  parseNameStatusDiff,
  validateCatalogSyncManifest,
  validateCatalogSyncPullRequest,
  verifySnapshotProgress,
} from './catalog-sync-guard.mjs';
import { OFFICIAL_BSI_REPOSITORY_URL } from './security-guards.mjs';
import {
  SOURCE_REGISTRY,
  SUPPORTED_CATALOG,
} from '../src/domain/sourceRegistry.mjs';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';
import {
  LEGACY_V1_MIGRATION_SIGNATURE,
  LEGACY_V1_MIGRATION_SNAPSHOT,
} from './sync-upstream-manifest.mjs';

const OLD_SHA = '1'.repeat(40);
const NEW_SHA = '2'.repeat(40);
const RESULT_NAMESPACE_PATH = 'Dokumentation/namespaces/result.csv';
const RESULT_NAMESPACE_URL = `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/${RESULT_NAMESPACE_PATH}`;
const UNREFERENCED_NAMESPACE_PATH =
  'Dokumentation/namespaces/security_targets_levels.csv';
const TOPICS_NAMESPACE_PATH = 'Dokumentation/namespaces/topics.csv';
const TOPIC_UUID = '22222222-2222-4222-8222-222222222222';
const UNCLASSIFIED_PATH = 'Quellkataloge/Kernel/unclassified.csv';

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

function contentSha256(contents: Buffer) {
  return createHash('sha256').update(contents).digest('hex');
}

function makeOscalContents(
  entry: (typeof SOURCE_REGISTRY)[number],
  catalogNamespaceUrls: string[],
  topicUuids: string[],
) {
  if (entry.kind !== 'oscal') {
    throw new Error('Fixture requested OSCAL content for a vocabulary collection');
  }

  if (entry.artifactKey === SUPPORTED_CATALOG.artifactKey) {
    return Buffer.from(JSON.stringify({
      catalog: {
        uuid: 'supported-catalog-fixture',
        metadata: {
          title: 'Grundschutz++ Fixture',
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
          groups: topicUuids.map((topicUuid, index) => ({
            id: `GC.${index + 1}`,
            props: [{
              name: 'alt-identifier',
              value: topicUuid,
            }],
          })),
        }],
      },
    }));
  }

  return Buffer.from(JSON.stringify({
    [entry.expectedRootType]: {
      uuid: `${entry.artifactKey}-fixture`,
    },
  }));
}

function makeFixture({
  snapshotCommitSha = NEW_SHA,
  catalogNamespaceUrls = [RESULT_NAMESPACE_URL],
  manifestNamespacePaths = [
    RESULT_NAMESPACE_PATH,
    UNREFERENCED_NAMESPACE_PATH,
    TOPICS_NAMESPACE_PATH,
  ],
  contentOverrides = new Map<string, Buffer>(),
  includeUnclassified = true,
} = {}): GuardFixture {
  const files: ManifestFile[] = [];
  const contentsByBlobSha = new Map<string, Buffer>();
  const treeEntries: TreeEntry[] = [];
  const topicUuids = snapshotCommitSha === LEGACY_V1_MIGRATION_SNAPSHOT
    ? Array.from(
        { length: 139 },
        (_, index) => `topic-uuid-${index < 119 ? index : 0}`,
      )
    : [TOPIC_UUID];
  const topicsCsv = [
    'Begriff,Definition,UUID',
    ...[...new Set(topicUuids)].map(
      (uuid, index) => `Fixture ${index},Fixture definition,${uuid}`,
    ),
    '',
  ].join('\n');

  for (const entry of SOURCE_REGISTRY) {
    if (entry.kind !== 'oscal') continue;
    const contents = contentOverrides.get(entry.upstreamPath) ??
      makeOscalContents(entry, catalogNamespaceUrls, topicUuids);
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

function approvedLegacyManifest() {
  return {
    repository: OFFICIAL_BSI_REPOSITORY_URL,
    snapshotCommitSha: LEGACY_V1_MIGRATION_SNAPSHOT,
    catalogPath: SUPPORTED_CATALOG.upstreamPath,
    files: [
      {
        kind: 'catalog',
        path: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
        gitBlobSha: '193e5e0841beab14c207a91e6aa788d70e84632c',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/action_words.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/action_words.csv',
        gitBlobSha: '7fde34ab802961299e058f7ecd8ab5f52a245b04',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/basethreats.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/basethreats.csv',
        gitBlobSha: 'bfad6b3fe3e1a56f8a158b73a7dea85a47886823',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/documentation_guidelines.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/documentation_guidelines.csv',
        gitBlobSha: '97f05331405785f6b7375938d421695a419ee6ee',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/effort_level.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/effort_level.csv',
        gitBlobSha: '9a81649eccfbd76c53edc1eb205d3a903d783a4c',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/modal_verbs.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/modal_verbs.csv',
        gitBlobSha: 'f0b460ef82a82ea5583ef7739b22573af6dfd7e7',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/result.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv',
        gitBlobSha: 'd8e4e9e736135cf131defbd69dea056b39a3c043',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/security_level.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
        gitBlobSha: '5436e0863d60914dfa8334965e48162fa9b23f49',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/security_targets.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_targets.csv',
        gitBlobSha: '9ee2fd569d59eb59a4b8e9a63bcf3e3d7038fb93',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/tags.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/tags.csv',
        gitBlobSha: 'a80d720d6b017305cf74887ef3d8976ca83c08c8',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/target_object_categories.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/target_object_categories.csv',
        gitBlobSha: 'e6f437c6b34dcc6705508ac7d6863f2e67f88ee7',
      },
    ],
    signatureSha256: LEGACY_V1_MIGRATION_SIGNATURE,
  };
}

describe('validateCatalogSyncManifest v2', () => {
  it('accepts the complete registry contract and canonical signature', () => {
    const { manifest } = makeFixture();

    expect(validateCatalogSyncManifest(manifest)).toBe(manifest);
    expect(computeManifestSignature(manifest)).toBe(manifest.signatureSha256);
    expect(manifest.files.filter((file) => file.rootType !== 'vocabulary')).toHaveLength(17);
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

  it('rejects unregistered manifest entries while leaving them eligible for tree reporting', () => {
    const fixture = makeFixture();
    const unregistered = rebuildManifest(fixture.manifest, [
      ...fixture.manifest.files,
      {
        artifactKey: 'unclassified-fixture',
        rootType: 'catalog',
        lifecycle: 'preview',
        path: 'Quellkataloge/Kernel/unclassified.json',
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
});

describe('catalog sync artifact verification', () => {
  it('accepts unreferenced direct CSV members from the registered namespace directory', async () => {
    const previous = makeFixture({
      snapshotCommitSha: OLD_SHA,
      manifestNamespacePaths: [
        RESULT_NAMESPACE_PATH,
        UNREFERENCED_NAMESPACE_PATH,
        TOPICS_NAMESPACE_PATH,
      ],
    });
    const next = makeFixture({
      snapshotCommitSha: NEW_SHA,
      manifestNamespacePaths: [
        RESULT_NAMESPACE_PATH,
        UNREFERENCED_NAMESPACE_PATH,
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
      manifestNamespacePaths: [RESULT_NAMESPACE_PATH, TOPICS_NAMESPACE_PATH],
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

describe('snapshot progression and v1 migration', () => {
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

  it('accepts only the pinned same-snapshot legacy v1 to v2 migration', async () => {
    const next = makeFixture({ snapshotCommitSha: LEGACY_V1_MIGRATION_SNAPSHOT });
    const fetchImpl = makeGitHubFetch(next);

    await expect(guardCatalogSyncPullRequest({
      ...validShape(LEGACY_V1_MIGRATION_SNAPSHOT),
      previousManifest: approvedLegacyManifest(),
      nextManifest: next.manifest,
      fetchImpl,
    })).resolves.toEqual({
      catalogSync: true,
      snapshotCommitSha: LEGACY_V1_MIGRATION_SNAPSHOT,
    });
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('/compare/'))).toBe(false);
  });

  it('rejects legacy-like manifests when either migration pin differs', async () => {
    const next = makeFixture({ snapshotCommitSha: LEGACY_V1_MIGRATION_SNAPSHOT });
    const wrongSignature = {
      ...approvedLegacyManifest(),
      signatureSha256: 'f'.repeat(64),
    };
    await expect(guardCatalogSyncPullRequest({
      ...validShape(LEGACY_V1_MIGRATION_SNAPSHOT),
      previousManifest: wrongSignature,
      nextManifest: next.manifest,
      fetchImpl: vi.fn(),
    })).rejects.toThrow('unexpected or missing fields');

    const wrongSnapshot = {
      ...approvedLegacyManifest(),
      snapshotCommitSha: OLD_SHA,
    };
    await expect(guardCatalogSyncPullRequest({
      ...validShape(LEGACY_V1_MIGRATION_SNAPSHOT),
      previousManifest: wrongSnapshot,
      nextManifest: next.manifest,
      fetchImpl: vi.fn(),
    })).rejects.toThrow('unexpected or missing fields');
  });

  it('accepts an approved legacy base advancing to a verified ahead snapshot', async () => {
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
    const fetchImpl = makeGitHubFetch(next, { compareStatus: 'ahead' });
    await expect(guardCatalogSyncPullRequest({
      ...validShape(),
      previousManifest: approvedLegacyManifest(),
      nextManifest: next.manifest,
      fetchImpl,
    })).resolves.toEqual({
      catalogSync: true,
      snapshotCommitSha: NEW_SHA,
    });
    expect(fetchImpl.mock.calls.some(([input]) => String(input).includes('/compare/'))).toBe(true);
  });

  it('rejects identical snapshots outside the pinned legacy migration', async () => {
    const previous = makeFixture({ snapshotCommitSha: NEW_SHA });
    const next = makeFixture({ snapshotCommitSha: NEW_SHA });
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
