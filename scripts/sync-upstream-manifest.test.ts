import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  resolveTrackedManifestPath,
  resolveUpstreamMetadataPath,
} from './security-guards.mjs';
import {
  buildChangeSummary,
  buildFileDelta,
  extractManifestFromVocabularyMetadata,
  hasManifestChanged,
  readTrackedManifest,
  syncUpstreamManifest,
  validateUpstreamManifest,
} from './sync-upstream-manifest.mjs';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';

const OFFICIAL_REPOSITORY =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek';
const BASE_SNAPSHOT_SHA = '1'.repeat(40);
const HEAD_SNAPSHOT_SHA = '2'.repeat(40);

interface ManifestFile {
  artifactKey: string;
  rootType: string;
  lifecycle: string;
  path: string;
  gitBlobSha: string;
  contentSha256: string;
}

interface GitTreeEntry {
  path: string;
  mode: string;
  type: string;
  sha: string;
  size?: number;
}

function manifestFile(overrides: Partial<ManifestFile> = {}): ManifestFile {
  return {
    artifactKey: 'catalog-gspp',
    rootType: 'catalog',
    lifecycle: 'supported',
    path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
    gitBlobSha: 'a'.repeat(40),
    contentSha256: 'a'.repeat(64),
    ...overrides,
  };
}

function makeManifest({
  snapshotCommitSha = HEAD_SNAPSHOT_SHA,
  files = [manifestFile()],
} = {}) {
  return buildUpstreamManifest({
    repository: OFFICIAL_REPOSITORY,
    snapshotCommitSha,
    files,
  });
}

function makeVocabularyMetadata(
  manifest: ReturnType<typeof makeManifest>,
  dataQualityFindings: unknown = [],
) {
  return {
    source: {
      repository: manifest.repository,
      snapshotCommitSha: manifest.snapshotCommitSha,
      snapshotCommitDate: '2026-04-02T00:00:00Z',
    },
    manifest,
    files: [],
    dataQualityFindings,
    integrity: {
      fetchedAt: '2026-04-02T00:00:00Z',
    },
    build: {
      workflowRunId: 'local',
      workflowRunUrl: null,
      runnerEnvironment: 'local',
    },
  };
}

function makeLegacyV1Manifest() {
  return {
    repository: OFFICIAL_REPOSITORY,
    snapshotCommitSha: BASE_SNAPSHOT_SHA,
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

function blob(pathname: string, sha: string): GitTreeEntry {
  return { path: pathname, mode: '100644', type: 'blob', sha, size: 1 };
}

function directory(pathname: string, sha: string): GitTreeEntry {
  return { path: pathname, mode: '040000', type: 'tree', sha };
}

function completeTree(entries: GitTreeEntry[]) {
  return { truncated: false, tree: entries };
}

function gitBlobResponse(buffer: Buffer) {
  const sha = execFileSync('git', ['hash-object', '--stdin'], {
    encoding: 'utf8',
    input: buffer,
  }).trim();
  return {
    sha,
    contentSha256: createHash('sha256').update(buffer).digest('hex'),
    response: new Response(JSON.stringify({
      sha,
      encoding: 'base64',
      size: buffer.length,
      content: buffer.toString('base64'),
    }), { headers: { 'Content-Type': 'application/json' } }),
  };
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getAllowedTempRoot() {
  return process.env.RUNNER_TEMP ?? tmpdir();
}

describe('upstream manifest validation and extraction', () => {
  it('accepts and extracts only a strict canonical v2 manifest', () => {
    const manifest = makeManifest();

    expect(validateUpstreamManifest(manifest)).toBe(manifest);
    expect(extractManifestFromVocabularyMetadata({ manifest })).toBe(manifest);
    expect(() =>
      extractManifestFromVocabularyMetadata({
        manifest: {
          ...manifest,
          files: [{ ...manifest.files[0], unexpected: true }],
        },
      }),
    ).toThrow('unexpected or missing fields');
    expect(() =>
      extractManifestFromVocabularyMetadata({
        manifest: { ...manifest, signatureSha256: 'f'.repeat(64) },
      }),
    ).toThrow('does not match the canonical payload');
    expect(() =>
      extractManifestFromVocabularyMetadata({ manifest: makeLegacyV1Manifest() }),
    ).toThrow('unexpected or missing fields');
  });

  it('rejects a v2 manifest for a repository other than the official BSI source', () => {
    const externalManifest = buildUpstreamManifest({
      repository: 'https://github.com/attacker/untrusted-catalog',
      snapshotCommitSha: HEAD_SNAPSHOT_SHA,
      files: [manifestFile()],
    });

    expect(() => validateUpstreamManifest(externalManifest)).toThrow(/official|BSI/i);
  });
});

describe('tracked manifest v2 contract', () => {
  it('rejects a tracked v1 manifest', async () => {
    const legacyManifest = makeLegacyV1Manifest();
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    await writeJson(manifestPath, legacyManifest);

    await expect(readTrackedManifest(manifestPath)).rejects.toThrow(
      'unexpected or missing fields',
    );
  });
});

describe('change summaries', () => {
  it('keeps file delta and data-quality findings in separate sections', () => {
    const manifest = makeManifest();
    const summary = buildChangeSummary(null, manifest, {
      fileDelta: [
        {
          status: 'added',
          path: 'Mappings/new.json',
          classification: 'unclassified',
        },
      ],
      dataQualityFindings: ['Alt-Identifier vollständig und eindeutig.'],
      controlIdentitySummary:
        '- **catalog-gspp**: 998 → 999 Controls (added: 1, removed: 0)',
    });

    expect(summary).toContain('### Datei-Delta');
    expect(summary).toContain('**added** (unclassified): `Mappings/new.json`');
    expect(summary).toContain('### Bekannte Datenqualitätsbefunde');
    expect(summary).toContain('- Alt-Identifier vollständig und eindeutig.');
    expect(summary).toContain('### Semantisches Control-Identitätsdelta');
    expect(summary).toContain('998 → 999 Controls');
  });

  it('rejects malformed or unsafe data-quality findings', () => {
    const manifest = makeManifest();

    expect(() =>
      buildChangeSummary(null, manifest, {
        dataQualityFindings: 'not-an-array' as never,
      }),
    ).toThrow('must be an array');
    expect(() =>
      buildChangeSummary(null, manifest, { dataQualityFindings: [''] }),
    ).toThrow('must contain a safe message');
    expect(() =>
      buildChangeSummary(null, manifest, {
        dataQualityFindings: [{ message: `unsafe${String.fromCharCode(0)}` }],
      }),
    ).toThrow('must contain a safe message');
    expect(() =>
      buildChangeSummary(null, manifest, { dataQualityFindings: [{}] }),
    ).toThrow('must contain a safe message');
  });
});

describe('hasManifestChanged', () => {
  it('detects missing and changed manifests by their canonical signature', () => {
    const manifest = makeManifest();
    const changedManifest = makeManifest({
      files: [manifestFile({ contentSha256: 'b'.repeat(64) })],
    });

    expect(hasManifestChanged(null, manifest)).toBe(true);
    expect(hasManifestChanged(manifest, manifest)).toBe(false);
    expect(hasManifestChanged(manifest, changedManifest)).toBe(true);
  });
});

describe('syncUpstreamManifest', () => {
  it('classifies previous and current registered paths across removals and renames', async () => {
    const removedPath =
      'implementation_layer/Legacy/removed-component_definition.json';
    const renamedPreviousPath =
      'implementation_layer/Legacy/renamed-component_definition.json';
    const renamedCurrentPath =
      'implementation_layer/Current/renamed-component_definition.json';
    const previousManifest = makeManifest({
      snapshotCommitSha: BASE_SNAPSHOT_SHA,
      files: [
        manifestFile({
          artifactKey: 'component-removed',
          rootType: 'component-definition',
          lifecycle: 'preview',
          path: removedPath,
          gitBlobSha: 'a'.repeat(40),
        }),
        manifestFile({
          artifactKey: 'component-renamed',
          rootType: 'component-definition',
          lifecycle: 'preview',
          path: renamedPreviousPath,
          gitBlobSha: 'b'.repeat(40),
        }),
      ],
    });
    const nextManifest = makeManifest({
      snapshotCommitSha: HEAD_SNAPSHOT_SHA,
      files: [
        manifestFile({
          artifactKey: 'component-renamed',
          rootType: 'component-definition',
          lifecycle: 'preview',
          path: renamedCurrentPath,
          gitBlobSha: 'c'.repeat(40),
        }),
      ],
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const responseTree = String(input).includes(BASE_SNAPSHOT_SHA)
        ? completeTree([
          blob(removedPath, 'a'.repeat(40)),
          blob(renamedPreviousPath, 'b'.repeat(40)),
        ])
        : completeTree([blob(renamedCurrentPath, 'c'.repeat(40))]);
      return new Response(JSON.stringify(responseTree), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await expect(
      buildFileDelta(previousManifest, nextManifest, { fetchImpl, token: '' }),
    ).resolves.toEqual([
      {
        status: 'added',
        path: renamedCurrentPath,
        classification: 'registered',
        artifactKey: 'component-renamed',
        rootType: 'component-definition',
        lifecycle: 'preview',
      },
      {
        status: 'removed',
        path: removedPath,
        classification: 'registered',
        artifactKey: 'component-removed',
        rootType: 'component-definition',
        lifecycle: 'preview',
      },
      {
        status: 'removed',
        path: renamedPreviousPath,
        classification: 'registered',
        artifactKey: 'component-renamed',
        rootType: 'component-definition',
        lifecycle: 'preview',
      },
    ]);
  });

  it('does not write or fetch trees when the canonical signature is unchanged', async () => {
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const metadataPath = path.join(tempDir, 'upstream-sources-metadata.json');
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    const manifest = makeManifest();
    const originalManifestText = JSON.stringify(manifest);
    const fetchImpl = vi.fn();

    await writeFile(manifestPath, originalManifestText, 'utf8');
    await writeJson(metadataPath, makeVocabularyMetadata(manifest));

    const result = await syncUpstreamManifest({
      metadataPath,
      manifestPath,
      fetchImpl,
      token: '',
    });

    expect(result.changed).toBe(false);
    expect(result.fileDelta).toEqual([]);
    expect(result.outputs.file_delta_summary).toBe('- Keine Dateiänderungen erkannt');
    expect(result.outputs.data_quality_summary).toBe(
      '- Keine bekannten Datenqualitätsbefunde',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await readFile(manifestPath, 'utf8')).toBe(originalManifestText);
  });

  it('reports added, modified, removed, and unclassified files from complete snapshot trees', async () => {
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const metadataPath = path.join(tempDir, 'upstream-sources-metadata.json');
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    const catalogPath = 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json';
    const addedCatalogPath =
      'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json';
    const removedProfilePath = 'control_layer/WLAN/sources/profiles/WLAN-profile.json';
    const unclassifiedModifiedPath =
      'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-catalog.json';
    const unclassifiedAddedPath = 'documentation/namespaces/security_targets_levels.csv';
    const oldCatalogBlob = 'a'.repeat(40);
    const newCatalogBlob = 'b'.repeat(40);
    const removedProfileBlob = 'c'.repeat(40);
    const addedCatalogBlob = 'd'.repeat(40);
    const oldUnclassifiedBlob = 'e'.repeat(40);
    const newUnclassifiedBlob = 'f'.repeat(40);
    const addedUnclassifiedBlob = '0'.repeat(40);
    const previousManifest = makeManifest({
      snapshotCommitSha: BASE_SNAPSHOT_SHA,
      files: [
        manifestFile({
          artifactKey: 'catalog-gspp-legacy',
          rootType: 'profile',
          lifecycle: 'preview',
          gitBlobSha: oldCatalogBlob,
        }),
        manifestFile({
          artifactKey: 'profile-wlan',
          rootType: 'profile',
          lifecycle: 'preview',
          path: removedProfilePath,
          gitBlobSha: removedProfileBlob,
          contentSha256: 'c'.repeat(64),
        }),
      ],
    });
    const nextManifest = makeManifest({
      snapshotCommitSha: HEAD_SNAPSHOT_SHA,
      files: [
        manifestFile({
          gitBlobSha: newCatalogBlob,
          contentSha256: 'b'.repeat(64),
        }),
        manifestFile({
          artifactKey: 'catalog-lieferkette',
          lifecycle: 'preview',
          path: addedCatalogPath,
          gitBlobSha: addedCatalogBlob,
          contentSha256: 'd'.repeat(64),
        }),
      ],
    });
    const baseTree = completeTree([
      directory('control_layer', '1'.repeat(40)),
      blob(catalogPath, oldCatalogBlob),
      blob(removedProfilePath, removedProfileBlob),
      blob(unclassifiedModifiedPath, oldUnclassifiedBlob),
      blob('README.md', '9'.repeat(40)),
    ]);
    const headTree = completeTree([
      directory('control_layer', '2'.repeat(40)),
      blob(catalogPath, newCatalogBlob),
      blob(addedCatalogPath, addedCatalogBlob),
      blob(unclassifiedModifiedPath, newUnclassifiedBlob),
      blob(unclassifiedAddedPath, addedUnclassifiedBlob),
      blob('README.md', '9'.repeat(40)),
    ]);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      const responseTree = url.includes(BASE_SNAPSHOT_SHA) ? baseTree : headTree;
      return new Response(JSON.stringify(responseTree), {
        headers: { 'Content-Type': 'application/json' },
      });
    });

    await writeJson(manifestPath, previousManifest);
    await writeJson(
      metadataPath,
      makeVocabularyMetadata(nextManifest, [
        'Alt-Identifier vollständig.',
        { message: 'Keine doppelten Alt-Identifier.' },
      ]),
    );

    const result = await syncUpstreamManifest({
      metadataPath,
      manifestPath,
      fetchImpl,
      token: '',
    });
    const persistedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    expect(result.changed).toBe(true);
    expect(result.fileDelta).toEqual([
      {
        status: 'modified',
        path: catalogPath,
        classification: 'registered',
        artifactKey: 'catalog-gspp',
        rootType: 'catalog',
        lifecycle: 'supported',
      },
      {
        status: 'modified',
        path: unclassifiedModifiedPath,
        classification: 'unclassified',
      },
      {
        status: 'added',
        path: addedCatalogPath,
        classification: 'registered',
        artifactKey: 'catalog-lieferkette',
        rootType: 'catalog',
        lifecycle: 'preview',
      },
      {
        status: 'removed',
        path: removedProfilePath,
        classification: 'registered',
        artifactKey: 'profile-wlan',
        rootType: 'profile',
        lifecycle: 'preview',
      },
      {
        status: 'added',
        path: unclassifiedAddedPath,
        classification: 'unclassified',
      },
    ]);
    expect(result.outputs.file_delta_summary).toContain(
      `**added** (unclassified): \`${unclassifiedAddedPath}\``,
    );
    expect(result.outputs.file_delta_summary).not.toContain('Alt-Identifier vollständig');
    expect(result.outputs.data_quality_summary).toBe(
      '- Alt-Identifier vollständig.\n- Keine doppelten Alt-Identifier.',
    );
    expect(result.outputs.data_quality_summary).not.toContain(catalogPath);
    expect(result.outputs.change_summary).toContain('### Datei-Delta');
    expect(result.outputs.change_summary).toContain(
      '### Bekannte Datenqualitätsbefunde',
    );
    expect(result.controlIdentityDelta).toBeNull();
    expect(result.outputs.control_identity_summary).toContain('nicht verfügbar');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.map(([input]) => String(input))).toEqual([
      `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/git/trees/${BASE_SNAPSHOT_SHA}?recursive=1`,
      `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/git/trees/${HEAD_SNAPSHOT_SHA}?recursive=1`,
      `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/git/blobs/${newCatalogBlob}`,
    ]);
    expect(persistedManifest).toEqual(nextManifest);
  });

  it('persists and reports the semantic control identity delta for changed catalogs', async () => {
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const metadataPath = path.join(tempDir, 'upstream-sources-metadata.json');
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    const controlIdentityDeltaPath = path.join(tempDir, 'control-identity-delta.json');
    const catalogPath = 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json';
    const previousDocument = Buffer.from(JSON.stringify({
      catalog: {
        groups: [{
          controls: [{
            id: 'TEST.1',
            title: 'Bestehend',
            props: [{ name: 'alt-identifier', value: 'alt-existing' }],
          }],
        }],
      },
    }), 'utf8');
    const nextDocument = Buffer.from(JSON.stringify({
      catalog: {
        groups: [{
          controls: [
            {
              id: 'TEST.1',
              title: 'Bestehend',
              props: [{ name: 'alt-identifier', value: 'alt-existing' }],
            },
            {
              id: 'TEST.2',
              title: 'Neu',
              props: [{ name: 'alt-identifier', value: 'alt-new' }],
            },
          ],
        }],
      },
    }), 'utf8');
    const previousBlob = gitBlobResponse(previousDocument);
    const nextBlob = gitBlobResponse(nextDocument);
    const previousManifest = makeManifest({
      snapshotCommitSha: BASE_SNAPSHOT_SHA,
      files: [manifestFile({
        gitBlobSha: previousBlob.sha,
        contentSha256: previousBlob.contentSha256,
      })],
    });
    const nextManifest = makeManifest({
      snapshotCommitSha: HEAD_SNAPSHOT_SHA,
      files: [manifestFile({
        gitBlobSha: nextBlob.sha,
        contentSha256: nextBlob.contentSha256,
      })],
    });
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/git/trees/')) {
        return new Response(JSON.stringify(completeTree([
          blob(
            catalogPath,
            url.includes(BASE_SNAPSHOT_SHA) ? previousBlob.sha : nextBlob.sha,
          ),
        ])), { headers: { 'Content-Type': 'application/json' } });
      }
      return url.endsWith(previousBlob.sha) ? previousBlob.response : nextBlob.response;
    });

    await writeJson(manifestPath, previousManifest);
    await writeJson(metadataPath, makeVocabularyMetadata(nextManifest));
    const result = await syncUpstreamManifest({
      metadataPath,
      manifestPath,
      controlIdentityDeltaPath,
      fetchImpl,
      token: '',
    });
    const persistedDelta = JSON.parse(await readFile(controlIdentityDeltaPath, 'utf8'));

    expect(result.changed).toBe(true);
    expect(result.controlIdentityDelta?.artifacts[0]).toMatchObject({
      artifactKey: 'catalog-gspp',
      previousControlCount: 1,
      nextControlCount: 2,
      counts: { added: 1 },
    });
    expect(persistedDelta).toEqual(result.controlIdentityDelta);
    expect(result.outputs.control_identity_summary).toContain('1 → 2 Controls');
    expect(result.outputs.change_summary).toContain(
      '### Semantisches Control-Identitätsdelta',
    );
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(nextManifest);
  });

  it('rejects v2 signature changes for an unchanged snapshot before writing', async () => {
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const metadataPath = path.join(tempDir, 'upstream-sources-metadata.json');
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    const previousManifest = makeManifest({
      snapshotCommitSha: HEAD_SNAPSHOT_SHA,
      files: [manifestFile({ contentSha256: 'a'.repeat(64) })],
    });
    const nextManifest = makeManifest({
      snapshotCommitSha: HEAD_SNAPSHOT_SHA,
      files: [manifestFile({ contentSha256: 'b'.repeat(64) })],
    });
    const fetchImpl = vi.fn();

    await writeJson(manifestPath, previousManifest);
    await writeJson(metadataPath, makeVocabularyMetadata(nextManifest));

    await expect(syncUpstreamManifest({
      metadataPath,
      manifestPath,
      fetchImpl,
      token: '',
    })).rejects.toThrow('unchanged snapshot');

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual(previousManifest);
  });

  it('rejects manifest and metadata paths outside the repo and temp roots', () => {
    expect(() => resolveTrackedManifestPath('/etc/upstream-manifest.json')).toThrow(
      'manifestPath must stay within an allowed working directory',
    );
    expect(() => resolveUpstreamMetadataPath('/etc/upstream-sources-metadata.json')).toThrow(
      'metadataPath must stay within an allowed working directory',
    );
  });
});
