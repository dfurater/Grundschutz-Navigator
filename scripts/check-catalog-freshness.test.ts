import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import viteConfig from '../vite.config';
import {
  assertCatalogFreshness,
  catalogFreshnessPlugin,
  checkCatalogFreshness,
  formatCatalogFreshnessMessage,
} from './check-catalog-freshness.mjs';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';

const OFFICIAL_REPOSITORY =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek';
const EXPECTED_SHA = '1'.repeat(40);
const FOUND_SHA = '2'.repeat(40);

function getAllowedTempRoot() {
  return process.env.RUNNER_TEMP ?? tmpdir();
}

function makeManifest({
  snapshotCommitSha = EXPECTED_SHA,
  contentSha256 = 'a'.repeat(64),
} = {}) {
  return buildUpstreamManifest({
    repository: OFFICIAL_REPOSITORY,
    snapshotCommitSha,
    files: [
      {
        artifactKey: 'catalog-gspp',
        rootType: 'catalog',
        lifecycle: 'supported',
        path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
        gitBlobSha: 'a'.repeat(40),
        contentSha256,
      },
    ],
  });
}

async function makePaths() {
  const directory = await mkdtemp(path.join(getAllowedTempRoot(), 'catalog-freshness-'));
  return {
    manifestPath: path.join(directory, 'upstream-manifest.json'),
    metadataPath: path.join(directory, 'upstream-sources-metadata.json'),
  };
}

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeFreshPair(paths: Awaited<ReturnType<typeof makePaths>>) {
  const manifest = makeManifest();
  await writeJson(paths.manifestPath, manifest);
  await writeJson(paths.metadataPath, { manifest });
  return manifest;
}

describe('catalog freshness', () => {
  it('wires the blocking test setup and non-blocking development plugin', async () => {
    const config = typeof viteConfig === 'function'
      ? await viteConfig({
          command: 'serve',
          mode: 'test',
          isSsrBuild: false,
          isPreview: false,
        })
      : await viteConfig;

    expect(config.test?.globalSetup).toContain(
      './scripts/check-catalog-freshness.mjs',
    );
    expect(config.plugins?.flat().map((plugin) => plugin?.name)).toContain(
      'catalog-freshness-diagnostic',
    );
  });

  it('accepts the CI-style pair generated from the tracked snapshot', async () => {
    const paths = await makePaths();
    await writeFreshPair(paths);

    await expect(checkCatalogFreshness(paths)).resolves.toMatchObject({
      state: 'fresh',
      expectedSnapshotSha: EXPECTED_SHA,
      foundSnapshotSha: EXPECTED_SHA,
    });
    await expect(assertCatalogFreshness(paths)).resolves.toMatchObject({
      state: 'fresh',
    });
  });

  it('detects both newer snapshots and same-commit registry-contract drift', async () => {
    const paths = await makePaths();
    const expectedManifest = await writeFreshPair(paths);
    const newerManifest = makeManifest({ snapshotCommitSha: FOUND_SHA });
    await writeJson(paths.metadataPath, { manifest: newerManifest });

    await expect(checkCatalogFreshness(paths)).resolves.toMatchObject({
      state: 'stale',
      expectedSnapshotSha: EXPECTED_SHA,
      foundSnapshotSha: FOUND_SHA,
    });

    const changedContract = makeManifest({ contentSha256: 'b'.repeat(64) });
    await writeJson(paths.metadataPath, { manifest: changedContract });
    const contractDrift = await checkCatalogFreshness(paths);

    expect(contractDrift).toMatchObject({
      state: 'stale',
      expectedSnapshotSha: EXPECTED_SHA,
      foundSnapshotSha: EXPECTED_SHA,
      expectedSignatureSha256: expectedManifest.signatureSha256,
      foundSignatureSha256: changedContract.signatureSha256,
    });
  });

  it('distinguishes missing tracked manifests from missing local metadata', async () => {
    const missingTrackedPaths = await makePaths();
    await expect(checkCatalogFreshness(missingTrackedPaths)).resolves.toMatchObject({
      state: 'missing',
      source: 'tracked-manifest',
    });

    const missingMetadataPaths = await makePaths();
    await writeJson(missingMetadataPaths.manifestPath, makeManifest());
    await expect(checkCatalogFreshness(missingMetadataPaths)).resolves.toMatchObject({
      state: 'missing',
      source: 'local-metadata',
      expectedSnapshotSha: EXPECTED_SHA,
    });
  });

  it('distinguishes malformed tracked manifests from malformed local metadata', async () => {
    const malformedTrackedPaths = await makePaths();
    await writeFile(malformedTrackedPaths.manifestPath, '{broken', 'utf8');
    await expect(checkCatalogFreshness(malformedTrackedPaths)).resolves.toMatchObject({
      state: 'malformed',
      source: 'tracked-manifest',
    });

    const malformedMetadataPaths = await makePaths();
    await writeJson(malformedMetadataPaths.manifestPath, makeManifest());
    await writeJson(malformedMetadataPaths.metadataPath, { manifest: { invalid: true } });
    await expect(checkCatalogFreshness(malformedMetadataPaths)).resolves.toMatchObject({
      state: 'malformed',
      source: 'local-metadata',
      expectedSnapshotSha: EXPECTED_SHA,
    });
  });

  it('reports expected and found 12-character SHAs without catalog content', async () => {
    const paths = await makePaths();
    await writeJson(paths.manifestPath, makeManifest());
    await writeJson(paths.metadataPath, {
      manifest: makeManifest({ snapshotCommitSha: FOUND_SHA }),
    });
    const result = await checkCatalogFreshness(paths);
    const message = formatCatalogFreshnessMessage(result);

    expect(message).toContain(`erwartet ${EXPECTED_SHA.slice(0, 12)}`);
    expect(message).toContain(`gefunden ${FOUND_SHA.slice(0, 12)}`);
    expect(message).toContain('npm run fetch-catalog');
    expect(message).not.toContain('control_layer');
    await expect(assertCatalogFreshness(paths)).rejects.toThrow(message);
  });

  it('warns non-blockingly through the Vite development-server logger', async () => {
    const paths = await makePaths();
    await writeJson(paths.manifestPath, makeManifest());
    const warn = vi.fn();
    const plugin = catalogFreshnessPlugin(paths);

    await expect(plugin.configureServer({
      config: { logger: { warn } },
    } as never)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('npm run fetch-catalog'),
    );
  });
});
