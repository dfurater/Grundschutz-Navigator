#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  DEFAULT_TRACKED_MANIFEST_PATH,
  DEFAULT_UPSTREAM_METADATA_PATH,
  resolveTrackedManifestPath,
  resolveUpstreamMetadataPath,
} from './security-guards.mjs';

const DEFAULT_METADATA_PATH = DEFAULT_UPSTREAM_METADATA_PATH;
const DEFAULT_MANIFEST_PATH = DEFAULT_TRACKED_MANIFEST_PATH;

function toJsonWithTrailingNewline(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

export function validateUpstreamManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    throw new Error('Upstream manifest must be an object');
  }

  if (!isNonEmptyString(manifest.repository)) {
    throw new Error('Upstream manifest must include repository');
  }

  if (!isNonEmptyString(manifest.snapshotCommitSha)) {
    throw new Error('Upstream manifest must include snapshotCommitSha');
  }

  if (!isNonEmptyString(manifest.catalogPath)) {
    throw new Error('Upstream manifest must include catalogPath');
  }

  if (!isNonEmptyString(manifest.signatureSha256)) {
    throw new Error('Upstream manifest must include signatureSha256');
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Upstream manifest must include files');
  }

  for (const file of manifest.files) {
    if (!file || typeof file !== 'object') {
      throw new Error('Upstream manifest file entries must be objects');
    }

    if (!isNonEmptyString(file.kind)) {
      throw new Error('Upstream manifest file entry must include kind');
    }

    if (!isNonEmptyString(file.path)) {
      throw new Error('Upstream manifest file entry must include path');
    }

    if (!isNonEmptyString(file.gitBlobSha)) {
      throw new Error('Upstream manifest file entry must include gitBlobSha');
    }
  }

  return manifest;
}

export function extractManifestFromVocabularyMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Vocabulary metadata must be an object');
  }

  return validateUpstreamManifest(metadata.manifest);
}

export function hasManifestChanged(previousManifest, nextManifest) {
  if (!previousManifest) {
    return true;
  }

  return previousManifest.signatureSha256 !== nextManifest.signatureSha256;
}

export async function readJsonFile(filePath) {
  const text = await readFile(filePath, 'utf8');
  return JSON.parse(text);
}

export async function readTrackedManifest(filePath = DEFAULT_MANIFEST_PATH) {
  try {
    return validateUpstreamManifest(await readJsonFile(filePath));
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
  await writeFile(resolvedManifestPath, toJsonWithTrailingNewline(manifest), 'utf8');
}

export function buildChangeSummary(previousManifest, nextManifest) {
  const lines = [];

  const prevSha = previousManifest?.snapshotCommitSha;
  const nextSha = nextManifest.snapshotCommitSha;
  if (prevSha !== nextSha) {
    lines.push(`- **Snapshot**: \`${prevSha ?? 'none'}\` → \`${nextSha}\``);
  }

  const prevFiles = new Map((previousManifest?.files ?? []).map((f) => [f.path, f]));
  const nextFiles = new Map(nextManifest.files.map((f) => [f.path, f]));

  for (const path of nextFiles.keys()) {
    if (!prevFiles.has(path)) {
      lines.push(`- **Neu**: \`${path}\``);
    }
  }

  for (const [filePath, nextFile] of nextFiles) {
    const prevFile = prevFiles.get(filePath);
    if (prevFile && prevFile.gitBlobSha !== nextFile.gitBlobSha) {
      lines.push(`- **Geändert**: \`${filePath}\``);
    }
  }

  for (const filePath of prevFiles.keys()) {
    if (!nextFiles.has(filePath)) {
      lines.push(`- **Entfernt**: \`${filePath}\``);
    }
  }

  return lines.length > 0 ? lines.join('\n') : '- Keine Dateiänderungen erkannt';
}

export async function syncUpstreamManifest({
  metadataPath = DEFAULT_METADATA_PATH,
  manifestPath = DEFAULT_MANIFEST_PATH,
} = {}) {
  const resolvedMetadataPath = resolveUpstreamMetadataPath(metadataPath);
  const resolvedManifestPath = resolveTrackedManifestPath(manifestPath);
  const metadata = await readJsonFile(resolvedMetadataPath);
  const nextManifest = extractManifestFromVocabularyMetadata(metadata);
  const previousManifest = await readTrackedManifest(resolvedManifestPath);
  const changed = hasManifestChanged(previousManifest, nextManifest);

  console.log(`Local signature:  ${previousManifest?.signatureSha256 ?? 'none'}`);
  console.log(`Remote signature: ${nextManifest.signatureSha256}`);

  if (changed) {
    await writeTrackedManifest(nextManifest, resolvedManifestPath);
    console.log('Upstream manifest changed.');
  } else {
    console.log('Upstream manifest unchanged.');
  }

  const changeSummary = buildChangeSummary(previousManifest, nextManifest);

  return {
    changed,
    previousManifest,
    nextManifest,
    outputs: {
      changed: String(changed),
      local_signature: previousManifest?.signatureSha256 ?? 'none',
      remote_signature: nextManifest.signatureSha256,
      snapshot_commit_sha: nextManifest.snapshotCommitSha,
      change_summary: changeSummary,
    },
  };
}

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

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
