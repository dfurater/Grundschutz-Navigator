#!/usr/bin/env node

import { compareStringsByCodeUnit } from '../src/domain/codeUnitOrder.mjs';
import { execFile } from 'node:child_process';
import { computeGitBlobSha, sha256Hex } from './contentHashes.mjs';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { DEFAULT_REQUEST_TIMEOUT_MS, fetchGitHubJson } from './githubApiFetch.mjs';
import { readRegularFileNoFollow } from './regularFileRead.mjs';
import {
  OFFICIAL_BSI_REPO,
  OFFICIAL_BSI_REPOSITORY_URL,
  buildOfficialBsiGitBlobApiUrl,
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
  ENTRY_CATALOG,
  MONITORED_UPSTREAM_ROOTS,
  SOURCE_REGISTRY,
  SUPPORTED_CATALOGS,
  getArtifactByUpstreamPath,
  hasRegistryKeyGrammar,
  isPathWithinMonitoredRoot,
  listProductUpstreamPaths,
  deriveCompanionArtifactKey,
} from '../src/domain/sourceRegistry.mjs';
import {
  COMPANION_LIFECYCLES,
  COMPANION_ROOT_TYPES,
  classifyCompanionArtifact,
  listCompanionTreePaths,
} from './companion-artifacts.mjs';
import {
  computeManifestSignature as computeV2ManifestSignature,
  normalizeGitTree,
  validateManifestV2Shape,
} from './upstream-artifacts.mjs';
import {
  validateCatalogControlIdentities,
  validateFetchedOscalArtifact,
} from './fetch-catalog.mjs';

const execFileAsync = promisify(execFile);

export const TRACKED_MANIFEST_PATH = 'upstream-manifest.json';
export const SYNC_BRANCH_PATTERN = /^chore\/catalog-sync-([0-9a-f]{12})$/;
export const SYNC_TITLE_PREFIX = 'chore(ci): BSI-Katalog-Sync ';
/**
 * Namensraum der Manifest-Übernahme von der Freigabe- auf die
 * Integrationslinie (Klasse M1 der Übernahme-Lane). Der Name ist stabil und
 * trägt keinen Snapshot-Suffix: Die Übernahme zweigt von `develop` ab und
 * springt immer auf `main`s aktuellen Stand, statt Einzelschritte
 * nachzuvollziehen — ein aus dem Snapshot abgeleiteter Name müsste bei jedem
 * weitergelaufenen `main` den Branch wechseln.
 */
export const CATALOG_IMPORT_BRANCH = 'chore/catalog-import-to-develop';
/** Einzige zulässige Base der Übernahme. */
export const CATALOG_IMPORT_BASE_REF = 'develop';
/** Einzige zulässige Herkunft des übernommenen Manifests. */
export const CATALOG_IMPORT_SOURCE_REF = 'origin/main';
/**
 * Ein PR, der das Manifest ändert, darf keinen dieser Pfade ändern: Der Guard
 * läuft aus dem PR-Head und darf nicht über seine eigene Änderung entscheiden.
 */
const MANIFEST_CHANGE_FORBIDDEN_PREFIXES = Object.freeze(['scripts/', '.github/']);

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export { DEFAULT_REQUEST_TIMEOUT_MS };

/**
 * Upstream-Pfade aller ausgelieferten Kataloge (GSPP-284). Die Sync-Lane prüft
 * jeden davon, nicht nur den Einstiegskatalog.
 */
const SUPPORTED_CATALOG_PATHS = new Set(SUPPORTED_CATALOGS.map((entry) => entry.upstreamPath));

/**
 * Registrierte OSCAL-Artefakte nach Schlüssel — Grundlage der
 * Versionskreuzprüfung beim Blob-Verify (GSPP-283).
 */
const REGISTRY_BY_ARTIFACT_KEY = new Map(
  SOURCE_REGISTRY
    .filter((entry) => entry.kind === 'oscal')
    .map((entry) => [entry.artifactKey, entry]),
);

export function computeManifestSignature(manifest) {
  return computeV2ManifestSignature(manifest);
}

function assertProductArtifactsMatchRegistry(manifest) {
  const fileByPath = new Map(manifest.files.map((file) => [file.path, file]));
  for (const entry of SOURCE_REGISTRY) {
    if (entry.kind !== 'oscal') continue;
    const file = fileByPath.get(entry.upstreamPath);
    if (!file) {
      throw new Error(`Manifest is missing registered artifact: ${entry.upstreamPath}`);
    }
    if (
      file.artifactKey !== entry.artifactKey ||
      file.rootType !== entry.expectedRootType ||
      file.lifecycle !== entry.lifecycle
    ) {
      throw new Error(`Manifest registry metadata does not match sourceRegistry: ${entry.upstreamPath}`);
    }
    if (entry.profileUpstreamPath !== undefined && !fileByPath.has(entry.profileUpstreamPath)) {
      throw new Error(`Manifest is missing registered profile: ${entry.profileUpstreamPath}`);
    }
  }
}

function assertCompanionFileIsValid(file, companionKeys) {
  if (!file.path.endsWith('.json') || !isPathWithinMonitoredRoot(file.path)) {
    throw new Error(`Manifest companion path is outside the monitored JSON roots: ${file.path}`);
  }
  if (!hasRegistryKeyGrammar(file.artifactKey) || companionKeys.has(file.artifactKey)) {
    throw new Error(`Manifest companion has an invalid or duplicate artifactKey: ${file.path}`);
  }
  companionKeys.add(file.artifactKey);
  if (!COMPANION_ROOT_TYPES.includes(file.rootType) || !COMPANION_LIFECYCLES.includes(file.lifecycle)) {
    throw new Error(`Manifest companion metadata is invalid: ${file.path}`);
  }
}

/**
 * Prüft das Manifest gegen das Register im Head (ADR-13): Produkteinträge
 * gleichen dem Register in Schlüssel, Pfad, Root-Typ und Lifecycle;
 * Vokabulardateien liegen direkt im registrierten Verzeichnis; jede andere
 * Datei ist ein Begleitartefakt unter einer überwachten Wurzel mit
 * eindeutigem, grammatikkonformem Schlüssel. Ob die Begleit- und
 * Vokabularmenge dem Snapshot-Tree entspricht, weist erst verifySnapshotFiles
 * nach.
 */
/** v2-Form und offizielles Repository, ohne Bezug zum Register. */
export function assertOfficialManifest(manifest, label = 'Manifest') {
  validateManifestV2Shape(manifest);
  if (manifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
    throw new Error(`${label} repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
  }
}

export function validateCatalogSyncManifest(manifest) {
  assertOfficialManifest(manifest);
  assertProductArtifactsMatchRegistry(manifest);
  const productPaths = new Set(listProductUpstreamPaths());
  const productKeys = new Set(SOURCE_REGISTRY.map((entry) => entry.artifactKey));
  const companionKeys = new Set(productKeys);
  for (const file of manifest.files) {
    if (productPaths.has(file.path)) continue;
    if (file.rootType === 'vocabulary') {
      const registryEntry = getArtifactByUpstreamPath(file.path);
      if (
        registryEntry?.kind !== 'vocabulary-collection' ||
        file.artifactKey !== registryEntry.artifactKey ||
        file.lifecycle !== registryEntry.lifecycle
      ) {
        throw new Error(`Manifest vocabulary metadata does not match sourceRegistry: ${file.path}`);
      }
      continue;
    }
    assertCompanionFileIsValid(file, companionKeys);
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

/**
 * Berechnet den PR-Diff als Drei-Punkt-Diff gegen die Merge-Basis
 * (`<base>...<head>`) — dieselbe Bezugsgröße, die GitHub für „Files changed"
 * verwendet und die die Schwesterprüfung `getChangedFiles`
 * (`scripts/git-changed-files.mjs`) bereits nutzt. Ein Zwei-Punkt-Diff
 * meldete jeden Pfad, an dem sich die beiden Bäume unterscheiden, also auch
 * Pfade, die allein die Base bewegt hat; der Guard bewertete dadurch Dateien,
 * die der Head nie angefasst hat. Der Vertrag verliert dabei nichts: Beide
 * Rulesets tragen `strict_required_status_checks_policy: true`, sodass die
 * Base-Spitze zum Merge-Zeitpunkt Vorfahr des Heads und damit selbst die
 * Merge-Basis ist — dort sind beide Rechnungen deckungsgleich.
 *
 * Die Bezugsgröße von `previousManifest` (`git show <baseSha>:…`) in
 * `runCli()` bleibt absichtlich der Base-SHA. Der Diff beantwortet, was der
 * Head geändert hat; das Manifest der Base beantwortet für
 * `verifySnapshotProgress`, ob der neue Snapshot dem voraus ist, was auf der
 * Base bereits liegt — dafür ist die Base-Spitze die strengere und damit
 * richtige Bezugsgröße.
 *
 * Die SHA-Prüfung liegt hier, weil dies der erste git-Aufruf mit beiden SHAs
 * ist; `runCli()` verlässt sich darauf auch für die nachgelagerten
 * Base-Lesezugriffe.
 */
export async function getPullRequestDiffEntries({
  baseSha,
  headSha,
  execFile = execFileAsync,
}) {
  if (!SHA_PATTERN.test(baseSha) || !SHA_PATTERN.test(headSha)) {
    throw new Error('PR_BASE_SHA and PR_HEAD_SHA must be lowercase 40-character SHAs');
  }

  const { stdout } = await execFile(
    'git',
    ['diff', '--name-status', '--no-renames', `${baseSha}...${headSha}`, '--'],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  return parseNameStatusDiff(stdout);
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

export async function verifySnapshotProgress(previousSha, nextSha, {
  fetchImpl = fetch,
  token,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  if (!SHA_PATTERN.test(previousSha) || !SHA_PATTERN.test(nextSha)) {
    throw new Error('Snapshot comparison requires two lowercase 40-character SHAs');
  }

  const apiBase = `https://api.github.com/repos/${OFFICIAL_BSI_REPO}`;
  await fetchGitHubJson(`${apiBase}/commits/${nextSha}`, {
    fetchImpl,
    token,
    label: 'New BSI snapshot lookup',
    requestTimeoutMs,
  });

  const comparison = await fetchGitHubJson(`${apiBase}/compare/${previousSha}...${nextSha}`, {
    fetchImpl,
    token,
    label: 'BSI snapshot comparison',
    requestTimeoutMs,
  });

  if (comparison.status !== 'ahead') {
    throw new Error(`New BSI snapshot must be ahead of the tracked snapshot (status=${comparison.status ?? 'missing'})`);
  }

  return comparison;
}

export async function verifySnapshotFiles(manifest, {
  fetchImpl = fetch,
  token,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
} = {}) {
  const apiBase = `https://api.github.com/repos/${OFFICIAL_BSI_REPO}`;
  const tree = await fetchGitHubJson(
    `${apiBase}/git/trees/${manifest.snapshotCommitSha}?recursive=1`,
    { fetchImpl, token, label: 'BSI snapshot tree lookup', requestTimeoutMs },
  );
  const normalizedTree = normalizeGitTree(tree, { monitoredRoots: MONITORED_UPSTREAM_ROOTS });
  const blobShaByPath = new Map(normalizedTree.map((entry) => [entry.path, entry.gitBlobSha]));
  for (const file of manifest.files) {
    if (blobShaByPath.get(file.path) !== file.gitBlobSha) {
      throw new Error(`Manifest blob SHA does not match the BSI snapshot: ${file.path}`);
    }
  }

  // Die Begleitmenge des Manifests ist genau die im Tree entdeckte Menge
  // (ADR-13): Kein Begleitartefakt darf still fehlen oder hinzukommen.
  const productPaths = new Set(listProductUpstreamPaths());
  const manifestCompanionPaths = manifest.files
    .filter((file) => file.rootType !== 'vocabulary' && !productPaths.has(file.path))
    .map((file) => file.path)
    .sort(compareStringsByCodeUnit);
  const treeCompanionPaths = listCompanionTreePaths(normalizedTree, SOURCE_REGISTRY)
    .sort(compareStringsByCodeUnit);
  if (JSON.stringify(manifestCompanionPaths) !== JSON.stringify(treeCompanionPaths)) {
    throw new Error('Manifest companion inventory does not match the BSI snapshot tree');
  }

  const fetchAndValidateArtifact = async (file) => {
    const blob = await fetchGitHubJson(
      buildOfficialBsiGitBlobApiUrl({
        repository: manifest.repository,
        gitBlobSha: file.gitBlobSha,
      }),
      { fetchImpl, token, label: `BSI artifact blob lookup (${file.path})`, requestTimeoutMs },
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
    const contentSha256 = sha256Hex(contents);
    if (contentSha256 !== file.contentSha256) {
      throw new Error(`Manifest contentSha256 does not match the BSI artifact: ${file.path}`);
    }

    // Die Namespace-URL ist hier nur Etikett, nicht die im Katalog
    // referenzierte Form: Die anschließenden Taxonomieprüfungen lesen
    // ausschließlich `entries`.
    if (file.rootType === 'vocabulary') {
      return buildVocabularyNamespaceData({
        namespaceUrl: `${OFFICIAL_BSI_REPOSITORY_URL}/tree/main/${file.path}`,
        repository: OFFICIAL_BSI_REPO,
        path: file.path,
        gitBlobSha: file.gitBlobSha,
        csvText: contents.toString('utf8'),
      });
    }

    // Ein Begleitartefakt trägt genau den Root-Typ und Lifecycle, den seine
    // Bytes ergeben; dieselbe Ableitung nutzt der Fetch.
    if (!productPaths.has(file.path)) {
      const companion = classifyCompanionArtifact(contents);
      if (companion.rootType !== file.rootType || companion.lifecycle !== file.lifecycle) {
        throw new Error(`Manifest companion lifecycle does not match its validation result: ${file.path}`);
      }
      return companion.document;
    }

    // Registry-Erwartung mitgeben, damit auch die Sync-Lane einen stillen
    // Versionswechsel eines BSI-Artefakts fail-closed erkennt (GSPP-283).
    const registryEntry = REGISTRY_BY_ARTIFACT_KEY.get(file.artifactKey);
    if (registryEntry?.upstreamPath !== file.path) {
      throw new Error(`Manifest artifact is not a registered OSCAL entry: ${file.artifactKey}`);
    }

    const artifact = validateFetchedOscalArtifact(contents, file.rootType, {
      artifactKey: file.artifactKey,
      expectedOscalVersion: registryEntry.oscalVersion,
    });
    if (SUPPORTED_CATALOG_PATHS.has(file.path)) {
      validateCatalogControlIdentities(artifact.json, file.artifactKey);
    }
    return artifact.json;
  };

  const supportedCatalogFiles = SUPPORTED_CATALOGS.map((entry) => {
    const file = manifest.files.find((candidate) => candidate.path === entry.upstreamPath);
    if (!file) {
      throw new Error(
        `Manifest does not contain the supported catalog document: ${entry.upstreamPath}`,
      );
    }
    return { entry, file };
  });
  // Validate all catalog references before any vocabulary blob is requested,
  // then derive delivery membership from the registered direct directory.
  const supportedCatalogDocuments = await Promise.all(
    supportedCatalogFiles.map(async ({ entry, file }) => ({
      entry,
      document: await fetchAndValidateArtifact(file),
    })),
  );
  const catalogDocument = supportedCatalogDocuments.find(
    ({ entry }) => entry.artifactKey === ENTRY_CATALOG.artifactKey,
  )?.document;
  if (!catalogDocument) {
    throw new Error(`Manifest does not contain the entry catalog: ${ENTRY_CATALOG.upstreamPath}`);
  }

  // Identisch zur Fetch-Lane: die Vokabular-Membership entsteht aus allen
  // ausgelieferten Katalogen. Liefen beide Ableitungen auseinander, würde die
  // Manifest-Inventarprüfung unten dauerhaft fehlschlagen.
  const referencedNamespaceUrls = [
    ...new Set(
      supportedCatalogDocuments.flatMap(({ document }) =>
        extractReferencedNamespaceUrls(document, OFFICIAL_BSI_REPO),
      ),
    ),
    // Code-Unit-Komparator: bewahrt exakt die bisherige implizite
    // Sortiersemantik von Array.prototype.sort() für Strings (S2871 verlangt
    // den Komparator, keine neue Kollation). Die Reihenfolge der
    // Inventarprüfung unten hängt nicht daran: Die Mitgliederliste sortiert
    // materializeVocabularyCollectionMembers selbst nach Pfad.
  ].sort(compareStringsByCodeUnit);
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

  // Der Vergleich ist bewusst reihenfolgesensitiv. Beide Seiten sind nach Pfad
  // sortiert: das Manifest kanonisch (validateManifestV2Shape in
  // upstream-artifacts.mjs, Codepoint-Ordnung), die Erwartung in
  // materializeVocabularyCollectionMembers (UTF-16-Code-Unit-Ordnung); der
  // Filter erhält die Manifestordnung. Die beiden Ordnungen weichen nur für
  // Pfade mit Zeichen außerhalb der BMP voneinander ab. Ein solcher Pfad und
  // ein ohne vorherige Formprüfung übergebenes, nicht kanonisches Manifest
  // scheitern hier fail-closed; einen falschen Bestand lässt der Vergleich nie
  // passieren.
  const manifestNamespacePaths = manifest.files
    .filter((file) => file.rootType === 'vocabulary')
    .map((file) => file.path);
  if (JSON.stringify(manifestNamespacePaths) !== JSON.stringify(expectedNamespacePaths)) {
    throw new Error('Manifest namespace inventory does not match the registered direct CSV directory');
  }

  const validatedArtifacts = await Promise.all(
    manifest.files
      .filter((file) => !SUPPORTED_CATALOG_PATHS.has(file.path))
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

function isLaneCandidate({ branch, title }) {
  return branch.startsWith('chore/catalog-sync-') || title.startsWith(SYNC_TITLE_PREFIX);
}

/**
 * Eine Regel für jeden PR, dessen Diff das Manifest enthält (ADR-13): kein
 * Diff-Pfad unter `scripts/` oder `.github/`, beide Manifeste v2-gültig mit
 * offiziellem Repository, das neue Manifest passt zum Register im Head, der
 * Snapshot ist gleich oder voraus, und jede Datei samt Begleitmenge besteht
 * die Snapshot-Verifikation.
 */
export function assertManifestChangeScope(diffEntries) {
  const forbidden = diffEntries.find((entry) =>
    MANIFEST_CHANGE_FORBIDDEN_PREFIXES.some((prefix) => entry.path.startsWith(prefix)),
  );
  if (forbidden) {
    throw new Error(`A PR that changes ${TRACKED_MANIFEST_PATH} must not change ${forbidden.path}`);
  }
}

export function validateManifestTransition(previousManifest, nextManifest) {
  assertOfficialManifest(previousManifest, 'Previous manifest');
  validateCatalogSyncManifest(nextManifest);
  const productPaths = new Set(listProductUpstreamPaths());
  const previousKeysByPath = new Map(previousManifest.files
    .filter((file) => file.rootType !== 'vocabulary' && !productPaths.has(file.path))
    .map((file) => [file.path, file.artifactKey]));
  for (const file of nextManifest.files) {
    if (file.rootType === 'vocabulary' || productPaths.has(file.path)) continue;
    const expectedKey = previousKeysByPath.get(file.path) ?? deriveCompanionArtifactKey(file.path);
    if (file.artifactKey !== expectedKey) {
      throw new Error(`Manifest companion key does not match its tracked path: ${file.path}`);
    }
  }
}

export async function guardCatalogSyncPullRequest({
  branch,
  title,
  diffEntries,
  previousManifest,
  nextManifest,
  fetchImpl = fetch,
  token,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
}) {
  if (!isCatalogSyncCandidate({ branch, title, diffEntries })) {
    return { catalogSync: false };
  }

  const laneCandidate = isLaneCandidate({ branch, title });
  if (laneCandidate) {
    validateCatalogSyncPullRequest({ branch, title, diffEntries });
  }
  assertManifestChangeScope(diffEntries);
  validateManifestTransition(previousManifest, nextManifest);
  if (laneCandidate) {
    const expectedBranch = `chore/catalog-sync-${nextManifest.snapshotCommitSha.slice(0, 12)}`;
    if (branch !== expectedBranch) {
      throw new Error(`Catalog sync branch must match the new snapshot: ${expectedBranch}`);
    }
  }
  // Der Lane-PR bringt immer einen neuen Snapshot; jeder andere
  // manifestverändernde PR darf am selben Snapshot bleiben.
  if (laneCandidate || previousManifest.snapshotCommitSha !== nextManifest.snapshotCommitSha) {
    await verifySnapshotProgress(
      previousManifest.snapshotCommitSha,
      nextManifest.snapshotCommitSha,
      { fetchImpl, token, requestTimeoutMs },
    );
  }
  await verifySnapshotFiles(nextManifest, { fetchImpl, token, requestTimeoutMs });

  return {
    catalogSync: laneCandidate,
    manifestChange: true,
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
  const diffEntries = await getPullRequestDiffEntries({ baseSha, headSha });

  if (!isCatalogSyncCandidate({ branch, title, diffEntries })) {
    console.log('Normal PR: catalog sync guard passed without network access.');
    return;
  }

  const { stdout: previousManifestText } = await execFileAsync(
    'git',
    ['show', `${baseSha}:${TRACKED_MANIFEST_PATH}`],
    { encoding: 'utf8', maxBuffer: 1024 * 1024 },
  );
  const previousManifest = JSON.parse(previousManifestText);
  const nextManifest = JSON.parse(
    (await readRegularFileNoFollow(TRACKED_MANIFEST_PATH)).toString('utf8'),
  );
  const result = await guardCatalogSyncPullRequest({
    branch,
    title,
    diffEntries,
    previousManifest,
    nextManifest,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });

  console.log(
    result.catalogSync
      ? `Catalog sync guard passed for snapshot ${result.snapshotCommitSha}.`
      : `Manifest change fully verified against snapshot ${result.snapshotCommitSha}.`,
  );
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
