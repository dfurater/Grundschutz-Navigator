import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  resolveTrackedManifestPath,
  resolveUpstreamMetadataPath,
} from './security-guards.mjs';
import {
  buildChangeSummary,
  extractManifestFromVocabularyMetadata,
  hasManifestChanged,
  syncUpstreamManifest,
  validateUpstreamManifest,
} from './sync-upstream-manifest.mjs';

function makeManifest(signatureSha256 = 'abc123') {
  return {
    repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    snapshotCommitSha: 'commit-123',
    catalogPath: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
    files: [
      {
        kind: 'catalog',
        path: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
        gitBlobSha: 'blob-catalog',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/result.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv',
        gitBlobSha: 'blob-result',
      },
    ],
    signatureSha256,
  };
}

function makeVocabularyMetadata(manifest: ReturnType<typeof makeManifest>) {
  return {
    source: {
      repository: manifest.repository,
      catalogPath: manifest.catalogPath,
      snapshotCommitSha: manifest.snapshotCommitSha,
      snapshotCommitDate: '2026-04-02T00:00:00Z',
    },
    manifest,
    files: [],
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

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getAllowedTempRoot() {
  return process.env.RUNNER_TEMP ?? tmpdir();
}

describe('validateUpstreamManifest', () => {
  it('accepts a manifest with catalog and namespace files', () => {
    expect(validateUpstreamManifest(makeManifest())).toEqual(makeManifest());
  });

  it('rejects manifests without tracked files', () => {
    expect(() =>
      validateUpstreamManifest({
        ...makeManifest(),
        files: [],
      }),
    ).toThrow('Upstream manifest must include files');
  });
});

describe('extractManifestFromVocabularyMetadata', () => {
  it('returns the embedded manifest from vocabulary metadata', () => {
    expect(
      extractManifestFromVocabularyMetadata({
        manifest: makeManifest(),
      }),
    ).toEqual(makeManifest());
  });
});

describe('buildChangeSummary', () => {
  it('reports snapshot SHA change when previous manifest is null', () => {
    const summary = buildChangeSummary(null, makeManifest());
    expect(summary).toContain('none');
    expect(summary).toContain('commit-123');
  });

  it('reports no changes when manifests are identical', () => {
    const manifest = makeManifest();
    const summary = buildChangeSummary(manifest, manifest);
    expect(summary).toContain('Keine Dateiänderungen erkannt');
  });

  it('reports added file', () => {
    const prev = makeManifest();
    const next = {
      ...makeManifest(),
      files: [
        ...makeManifest().files,
        { kind: 'namespace', path: 'Dokumentation/namespaces/new.csv', gitBlobSha: 'blob-new' },
      ],
    };
    const summary = buildChangeSummary(prev, next);
    expect(summary).toContain('Neu');
    expect(summary).toContain('Dokumentation/namespaces/new.csv');
  });

  it('reports changed file when gitBlobSha differs', () => {
    const prev = makeManifest();
    const next = {
      ...makeManifest(),
      files: [
        { kind: 'catalog', path: prev.files[0].path, gitBlobSha: 'blob-catalog-updated' },
        ...makeManifest().files.slice(1),
      ],
    };
    const summary = buildChangeSummary(prev, next);
    expect(summary).toContain('Geändert');
    expect(summary).toContain(prev.files[0].path);
  });

  it('reports removed file', () => {
    const prev = {
      ...makeManifest(),
      files: [
        ...makeManifest().files,
        { kind: 'namespace', path: 'Dokumentation/namespaces/removed.csv', gitBlobSha: 'blob-removed' },
      ],
    };
    const summary = buildChangeSummary(prev, makeManifest());
    expect(summary).toContain('Entfernt');
    expect(summary).toContain('Dokumentation/namespaces/removed.csv');
  });
});

describe('hasManifestChanged', () => {
  it('detects the first generated manifest as a change', () => {
    expect(hasManifestChanged(null, makeManifest())).toBe(true);
  });

  it('uses the combined signature instead of single-file hashes', () => {
    expect(hasManifestChanged(makeManifest('same-signature'), makeManifest('same-signature'))).toBe(false);
    expect(hasManifestChanged(makeManifest('old-signature'), makeManifest('new-signature'))).toBe(true);
  });
});

describe('syncUpstreamManifest', () => {
  it('detects a changed embedded manifest and updates the tracked manifest afterwards', async () => {
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const metadataPath = path.join(tempDir, 'upstream-sources-metadata.json');
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    const previousManifest = makeManifest('old-signature');
    const nextManifest = {
      ...makeManifest('new-signature'),
      snapshotCommitSha: 'commit-456',
      files: [
        { ...makeManifest().files[0], gitBlobSha: 'blob-catalog-updated' },
        ...makeManifest().files.slice(1),
      ],
    };

    await writeJson(manifestPath, previousManifest);
    await writeJson(metadataPath, makeVocabularyMetadata(nextManifest));

    const result = await syncUpstreamManifest({ metadataPath, manifestPath });
    const persistedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    expect(result.changed).toBe(true);
    expect(result.previousManifest).toEqual(previousManifest);
    expect(result.nextManifest).toEqual(nextManifest);
    expect(result.outputs).toEqual({
      changed: 'true',
      local_signature: 'old-signature',
      remote_signature: 'new-signature',
      snapshot_commit_sha: 'commit-456',
      change_summary: expect.stringContaining('Snapshot'),
    });
    expect(persistedManifest).toEqual(nextManifest);
  });

  it('keeps the tracked manifest unchanged when the embedded manifest matches', async () => {
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const metadataPath = path.join(tempDir, 'upstream-sources-metadata.json');
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    const manifest = makeManifest('same-signature');

    await writeJson(manifestPath, manifest);
    await writeJson(metadataPath, makeVocabularyMetadata(manifest));

    const result = await syncUpstreamManifest({ metadataPath, manifestPath });
    const persistedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    expect(result.changed).toBe(false);
    expect(result.previousManifest).toEqual(manifest);
    expect(result.nextManifest).toEqual(manifest);
    expect(result.outputs).toEqual({
      changed: 'false',
      local_signature: 'same-signature',
      remote_signature: 'same-signature',
      snapshot_commit_sha: 'commit-123',
      change_summary: '- Keine Dateiänderungen erkannt',
    });
    expect(persistedManifest).toEqual(manifest);
  });

  it('treats the first embedded manifest as a change when no tracked manifest exists yet', async () => {
    const tempDir = await mkdtemp(path.join(getAllowedTempRoot(), 'sync-upstream-manifest-'));
    const metadataPath = path.join(tempDir, 'upstream-sources-metadata.json');
    const manifestPath = path.join(tempDir, 'upstream-manifest.json');
    const manifest = makeManifest('first-signature');

    await writeJson(metadataPath, makeVocabularyMetadata(manifest));

    const result = await syncUpstreamManifest({ metadataPath, manifestPath });
    const persistedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));

    expect(result.changed).toBe(true);
    expect(result.previousManifest).toBeNull();
    expect(result.nextManifest).toEqual(manifest);
    expect(result.outputs).toEqual({
      changed: 'true',
      local_signature: 'none',
      remote_signature: 'first-signature',
      snapshot_commit_sha: 'commit-123',
      change_summary: expect.stringContaining('Snapshot'),
    });
    expect(persistedManifest).toEqual(manifest);
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
