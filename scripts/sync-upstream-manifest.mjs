#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_TRACKED_MANIFEST_PATH,
  DEFAULT_UPSTREAM_METADATA_PATH,
  OFFICIAL_BSI_REPO,
  OFFICIAL_BSI_REPOSITORY_URL,
  OFFICIAL_CATALOG_PATH,
  resolveTrackedManifestPath,
  resolveUpstreamMetadataPath,
} from './security-guards.mjs';
import {
  MONITORED_UPSTREAM_ROOTS,
} from '../src/domain/sourceRegistry.mjs';
import {
  buildSnapshotTreeDelta,
  materializeRegisteredPathMap,
  validateManifestV2Shape,
} from './upstream-artifacts.mjs';

const DEFAULT_METADATA_PATH = DEFAULT_UPSTREAM_METADATA_PATH;
const DEFAULT_MANIFEST_PATH = DEFAULT_TRACKED_MANIFEST_PATH;
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export const LEGACY_V1_MIGRATION_SNAPSHOT = '12abb438fcdb4f4b63fb3e751e89d7c526e647b5';
export const LEGACY_V1_MIGRATION_SIGNATURE = '79bda3896eb6b0a07df3ba27ee8ef283b715962c1af9920f1a641829c693c7e2';

function toJsonWithTrailingNewline(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

export function isApprovedLegacyV1Manifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return false;
  const topLevelKeys = Object.keys(manifest).sort();
  if (JSON.stringify(topLevelKeys) !== JSON.stringify([
    'catalogPath',
    'files',
    'repository',
    'signatureSha256',
    'snapshotCommitSha',
  ])) return false;
  if (
    manifest.schemaVersion === undefined &&
    manifest.snapshotCommitSha === LEGACY_V1_MIGRATION_SNAPSHOT &&
    manifest.signatureSha256 === LEGACY_V1_MIGRATION_SIGNATURE &&
    manifest.repository === OFFICIAL_BSI_REPOSITORY_URL &&
    manifest.catalogPath === OFFICIAL_CATALOG_PATH &&
    Array.isArray(manifest.files) &&
    manifest.files.length > 0
  ) {
    const signaturePayload = {
      repository: manifest.repository,
      snapshotCommitSha: manifest.snapshotCommitSha,
      catalogPath: manifest.catalogPath,
      files: manifest.files,
    };
    const recomputedSignature = createHash('sha256')
      .update(JSON.stringify(signaturePayload))
      .digest('hex');
    return recomputedSignature === LEGACY_V1_MIGRATION_SIGNATURE;
  }
  return false;
}

export function validateUpstreamManifest(manifest) {
  const validated = validateManifestV2Shape(manifest);
  if (validated.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
    throw new Error(`Upstream manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
  }
  return validated;
}

export function extractManifestFromVocabularyMetadata(metadata) {
  assertObject(metadata, 'Vocabulary metadata');
  return validateUpstreamManifest(metadata.manifest);
}

export function hasManifestChanged(previousManifest, nextManifest) {
  if (!previousManifest) return true;
  return previousManifest.signatureSha256 !== nextManifest.signatureSha256;
}

export async function readJsonFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

export async function readTrackedManifest(filePath = DEFAULT_MANIFEST_PATH) {
  try {
    const manifest = await readJsonFile(filePath);
    if (isApprovedLegacyV1Manifest(manifest)) return manifest;
    return validateUpstreamManifest(manifest);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeTrackedManifest(manifest, filePath = DEFAULT_MANIFEST_PATH) {
  const resolvedManifestPath = resolveTrackedManifestPath(filePath);
  await mkdir(path.dirname(resolvedManifestPath), { recursive: true });
  await writeFile(resolvedManifestPath, toJsonWithTrailingNewline(validateUpstreamManifest(manifest)), 'utf8');
}

function formatFileDelta(fileDelta) {
  if (fileDelta.length === 0) return '- Keine Dateiänderungen erkannt';
  return fileDelta.map((entry) => {
    const classification = entry.classification === 'registered'
      ? `registriert: ${entry.artifactKey}`
      : 'unclassified';
    return `- **${entry.status}** (${classification}): \`${entry.path}\``;
  }).join('\n');
}

function normalizeDataQualityFindings(findings) {
  if (!Array.isArray(findings)) {
    throw new Error('dataQualityFindings must be an array');
  }
  return findings.map((finding, index) => {
    const value = typeof finding === 'string' ? finding : finding?.message;
    if (!isNonEmptyString(value) || /[\u0000-\u001f\u007f]/.test(value)) {
      throw new Error(`dataQualityFindings[${index}] must contain a safe message`);
    }
    return value;
  });
}

function formatDataQualityFindings(findings) {
  return findings.length === 0
    ? '- Keine bekannten Datenqualitätsbefunde'
    : findings.map((finding) => `- ${finding}`).join('\n');
}

export function buildChangeSummary(
  previousManifest,
  nextManifest,
  { fileDelta = [], dataQualityFindings = [] } = {},
) {
  const normalizedFindings = normalizeDataQualityFindings(dataQualityFindings);
  const migrationNote =
    previousManifest &&
    previousManifest.snapshotCommitSha === nextManifest.snapshotCommitSha &&
    previousManifest.signatureSha256 !== nextManifest.signatureSha256
      ? '\n- Manifest-Contract wurde für denselben Snapshot deterministisch aktualisiert.'
      : '';

  return [
    '### Datei-Delta',
    `${formatFileDelta(fileDelta)}${migrationNote}`,
    '',
    '### Bekannte Datenqualitätsbefunde',
    formatDataQualityFindings(normalizedFindings),
  ].join('\n');
}

async function fetchSnapshotTree(snapshotSha, { fetchImpl = fetch, token } = {}) {
  if (!SHA_PATTERN.test(snapshotSha)) {
    throw new Error('Tree lookup requires a lowercase 40-character snapshot SHA');
  }
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const url = `https://api.github.com/repos/${OFFICIAL_BSI_REPO}/git/trees/${snapshotSha}?recursive=1`;
  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (error) {
    throw new Error(`BSI snapshot tree lookup failed: ${error instanceof Error ? error.message : 'network error'}`);
  }
  if (!response.ok) {
    throw new Error(`BSI snapshot tree lookup failed with HTTP ${response.status}`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error('BSI snapshot tree lookup returned invalid JSON');
  }
}

function buildRegisteredPathMap(previousManifest, nextManifest) {
  const files = [
    ...(previousManifest?.schemaVersion === 2 ? previousManifest.files : []),
    ...nextManifest.files,
  ];
  const byPath = new Map();
  for (const file of files) byPath.set(file.path, file);
  return materializeRegisteredPathMap([...byPath.values()]);
}

export async function buildFileDelta(previousManifest, nextManifest, options = {}) {
  if (!previousManifest || previousManifest.snapshotCommitSha === nextManifest.snapshotCommitSha) {
    return [];
  }
  const [baseTree, headTree] = await Promise.all([
    fetchSnapshotTree(previousManifest.snapshotCommitSha, options),
    fetchSnapshotTree(nextManifest.snapshotCommitSha, options),
  ]);
  return buildSnapshotTreeDelta({
    baseTree,
    headTree,
    monitoredRoots: MONITORED_UPSTREAM_ROOTS,
    registeredPaths: buildRegisteredPathMap(previousManifest, nextManifest),
  });
}

export async function syncUpstreamManifest({
  metadataPath = DEFAULT_METADATA_PATH,
  manifestPath = DEFAULT_MANIFEST_PATH,
  fetchImpl = fetch,
  token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
} = {}) {
  const resolvedMetadataPath = resolveUpstreamMetadataPath(metadataPath);
  const resolvedManifestPath = resolveTrackedManifestPath(manifestPath);
  const metadata = await readJsonFile(resolvedMetadataPath);
  const nextManifest = extractManifestFromVocabularyMetadata(metadata);
  const previousManifest = await readTrackedManifest(resolvedManifestPath);
  const changed = hasManifestChanged(previousManifest, nextManifest);
  if (
    changed &&
    previousManifest &&
    previousManifest.snapshotCommitSha === nextManifest.snapshotCommitSha &&
    !isApprovedLegacyV1Manifest(previousManifest)
  ) {
    throw new Error(
      'A manifest v2 signature change for an unchanged snapshot is outside the automatic sync contract',
    );
  }
  const dataQualityFindings = normalizeDataQualityFindings(metadata.dataQualityFindings ?? []);
  const fileDelta = changed
    ? await buildFileDelta(previousManifest, nextManifest, { fetchImpl, token })
    : [];

  console.log(`Local signature:  ${previousManifest?.signatureSha256 ?? 'none'}`);
  console.log(`Remote signature: ${nextManifest.signatureSha256}`);

  if (changed) {
    await writeTrackedManifest(nextManifest, resolvedManifestPath);
    console.log('Upstream manifest changed.');
  } else {
    console.log('Upstream manifest unchanged.');
  }

  const isSameSnapshotManifestMigration = Boolean(
    isApprovedLegacyV1Manifest(previousManifest) &&
    previousManifest.snapshotCommitSha === nextManifest.snapshotCommitSha &&
    previousManifest.signatureSha256 !== nextManifest.signatureSha256,
  );
  const fileDeltaSummary = `${formatFileDelta(fileDelta)}${
    isSameSnapshotManifestMigration
      ? '\n- Manifest-Contract wurde für denselben Snapshot deterministisch aktualisiert.'
      : ''
  }`;
  const dataQualitySummary = formatDataQualityFindings(dataQualityFindings);
  const changeSummary = buildChangeSummary(previousManifest, nextManifest, {
    fileDelta,
    dataQualityFindings,
  });

  return {
    changed,
    previousManifest,
    nextManifest,
    fileDelta,
    dataQualityFindings,
    outputs: {
      changed: String(changed),
      local_signature: previousManifest?.signatureSha256 ?? 'none',
      remote_signature: nextManifest.signatureSha256,
      snapshot_commit_sha: nextManifest.snapshotCommitSha,
      file_delta_summary: fileDeltaSummary,
      data_quality_summary: dataQualitySummary,
      change_summary: changeSummary,
    },
  };
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  syncUpstreamManifest()
    .then((result) => {
      console.log(`SYNC_RESULT_JSON=${JSON.stringify(result.outputs)}`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
