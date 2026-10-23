import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildCorpusCachePayload,
  corpusArtifactKeys,
  writeCorpusCache,
} from './upstream-corpus-cache.mjs';

function inspected(artifactKey, repoPath, text) {
  const buffer = Buffer.from(text, 'utf8');
  return {
    descriptor: { artifactKey, path: repoPath, gitBlobSha: 'b'.repeat(40) },
    rawFile: { buffer },
  };
}

function lineage(catalogKey, profileArtifactKey, sourceKeys) {
  return {
    catalogKey,
    profile: { artifactKey: profileArtifactKey },
    imports: sourceKeys.map((artifactKey, index) => ({
      index,
      state: artifactKey ? 'complete' : 'artifact-unregistered',
      source: artifactKey ? { artifactKey } : null,
    })),
  };
}

const LINEAGES = [
  lineage('gspp', 'profile-gspp', ['cat-a']),
  lineage('wlan', 'profile-wlan', ['cat-a']),
];

describe('corpusArtifactKeys', () => {
  it('vereint Profile, Importziele und Orakelkataloge dedupliziert und sortiert', () => {
    expect(corpusArtifactKeys(LINEAGES)).toEqual([
      'cat-a',
      'catalog-gspp',
      'catalog-wlan',
      'profile-gspp',
      'profile-wlan',
    ]);
  });

  it('übernimmt nur aufgelöste Importquellen', () => {
    expect(corpusArtifactKeys([lineage('lieferkette', 'profile-lieferkette', [null, 'cat-b'])])).toEqual([
      'cat-b',
      'catalog-lieferkette',
      'profile-lieferkette',
    ]);
  });
});

const inspectedArtifacts = [
  inspected('profile-gspp', 'p/gspp.json', '{"profile":1}'),
  inspected('cat-a', 'c/a.json', '{"catalog":"A"}'),
  inspected('catalog-wlan', 'c/wlan.json', '{"catalog":"WLAN"}'),
];

describe('buildCorpusCachePayload', () => {

  it('trägt exakte Rohbytes, SHA-256 und Größe je Datei', () => {
    const payload = buildCorpusCachePayload({
      inspectedArtifacts,
      lineages: LINEAGES,
      snapshotCommitSha: '9008ca0baecd958d175bbb994d6121865e266600'.slice(0, 40),
    });

    expect(payload.cacheManifest.files).toHaveLength(3);
    expect(payload.missingKeys.sort()).toEqual(['catalog-gspp', 'profile-wlan']);
    const wlan = payload.cacheManifest.files.find((file) => file.artifactKey === 'catalog-wlan');
    expect(wlan?.path).toBe('c/wlan.json');
    expect(wlan?.sizeBytes).toBe(Buffer.byteLength('{"catalog":"WLAN"}'));
    expect(wlan?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(wlan?.gitBlobSha).toMatch(/^[0-9a-f]{40}$/);

    const artifactForWlan = payload.artifacts.find((file) => file.fileName === 'catalog-wlan.json');
    expect(Buffer.from(artifactForWlan!.contentsBase64, 'base64').toString('utf8')).toBe(
      '{"catalog":"WLAN"}',
    );
  });

  it('meldet fehlende Artefakte als missingKeys statt zu werfen — die Korpus-Suite prüft hart', () => {
    const payload = buildCorpusCachePayload({
      inspectedArtifacts: inspectedArtifacts.slice(2),
      lineages: LINEAGES,
      snapshotCommitSha: '9008ca0baecd958d175bbb994d6121865e266600',
    });

    expect(payload.missingKeys.sort()).toEqual([
      'cat-a',
      'catalog-gspp',
      'profile-gspp',
      'profile-wlan',
    ]);
    expect(payload.cacheManifest.files.map((file) => file.artifactKey)).toEqual([
      'catalog-wlan',
    ]);
  });
});

describe('writeCorpusCache', () => {
  it('schreibt Dokumente und Begleitmanifest lesbar zurück', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'corpus-cache-'));
    try {
      const payload = buildCorpusCachePayload({
        inspectedArtifacts,
        lineages: LINEAGES,
        snapshotCommitSha: '9008ca0baecd958d175bbb994d6121865e266600',
      });
      await writeCorpusCache(payload, directory);

      const manifest = JSON.parse(await readFile(join(directory, 'corpus-manifest.json'), 'utf8'));
      expect(manifest.schemaVersion).toBe(1);
      expect(manifest.files).toHaveLength(3);
      await readFile(join(directory, 'profile-gspp.json'), 'utf8');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
