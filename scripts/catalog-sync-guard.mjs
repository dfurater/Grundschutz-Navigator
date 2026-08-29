#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import {
  OFFICIAL_BSI_REPO,
  OFFICIAL_BSI_REPOSITORY_URL,
  assertRegisteredUpstreamRepoPath,
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
  isSafeRepoPath,
} from '../src/domain/sourceRegistry.mjs';
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
const REGISTRY_LIFECYCLE_MIGRATION_PATH = 'src/domain/sourceRegistry.mjs';
/** Die im Quellregister deklarierten Lifecycles — einzige zulässige Werte. */
const REGISTRY_LIFECYCLES = new Set([
  'supported',
  'preview',
  'draft',
  'blocked-by-upstream',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Registrierte OSCAL-Artefakte nach Schlüssel — Grundlage der
 * Versionskreuzprüfung beim Blob-Verify (GSPP-283).
 */
/**
 * Upstream-Pfade aller ausgelieferten Kataloge (GSPP-284). Die Sync-Lane prüft
 * jeden davon, nicht nur den Einstiegskatalog.
 */
const SUPPORTED_CATALOG_PATHS = new Set(SUPPORTED_CATALOGS.map((entry) => entry.upstreamPath));

const REGISTRY_BY_ARTIFACT_KEY = new Map(
  SOURCE_REGISTRY
    .filter((entry) => entry.kind === 'oscal')
    .map((entry) => [entry.artifactKey, entry]),
);

export function computeManifestSignature(manifest) {
  return computeV2ManifestSignature(manifest);
}

function assertRegisteredArtifactsPresent(manifestPaths, manifest) {
  const exactRegistryFiles = new Map(
    SOURCE_REGISTRY
      .filter((entry) => entry.kind === 'oscal')
      .map((entry) => [entry.upstreamPath, entry]),
  );

  for (const [repoPath, entry] of exactRegistryFiles) {
    if (!manifestPaths.has(repoPath)) {
      // ADR-7-Nachtrag: Ein gesperrtes Artefakt darf im Manifest fehlen, wenn
      // es upstream vollständig entfernt wurde. verifySnapshotFiles prüft die
      // Tree-Abwesenheit gegen den Snapshot nach, bevor eine Sync-PR gilt.
      if (entry.lifecycle === 'blocked-by-upstream') continue;
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
}

function assertManifestPathsAreRegistered(manifest, materializedNamespacePaths) {
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
}

export function validateCatalogSyncManifest(manifest) {
  validateManifestV2Shape(manifest);

  if (manifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
    throw new Error(`Manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
  }

  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  const materializedNamespacePaths = manifest.files
    .filter((file) => file.rootType === 'vocabulary')
    .map((file) => file.path);

  assertRegisteredArtifactsPresent(manifestPaths, manifest);
  assertManifestPathsAreRegistered(manifest, materializedNamespacePaths);

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

/**
 * Ein fachlich geprüfter Lifecycle-Wechsel ist kein autonomer Catalog-Sync.
 * Er ist nur zulässig, wenn derselbe Snapshot und sämtliche Content-Pins
 * unverändert bleiben und die PR zugleich das Quellregister ändert. Der
 * nächste Manifeststand wird anschließend noch gegen das aktuelle Registry
 * validiert.
 *
 * Die tragende Sicherheitseigenschaft ist, dass **keine neuen Bytes gepinnt
 * werden**: `gitBlobSha` und `contentSha256` jeder Datei bleiben identisch, die
 * Dateimenge bleibt identisch, und der Snapshot wechselt nicht. Über diese
 * Bedingungen hinaus ist die Richtung des Wechsels nicht sicherheitsrelevant —
 * eine Promotion wie `preview` → `supported` (GSPP-242) liefert ausschließlich
 * bereits gepinnte und beim Fetch bereits transient validierte Bytes aus.
 *
 * Ausgenommen bleibt allein die Deeskalation **aus** `blocked-by-upstream`
 * heraus: Ein wegen eines Upstream-Defekts gesperrtes Artefakt wird über diesen
 * Pfad nicht entsperrt. Dieser Fall gehört in die vollständige
 * Snapshot-Verifikation, nicht in die Ausnahme.
 */
export function isRegistryLifecycleOnlyMigration({ diffEntries, previousManifest, nextManifest }) {
  if (
    !Array.isArray(diffEntries) ||
    !diffEntries.some(
      (entry) => entry.status === 'M' && entry.path === TRACKED_MANIFEST_PATH,
    ) ||
    !diffEntries.some(
      (entry) => entry.status === 'M' && entry.path === REGISTRY_LIFECYCLE_MIGRATION_PATH,
    ) ||
    !previousManifest ||
    !nextManifest ||
    previousManifest.snapshotCommitSha !== nextManifest.snapshotCommitSha ||
    !Array.isArray(previousManifest.files) ||
    !Array.isArray(nextManifest.files) ||
    previousManifest.files.length !== nextManifest.files.length
  ) {
    return false;
  }

  const previousByPath = new Map(previousManifest.files.map((file) => [file.path, file]));
  let lifecycleChanges = 0;
  for (const nextFile of nextManifest.files) {
    const previousFile = previousByPath.get(nextFile.path);
    if (
      !previousFile ||
      previousFile.artifactKey !== nextFile.artifactKey ||
      previousFile.rootType !== nextFile.rootType ||
      previousFile.gitBlobSha !== nextFile.gitBlobSha ||
      previousFile.contentSha256 !== nextFile.contentSha256
    ) {
      return false;
    }
    if (previousFile.lifecycle === nextFile.lifecycle) continue;
    // Fail-closed gegen undeklarierte Werte: Nur die im Quellregister
    // definierten Lifecycles sind überhaupt vergleichbar.
    if (
      !REGISTRY_LIFECYCLES.has(previousFile.lifecycle) ||
      !REGISTRY_LIFECYCLES.has(nextFile.lifecycle)
    ) {
      return false;
    }
    // Keine Entsperrung über diesen Pfad.
    if (previousFile.lifecycle === 'blocked-by-upstream') {
      return false;
    }
    lifecycleChanges += 1;
  }

  return lifecycleChanges > 0;
}

/**
 * Ein neuer interner Preview-Katalog darf derselbe Snapshot ergänzen, wenn
 * alle bestehenden Pins unverändert bleiben und die vollständige Snapshot-
 * Verifikation die neuen Bytes gegen Tree, Blob und Inhaltspins prüft.
 *
 * Die Ausnahme ist absichtlich enger als ein allgemeiner Registry-Import:
 * Sie erlaubt nur nicht auslieferbare Katalogquellen ohne `catalogKey`.
 */
export function isRegistryPreviewArtifactExpansion({ diffEntries, previousManifest, nextManifest }) {
  if (
    !Array.isArray(diffEntries) ||
    !diffEntries.some(
      (entry) => entry.status === 'M' && entry.path === TRACKED_MANIFEST_PATH,
    ) ||
    !diffEntries.some(
      (entry) => entry.status === 'M' && entry.path === REGISTRY_LIFECYCLE_MIGRATION_PATH,
    ) ||
    !previousManifest ||
    !nextManifest ||
    previousManifest.snapshotCommitSha !== nextManifest.snapshotCommitSha ||
    !Array.isArray(previousManifest.files) ||
    !Array.isArray(nextManifest.files) ||
    previousManifest.files.length >= nextManifest.files.length
  ) {
    return false;
  }

  const nextByPath = new Map(nextManifest.files.map((file) => [file.path, file]));
  for (const previousFile of previousManifest.files) {
    const nextFile = nextByPath.get(previousFile.path);
    if (
      !nextFile ||
      nextFile.artifactKey !== previousFile.artifactKey ||
      nextFile.rootType !== previousFile.rootType ||
      nextFile.lifecycle !== previousFile.lifecycle ||
      nextFile.gitBlobSha !== previousFile.gitBlobSha ||
      nextFile.contentSha256 !== previousFile.contentSha256
    ) {
      return false;
    }
  }

  const previousPaths = new Set(previousManifest.files.map((file) => file.path));
  const addedFiles = nextManifest.files.filter((file) => !previousPaths.has(file.path));
  return addedFiles.length > 0 && addedFiles.every((file) => {
    const registryEntry = getArtifactByUpstreamPath(file.path);
    return (
      registryEntry?.kind === 'oscal' &&
      registryEntry.expectedRootType === 'catalog' &&
      registryEntry.lifecycle === 'preview' &&
      registryEntry.catalogKey === undefined &&
      file.artifactKey === registryEntry.artifactKey &&
      file.rootType === registryEntry.expectedRootType &&
      file.lifecycle === registryEntry.lifecycle
    );
  });
}

/**
 * Zulässige Begleitpfade einer OSCAL-Versionsmigration — Positivliste, kein
 * Verbot. Was hier nicht aufgeführt ist, lässt die Ausnahme fail-closed auf
 * den regulären Sync-Pfad zurückfallen.
 *
 * Warum `src/` und `docs/` genügen, obwohl dort Produktcode liegt: Die harten
 * Regeln des autonomen Sync-Pfads — Branchname, exakter Titel, genau eine
 * Datei — schützen vor Auto-Merge-Missbrauch. `update-catalog.yml` aktiviert
 * Auto-Merge ausschließlich auf der PR, die es selbst erzeugt hat; eine
 * Migrations-PR trägt einen anderen Branchnamen, bekommt deshalb nie
 * Auto-Merge und durchläuft validate, documentation-contract, CodeQL, Sonar,
 * Greptile und einen menschlichen Merge. Für Produktcode ist dieser Guard also
 * nicht das Kontrollinstrument — das sind die anderen Checks. Was er schützen
 * muss, ist die Beweiskette der Lane selbst: Fetch, Manifest-Erzeugung,
 * Policy, dieser Guard und die Workflows, die sie aufrufen. Sie liegt
 * vollständig unter `scripts/` und `.github/` — und genau die sind hier nicht
 * aufgeführt, ohne dass eine einzige Datei namentlich verboten werden müsste.
 */
const MIGRATION_COMPANION_PREFIXES = Object.freeze(['src/', 'docs/']);

/** Beide Pfade müssen im Diff stehen; ohne sie ist es keine Migration. */
const MIGRATION_REQUIRED_PATHS = Object.freeze([
  TRACKED_MANIFEST_PATH,
  REGISTRY_LIFECYCLE_MIGRATION_PATH,
]);

/**
 * Wird als `node --input-type=module -e <script> -- <url>` ausgeführt und gibt
 * das geladene Register als JSON auf stdout aus.
 */
const LOAD_REGISTRY_CHILD_SCRIPT =
  'const loaded = await import(process.argv[1]); '
  + 'process.stdout.write(JSON.stringify(loaded.SOURCE_REGISTRY ?? null));';

/**
 * Die Modulkette, die `SOURCE_REGISTRY` zum Auswerten braucht. Alle Module
 * liegen flach im selben temporären Verzeichnis, weshalb ihre relativen
 * Importe untereinander auflösen.
 *
 * Die Liste ist bewusst explizit und nicht aus dem Importgraph abgeleitet:
 * Eine Ableitung müsste den Graph am Base-SHA selbst traversieren, also genau
 * die Datei parsen, die sie erst materialisieren will. Statt der Ableitung
 * hängt die Kopplung an einem Test — `catalog-sync-guard.test.ts` liest die
 * relativen Importe jedes Kettenglieds aus dem Quellbaum und schlägt fehl,
 * sobald eines davon hier fehlt. Ohne diesen Test bräche ein neuer relativer
 * Import in `sourceRegistry.mjs` den Migrationspfad still und fail-closed mit
 * einem irreführenden Modulauflösungsfehler (Gitar-Befund).
 */
export const REGISTRY_MODULE_CHAIN = Object.freeze([
  REGISTRY_LIFECYCLE_MIGRATION_PATH,
  'src/domain/oscalVersionMatrix.mjs',
]);

function isMigrationSafePath(path) {
  // Ein Pfad, den das Quellregister selbst nicht als sicher anerkennt —
  // absolut, mit Backslash oder mit `..`-Segment — passiert die Positivliste
  // nie, auch wenn er zufällig mit einem erlaubten Präfix beginnt.
  if (!isSafeRepoPath(path)) return false;
  if (MIGRATION_REQUIRED_PATHS.includes(path)) return true;
  return MIGRATION_COMPANION_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function hasRequiredMigrationPaths(diffEntries) {
  return MIGRATION_REQUIRED_PATHS.every((requiredPath) =>
    diffEntries.some((entry) => entry.status === 'M' && entry.path === requiredPath),
  );
}

/**
 * Der Snapshot bewegt sich, die Artefaktidentität nicht: gleiche Pfadmenge,
 * je Datei unveränderte `artifactKey`, `rootType` und `lifecycle`. Nur die
 * Pins dürfen neue Bytes benennen — sie werden anschließend vollständig gegen
 * die echte BSI-API geprüft. Ein hinzugekommener oder entfallener Pfad gehört
 * in den regulären Sync- oder Preview-Erweiterungspfad, nicht hierher.
 */
function manifestAdvancesSnapshotOnly(previousManifest, nextManifest) {
  if (
    previousManifest.snapshotCommitSha === nextManifest.snapshotCommitSha ||
    !Array.isArray(previousManifest.files) ||
    !Array.isArray(nextManifest.files) ||
    previousManifest.files.length !== nextManifest.files.length
  ) {
    return false;
  }

  const previousByPath = new Map(previousManifest.files.map((file) => [file.path, file]));
  return nextManifest.files.every((nextFile) => {
    const previousFile = previousByPath.get(nextFile.path);
    return (
      previousFile !== undefined &&
      previousFile.artifactKey === nextFile.artifactKey &&
      previousFile.rootType === nextFile.rootType &&
      previousFile.lifecycle === nextFile.lifecycle
    );
  });
}

/**
 * Strukturelle Gleichheit über JSON-Werte. Ein Referenzvergleich genügt hier
 * nicht: Der Vorstand kommt als frisch geparstes JSON aus einem Kindprozess,
 * der aktuelle Stand ist das eingefrorene `SOURCE_REGISTRY` dieses Prozesses.
 * Ein künftig hinzukommendes Objekt- oder Array-Feld wäre per `!==` immer
 * ungleich und würde die Ausnahme still und unbemerkt verschließen.
 */
function isStructurallyEqual(left, right) {
  if (left === right) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => isStructurallyEqual(value, right[index]));
  }
  if (typeof left !== 'object' || typeof right !== 'object' || left === null || right === null) {
    return false;
  }
  const leftKeys = Object.keys(left).sort(compareStringsByCodeUnit);
  const rightKeys = Object.keys(right).sort(compareStringsByCodeUnit);
  if (!isStructurallyEqual(leftKeys, rightKeys)) return false;
  return leftKeys.every((key) => isStructurallyEqual(left[key], right[key]));
}

function entryChangesOnlyOscalVersion(previousEntry, nextEntry) {
  const isOscalPair = previousEntry.kind === 'oscal' && nextEntry.kind === 'oscal';
  const fieldNames = new Set([...Object.keys(previousEntry), ...Object.keys(nextEntry)]);
  for (const fieldName of fieldNames) {
    if (fieldName === 'oscalVersion' && isOscalPair) continue;
    if (!isStructurallyEqual(previousEntry[fieldName], nextEntry[fieldName])) return false;
  }
  return true;
}

/**
 * Der Registerdiff bewegt ausschließlich `oscalVersion` von OSCAL-Artefakten,
 * und mindestens eines muss sich bewegen.
 *
 * Verglichen wird der VOLLSTÄNDIGE Bestand über `artifactKey`, einschließlich
 * der Nicht-OSCAL-Einträge: Eine Beschränkung auf die oscal-Teilmenge ließe
 * eine sonst gültige Migration nebenbei etwa das `upstreamDirectory` einer
 * vocabulary-collection verschieben, ohne dass es hier bewertet würde.
 */
function registryChangesOnlyOscalVersions(previousSourceRegistry, nextSourceRegistry) {
  if (
    !Array.isArray(previousSourceRegistry) ||
    !Array.isArray(nextSourceRegistry) ||
    previousSourceRegistry.length !== nextSourceRegistry.length
  ) {
    return false;
  }

  const previousByKey = new Map(
    previousSourceRegistry.map((entry) => [entry?.artifactKey, entry]),
  );
  let versionChanges = 0;

  for (const nextEntry of nextSourceRegistry) {
    const previousEntry = previousByKey.get(nextEntry?.artifactKey);
    if (previousEntry === undefined) return false;
    if (!entryChangesOnlyOscalVersion(previousEntry, nextEntry)) return false;
    if (
      previousEntry.kind === 'oscal' &&
      nextEntry.kind === 'oscal' &&
      previousEntry.oscalVersion !== nextEntry.oscalVersion
    ) {
      versionChanges += 1;
    }
  }

  return versionChanges > 0;
}

/**
 * BSI veröffentlicht abgeleitete Kataloge und Profile gebündelt neu, sobald
 * sich irgendeine Quelle ändert; ein isolierter Schritt, der nur ein einzelnes
 * Artefakt bewegt, existiert dort nicht. Hebt dabei ein bereits registriertes
 * Artefakt seine `metadata.oscal-version`, blockiert der fail-closed-Abgleich
 * (GSPP-283) jeden weiteren Fetch — und beide Einzelwege bleiben rot: Eine
 * reine Registeränderung fetcht am alten Snapshot gegen die neue Erwartung,
 * eine reine Manifest-PR am neuen Snapshot gegen die alte. Die autonome Lane
 * kann sich nicht selbst befreien, weil `update-catalog.yml` `fetch-catalog`
 * vor der Manifest-Erzeugung aufruft und dort bereits scheitert.
 *
 * Diese Ausnahme löst genau diesen Deadlock, ohne die Beweislast zu senken.
 * Anders als `isRegistryLifecycleOnlyMigration` und
 * `isRegistryPreviewArtifactExpansion` stammt ihre Sicherheit nicht aus
 * "keine neuen Bytes" — hier darf jeder Pin neue Bytes benennen. Sie stammt
 * aus der vollständigen `verifySnapshotFiles`-Prüfung gegen die echte
 * BSI-API, die für diesen Zweig zwingend läuft, und aus vier eng gefassten
 * Struktureigenschaften des Diffs: beide Pflichtpfade vorhanden, kein Pfad
 * außerhalb der Positivliste, unveränderte Artefaktidentität im Manifest,
 * ausschließlich `oscalVersion`-Bewegung im Register.
 */
export function isRegistryOscalVersionMigration({
  diffEntries,
  previousManifest,
  nextManifest,
  previousSourceRegistry,
  nextSourceRegistry = SOURCE_REGISTRY,
}) {
  if (!Array.isArray(diffEntries) || !previousManifest || !nextManifest) return false;
  if (!hasRequiredMigrationPaths(diffEntries)) return false;
  if (!diffEntries.every((entry) => isMigrationSafePath(entry.path))) return false;
  if (!manifestAdvancesSnapshotOnly(previousManifest, nextManifest)) return false;
  return registryChangesOnlyOscalVersions(previousSourceRegistry, nextSourceRegistry);
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

function computeGitBlobSha(contents) {
  return createHash('sha1')
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest('hex');
}

/**
 * Code-Unit-Vergleich zweier Strings — semantisch identisch zur impliziten
 * Sortiersemantik von Array.prototype.sort(), aber ohne Ternär-Kaskade.
 */
function compareStringsByCodeUnit(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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

  // ADR-7-Nachtrag: Ein im Manifest fehlendes, gesperrtes Artefakt darf die
  // Sync-PR nur dann passieren, wenn es tatsächlich aus dem gepinnten Tree
  // verschwunden ist — sonst könnte eine Sync-PR ein noch vorhandenes
  // Artefakt stillschweigend aus dem Manifest auslassen.
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  for (const entry of SOURCE_REGISTRY) {
    if (entry.kind !== 'oscal' || entry.lifecycle !== 'blocked-by-upstream') continue;
    if (manifestPaths.has(entry.upstreamPath)) continue;
    if (blobShaByPath.has(entry.upstreamPath)) {
      throw new Error(
        `Manifest omits blocked artifact that is still present in the BSI snapshot: ${entry.upstreamPath}`,
      );
    }
  }

  const fetchAndValidateArtifact = async (file) => {
    const blob = await fetchGitHubJson(
      buildOfficialBsiGitBlobApiUrl({
        repository: manifest.repository,
        gitBlobSha: file.gitBlobSha,
      }),
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

    // Registry-Erwartung mitgeben, damit auch die Sync-Lane einen stillen
    // Versionswechsel eines BSI-Artefakts fail-closed erkennt (GSPP-283).
    // Ein fehlender Registry-Eintrag darf die Kreuzprüfung nicht still
    // überspringen: verifySnapshotFiles ist einzeln aufrufbar und darf sich
    // nicht darauf verlassen, dass validateCatalogSyncManifest vorher lief.
    const registryEntry = REGISTRY_BY_ARTIFACT_KEY.get(file.artifactKey);
    if (!registryEntry) {
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
    // Sortiersemantik von Array.prototype.sort() für Strings, damit die
    // JSON.stringify-Gegenprüfung gegen die Manifest-Pfade byte-identisch
    // bleibt (S2871 verlangt den Komparator, keine neue Kollation).
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

export async function guardCatalogSyncPullRequest({
  branch,
  title,
  diffEntries,
  previousManifest,
  nextManifest,
  previousSourceRegistry,
  fetchImpl = fetch,
  token,
}) {
  if (isRegistryLifecycleOnlyMigration({ diffEntries, previousManifest, nextManifest })) {
    validateManifestV2Shape(previousManifest);
    if (previousManifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
      throw new Error(`Previous manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
    }
    validateCatalogSyncManifest(nextManifest);
    return { catalogSync: false, registryLifecycleMigration: true };
  }

  if (isRegistryPreviewArtifactExpansion({ diffEntries, previousManifest, nextManifest })) {
    validateManifestV2Shape(previousManifest);
    if (previousManifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
      throw new Error(`Previous manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
    }
    validateCatalogSyncManifest(nextManifest);
    await verifySnapshotFiles(nextManifest, { fetchImpl, token });
    return { catalogSync: false, registryPreviewArtifactExpansion: true };
  }

  if (isRegistryOscalVersionMigration({
    diffEntries,
    previousManifest,
    nextManifest,
    previousSourceRegistry,
  })) {
    validateManifestV2Shape(previousManifest);
    if (previousManifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
      throw new Error(`Previous manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
    }
    validateCatalogSyncManifest(nextManifest);
    // Ungekürzt gegenüber dem regulären Sync-Pfad: Die Sicherheit dieses
    // Zweigs steht und fällt mit diesen beiden Prüfungen.
    await verifySnapshotProgress(
      previousManifest.snapshotCommitSha,
      nextManifest.snapshotCommitSha,
      { fetchImpl, token },
    );
    await verifySnapshotFiles(nextManifest, { fetchImpl, token });
    return {
      catalogSync: false,
      registryOscalVersionMigration: true,
      snapshotCommitSha: nextManifest.snapshotCommitSha,
    };
  }

  if (!isCatalogSyncCandidate({ branch, title, diffEntries })) {
    return { catalogSync: false };
  }

  validateCatalogSyncPullRequest({ branch, title, diffEntries });
  validateManifestV2Shape(previousManifest);
  if (previousManifest.repository !== OFFICIAL_BSI_REPOSITORY_URL) {
    throw new Error(`Previous manifest repository must be ${OFFICIAL_BSI_REPOSITORY_URL}`);
  }
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
  await verifySnapshotFiles(nextManifest, { fetchImpl, token });

  return {
    catalogSync: true,
    snapshotCommitSha: nextManifest.snapshotCommitSha,
  };
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

/**
 * Lädt `SOURCE_REGISTRY`, wie es am PR-Base-SHA stand.
 *
 * Die gesamte Modulkette — Register plus die von ihm importierte
 * Versionsmatrix — wird in ein temporäres Verzeichnis AUSSERHALB des
 * Quellbaums geschrieben, damit der relative Import `./oscalVersionMatrix.mjs`
 * dort auflöst. Nichts landet unter `src/`: Ein hart abgebrochener Lauf kann
 * so keinen importierbaren Rest in einem getrackten Quellverzeichnis
 * hinterlassen, den Build- oder Test-Globs später aufsammeln.
 *
 * Der Import ist zugleich die Gültigkeitsprüfung: `sourceRegistry.mjs`
 * validiert sich beim Laden selbst. Ein am Base-SHA ungültiges Register lässt
 * diesen Aufruf fail-closed scheitern, statt einen halben Stand durchzulassen.
 *
 * Er läuft in einem Kindprozess statt als `import()` in diesem Modul, weil ein
 * dynamischer Import mit berechnetem Pfad Vites Rolldown-SSR-Transform dieses
 * Skripts zum Abbruch bringt — reproduziert beim Testlauf, der Fehlbericht
 * zeigt irreführend auf die Shebang-Zeile (`Invalid Character '!'` an
 * `catalog-sync-guard.mjs:1:68`). Der Kindprozess wird von Vite nie geparst.
 */
export async function loadSourceRegistryAtRef(baseSha) {
  const directory = await mkdtemp(join(tmpdir(), 'gspp-source-registry-'));
  try {
    for (const modulePath of REGISTRY_MODULE_CHAIN) {
      const { stdout } = await execFileAsync(
        'git',
        ['show', `${baseSha}:${modulePath}`],
        { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
      );
      await writeFile(join(directory, basename(modulePath)), stdout, 'utf8');
    }
    const entryModule = join(directory, basename(REGISTRY_LIFECYCLE_MIGRATION_PATH));
    const { stdout } = await execFileAsync(
      process.execPath,
      ['--input-type=module', '-e', LOAD_REGISTRY_CHILD_SCRIPT, '--', pathToFileURL(entryModule).href],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
    );
    const previousRegistry = JSON.parse(stdout);
    if (!Array.isArray(previousRegistry)) {
      throw new TypeError('Base-ref sourceRegistry.mjs exports no SOURCE_REGISTRY array');
    }
    return previousRegistry;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
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
  // Nur laden, wenn die PR das Register überhaupt anfasst — sonst kostet der
  // Kettenimport jede gewöhnliche Manifest-PR unnötig Zeit.
  const previousSourceRegistry = diffEntries.some(
    (entry) => entry.status === 'M' && entry.path === REGISTRY_LIFECYCLE_MIGRATION_PATH,
  )
    ? await loadSourceRegistryAtRef(baseSha)
    : undefined;
  const result = await guardCatalogSyncPullRequest({
    branch,
    title,
    diffEntries,
    previousManifest,
    nextManifest,
    previousSourceRegistry,
    token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN,
  });

  if (result.registryLifecycleMigration) {
    console.log('Registry-Lifecycle-Migration geprüft; kein autonomer Catalog-Sync.');
    return;
  }
  if (result.registryPreviewArtifactExpansion) {
    console.log('Registry-Preview-Erweiterung vollständig gegen denselben Snapshot geprüft.');
    return;
  }
  if (result.registryOscalVersionMigration) {
    console.log(
      `Registry-OSCAL-Versionsmigration vollständig gegen Snapshot ${result.snapshotCommitSha} geprüft.`,
    );
    return;
  }
  console.log(`Catalog sync guard passed for snapshot ${result.snapshotCommitSha}.`);
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
