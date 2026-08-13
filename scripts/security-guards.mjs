import path from 'node:path';
import { tmpdir } from 'node:os';
import { posix as posixPath } from 'node:path';
import {
  SUPPORTED_CATALOG,
  getArtifactByUpstreamPath,
  listArtifacts,
} from '../src/domain/sourceRegistry.mjs';

const supportedVocabularyCollection = listArtifacts({ lifecycle: 'supported' }).find(
  (entry) => entry.kind === 'vocabulary-collection',
);
if (!supportedVocabularyCollection) {
  throw new Error('Source registry must declare a supported vocabulary collection');
}

export const REPO_ROOT = process.cwd();
export const OFFICIAL_BSI_REPO = 'BSI-Bund/Stand-der-Technik-Bibliothek';
export const OFFICIAL_CATALOG_PATH = SUPPORTED_CATALOG.upstreamPath;
export const OFFICIAL_NAMESPACE_DIRECTORY = supportedVocabularyCollection.upstreamDirectory;
export const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'public', 'data');
export const DEFAULT_UPSTREAM_METADATA_PATH = path.join(DEFAULT_ARTIFACTS_DIR, 'upstream-sources-metadata.json');
export const DEFAULT_TRACKED_MANIFEST_PATH = path.join(REPO_ROOT, 'upstream-manifest.json');
export const OFFICIAL_BSI_REPOSITORY_URL = `https://github.com/${OFFICIAL_BSI_REPO}`;

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPathInsideRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function assertAllowedAbsolutePath(resolvedPath, {
  label,
  allowedRoots,
  expectedBaseNames,
  expectedNamePattern,
}) {
  if (
    Array.isArray(expectedBaseNames) &&
    expectedBaseNames.length > 0 &&
    !expectedBaseNames.includes(path.basename(resolvedPath))
  ) {
    throw new Error(`${label} must use one of these file names: ${expectedBaseNames.join(', ')}`);
  }

  if (expectedNamePattern && !expectedNamePattern.test(path.basename(resolvedPath))) {
    throw new Error(`${label} must use an allowed file name`);
  }

  const resolvedRoots = allowedRoots
    .filter(isNonEmptyString)
    .map((root) => path.resolve(root));

  if (resolvedRoots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    return resolvedPath;
  }

  throw new Error(`${label} must stay within an allowed working directory`);
}

/**
 * Liest einen Antwortkörper strombasiert und bricht ab, **sobald** das Limit
 * überschritten ist (GSPP-283, GSPP-324).
 *
 * `response.arrayBuffer()` würde die vollständige Antwort erst puffern und das
 * Limit danach prüfen — eine übergroße Antwort wäre dann bereits im Speicher.
 * Die Grenze wäre damit nur eine Nachkontrolle, kein Schutz vor
 * Speichererschöpfung auf dem Runner.
 *
 * Gemeinsame Implementierung für den Katalog-Fetch und den Schema-Wartungslauf;
 * beide Pfade dürfen sich nicht auseinanderentwickeln.
 *
 * @param {Response} response
 * @param {{maxBytes: number, label?: string, limitMessage?: string}} options
 * @returns {Promise<Buffer>}
 */
export async function readBodyWithLimit(response, {
  maxBytes,
  label = 'Antwort',
  limitMessage,
} = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`${label}: maxBytes muss eine positive ganze Zahl sein`);
  }

  const exceeded = () =>
    new Error(limitMessage ?? `${label} überschreitet das Limit von ${maxBytes} Bytes.`);

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // Kein Stream verfügbar: weiterhin begrenzen, aber ohne Frühabbruch.
    const buffered = Buffer.from(await response.arrayBuffer());
    if (buffered.length > maxBytes) {
      throw exceeded();
    }
    return buffered;
  }

  const reader = body.getReader();
  const chunks = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw exceeded();
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
}

export function resolveOptionalSnapshotSha(configuredValue = process.env.BSI_SNAPSHOT_SHA) {
  if (typeof configuredValue !== 'string') {
    return '';
  }

  const normalized = configuredValue.trim();
  if (normalized.length === 0) {
    return '';
  }

  if (!/^[0-9a-f]{40}$/i.test(normalized)) {
    throw new Error('BSI_SNAPSHOT_SHA must be a 40-character hexadecimal commit SHA');
  }

  return normalized.toLowerCase();
}

export function assertAllowedGitHubRef(ref, label = 'GitHub ref') {
  if (!isNonEmptyString(ref)) {
    throw new Error(`${label} must not be empty`);
  }

  const normalized = ref.trim();
  if (
    normalized.startsWith('/') ||
    normalized.endsWith('/') ||
    normalized.includes('..') ||
    normalized.includes('\\') ||
    !/^[A-Za-z0-9._/-]+$/.test(normalized)
  ) {
    throw new Error(`${label} contains unsafe characters`);
  }

  return normalized;
}

export function assertOfficialBsiRepository(repository, label = 'Upstream repository') {
  if (repository === OFFICIAL_BSI_REPO || repository === OFFICIAL_BSI_REPOSITORY_URL) {
    return OFFICIAL_BSI_REPO;
  }

  throw new Error(`${label} must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
}

export function buildOfficialBsiGitBlobApiUrl({ repository, gitBlobSha } = {}) {
  const officialRepository = assertOfficialBsiRepository(
    repository,
    'Git blob repository',
  );
  if (!/^[0-9a-f]{40}$/.test(gitBlobSha ?? '')) {
    throw new Error('gitBlobSha must be a lowercase 40-character Git SHA');
  }
  return `https://api.github.com/repos/${officialRepository}/git/blobs/${gitBlobSha}`;
}

function normalizeUpstreamRepoPath(repoPath) {
  if (!isNonEmptyString(repoPath)) {
    throw new Error('Upstream repository path must not be empty');
  }

  const normalized = repoPath.trim();
  if (
    normalized.startsWith('/') ||
    normalized.includes('\\') ||
    normalized.includes('..')
  ) {
    throw new Error(`Unsafe upstream repository path: ${normalized}`);
  }

  const normalizedPosixPath = posixPath.normalize(normalized);
  const segments = normalizedPosixPath.split('/');
  if (
    normalizedPosixPath !== normalized ||
    segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error(`Unsafe upstream repository path: ${normalized}`);
  }

  return normalizedPosixPath;
}

export function assertAllowedUpstreamRepoPath(repoPath) {
  const normalizedPosixPath = normalizeUpstreamRepoPath(repoPath);

  // Registry-getriebene Allowlist (ADR-1): Nur supported-Artefakte sind
  // fetchbar; preview/draft-Einträge bleiben bewusst ausgeschlossen.
  const registryEntry = getArtifactByUpstreamPath(normalizedPosixPath);
  if (registryEntry && registryEntry.lifecycle === 'supported') {
    return normalizedPosixPath;
  }

  throw new Error(`Upstream repository path is outside the allowed BSI contract: ${normalizedPosixPath}`);
}

/**
 * Inspection-only path guard for deterministic manifest validation. Unlike the
 * delivery allowlist this may admit preview/draft OSCAL artifacts, but dynamic
 * vocabulary members must first be materialized from the registered direct
 * namespace directory membership.
 */
export function assertRegisteredUpstreamRepoPath(repoPath, {
  materializedNamespacePaths = [],
} = {}) {
  const normalizedPath = normalizeUpstreamRepoPath(repoPath);
  const registryEntry = getArtifactByUpstreamPath(normalizedPath);

  if (registryEntry?.kind === 'oscal') {
    return normalizedPath;
  }

  if (
    registryEntry?.kind === 'vocabulary-collection' &&
    materializedNamespacePaths.includes(normalizedPath)
  ) {
    return normalizedPath;
  }

  throw new Error(`Upstream repository path is not a materialized registry artifact: ${normalizedPath}`);
}

export function resolveTrackedManifestPath(filePath = DEFAULT_TRACKED_MANIFEST_PATH, {
  repoRoot = REPO_ROOT,
  tempRoot = process.env.RUNNER_TEMP ?? tmpdir(),
  label = 'manifestPath',
} = {}) {
  if (!isNonEmptyString(filePath)) {
    throw new Error(`${label} must not be empty`);
  }

  return assertAllowedAbsolutePath(path.resolve(filePath.trim()), {
    label,
    allowedRoots: [repoRoot, tempRoot],
    expectedBaseNames: ['upstream-manifest.json'],
  });
}

export function resolveUpstreamMetadataPath(filePath = DEFAULT_UPSTREAM_METADATA_PATH, {
  repoRoot = REPO_ROOT,
  tempRoot = process.env.RUNNER_TEMP ?? tmpdir(),
  label = 'metadataPath',
} = {}) {
  if (!isNonEmptyString(filePath)) {
    throw new Error(`${label} must not be empty`);
  }

  return assertAllowedAbsolutePath(path.resolve(filePath.trim()), {
    label,
    allowedRoots: [repoRoot, tempRoot],
    expectedBaseNames: ['upstream-sources-metadata.json'],
  });
}
