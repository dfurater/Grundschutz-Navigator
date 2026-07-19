#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  OFFICIAL_BSI_REPO,
  OFFICIAL_CATALOG_PATH,
  OFFICIAL_NAMESPACE_DIRECTORY,
  assertAllowedUpstreamRepoPath,
} from './security-guards.mjs';

const execFileAsync = promisify(execFile);

export const OFFICIAL_BSI_REPOSITORY_URL = `https://github.com/${OFFICIAL_BSI_REPO}`;
export const TRACKED_MANIFEST_PATH = 'upstream-manifest.json';
export const SYNC_BRANCH_PATTERN = /^chore\/catalog-sync-([0-9a-f]{12})$/;
export const SYNC_TITLE_PREFIX = 'chore(ci): BSI-Katalog-Sync ';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const TOP_LEVEL_KEYS = [
  'catalogPath',
  'files',
  'repository',
  'signatureSha256',
  'snapshotCommitSha',
];
const CATALOG_FILE_KEYS = ['gitBlobSha', 'kind', 'path'];
const NAMESPACE_FILE_KEYS = ['gitBlobSha', 'kind', 'namespace', 'path'];

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(sortedExpectedKeys)) {
    throw new Error(`${label} contains unexpected or missing fields`);
  }
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function computeManifestSignature(manifest) {
  const signaturePayload = {
    repository: manifest.repository,
    snapshotCommitSha: manifest.snapshotCommitSha,
    catalogPath: manifest.catalogPath,
    files: manifest.files,
  };

  return createHash('sha256')
    .update(JSON.stringify(signaturePayload))
    .digest('hex');
}

export function validateCatalogSyncManifest(manifest) {
  assertObject(manifest, 'Upstream manifest');
  assertExactKeys(manifest, TOP_LEVEL_KEYS, 'Upstream manifest');

  if (manifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
    throw new Error(`Manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
  }
  if (manifest.catalogPath !== OFFICIAL_CATALOG_PATH) {
    throw new Error(`Manifest catalogPath must be ${OFFICIAL_CATALOG_PATH}`);
  }
  if (!SHA_PATTERN.test(manifest.snapshotCommitSha)) {
    throw new Error('Manifest snapshotCommitSha must be a lowercase 40-character hexadecimal SHA');
  }
  if (!SHA256_PATTERN.test(manifest.signatureSha256)) {
    throw new Error('Manifest signatureSha256 must be a lowercase SHA-256 value');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Manifest files must be a non-empty array');
  }

  const seenPaths = new Set();
  const namespacePaths = [];
  let catalogCount = 0;

  for (const [index, file] of manifest.files.entries()) {
    assertObject(file, `Manifest file ${index}`);

    if (file.kind === 'catalog') {
      assertExactKeys(file, CATALOG_FILE_KEYS, `Manifest catalog file ${index}`);
      catalogCount += 1;
      if (index !== 0 || file.path !== OFFICIAL_CATALOG_PATH) {
        throw new Error('Manifest must contain the official catalog as its first file');
      }
    } else if (file.kind === 'namespace') {
      assertExactKeys(file, NAMESPACE_FILE_KEYS, `Manifest namespace file ${index}`);
      const namespacePrefix = `${OFFICIAL_NAMESPACE_DIRECTORY}/`;
      const namespaceFileName = file.path.startsWith(namespacePrefix)
        ? file.path.slice(namespacePrefix.length)
        : '';
      if (!namespaceFileName || namespaceFileName.includes('/') || !namespaceFileName.endsWith('.csv')) {
        throw new Error('Manifest namespace paths must be direct CSV files in Dokumentation/namespaces');
      }
      const expectedNamespace = `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/${file.path}`;
      if (file.namespace !== expectedNamespace) {
        throw new Error(`Manifest namespace URL must be ${expectedNamespace}`);
      }
      namespacePaths.push(file.path);
    } else {
      throw new Error(`Manifest file ${index} has unsupported kind`);
    }

    assertAllowedUpstreamRepoPath(file.path);
    if (!SHA_PATTERN.test(file.gitBlobSha)) {
      throw new Error(`Manifest file ${file.path} must include a lowercase 40-character blob SHA`);
    }
    if (seenPaths.has(file.path)) {
      throw new Error(`Manifest contains duplicate path: ${file.path}`);
    }
    seenPaths.add(file.path);
  }

  if (catalogCount !== 1) {
    throw new Error('Manifest must contain exactly one catalog file');
  }

  const sortedNamespacePaths = [...namespacePaths].sort((left, right) => left.localeCompare(right));
  if (JSON.stringify(namespacePaths) !== JSON.stringify(sortedNamespacePaths)) {
    throw new Error('Manifest namespace files must be sorted by path');
  }

  const expectedSignature = computeManifestSignature(manifest);
  if (manifest.signatureSha256 !== expectedSignature) {
    throw new Error('Manifest signatureSha256 does not match the canonical payload');
  }

  return manifest;
}

export function parseNameStatusDiff(diffOutput) {
  if (typeof diffOutput !== 'string' || diffOutput.length === 0) {
    return [];
  }

  return diffOutput
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf('\t');
      if (separatorIndex <= 0 || separatorIndex === line.length - 1) {
        throw new Error('PR diff contains an unparseable path entry');
      }
      return {
        status: line.slice(0, separatorIndex),
        path: line.slice(separatorIndex + 1),
      };
    });
}

export function isCatalogSyncCandidate({ branch, title, diffEntries }) {
  return (
    branch.startsWith('chore/catalog-sync-') ||
    title.startsWith(SYNC_TITLE_PREFIX) ||
    diffEntries.some((entry) => entry.path === TRACKED_MANIFEST_PATH)
  );
}

export function validateCatalogSyncPullRequest({ branch, title, diffEntries }) {
  const match = SYNC_BRANCH_PATTERN.exec(branch);
  if (!match) {
    throw new Error('Catalog sync branch must match chore/catalog-sync-<12 lowercase hex>');
  }

  const expectedTitle = `${SYNC_TITLE_PREFIX}${match[1]}`;
  if (title !== expectedTitle) {
    throw new Error(`Catalog sync PR title must be exactly: ${expectedTitle}`);
  }

  if (
    diffEntries.length !== 1 ||
    diffEntries[0].status !== 'M' ||
    diffEntries[0].path !== TRACKED_MANIFEST_PATH
  ) {
    throw new Error('Catalog sync PR must modify exactly upstream-manifest.json without add/delete/rename');
  }
}

async function fetchGitHubJson(url, { fetchImpl, token, label }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new Error(`${label} failed: ${error instanceof Error ? error.message : 'network error'}`);
  }

  if (!response.ok) {
    throw new Error(`${label} failed with HTTP ${response.status}`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
}

export async function verifySnapshotProgress(previousSha, nextSha, {
  fetchImpl = fetch,
  token,
} = {}) {
  if (!SHA_PATTERN.test(previousSha) || !SHA_PATTERN.test(nextSha)) {
    throw new Error('Snapshot comparison requires two lowercase 40-character SHAs');
  }

  const apiBase = `https://api.github.com/repos/${OFFICIAL_BSI_REPO}`;
  await fetchGitHubJson(`${apiBase}/commits/${nextSha}`, {
    fetchImpl,
    token,
    label: 'New BSI snapshot lookup',
  });

  const comparison = await fetchGitHubJson(`${apiBase}/compare/${previousSha}...${nextSha}`, {
    fetchImpl,
    token,
    label: 'BSI snapshot comparison',
  });

  if (comparison.status !== 'ahead') {
    throw new Error(`New BSI snapshot must be ahead of the tracked snapshot (status=${comparison.status ?? 'missing'})`);
  }

  return comparison;
}

export async function guardCatalogSyncPullRequest({
  branch,
  title,
  diffEntries,
  previousManifest,
  nextManifest,
  fetchImpl = fetch,
  token,
}) {
  if (!isCatalogSyncCandidate({ branch, title, diffEntries })) {
    return { catalogSync: false };
  }

  validateCatalogSyncPullRequest({ branch, title, diffEntries });
  validateCatalogSyncManifest(previousManifest);
  validateCatalogSyncManifest(nextManifest);
  const expectedBranch = `chore/catalog-sync-${nextManifest.snapshotCommitSha.slice(0, 12)}`;
  if (branch !== expectedBranch) {
    throw new Error(`Catalog sync branch must match the new snapshot: ${expectedBranch}`);
  }
  await verifySnapshotProgress(
    previousManifest.snapshotCommitSha,
    nextManifest.snapshotCommitSha,
    { fetchImpl, token },
  );

  return {
    catalogSync: true,
    snapshotCommitSha: nextManifest.snapshotCommitSha,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function runCli() {
  if (process.argv[2] === '--validate-manifest') {
    const manifestPath = process.argv[3];
    if (!manifestPath) {
      throw new Error('--validate-manifest requires a path');
    }
    validateCatalogSyncManifest(await readJson(manifestPath));
    console.log(`Validated catalog sync manifest: ${manifestPath}`);
    return;
  }

  const branch = process.env.PR_HEAD_REF ?? '';
  const title = process.env.PR_TITLE ?? '';
  const baseSha = process.env.PR_BASE_SHA ?? '';
  const headSha = process.env.PR_HEAD_SHA ?? '';
  if (!SHA_PATTERN.test(baseSha) || !SHA_PATTERN.test(headSha)) {
    throw new Error('PR_BASE_SHA and PR_HEAD_SHA must be lowercase 40-character SHAs');
  }

  const { stdout: diffOutput } = await execFileAsync(
    'git',
    ['diff', '--name-status', '--no-renames', baseSha, headSha],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  const diffEntries = parseNameStatusDiff(diffOutput);

  if (!isCatalogSyncCandidate({ branch, title, diffEntries })) {
    console.log('Normal PR: catalog sync guard passed without network access.');
    return;
  }

  const manifestStat = await lstat(TRACKED_MANIFEST_PATH);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error('upstream-manifest.json must be a regular file, not a symlink');
  }

  const { stdout: previousManifestText } = await execFileAsync(
    'git',
    ['show', `${baseSha}:${TRACKED_MANIFEST_PATH}`],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  const previousManifest = JSON.parse(previousManifestText);
  const nextManifest = await readJson(TRACKED_MANIFEST_PATH);
  const result = await guardCatalogSyncPullRequest({
    branch,
    title,
    diffEntries,
    previousManifest,
    nextManifest,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });

  console.log(`Catalog sync guard passed for snapshot ${result.snapshotCommitSha}.`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
