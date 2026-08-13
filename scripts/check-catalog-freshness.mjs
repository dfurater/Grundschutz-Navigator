import {
  DEFAULT_TRACKED_MANIFEST_PATH,
  DEFAULT_UPSTREAM_METADATA_PATH,
  resolveTrackedManifestPath,
  resolveUpstreamMetadataPath,
} from './security-guards.mjs';
import {
  extractManifestFromVocabularyMetadata,
  hasManifestChanged,
  readJsonFile,
  readTrackedManifest,
} from './sync-upstream-manifest.mjs';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHORT_SHA_LENGTH = 12;
const FETCH_REMEDIATION = 'Führe `npm run fetch-catalog` aus.';

function isMissingFileError(error) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'ENOENT',
  );
}

function candidateSnapshotSha(metadata) {
  const candidate = metadata?.manifest?.snapshotCommitSha;
  return typeof candidate === 'string' && SHA_PATTERN.test(candidate)
    ? candidate
    : null;
}

function shortSha(value, fallback = 'unbekannt') {
  return typeof value === 'string' && value.length >= SHORT_SHA_LENGTH
    ? value.slice(0, SHORT_SHA_LENGTH)
    : fallback;
}

export async function checkCatalogFreshness({
  manifestPath = DEFAULT_TRACKED_MANIFEST_PATH,
  metadataPath = DEFAULT_UPSTREAM_METADATA_PATH,
} = {}) {
  const resolvedManifestPath = resolveTrackedManifestPath(manifestPath);
  const resolvedMetadataPath = resolveUpstreamMetadataPath(metadataPath);

  let expectedManifest;
  try {
    expectedManifest = await readTrackedManifest(resolvedManifestPath);
  } catch {
    return {
      state: 'malformed',
      source: 'tracked-manifest',
      expectedSnapshotSha: null,
      foundSnapshotSha: null,
      expectedSignatureSha256: null,
      foundSignatureSha256: null,
    };
  }

  if (!expectedManifest) {
    return {
      state: 'missing',
      source: 'tracked-manifest',
      expectedSnapshotSha: null,
      foundSnapshotSha: null,
      expectedSignatureSha256: null,
      foundSignatureSha256: null,
    };
  }

  let metadata;
  try {
    metadata = await readJsonFile(resolvedMetadataPath);
  } catch (error) {
    return {
      state: isMissingFileError(error) ? 'missing' : 'malformed',
      source: 'local-metadata',
      expectedSnapshotSha: expectedManifest.snapshotCommitSha,
      foundSnapshotSha: null,
      expectedSignatureSha256: expectedManifest.signatureSha256,
      foundSignatureSha256: null,
    };
  }

  let foundManifest;
  try {
    foundManifest = extractManifestFromVocabularyMetadata(metadata);
  } catch {
    return {
      state: 'malformed',
      source: 'local-metadata',
      expectedSnapshotSha: expectedManifest.snapshotCommitSha,
      foundSnapshotSha: candidateSnapshotSha(metadata),
      expectedSignatureSha256: expectedManifest.signatureSha256,
      foundSignatureSha256: null,
    };
  }

  const shared = {
    source: 'local-metadata',
    expectedSnapshotSha: expectedManifest.snapshotCommitSha,
    foundSnapshotSha: foundManifest.snapshotCommitSha,
    expectedSignatureSha256: expectedManifest.signatureSha256,
    foundSignatureSha256: foundManifest.signatureSha256,
  };

  return hasManifestChanged(expectedManifest, foundManifest)
    ? { state: 'stale', ...shared }
    : { state: 'fresh', ...shared };
}

export function formatCatalogFreshnessMessage(result) {
  if (result.state === 'fresh') {
    return `Lokale Katalogdaten entsprechen Snapshot ${shortSha(result.expectedSnapshotSha)}.`;
  }

  if (result.source === 'tracked-manifest') {
    return result.state === 'missing'
      ? 'Das eingecheckte `upstream-manifest.json` fehlt. Stelle den Repository-Zustand wieder her.'
      : 'Das eingecheckte `upstream-manifest.json` ist ungültig. Stelle den Repository-Zustand wieder her.';
  }

  const snapshots =
    `erwartet ${shortSha(result.expectedSnapshotSha)}, ` +
    `gefunden ${shortSha(result.foundSnapshotSha, result.state === 'missing' ? 'fehlt' : 'ungültig')}`;
  if (result.state === 'stale') {
    const signatures =
      `Manifest-Signatur erwartet ${shortSha(result.expectedSignatureSha256)}, ` +
      `gefunden ${shortSha(result.foundSignatureSha256)}.`;
    return `Lokale Katalogdaten weichen vom eingecheckten Manifest ab (${snapshots}). ${signatures} ${FETCH_REMEDIATION}`;
  }
  if (result.state === 'missing') {
    return `Lokale Katalog-Metadaten fehlen (${snapshots}). ${FETCH_REMEDIATION}`;
  }
  return `Lokale Katalog-Metadaten sind ungültig (${snapshots}). ${FETCH_REMEDIATION}`;
}

export async function assertCatalogFreshness(options) {
  const result = await checkCatalogFreshness(options);
  if (result.state !== 'fresh') {
    throw new Error(formatCatalogFreshnessMessage(result));
  }
  return result;
}

export function catalogFreshnessPlugin(options) {
  return {
    name: 'catalog-freshness-diagnostic',
    apply: 'serve',
    async configureServer(server) {
      const result = await checkCatalogFreshness(options);
      if (result.state !== 'fresh') {
        server.config.logger.warn(
          `\n[catalog-freshness] WARNUNG: ${formatCatalogFreshnessMessage(result)}\n`,
        );
      }
    },
  };
}

export default async function setupCatalogFreshness() {
  await assertCatalogFreshness();
}
