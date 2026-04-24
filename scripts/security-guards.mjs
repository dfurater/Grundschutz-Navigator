import path from 'node:path';
import { tmpdir } from 'node:os';
import { posix as posixPath } from 'node:path';

export const REPO_ROOT = process.cwd();
export const OFFICIAL_BSI_REPO = 'BSI-Bund/Stand-der-Technik-Bibliothek';
export const OFFICIAL_CATALOG_PATH = 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json';
export const OFFICIAL_NAMESPACE_DIRECTORY = 'Dokumentation/namespaces';
export const DEFAULT_ARTIFACTS_DIR = path.join(REPO_ROOT, 'public', 'data');
export const DEFAULT_UPSTREAM_METADATA_PATH = path.join(DEFAULT_ARTIFACTS_DIR, 'upstream-sources-metadata.json');
export const DEFAULT_TRACKED_MANIFEST_PATH = path.join(REPO_ROOT, 'upstream-manifest.json');

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

export function assertAllowedUpstreamRepoPath(repoPath) {
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
  if (normalizedPosixPath !== normalized || segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throw new Error(`Unsafe upstream repository path: ${normalized}`);
  }

  if (normalizedPosixPath === OFFICIAL_CATALOG_PATH) {
    return normalizedPosixPath;
  }

  const namespacePrefix = `${OFFICIAL_NAMESPACE_DIRECTORY}/`;
  if (
    normalizedPosixPath.startsWith(namespacePrefix) &&
    normalizedPosixPath.endsWith('.csv')
  ) {
    return normalizedPosixPath;
  }

  throw new Error(`Upstream repository path is outside the allowed BSI contract: ${normalized}`);
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
