#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  OFFICIAL_BSI_REPO,
  OFFICIAL_BSI_REPOSITORY_URL,
  assertRegisteredUpstreamRepoPath,
} from './security-guards.mjs';
import {
  buildVocabularyNamespaceData,
  extractReferencedNamespaceUrls,
  materializeVocabularyCollectionMembers,
} from './vocabulary-utils.mjs';
import {
  analyzePracticeVocabularyIntegrity,
  analyzeTopicVocabularyCoverage,
  assertPracticeVocabularyIntegrity,
  assertTopicVocabularyCoverage,
} from './taxonomy-coverage.mjs';
import {
  MONITORED_UPSTREAM_ROOTS,
  SOURCE_REGISTRY,
  SUPPORTED_CATALOG,
  getArtifactByUpstreamPath,
} from '../src/domain/sourceRegistry.mjs';
import {
  computeManifestSignature as computeV2ManifestSignature,
  normalizeGitTree,
  validateManifestV2Shape,
} from './upstream-artifacts.mjs';
import {
  isApprovedLegacyV1Manifest,
} from './sync-upstream-manifest.mjs';
import {
  validateCatalogControlIdentities,
  validateFetchedOscalArtifact,
} from './fetch-catalog.mjs';

const execFileAsync = promisify(execFile);

export const TRACKED_MANIFEST_PATH = 'upstream-manifest.json';
export const SYNC_BRANCH_PATTERN = /^chore\/catalog-sync-([0-9a-f]{12})$/;
export const SYNC_TITLE_PREFIX = 'chore(ci): BSI-Katalog-Sync ';

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VOCABULARY_COLLECTION_MIGRATION = Object.freeze({
  snapshotCommitSha: '12abb438fcdb4f4b63fb3e751e89d7c526e647b5',
  previousSignatureSha256:
    '6de483f6e8d437b14cdbf834e127bf617cfe773ff0b290adef8cc26e094420da',
  nextSignatureSha256:
    'bd7db0913c960cf2b2a5d6410856eddeff6027045622a1f4241fbabc779fd624',
});

/**
 * Einmaliger Strukturübergang zur BSI-Layer-Architektur (BSI-PR #63, GRU-304).
 *
 * Anders als ein gewöhnlicher Snapshot-Wechsel ändert dieser Übergang zugleich
 * jeden registrierten Upstream-Pfad. Registry und gepinnter Snapshot müssen
 * deshalb im selben Commit umgestellt werden: Ein Sync-PR mit ausschließlich
 * upstream-manifest.json würde gegen die alte Registry geprüft, ein Code-PR
 * ohne Manifest-Update ließe den `validate`-Job mit dem alten Snapshot gegen
 * die neuen Pfade fetchen.
 *
 * Die Ausnahme ist an beide Signaturen gebunden und gilt damit für genau
 * diesen einen Übergang. Jeder andere PR, der das Manifest anfasst, muss den
 * vollständigen Sync-Lane-Vertrag erfüllen.
 */
const LAYER_STRUCTURE_MIGRATION = Object.freeze({
  previousSnapshotCommitSha: '12abb438fcdb4f4b63fb3e751e89d7c526e647b5',
  nextSnapshotCommitSha: 'cea4589c2b8337207772a88dd82d808cba5e1d89',
  previousSignatureSha256:
    'bd7db0913c960cf2b2a5d6410856eddeff6027045622a1f4241fbabc779fd624',
  nextSignatureSha256:
    '6f5d20990b3859f1b0a611aa1816bc638d1ed293823b84c4fa1cddb9b1c523d2',
});

/**
 * Einmaliger Registry- und Manifestübergang für die durch BSI ersetzten
 * AWS-Preview-Komponenten (GRU-308).
 *
 * Der Engineering-PR muss Registry und Manifest atomar ändern, kann deshalb
 * nicht die Manifest-only-Form der automatischen Sync-Lane verwenden. Die
 * Ausnahme ist an beide Snapshots und Signaturen sowie an Branch, Titel und
 * den exakten Datei-Scope gebunden; Tree-, Blob-, Hash-, Root-Type- und
 * Registry-Prüfungen bleiben vollständig aktiv.
 */
const AWS_COMPONENT_REPLACEMENT_MIGRATION = Object.freeze({
  branch: 'codex/gru-308-gru-305-sync-recovery',
  title: 'fix(sync): AWS-Registry und Werktagslauf aktualisieren (GRU-308, GRU-305)',
  diffEntries: Object.freeze([
    Object.freeze({ status: 'M', path: '.github/workflows/update-catalog.yml' }),
    Object.freeze({ status: 'M', path: 'scripts/catalog-sync-guard.mjs' }),
    Object.freeze({ status: 'M', path: 'scripts/catalog-sync-guard.test.ts' }),
    Object.freeze({ status: 'M', path: 'scripts/fetch-catalog.mjs' }),
    Object.freeze({ status: 'M', path: 'scripts/fetch-catalog.test.ts' }),
    Object.freeze({ status: 'M', path: 'scripts/sync-upstream-manifest.test.ts' }),
    Object.freeze({ status: 'A', path: 'scripts/update-catalog-workflow.test.ts' }),
    Object.freeze({ status: 'M', path: 'src/domain/sourceRegistry.mjs' }),
    Object.freeze({ status: 'M', path: 'src/domain/sourceRegistry.test.ts' }),
    Object.freeze({ status: 'M', path: TRACKED_MANIFEST_PATH }),
  ]),
  previousSnapshotCommitSha: 'cea4589c2b8337207772a88dd82d808cba5e1d89',
  nextSnapshotCommitSha: 'c1e53dcfbb5adc503964042a859f01ea721a4419',
  previousSignatureSha256:
    '6f5d20990b3859f1b0a611aa1816bc638d1ed293823b84c4fa1cddb9b1c523d2',
  nextSignatureSha256:
    '838464de3ae659d0278c4563aa926935790bfa23cb5fa2ccefc55fa9cb063195',
});

/**
 * Einmaliger Registry- und Manifestübergang für die durch BSI entfernte
 * WLAN- und neu veröffentlichte Keycloak-Preview-Komponente (GRU-319).
 *
 * Wie bei der AWS-Migration müssen Registry und Manifest atomar wechseln.
 * Die Ausnahme bleibt deshalb auf den exakten Engineering-PR sowie beide
 * Snapshots und Signaturen beschränkt.
 */
const WLAN_KEYCLOAK_COMPONENT_MIGRATION = Object.freeze({
  branch:
    'codex/gru-319-fixsync-upstream-delta-47de2824-mit-wlan-keycloak-registry',
  title:
    'fix(sync): Upstream-Delta 47de2824 mit WLAN-/Keycloak-Registry-Migration einspielen',
  diffEntries: Object.freeze([
    Object.freeze({ status: 'M', path: 'scripts/catalog-sync-guard.mjs' }),
    Object.freeze({ status: 'M', path: 'scripts/catalog-sync-guard.test.ts' }),
    Object.freeze({ status: 'M', path: 'src/domain/sourceRegistry.mjs' }),
    Object.freeze({ status: 'M', path: 'src/domain/sourceRegistry.test.ts' }),
    Object.freeze({ status: 'M', path: TRACKED_MANIFEST_PATH }),
  ]),
  previousSnapshotCommitSha: 'c1e53dcfbb5adc503964042a859f01ea721a4419',
  nextSnapshotCommitSha: '47de2824a341812438ef3f044b3f65ce2cad6e32',
  previousSignatureSha256:
    '838464de3ae659d0278c4563aa926935790bfa23cb5fa2ccefc55fa9cb063195',
  nextSignatureSha256:
    'fd9e5d887481466616451d315fbbf34bbf82aa5d95f2e12e5aa5dadd2a7bd80a',
});

export function computeManifestSignature(manifest) {
  return computeV2ManifestSignature(manifest);
}

export function validateCatalogSyncManifest(manifest) {
  validateManifestV2Shape(manifest);

  if (manifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
    throw new Error(`Manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
  }

  const exactRegistryFiles = new Map(
    SOURCE_REGISTRY
      .filter((entry) => entry.kind === 'oscal')
      .map((entry) => [entry.upstreamPath, entry]),
  );
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  const materializedNamespacePaths = manifest.files
    .filter((file) => file.rootType === 'vocabulary')
    .map((file) => file.path);

  for (const [repoPath, entry] of exactRegistryFiles) {
    if (!manifestPaths.has(repoPath)) {
      throw new Error(`Manifest is missing registered artifact: ${repoPath}`);
    }
    const file = manifest.files.find((candidate) => candidate.path === repoPath);
    if (
      file.artifactKey !== entry.artifactKey ||
      file.rootType !== entry.expectedRootType ||
      file.lifecycle !== entry.lifecycle
    ) {
      throw new Error(`Manifest registry metadata does not match sourceRegistry: ${repoPath}`);
    }
  }

  for (const file of manifest.files) {
    const registryEntry = getArtifactByUpstreamPath(file.path);
    if (!registryEntry) {
      throw new Error(`Manifest contains an unregistered path: ${file.path}`);
    }
    if (registryEntry.kind === 'vocabulary-collection') {
      if (
        file.artifactKey !== registryEntry.artifactKey ||
        file.rootType !== 'vocabulary' ||
        file.lifecycle !== registryEntry.lifecycle
      ) {
        throw new Error(`Manifest vocabulary metadata does not match sourceRegistry: ${file.path}`);
      }
    }
    assertRegisteredUpstreamRepoPath(file.path, { materializedNamespacePaths });
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

export function isApprovedLayerStructureMigration(
  previousManifest,
  nextManifest,
) {
  return (
    previousManifest?.snapshotCommitSha ===
      LAYER_STRUCTURE_MIGRATION.previousSnapshotCommitSha &&
    nextManifest?.snapshotCommitSha ===
      LAYER_STRUCTURE_MIGRATION.nextSnapshotCommitSha &&
    previousManifest?.signatureSha256 ===
      LAYER_STRUCTURE_MIGRATION.previousSignatureSha256 &&
    nextManifest?.signatureSha256 ===
      LAYER_STRUCTURE_MIGRATION.nextSignatureSha256
  );
}

export function isApprovedAwsComponentReplacementMigration(
  previousManifest,
  nextManifest,
) {
  return isApprovedPinnedManifestMigration(
    previousManifest,
    nextManifest,
    AWS_COMPONENT_REPLACEMENT_MIGRATION,
  );
}

function isApprovedPinnedManifestMigration(
  previousManifest,
  nextManifest,
  migration,
) {
  return (
    previousManifest?.snapshotCommitSha ===
      migration.previousSnapshotCommitSha &&
    nextManifest?.snapshotCommitSha ===
      migration.nextSnapshotCommitSha &&
    previousManifest?.signatureSha256 ===
      migration.previousSignatureSha256 &&
    nextManifest?.signatureSha256 ===
      migration.nextSignatureSha256
  );
}

export function isApprovedWlanKeycloakComponentMigration(
  previousManifest,
  nextManifest,
) {
  return isApprovedPinnedManifestMigration(
    previousManifest,
    nextManifest,
    WLAN_KEYCLOAK_COMPONENT_MIGRATION,
  );
}

export function isApprovedVocabularyCollectionMigration(
  previousManifest,
  nextManifest,
) {
  return (
    previousManifest?.snapshotCommitSha ===
      VOCABULARY_COLLECTION_MIGRATION.snapshotCommitSha &&
    nextManifest?.snapshotCommitSha ===
      VOCABULARY_COLLECTION_MIGRATION.snapshotCommitSha &&
    previousManifest?.signatureSha256 ===
      VOCABULARY_COLLECTION_MIGRATION.previousSignatureSha256 &&
    nextManifest?.signatureSha256 ===
      VOCABULARY_COLLECTION_MIGRATION.nextSignatureSha256
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

export function validateAwsComponentReplacementPullRequest({
  branch,
  title,
  diffEntries,
}) {
  validatePinnedEngineeringMigrationPullRequest(
    { branch, title, diffEntries },
    AWS_COMPONENT_REPLACEMENT_MIGRATION,
    'AWS component replacement',
  );
}

function validatePinnedEngineeringMigrationPullRequest(
  { branch, title, diffEntries },
  migration,
  label,
) {
  if (branch !== migration.branch) {
    throw new Error(
      `${label} branch must be exactly: ${migration.branch}`,
    );
  }
  if (title !== migration.title) {
    throw new Error(
      `${label} title must be exactly: ${migration.title}`,
    );
  }

  const expectedDiff = new Map(
    migration.diffEntries.map(({ path, status }) => [
      path,
      status,
    ]),
  );
  const actualDiff = new Map();
  for (const entry of diffEntries) {
    if (actualDiff.has(entry.path)) {
      throw new Error(`${label} file scope must match exactly`);
    }
    actualDiff.set(entry.path, entry.status);
  }
  const hasExactFileScope =
    actualDiff.size === expectedDiff.size &&
    [...expectedDiff].every(
      ([path, status]) => actualDiff.get(path) === status,
    );
  if (!hasExactFileScope) {
    throw new Error(`${label} file scope must match exactly`);
  }
}

export function validateWlanKeycloakComponentMigrationPullRequest({
  branch,
  title,
  diffEntries,
}) {
  validatePinnedEngineeringMigrationPullRequest(
    { branch, title, diffEntries },
    WLAN_KEYCLOAK_COMPONENT_MIGRATION,
    'WLAN/Keycloak component migration',
  );
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

function computeGitBlobSha(contents) {
  return createHash('sha1')
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest('hex');
}

export async function verifySnapshotFiles(manifest, {
  fetchImpl = fetch,
  token,
} = {}) {
  const apiBase = `https://api.github.com/repos/${OFFICIAL_BSI_REPO}`;
  const tree = await fetchGitHubJson(
    `${apiBase}/git/trees/${manifest.snapshotCommitSha}?recursive=1`,
    { fetchImpl, token, label: 'BSI snapshot tree lookup' },
  );
  const normalizedTree = normalizeGitTree(tree, { monitoredRoots: MONITORED_UPSTREAM_ROOTS });
  const blobShaByPath = new Map(normalizedTree.map((entry) => [entry.path, entry.gitBlobSha]));
  for (const file of manifest.files) {
    if (blobShaByPath.get(file.path) !== file.gitBlobSha) {
      throw new Error(`Manifest blob SHA does not match the BSI snapshot: ${file.path}`);
    }
  }

  const fetchAndValidateArtifact = async (file) => {
    const blob = await fetchGitHubJson(
      `${apiBase}/git/blobs/${file.gitBlobSha}`,
      { fetchImpl, token, label: `BSI artifact blob lookup (${file.path})` },
    );
    if (
      blob?.sha !== file.gitBlobSha ||
      blob?.encoding !== 'base64' ||
      typeof blob.content !== 'string'
    ) {
      throw new Error(`BSI artifact blob lookup returned invalid content: ${file.path}`);
    }

    const contents = Buffer.from(blob.content, 'base64');
    if (computeGitBlobSha(contents) !== file.gitBlobSha) {
      throw new Error(`BSI artifact content does not match its Git blob SHA: ${file.path}`);
    }
    const contentSha256 = createHash('sha256').update(contents).digest('hex');
    if (contentSha256 !== file.contentSha256) {
      throw new Error(`Manifest contentSha256 does not match the BSI artifact: ${file.path}`);
    }

    if (file.rootType === 'vocabulary') {
      return buildVocabularyNamespaceData({
        namespaceUrl: `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/${file.path}`,
        repository: OFFICIAL_BSI_REPO,
        path: file.path,
        gitBlobSha: file.gitBlobSha,
        csvText: contents.toString('utf8'),
      });
    }

    const artifact = validateFetchedOscalArtifact(contents, file.rootType);
    if (file.path === SUPPORTED_CATALOG.upstreamPath) {
      validateCatalogControlIdentities(artifact.json, file.artifactKey);
    }
    return artifact.json;
  };

  const catalogFile = manifest.files.find(
    (file) => file.path === SUPPORTED_CATALOG.upstreamPath,
  );
  if (!catalogFile) {
    throw new Error('Manifest does not contain the supported catalog document');
  }
  // Validate all catalog references before any vocabulary blob is requested,
  // then derive delivery membership from the registered direct directory.
  const catalogDocument = await fetchAndValidateArtifact(catalogFile);

  const referencedNamespaceUrls = extractReferencedNamespaceUrls(
    catalogDocument,
    OFFICIAL_BSI_REPO,
  );
  const vocabularyCollection = SOURCE_REGISTRY.find(
    (entry) => entry.kind === 'vocabulary-collection' && entry.lifecycle === 'supported',
  );
  if (!vocabularyCollection) {
    throw new Error('Source registry does not contain a supported vocabulary collection');
  }
  const expectedNamespacePaths = materializeVocabularyCollectionMembers({
    collection: vocabularyCollection,
    treeFiles: normalizedTree,
    referencedNamespaceUrls,
    repository: OFFICIAL_BSI_REPO,
  }).map((member) => member.path);

  const manifestNamespacePaths = manifest.files
    .filter((file) => file.rootType === 'vocabulary')
    .map((file) => file.path);
  if (JSON.stringify(manifestNamespacePaths) !== JSON.stringify(expectedNamespacePaths)) {
    throw new Error('Manifest namespace inventory does not match the registered direct CSV directory');
  }

  const validatedArtifacts = await Promise.all(
    manifest.files
      .filter((file) => file.path !== SUPPORTED_CATALOG.upstreamPath)
      .map(async (file) => ({
        file,
        artifact: await fetchAndValidateArtifact(file),
      })),
  );
  const practicesPath = `${vocabularyCollection.upstreamDirectory}/practices.csv`;
  const practicesNamespace = validatedArtifacts.find(
    ({ file }) => file.path === practicesPath,
  )?.artifact;
  const practiceIntegrity = practicesNamespace
    ? analyzePracticeVocabularyIntegrity(catalogDocument, practicesNamespace)
    : null;
  assertPracticeVocabularyIntegrity(
    manifest.snapshotCommitSha,
    practiceIntegrity,
  );
  const topicsPath = `${vocabularyCollection.upstreamDirectory}/topics.csv`;
  const topicsNamespace = validatedArtifacts.find(
    ({ file }) => file.path === topicsPath,
  )?.artifact;
  const topicCoverage = topicsNamespace
    ? analyzeTopicVocabularyCoverage(catalogDocument, topicsNamespace)
    : null;
  assertTopicVocabularyCoverage(
    manifest.snapshotCommitSha,
    topicCoverage,
  );
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

  const isVocabularyCollectionMigration =
    isApprovedVocabularyCollectionMigration(previousManifest, nextManifest);
  const isLayerStructureMigration =
    isApprovedLayerStructureMigration(previousManifest, nextManifest);
  const isAwsComponentReplacementMigration =
    isApprovedAwsComponentReplacementMigration(previousManifest, nextManifest);
  const isWlanKeycloakComponentMigration =
    isApprovedWlanKeycloakComponentMigration(previousManifest, nextManifest);
  const isPinnedStructuralMigration =
    isVocabularyCollectionMigration ||
    isLayerStructureMigration ||
    isAwsComponentReplacementMigration ||
    isWlanKeycloakComponentMigration;
  if (isAwsComponentReplacementMigration) {
    validateAwsComponentReplacementPullRequest({ branch, title, diffEntries });
  } else if (isWlanKeycloakComponentMigration) {
    validateWlanKeycloakComponentMigrationPullRequest({
      branch,
      title,
      diffEntries,
    });
  } else if (!isPinnedStructuralMigration) {
    validateCatalogSyncPullRequest({ branch, title, diffEntries });
  }
  const isLegacyMigration = isApprovedLegacyV1Manifest(previousManifest);
  if (!isLegacyMigration) {
    validateManifestV2Shape(previousManifest);
    if (previousManifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
      throw new Error(`Previous manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
    }
  }
  validateCatalogSyncManifest(nextManifest);
  const expectedBranch = `chore/catalog-sync-${nextManifest.snapshotCommitSha.slice(0, 12)}`;
  if (!isPinnedStructuralMigration && branch !== expectedBranch) {
    throw new Error(`Catalog sync branch must match the new snapshot: ${expectedBranch}`);
  }
  const isSameSnapshotLegacyMigration =
    isLegacyMigration &&
    previousManifest.snapshotCommitSha === nextManifest.snapshotCommitSha;
  if (isSameSnapshotLegacyMigration) {
    if (
      previousManifest.signatureSha256 === nextManifest.signatureSha256
    ) {
      throw new Error('Approved manifest v1 migration must deterministically replace the same pinned snapshot');
    }
  } else if (!isVocabularyCollectionMigration) {
    await verifySnapshotProgress(
      previousManifest.snapshotCommitSha,
      nextManifest.snapshotCommitSha,
      { fetchImpl, token },
    );
  }
  await verifySnapshotFiles(nextManifest, { fetchImpl, token });

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
