import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  DEFAULT_ARTIFACTS_DIR,
  OFFICIAL_BSI_REPO,
  OFFICIAL_BSI_REPOSITORY_URL,
  REPO_ROOT,
  readBodyWithLimit,
} from './security-guards.mjs';
import { validateManifestV2Shape } from './upstream-artifacts.mjs';

export const DEFAULT_CONTROL_IDENTITY_DELTA_PATH = path.join(
  DEFAULT_ARTIFACTS_DIR,
  'control-identity-delta.json',
);

const GITHUB_BLOB_RESPONSE_LIMIT_BYTES = 32 * 1024 * 1024;
const CLASSIFICATIONS = [
  'added',
  'removed',
  'moved',
  'id-rebound',
  'identifier-changed',
  'ambiguous',
];

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value;
}

function readRequiredString(value, label) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function isPathInsideRoot(targetPath, rootPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function resolveControlIdentityDeltaPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim().length === 0) {
    throw new Error('controlIdentityDeltaPath must not be empty');
  }
  const resolvedPath = path.resolve(filePath.trim());
  if (path.basename(resolvedPath) !== 'control-identity-delta.json') {
    throw new Error('controlIdentityDeltaPath must use control-identity-delta.json');
  }
  const allowedRoots = [REPO_ROOT, process.env.RUNNER_TEMP ?? tmpdir()].map((root) =>
    path.resolve(root),
  );
  if (!allowedRoots.some((root) => isPathInsideRoot(resolvedPath, root))) {
    throw new Error('controlIdentityDeltaPath must stay within an allowed working directory');
  }
  return resolvedPath;
}

function readAltIdentifier(control) {
  const props = readArray(control.props, 'Control props');
  const values = props
    .filter((prop) => prop?.name === 'alt-identifier')
    .map((prop) => typeof prop?.value === 'string' ? prop.value.trim() : '')
    .filter(Boolean);
  return values.length === 1 ? values[0] : null;
}

function collectControls(catalogDocument, label) {
  const document = assertObject(catalogDocument, label);
  const catalog = assertObject(document.catalog, `${label}.catalog`);
  const controls = [];

  function visitContainer(container, containerLabel) {
    for (const [index, candidate] of readArray(
      container.controls,
      `${containerLabel}.controls`,
    ).entries()) {
      const control = assertObject(candidate, `${containerLabel}.controls[${index}]`);
      controls.push({
        index: controls.length,
        controlId: readRequiredString(control.id, `${containerLabel}.controls[${index}].id`),
        altIdentifier: readAltIdentifier(control),
        title: readRequiredString(
          control.title,
          `${containerLabel}.controls[${index}].title`,
        ),
      });
      visitContainer(control, `${containerLabel}.controls[${index}]`);
    }

    for (const [index, candidate] of readArray(
      container.groups,
      `${containerLabel}.groups`,
    ).entries()) {
      const group = assertObject(candidate, `${containerLabel}.groups[${index}]`);
      visitContainer(group, `${containerLabel}.groups[${index}]`);
    }
  }

  visitContainer(catalog, `${label}.catalog`);
  return controls;
}

function groupBy(records, key) {
  const groups = new Map();
  for (const record of records) {
    const value = record[key];
    if (value === null) continue;
    const group = groups.get(value) ?? [];
    group.push(record);
    groups.set(value, group);
  }
  return groups;
}

function makeEntry({
  classification,
  artifactKey,
  previousSnapshotSha,
  nextSnapshotSha,
  previous = null,
  next = null,
  evidence = null,
}) {
  return {
    classification,
    artifactKey,
    previousSnapshotSha,
    nextSnapshotSha,
    oldControlId: previous?.controlId ?? null,
    newControlId: next?.controlId ?? null,
    oldAltIdentifier: previous?.altIdentifier ?? null,
    newAltIdentifier: next?.altIdentifier ?? null,
    title: next?.title ?? previous?.title ?? '',
    evidence,
  };
}

function createCounts(entries) {
  return Object.fromEntries(CLASSIFICATIONS.map((classification) => [
    classification,
    entries.filter((entry) => entry.classification === classification).length,
  ]));
}

function sortEntries(entries) {
  const order = new Map(CLASSIFICATIONS.map((classification, index) => [classification, index]));
  return entries.sort((left, right) =>
    order.get(left.classification) - order.get(right.classification) ||
    (left.oldControlId ?? '').localeCompare(right.oldControlId ?? '') ||
    (left.newControlId ?? '').localeCompare(right.newControlId ?? '') ||
    left.title.localeCompare(right.title),
  );
}

export function compareCatalogControlIdentities({
  artifactKey,
  previousSnapshotSha,
  nextSnapshotSha,
  previousCatalog,
  nextCatalog,
}) {
  const previousControls = collectControls(previousCatalog, 'Previous catalog');
  const nextControls = collectControls(nextCatalog, 'Next catalog');
  const context = { artifactKey, previousSnapshotSha, nextSnapshotSha };
  const entries = [];
  const handledPrevious = new Set();
  const handledNext = new Set();
  const previousBaseClass = new Map();
  const nextBaseClass = new Map();
  const previousByAlt = groupBy(previousControls, 'altIdentifier');
  const nextByAlt = groupBy(nextControls, 'altIdentifier');

  function markAmbiguous(records, side, kind) {
    for (const record of records) {
      const handled = side === 'previous' ? handledPrevious : handledNext;
      if (handled.has(record.index)) continue;
      handled.add(record.index);
      (side === 'previous' ? previousBaseClass : nextBaseClass)
        .set(record.index, 'ambiguous');
      entries.push(makeEntry({
        ...context,
        classification: 'ambiguous',
        previous: side === 'previous' ? record : null,
        next: side === 'next' ? record : null,
        evidence: { kind, cryptographicallyProven: false },
      }));
    }
  }

  markAmbiguous(
    previousControls.filter((control) => control.altIdentifier === null),
    'previous',
    'missing-alt-identifier',
  );
  markAmbiguous(
    nextControls.filter((control) => control.altIdentifier === null),
    'next',
    'missing-alt-identifier',
  );
  for (const records of previousByAlt.values()) {
    if (records.length > 1) markAmbiguous(records, 'previous', 'duplicate-alt-identifier');
  }
  for (const records of nextByAlt.values()) {
    if (records.length > 1) markAmbiguous(records, 'next', 'duplicate-alt-identifier');
  }

  for (const [altIdentifier, previousMatches] of previousByAlt) {
    const nextMatches = nextByAlt.get(altIdentifier);
    if (previousMatches.length !== 1 || nextMatches?.length !== 1) continue;
    const previous = previousMatches[0];
    const next = nextMatches[0];
    handledPrevious.add(previous.index);
    handledNext.add(next.index);
    previousBaseClass.set(previous.index, 'alt-identifier-match');
    nextBaseClass.set(next.index, 'alt-identifier-match');
    if (previous.controlId !== next.controlId) {
      entries.push(makeEntry({
        ...context,
        classification: 'moved',
        previous,
        next,
        evidence: { kind: 'alt-identifier-equality', cryptographicallyProven: true },
      }));
    }
  }

  const unmatchedPrevious = previousControls.filter(
    (control) => !handledPrevious.has(control.index),
  );
  const unmatchedNext = nextControls.filter((control) => !handledNext.has(control.index));
  const previousByTitle = groupBy(unmatchedPrevious, 'title');
  const nextByTitle = groupBy(unmatchedNext, 'title');
  const allPreviousByTitle = groupBy(previousControls, 'title');
  const allNextByTitle = groupBy(nextControls, 'title');

  for (const [title, previousMatches] of previousByTitle) {
    const nextMatches = nextByTitle.get(title);
    if (!nextMatches) continue;
    if (
      allPreviousByTitle.get(title)?.length === 1 &&
      allNextByTitle.get(title)?.length === 1
    ) {
      const previous = previousMatches[0];
      const next = nextMatches[0];
      handledPrevious.add(previous.index);
      handledNext.add(next.index);
      previousBaseClass.set(previous.index, 'identifier-changed');
      nextBaseClass.set(next.index, 'identifier-changed');
      entries.push(makeEntry({
        ...context,
        classification: 'identifier-changed',
        previous,
        next,
        evidence: { kind: 'title-equality', cryptographicallyProven: false },
      }));
      continue;
    }
    markAmbiguous(previousMatches, 'previous', 'repeated-title-candidate');
    markAmbiguous(nextMatches, 'next', 'repeated-title-candidate');
  }

  for (const previous of previousControls) {
    if (handledPrevious.has(previous.index)) continue;
    handledPrevious.add(previous.index);
    previousBaseClass.set(previous.index, 'removed');
    entries.push(makeEntry({ ...context, classification: 'removed', previous }));
  }
  for (const next of nextControls) {
    if (handledNext.has(next.index)) continue;
    handledNext.add(next.index);
    nextBaseClass.set(next.index, 'added');
    entries.push(makeEntry({ ...context, classification: 'added', next }));
  }

  const previousById = groupBy(previousControls, 'controlId');
  const nextById = groupBy(nextControls, 'controlId');
  for (const [controlId, previousMatches] of previousById) {
    const nextMatches = nextById.get(controlId);
    if (previousMatches.length !== 1 || nextMatches?.length !== 1) continue;
    const previous = previousMatches[0];
    const next = nextMatches[0];
    const oldClassification = previousBaseClass.get(previous.index);
    const newClassification = nextBaseClass.get(next.index);
    // A shifted sequence reuses several numeric IDs incidentally. Once both
    // sides are already paired by stable alt-identifier or unique title, that
    // is not an additional rebound. Only a newly introduced, otherwise
    // unpaired identity occupying an old ID gets this overlapping diagnostic.
    if (
      previous.altIdentifier !== null &&
      next.altIdentifier !== null &&
      previous.altIdentifier !== next.altIdentifier &&
      newClassification === 'added' &&
      (oldClassification === 'removed' || oldClassification === 'identifier-changed')
    ) {
      entries.push(makeEntry({
        ...context,
        classification: 'id-rebound',
        previous,
        next,
        evidence: { kind: 'control-id-reuse', cryptographicallyProven: false },
      }));
    }
  }

  const sortedEntries = sortEntries(entries);
  return {
    artifactKey,
    previousSnapshotSha,
    nextSnapshotSha,
    previousControlCount: previousControls.length,
    nextControlCount: nextControls.length,
    counts: createCounts(sortedEntries),
    entries: sortedEntries,
  };
}

function gitBlobSha(buffer) {
  return createHash('sha1')
    .update(Buffer.from(`blob ${buffer.length}\0`, 'utf8'))
    .update(buffer)
    .digest('hex');
}

function parseBase64(value, label) {
  if (typeof value !== 'string') throw new Error(`${label} is not base64 text`);
  const compact = value.replace(/[\r\n]/g, '');
  if (
    compact.length === 0 ||
    compact.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact)
  ) {
    throw new Error(`${label} is not canonical base64`);
  }
  const decoded = Buffer.from(compact, 'base64');
  if (decoded.toString('base64') !== compact) {
    throw new Error(`${label} is not canonical base64`);
  }
  return decoded;
}

async function fetchCatalogBlob(file, { fetchImpl, token }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const url = `https://api.github.com/repos/${OFFICIAL_BSI_REPO}/git/blobs/${file.gitBlobSha}`;
  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch {
    throw new Error(`Catalog blob lookup failed for ${file.artifactKey}`);
  }
  if (!response.ok) {
    throw new Error(`Catalog blob lookup failed for ${file.artifactKey} with HTTP ${response.status}`);
  }
  const responseBuffer = await readBodyWithLimit(response, {
    maxBytes: GITHUB_BLOB_RESPONSE_LIMIT_BYTES,
    label: `Catalog blob response for ${file.artifactKey}`,
  });
  let payload;
  try {
    payload = JSON.parse(responseBuffer.toString('utf8'));
  } catch {
    throw new Error(`Catalog blob lookup returned invalid JSON for ${file.artifactKey}`);
  }
  assertObject(payload, `Catalog blob response for ${file.artifactKey}`);
  if (payload.sha !== file.gitBlobSha) {
    throw new Error(`Catalog blob SHA mismatch for ${file.artifactKey}`);
  }
  if (payload.encoding !== 'base64') {
    throw new Error(`Catalog blob encoding is not base64 for ${file.artifactKey}`);
  }
  const content = parseBase64(payload.content, `Catalog blob content for ${file.artifactKey}`);
  if (payload.size !== undefined && payload.size !== content.length) {
    throw new Error(`Catalog blob size mismatch for ${file.artifactKey}`);
  }
  if (gitBlobSha(content) !== file.gitBlobSha) {
    throw new Error(`Catalog Git blob hash mismatch for ${file.artifactKey}`);
  }
  const contentSha256 = createHash('sha256').update(content).digest('hex');
  if (contentSha256 !== file.contentSha256) {
    throw new Error(`Catalog content hash mismatch for ${file.artifactKey}`);
  }
  try {
    return JSON.parse(content.toString('utf8'));
  } catch {
    throw new Error(`Catalog blob contains invalid JSON for ${file.artifactKey}`);
  }
}

function validateOfficialManifest(manifest) {
  const validated = validateManifestV2Shape(manifest);
  if (validated.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
    throw new Error(`Control identity delta requires ${OFFICIAL_BSI_REPOSITORY_URL}`);
  }
  return validated;
}

function indexCatalogFiles(manifest, label) {
  const files = new Map();
  for (const file of manifest.files.filter((candidate) => candidate.rootType === 'catalog')) {
    if (files.has(file.artifactKey)) {
      throw new Error(`${label} contains duplicate catalog artifactKey ${file.artifactKey}`);
    }
    files.set(file.artifactKey, file);
  }
  return files;
}

function emptyCatalog() {
  return { catalog: {} };
}

export async function buildControlIdentityDelta(
  previousManifestInput,
  nextManifestInput,
  { fetchImpl = fetch, token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN } = {},
) {
  const previousManifest = validateOfficialManifest(previousManifestInput);
  const nextManifest = validateOfficialManifest(nextManifestInput);
  const previousFiles = indexCatalogFiles(previousManifest, 'Previous manifest');
  const nextFiles = indexCatalogFiles(nextManifest, 'Next manifest');
  const artifactKeys = [...new Set([...previousFiles.keys(), ...nextFiles.keys()])].sort();
  const cache = new Map();

  function load(file) {
    if (!file) return Promise.resolve(emptyCatalog());
    const cacheKey = `${file.gitBlobSha}:${file.contentSha256}`;
    if (!cache.has(cacheKey)) {
      cache.set(cacheKey, fetchCatalogBlob(file, { fetchImpl, token }));
    }
    return cache.get(cacheKey);
  }

  const artifacts = [];
  for (const artifactKey of artifactKeys) {
    const previousFile = previousFiles.get(artifactKey);
    const nextFile = nextFiles.get(artifactKey);
    const [previousCatalog, nextCatalog] = await Promise.all([
      load(previousFile),
      load(nextFile),
    ]);
    artifacts.push(compareCatalogControlIdentities({
      artifactKey,
      previousSnapshotSha: previousManifest.snapshotCommitSha,
      nextSnapshotSha: nextManifest.snapshotCommitSha,
      previousCatalog,
      nextCatalog,
    }));
  }

  return {
    schemaVersion: 1,
    previousSnapshotSha: previousManifest.snapshotCommitSha,
    nextSnapshotSha: nextManifest.snapshotCommitSha,
    artifacts,
  };
}

export async function writeControlIdentityDelta(
  delta,
  filePath = DEFAULT_CONTROL_IDENTITY_DELTA_PATH,
) {
  const resolvedPath = resolveControlIdentityDeltaPath(filePath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, `${JSON.stringify(delta, null, 2)}\n`, 'utf8');
}

export function formatControlIdentityDeltaSummary(delta) {
  if (!Array.isArray(delta?.artifacts) || delta.artifacts.length === 0) {
    return '- Keine Control-Identitätsänderungen erkannt';
  }
  return delta.artifacts.map((artifact) => {
    const counts = CLASSIFICATIONS
      .map((classification) => `${classification}: ${artifact.counts[classification]}`)
      .join(', ');
    return `- **${artifact.artifactKey}**: ${artifact.previousControlCount} → ${artifact.nextControlCount} Controls (${counts})`;
  }).join('\n');
}
