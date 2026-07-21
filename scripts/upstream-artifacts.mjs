import { createHash } from 'node:crypto';

export const UPSTREAM_MANIFEST_SCHEMA_VERSION = 2;

const GIT_SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const ARTIFACT_KEY_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const ARTIFACT_LIFECYCLES = new Set([
  'supported',
  'preview',
  'draft',
  'blocked-by-upstream',
]);
const MANIFEST_KEYS = [
  'files',
  'repository',
  'schemaVersion',
  'signatureSha256',
  'snapshotCommitSha',
];
const MANIFEST_FILE_KEYS = [
  'artifactKey',
  'contentSha256',
  'gitBlobSha',
  'lifecycle',
  'path',
  'rootType',
];

function comparePaths(left, right) {
  const leftCodePoints = Array.from(left, (character) => character.codePointAt(0));
  const rightCodePoints = Array.from(right, (character) => character.codePointAt(0));
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    if (leftCodePoints[index] < rightCodePoints[index]) return -1;
    if (leftCodePoints[index] > rightCodePoints[index]) return 1;
  }
  if (leftCodePoints.length < rightCodePoints.length) return -1;
  if (leftCodePoints.length > rightCodePoints.length) return 1;
  return 0;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort(comparePaths);
  const sortedExpectedKeys = [...expectedKeys].sort(comparePaths);
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
    throw new Error(`${label} contains unexpected or missing fields`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value;
}

function assertSafeRepoPath(value, label = 'Repository path') {
  const repoPath = assertNonEmptyString(value, label);
  if (
    repoPath.startsWith('/') ||
    repoPath.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(repoPath)
  ) {
    throw new Error(`${label} is unsafe: ${repoPath}`);
  }

  const segments = repoPath.split('/');
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === '.' || segment === '..',
    )
  ) {
    throw new Error(`${label} is unsafe: ${repoPath}`);
  }

  return repoPath;
}

function normalizeMonitoredRoots(monitoredRoots) {
  if (!Array.isArray(monitoredRoots) || monitoredRoots.length === 0) {
    throw new Error('monitoredRoots must be a non-empty array');
  }

  const roots = monitoredRoots.map((root, index) =>
    assertSafeRepoPath(root, `Monitored root ${index}`),
  );
  if (new Set(roots).size !== roots.length) {
    throw new Error('monitoredRoots must not contain duplicates');
  }
  return roots.sort(comparePaths);
}

function isInsideMonitoredRoot(repoPath, monitoredRoots) {
  return monitoredRoots.some(
    (root) => repoPath === root || repoPath.startsWith(`${root}/`),
  );
}

function normalizeRepositoryUrl(repository) {
  const value = assertNonEmptyString(repository, 'Manifest repository');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Manifest repository must be a valid URL');
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (
    url.protocol !== 'https:' ||
    url.host !== 'github.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    segments.length !== 2
  ) {
    throw new Error('Manifest repository must be an HTTPS GitHub repository URL');
  }

  return `https://github.com/${segments[0]}/${segments[1]}`;
}

function normalizeManifestFile(file, label) {
  assertObject(file, label);

  const artifactKey = assertNonEmptyString(file.artifactKey, `${label}.artifactKey`);
  if (!ARTIFACT_KEY_PATTERN.test(artifactKey)) {
    throw new Error(`${label}.artifactKey violates the key grammar`);
  }

  const rootType = assertNonEmptyString(file.rootType, `${label}.rootType`);
  const lifecycle = assertNonEmptyString(file.lifecycle, `${label}.lifecycle`);
  if (!ARTIFACT_LIFECYCLES.has(lifecycle)) {
    throw new Error(`${label}.lifecycle is unknown: ${lifecycle}`);
  }

  const repoPath = assertSafeRepoPath(file.path, `${label}.path`);
  if (!GIT_SHA_PATTERN.test(file.gitBlobSha ?? '')) {
    throw new Error(`${label}.gitBlobSha must be a lowercase 40-character Git SHA`);
  }
  if (!SHA256_PATTERN.test(file.contentSha256 ?? '')) {
    throw new Error(`${label}.contentSha256 must be a lowercase SHA-256 value`);
  }

  return {
    artifactKey,
    rootType,
    lifecycle,
    path: repoPath,
    gitBlobSha: file.gitBlobSha,
    contentSha256: file.contentSha256,
  };
}

function canonicalizeManifestFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('Manifest files must be a non-empty array');
  }

  const normalized = files.map((file, index) =>
    normalizeManifestFile(file, `Manifest file ${index}`),
  );
  const paths = new Set();
  for (const file of normalized) {
    if (paths.has(file.path)) {
      throw new Error(`Manifest contains duplicate path: ${file.path}`);
    }
    paths.add(file.path);
  }

  return normalized.sort((left, right) => comparePaths(left.path, right.path));
}

function buildSignaturePayload({ repository, snapshotCommitSha, files }) {
  return {
    schemaVersion: UPSTREAM_MANIFEST_SCHEMA_VERSION,
    repository: normalizeRepositoryUrl(repository),
    snapshotCommitSha,
    files: canonicalizeManifestFiles(files),
  };
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Normalizes the regular files below caller-supplied monitoring roots from a
 * complete GitHub recursive-tree response. No content is fetched here.
 */
export function normalizeGitTree(treeResponse, { monitoredRoots }) {
  assertObject(treeResponse, 'Upstream tree response');
  if (treeResponse.truncated !== false) {
    throw new Error('Upstream tree response is truncated or incomplete');
  }
  if (!Array.isArray(treeResponse.tree)) {
    throw new Error('Upstream tree response must include a tree array');
  }

  const roots = normalizeMonitoredRoots(monitoredRoots);
  const seenPaths = new Set();
  const files = [];

  for (const [index, entry] of treeResponse.tree.entries()) {
    assertObject(entry, `Upstream tree entry ${index}`);
    const repoPath = assertSafeRepoPath(entry.path, `Upstream tree entry ${index}.path`);
    if (seenPaths.has(repoPath)) {
      throw new Error(`Upstream tree contains duplicate path: ${repoPath}`);
    }
    seenPaths.add(repoPath);

    if (!GIT_SHA_PATTERN.test(entry.sha ?? '')) {
      throw new Error(`Upstream tree entry ${repoPath} has an invalid Git SHA`);
    }

    const monitored = isInsideMonitoredRoot(repoPath, roots);
    if (entry.type === 'tree' && entry.mode === '040000') {
      continue;
    }
    if (!monitored) {
      continue;
    }
    if (entry.type !== 'blob' || entry.mode !== '100644') {
      throw new Error(
        `Upstream tree entry ${repoPath} is not a regular file (type=${entry.type ?? 'missing'}, mode=${entry.mode ?? 'missing'})`,
      );
    }

    if (
      entry.size !== undefined &&
      (!Number.isSafeInteger(entry.size) || entry.size < 0)
    ) {
      throw new Error(`Upstream tree entry ${repoPath} has an invalid size`);
    }

    files.push({
      path: repoPath,
      gitBlobSha: entry.sha,
      sizeBytes: entry.size ?? null,
    });
  }

  return files.sort((left, right) => comparePaths(left.path, right.path));
}

/**
 * Creates the explicit path-to-registry projection used for delta
 * classification. Dynamic collections must be materialized by the caller.
 */
export function materializeRegisteredPathMap(entries) {
  if (!Array.isArray(entries)) {
    throw new Error('Registered path entries must be an array');
  }

  const registeredPaths = new Map();
  for (const [index, entry] of entries.entries()) {
    assertObject(entry, `Registered path entry ${index}`);
    const repoPath = assertSafeRepoPath(entry.path, `Registered path entry ${index}.path`);
    if (registeredPaths.has(repoPath)) {
      throw new Error(`Registered path map contains duplicate path: ${repoPath}`);
    }

    const artifactKey = assertNonEmptyString(
      entry.artifactKey,
      `Registered path entry ${index}.artifactKey`,
    );
    if (!ARTIFACT_KEY_PATTERN.test(artifactKey)) {
      throw new Error(`Registered path entry ${index}.artifactKey violates the key grammar`);
    }
    const rootType = assertNonEmptyString(
      entry.rootType,
      `Registered path entry ${index}.rootType`,
    );
    const lifecycle = assertNonEmptyString(
      entry.lifecycle,
      `Registered path entry ${index}.lifecycle`,
    );
    if (!ARTIFACT_LIFECYCLES.has(lifecycle)) {
      throw new Error(`Registered path entry ${index}.lifecycle is unknown: ${lifecycle}`);
    }

    registeredPaths.set(repoPath, { artifactKey, rootType, lifecycle });
  }

  return registeredPaths;
}

function validateRegisteredPathMap(registeredPaths) {
  if (!(registeredPaths instanceof Map)) {
    throw new Error('registeredPaths must be a Map created from explicit registry paths');
  }

  for (const [repoPath, entry] of registeredPaths) {
    assertSafeRepoPath(repoPath, 'Registered path map key');
    assertObject(entry, `Registered path map entry ${repoPath}`);

    const artifactKey = assertNonEmptyString(
      entry.artifactKey,
      `Registered path map entry ${repoPath}.artifactKey`,
    );
    if (!ARTIFACT_KEY_PATTERN.test(artifactKey)) {
      throw new Error(`Registered path map entry ${repoPath}.artifactKey violates the key grammar`);
    }
    assertNonEmptyString(entry.rootType, `Registered path map entry ${repoPath}.rootType`);
    if (!ARTIFACT_LIFECYCLES.has(entry.lifecycle)) {
      throw new Error(
        `Registered path map entry ${repoPath}.lifecycle is unknown: ${entry.lifecycle}`,
      );
    }
  }

  return registeredPaths;
}

function indexNormalizedTree(files, label) {
  if (!Array.isArray(files)) {
    throw new Error(`${label} must be an array`);
  }

  const indexed = new Map();
  for (const [index, file] of files.entries()) {
    assertObject(file, `${label} entry ${index}`);
    const repoPath = assertSafeRepoPath(file.path, `${label} entry ${index}.path`);
    if (!GIT_SHA_PATTERN.test(file.gitBlobSha ?? '')) {
      throw new Error(`${label} entry ${repoPath} has an invalid Git SHA`);
    }
    if (indexed.has(repoPath)) {
      throw new Error(`${label} contains duplicate path: ${repoPath}`);
    }
    indexed.set(repoPath, file.gitBlobSha);
  }
  return indexed;
}

function classifyDeltaEntry(status, repoPath, registeredPaths) {
  const registered = registeredPaths.get(repoPath);
  if (!registered) {
    return {
      status,
      path: repoPath,
      classification: 'unclassified',
    };
  }

  return {
    status,
    path: repoPath,
    classification: 'registered',
    artifactKey: registered.artifactKey,
    rootType: registered.rootType,
    lifecycle: registered.lifecycle,
  };
}

/**
 * Produces an added/modified/removed delta without reading any blob content.
 */
function buildNormalizedSnapshotDelta(previousFiles, nextFiles, registeredPaths) {
  validateRegisteredPathMap(registeredPaths);

  const previous = indexNormalizedTree(previousFiles, 'Previous tree files');
  const next = indexNormalizedTree(nextFiles, 'Next tree files');
  const paths = [...new Set([...previous.keys(), ...next.keys()])].sort(comparePaths);
  const delta = [];

  for (const repoPath of paths) {
    if (!previous.has(repoPath)) {
      delta.push(classifyDeltaEntry('added', repoPath, registeredPaths));
    } else if (!next.has(repoPath)) {
      delta.push(classifyDeltaEntry('removed', repoPath, registeredPaths));
    } else if (previous.get(repoPath) !== next.get(repoPath)) {
      delta.push(classifyDeltaEntry('modified', repoPath, registeredPaths));
    }
  }

  return delta;
}

export function buildSnapshotTreeDelta({
  baseTree,
  headTree,
  monitoredRoots,
  registeredPaths,
}) {
  const roots = normalizeMonitoredRoots(monitoredRoots);
  validateRegisteredPathMap(registeredPaths);
  for (const repoPath of registeredPaths.keys()) {
    if (!isInsideMonitoredRoot(repoPath, roots)) {
      throw new Error(`Registered path is outside monitored roots: ${repoPath}`);
    }
  }

  const baseFiles = normalizeGitTree(baseTree, { monitoredRoots: roots });
  const headFiles = normalizeGitTree(headTree, { monitoredRoots: roots });
  return buildNormalizedSnapshotDelta(baseFiles, headFiles, registeredPaths);
}

export function computeManifestSignature(manifest) {
  assertObject(manifest, 'Upstream manifest');
  if (!GIT_SHA_PATTERN.test(manifest.snapshotCommitSha ?? '')) {
    throw new Error('Manifest snapshotCommitSha must be a lowercase 40-character Git SHA');
  }

  const payload = buildSignaturePayload({
    repository: manifest.repository,
    snapshotCommitSha: manifest.snapshotCommitSha,
    files: manifest.files,
  });
  return sha256Hex(JSON.stringify(payload));
}

export function buildUpstreamManifest({ repository, snapshotCommitSha, files }) {
  if (!GIT_SHA_PATTERN.test(snapshotCommitSha ?? '')) {
    throw new Error('Manifest snapshotCommitSha must be a lowercase 40-character Git SHA');
  }

  const payload = buildSignaturePayload({ repository, snapshotCommitSha, files });
  return {
    ...payload,
    signatureSha256: sha256Hex(JSON.stringify(payload)),
  };
}

export function validateManifestV2Shape(manifest) {
  assertObject(manifest, 'Upstream manifest');
  assertExactKeys(manifest, MANIFEST_KEYS, 'Upstream manifest');
  if (manifest.schemaVersion !== UPSTREAM_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Upstream manifest schemaVersion must be ${UPSTREAM_MANIFEST_SCHEMA_VERSION}`,
    );
  }
  if (!GIT_SHA_PATTERN.test(manifest.snapshotCommitSha ?? '')) {
    throw new Error('Manifest snapshotCommitSha must be a lowercase 40-character Git SHA');
  }
  if (!SHA256_PATTERN.test(manifest.signatureSha256 ?? '')) {
    throw new Error('Manifest signatureSha256 must be a lowercase SHA-256 value');
  }
  if (!Array.isArray(manifest.files)) {
    throw new Error('Manifest files must be a non-empty array');
  }

  for (const [index, file] of manifest.files.entries()) {
    assertObject(file, `Manifest file ${index}`);
    assertExactKeys(file, MANIFEST_FILE_KEYS, `Manifest file ${index}`);
  }

  const canonicalFiles = canonicalizeManifestFiles(manifest.files);
  if (JSON.stringify(canonicalFiles) !== JSON.stringify(manifest.files)) {
    throw new Error('Manifest files must be in canonical path order');
  }

  const normalizedRepository = normalizeRepositoryUrl(manifest.repository);
  if (normalizedRepository !== manifest.repository) {
    throw new Error('Manifest repository URL must be canonical');
  }

  const expectedSignature = computeManifestSignature(manifest);
  if (manifest.signatureSha256 !== expectedSignature) {
    throw new Error('Manifest signatureSha256 does not match the canonical payload');
  }

  return manifest;
}
