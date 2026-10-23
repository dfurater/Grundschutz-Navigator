/**
 * Quellregister für BSI-Upstream-Artefakte (ADR-1).
 *
 * Führt die Produktartefakte (ADR-13): die Kataloge mit `catalogKey`, je
 * Katalog optional den Pfad seines BSI-Profils (`profileUpstreamPath`), und die
 * Vokabularsammlung. Wird sowohl von den Build-Skripten
 * (`scripts/security-guards.mjs`) als auch von der App importiert; deshalb
 * reines ESM ohne Node-Abhängigkeiten.
 *
 * Nur Einträge mit `lifecycle: 'supported'` werden ausgeliefert. Jede andere
 * `.json`-Datei unter `MONITORED_UPSTREAM_ROOTS` ist ein Begleitartefakt: Der
 * Fetch entdeckt sie im gepinnten Tree, pinnt sie im Manifest und liefert ihre
 * Bytes nie als App-Artefakt aus.
 *
 * Jeder OSCAL-Eintrag führt zusätzlich die vom Artefakt deklarierte
 * `metadata.oscal-version` (GSPP-283). Das ist die erwartete Version des
 * konkreten BSI-Artefakts; welche Root×Version-Paare der Standard überhaupt
 * kennt und welches Schema dafür gilt, beantwortet ausschließlich
 * `oscalVersionMatrix.mjs`. Beide Fakten haben genau einen Ort, und
 * `validateSourceRegistry` kreuzt sie gegeneinander.
 */

import {
  getSchemaPin,
  isImpossibleCombination,
  isKnownOscalRootKey,
  isPinnedOscalVersion,
} from './oscalVersionMatrix.mjs';

const REGISTRY_KEY_GRAMMAR = /^[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

/** Gemeinsame NCName-kompatible Grammatik für artifactKey und catalogKey. */
export function hasRegistryKeyGrammar(value) {
  return typeof value === 'string' && REGISTRY_KEY_GRAMMAR.test(value);
}

const OSCAL_ROOT_TYPES = Object.freeze([
  'catalog',
  'profile',
  'mapping-collection',
  'component-definition',
]);

const LIFECYCLES = Object.freeze(['supported', 'preview', 'draft', 'blocked-by-upstream']);
const BSI_UPSTREAM_ISSUE_URL =
  /^https:\/\/github\.com\/BSI-Bund\/Stand-der-Technik-Bibliothek\/issues\/[1-9]\d*$/;

/**
 * Wurzeln, unter denen der Fetch liest: Produktpfade, materialisierte
 * Vokabulardateien und Begleitartefakte (`.json`) des gepinnten Trees.
 *
 * `documentation/namespaces` bleibt bewusst eng gefasst: der Vokabular-Ordner
 * ist der einzige fachlich relevante Teil von `documentation/`, der Rest
 * (OSCAL.md, datamodel/, Grafiken) gehört nicht in die Delta-Beobachtung.
 */
export const MONITORED_UPSTREAM_ROOTS = Object.freeze([
  'control_layer',
  'documentation/namespaces',
  'implementation_layer',
]);

export const SOURCE_REGISTRY = Object.freeze(
  [
    {
      artifactKey: 'catalog-gspp',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      catalogKey: 'gspp',
      upstreamPath: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      profileUpstreamPath: 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
      lifecycle: 'supported',
      entryCatalog: true,
      title: 'Grundschutz++ Anwenderkatalog',
    },
    {
      artifactKey: 'namespaces-bsi',
      kind: 'vocabulary-collection',
      upstreamDirectory: 'documentation/namespaces',
      fileSuffix: '.csv',
      lifecycle: 'supported',
      title: 'Offizielle BSI-Namespace-Vokabulare',
    },
    {
      artifactKey: 'catalog-lieferkette',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      catalogKey: 'lieferkette',
      upstreamPath: 'control_layer/Lieferkettensicherheit/Lieferkettensicherheit-resolved_catalog.json',
      profileUpstreamPath: 'control_layer/Lieferkettensicherheit/sources/profiles/Lieferkettensicherheit-profile.json',
      lifecycle: 'supported',
      title: 'Anwenderkatalog Lieferkettensicherheit',
    },
    {
      artifactKey: 'catalog-wlan',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      catalogKey: 'wlan',
      upstreamPath: 'control_layer/WLAN/WLAN-resolved_catalog.json',
      profileUpstreamPath: 'control_layer/WLAN/sources/profiles/WLAN-profile.json',
      lifecycle: 'supported',
      title: 'Anwenderkatalog WLAN',
    },
    {
      artifactKey: 'catalog-mindeststandard-tls',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      catalogKey: 'mindeststandard-tls',
      upstreamPath: 'control_layer/Mindeststandard-TLS/Entwurf-Mindeststandard-TLS-catalog.json',
      lifecycle: 'draft',
      title: 'Mindeststandard TLS (Entwurf)',
    },
  ].map((entry) => Object.freeze(entry)),
);

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Segmentsichere Repository-Pfade ohne Node-Abhängigkeit; bewusst gleich
 * streng wie `assertAllowedUpstreamRepoPath` in scripts/security-guards.mjs.
 */
export function isSafeRepoPath(path) {
  if (!isNonEmptyString(path)) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('..')) return false;
  return path.split('/').every((segment) => segment.length > 0 && segment !== '.');
}

export function isPathWithinMonitoredRoot(path) {
  if (!isSafeRepoPath(path)) return false;
  return MONITORED_UPSTREAM_ROOTS.some(
    (root) => path === root || path.startsWith(`${root}/`),
  );
}

/**
 * Kreuzt die vom Artefakt deklarierte OSCAL-Version gegen die Versionsmatrix
 * (GSPP-283). Fail-closed: eine fehlende, nicht gepinnte oder für diesen
 * Root-Typ unmögliche Version lässt das Register beim Import scheitern, statt
 * das Artefakt später gegen eine Nachbarversion zu prüfen.
 */
function assertMatrixCompatibleVersion(entry) {
  const { artifactKey, expectedRootType, oscalVersion } = entry;

  if (!isNonEmptyString(oscalVersion)) {
    throw new Error(`Missing oscalVersion in source registry entry ${artifactKey}`);
  }
  if (!isKnownOscalRootKey(expectedRootType)) {
    throw new Error(
      `Source registry entry ${artifactKey} uses a root type the version matrix does not know: ${expectedRootType}`,
    );
  }
  if (isImpossibleCombination(expectedRootType, oscalVersion)) {
    throw new Error(
      `Source registry entry ${artifactKey} declares an impossible OSCAL combination: ${expectedRootType} @ ${oscalVersion}`,
    );
  }
  if (!isPinnedOscalVersion(oscalVersion)) {
    throw new Error(
      `Source registry entry ${artifactKey} declares an unpinned OSCAL version: ${oscalVersion}`,
    );
  }
  if (!getSchemaPin(expectedRootType, oscalVersion)) {
    throw new Error(
      `Source registry entry ${artifactKey} has no pinned schema for ${expectedRootType} @ ${oscalVersion}`,
    );
  }
}

function assertArtifactKeyIsValid(entry, artifactKeys) {
  if (!hasRegistryKeyGrammar(entry.artifactKey)) {
    throw new Error(`artifactKey violates the key grammar: ${entry.artifactKey}`);
  }
  if (artifactKeys.has(entry.artifactKey)) {
    throw new Error(`Duplicate artifactKey in source registry: ${entry.artifactKey}`);
  }
  artifactKeys.add(entry.artifactKey);
}

function assertLifecycleIsValid(entry) {
  if (!LIFECYCLES.includes(entry.lifecycle)) {
    throw new Error(`Unknown lifecycle in source registry entry ${entry.artifactKey}: ${entry.lifecycle}`);
  }
}

function assertUpstreamIssueUsageIsValid(entry) {
  if (entry.lifecycle === 'blocked-by-upstream') {
    if (entry.kind !== 'oscal' || !BSI_UPSTREAM_ISSUE_URL.test(entry.upstreamIssue ?? '')) {
      throw new Error(`Blocked source registry entry requires a BSI upstream issue: ${entry.artifactKey}`);
    }
    return;
  }
  if (entry.upstreamIssue !== undefined) {
    throw new Error(`Only blocked source registry entries may declare an upstream issue: ${entry.artifactKey}`);
  }
}

function assertOscalRootTypeIsKnown(entry) {
  if (!OSCAL_ROOT_TYPES.includes(entry.expectedRootType)) {
    throw new Error(
      `Unknown OSCAL root type in source registry entry ${entry.artifactKey}: ${entry.expectedRootType}`,
    );
  }
}

function assertCatalogKeyUsageIsValid(entry, catalogKeys) {
  const isCatalog = entry.expectedRootType === 'catalog';
  if (!isCatalog && entry.catalogKey !== undefined) {
    throw new Error(
      `Entry ${entry.artifactKey} may define catalogKey only for root type "catalog"`,
    );
  }
  if (entry.catalogKey === undefined) {
    if (isCatalog && entry.lifecycle === 'supported') {
      throw new Error(
        `Supported catalog entry ${entry.artifactKey} requires a catalogKey for app delivery`,
      );
    }
    return;
  }
  if (!hasRegistryKeyGrammar(entry.catalogKey)) {
    throw new Error(`catalogKey violates the key grammar: ${entry.catalogKey}`);
  }
  if (catalogKeys.has(entry.catalogKey)) {
    throw new Error(`Duplicate catalogKey in source registry: ${entry.catalogKey}`);
  }
  catalogKeys.add(entry.catalogKey);
}

function assertEntryCatalogUsageIsValid(entry) {
  if (entry.entryCatalog === undefined) return;
  if (entry.entryCatalog !== true) {
    throw new Error(`entryCatalog must be true when present: ${entry.artifactKey}`);
  }
  const isSupportedCatalog =
    entry.expectedRootType === 'catalog' && entry.lifecycle === 'supported';
  if (!isSupportedCatalog) {
    throw new Error(
      `Only a supported catalog entry may be the entry catalog: ${entry.artifactKey}`,
    );
  }
}

function assertOscalEntryIsValid(entry, upstreamPaths, catalogKeys) {
  assertOscalRootTypeIsKnown(entry);
  assertMatrixCompatibleVersion(entry);

  if (!isSafeRepoPath(entry.upstreamPath)) {
    throw new Error(`Unsafe upstream path in source registry: ${entry.upstreamPath}`);
  }
  if (upstreamPaths.has(entry.upstreamPath)) {
    throw new Error(`Duplicate upstreamPath in source registry: ${entry.upstreamPath}`);
  }
  upstreamPaths.add(entry.upstreamPath);

  if (entry.profileUpstreamPath !== undefined) {
    if (entry.expectedRootType !== 'catalog' || !isPathWithinMonitoredRoot(entry.profileUpstreamPath)) {
      throw new Error(`Invalid profileUpstreamPath in source registry entry ${entry.artifactKey}`);
    }
    if (upstreamPaths.has(entry.profileUpstreamPath)) {
      throw new Error(`Duplicate upstreamPath in source registry: ${entry.profileUpstreamPath}`);
    }
    upstreamPaths.add(entry.profileUpstreamPath);
  }

  assertCatalogKeyUsageIsValid(entry, catalogKeys);
  assertEntryCatalogUsageIsValid(entry);
}

function assertVocabularyCollectionEntryIsValid(entry) {
  if (entry.entryCatalog !== undefined) {
    throw new Error(`Only a supported catalog entry may be the entry catalog: ${entry.artifactKey}`);
  }
  if (!isSafeRepoPath(entry.upstreamDirectory)) {
    throw new Error(`Unsafe upstream path in source registry: ${entry.upstreamDirectory}`);
  }
  if (!isNonEmptyString(entry.fileSuffix) || !entry.fileSuffix.startsWith('.')) {
    throw new Error(`Invalid fileSuffix in source registry entry ${entry.artifactKey}`);
  }
}

function assertEntryKindIsValid(entry) {
  if (entry.kind !== 'oscal' && entry.kind !== 'vocabulary-collection') {
    throw new Error(`Unknown kind in source registry entry ${entry.artifactKey}: ${entry.kind}`);
  }
}

export function validateSourceRegistry(entries = SOURCE_REGISTRY) {
  const artifactKeys = new Set();
  const upstreamPaths = new Set();
  const catalogKeys = new Set();

  for (const entry of entries) {
    assertArtifactKeyIsValid(entry, artifactKeys);
    assertLifecycleIsValid(entry);
    assertUpstreamIssueUsageIsValid(entry);
    if (!isNonEmptyString(entry.title)) {
      throw new Error(`Missing title in source registry entry ${entry.artifactKey}`);
    }

    if (entry.kind === 'oscal') {
      assertOscalEntryIsValid(entry, upstreamPaths, catalogKeys);
    } else if (entry.kind === 'vocabulary-collection') {
      assertVocabularyCollectionEntryIsValid(entry);
    } else {
      assertEntryKindIsValid(entry);
    }
  }
}

for (const root of MONITORED_UPSTREAM_ROOTS) {
  if (!isSafeRepoPath(root)) {
    throw new Error(`Unsafe monitored upstream root: ${root}`);
  }
}

for (const entry of SOURCE_REGISTRY) {
  const path = entry.kind === 'oscal' ? entry.upstreamPath : entry.upstreamDirectory;
  if (!isPathWithinMonitoredRoot(path)) {
    throw new Error(`Source registry path is outside monitored upstream roots: ${path}`);
  }
}

export function listArtifacts({ lifecycle } = {}) {
  if (lifecycle === undefined) return SOURCE_REGISTRY;
  return SOURCE_REGISTRY.filter((entry) => entry.lifecycle === lifecycle);
}

export function getArtifactByUpstreamPath(path) {
  if (!isNonEmptyString(path)) return null;

  for (const entry of SOURCE_REGISTRY) {
    if (entry.kind === 'oscal') {
      if (entry.upstreamPath === path) return entry;
      continue;
    }
    const prefix = `${entry.upstreamDirectory}/`;
    if (
      path.startsWith(prefix) &&
      path.endsWith(entry.fileSuffix) &&
      !path.slice(prefix.length).includes('/')
    ) {
      return entry;
    }
  }
  return null;
}

export function getExpectedRootType(path) {
  const entry = getArtifactByUpstreamPath(path);
  return entry?.kind === 'oscal' ? entry.expectedRootType : null;
}

export function listOscalArtifacts() {
  return SOURCE_REGISTRY.filter((entry) => entry.kind === 'oscal');
}

/** Pfade, die das Register als Produktartefakt führt (ohne Profile). */
export function listProductUpstreamPaths(entries = SOURCE_REGISTRY) {
  return entries.filter((entry) => entry.kind === 'oscal').map((entry) => entry.upstreamPath);
}

/**
 * Leitet den Schlüssel eines Begleitartefakts deterministisch aus seinem Pfad
 * ab: Endung `.json` entfernen, Kleinbuchstaben, jede Folge anderer Zeichen als
 * `[a-z0-9]` wird ein Bindestrich. Erfüllt das Ergebnis die Schlüsselgrammatik
 * nicht, gibt es `null` zurück.
 */
export function deriveCompanionArtifactKey(path) {
  if (!isSafeRepoPath(path) || !path.endsWith('.json')) return null;
  const key = path
    .slice(0, -'.json'.length)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return hasRegistryKeyGrammar(key) ? key : null;
}

export function getExpectedOscalVersion(path) {
  const entry = getArtifactByUpstreamPath(path);
  return entry?.kind === 'oscal' ? entry.oscalVersion : null;
}

/**
 * Verbindet Registry und Versionsmatrix: liefert den gepinnten Schema-Vertrag
 * für ein registriertes Artefakt. Die Registry steuert Root-Typ und Version
 * bei, die Matrix Herkunft, `$id` und Hash.
 */
export function getSchemaPinForArtifact(artifactKey) {
  const entry = SOURCE_REGISTRY.find(
    (candidate) => candidate.kind === 'oscal' && candidate.artifactKey === artifactKey,
  );
  if (!entry) return null;
  return getSchemaPin(entry.expectedRootType, entry.oscalVersion);
}

export function getCatalogByKey(catalogKey) {
  return (
    SOURCE_REGISTRY.find((entry) => entry.kind === 'oscal' && entry.catalogKey === catalogKey) ?? null
  );
}

export function listCatalogKeys() {
  return SOURCE_REGISTRY.filter((entry) => entry.kind === 'oscal' && entry.catalogKey !== undefined)
    .map((entry) => entry.catalogKey);
}

export function isCatalogKey(value) {
  return listCatalogKeys().includes(value);
}

/**
 * Alle produktiv ausgelieferten Kataloge in Registerreihenfolge (GSPP-284).
 *
 * Der frühere Ein-Katalog-Contract ist aufgelöst: die Lane trägt beliebig
 * viele `supported`-Kataloge. Die Untergrenze bleibt hart — ohne
 * ausgelieferten Katalog hätte die App keinen Einstieg.
 */
export function listSupportedCatalogs(entries = SOURCE_REGISTRY) {
  return entries.filter(
    (entry) =>
      entry.kind === 'oscal' &&
      entry.expectedRootType === 'catalog' &&
      entry.lifecycle === 'supported' &&
      entry.catalogKey !== undefined,
  );
}

/**
 * Der ausgewiesene Einstiegskatalog: der Katalog, den die App eager lädt und
 * dessen Artefakte den unveränderten Auslieferungsvertrag `catalog.json` /
 * `catalog-metadata.json` behalten.
 *
 * Die Auszeichnung ist ein explizites Registerfeld statt der Registerposition.
 * Eine Umsortierung des Registers darf den Einstiegs- und Cache-Vertrag der
 * ausgelieferten App nicht still verschieben.
 */
export function resolveEntryCatalog(entries = SOURCE_REGISTRY) {
  const supported = listSupportedCatalogs(entries);
  if (supported.length === 0) {
    throw new Error('Source registry must declare at least one supported catalog, found 0');
  }

  const designated = supported.filter((entry) => entry.entryCatalog === true);
  if (designated.length !== 1) {
    throw new Error(
      `Source registry must designate exactly one supported entry catalog, found ${designated.length}`,
    );
  }
  return designated[0];
}

/**
 * Dateiname des ausgelieferten Katalogdatenartefakts.
 *
 * Der Einstiegskatalog behält `catalog.json`; jeder weitere `supported`-Katalog
 * erhält einen aus seinem `catalogKey` abgeleiteten Namen. Der Name wird nie
 * von Hand gepflegt, damit Fetch-Lane, Ausgabe-Allowlist und Ladepfad nicht
 * auseinanderlaufen können.
 */
export function catalogDataFileName(entry) {
  assertSupportedCatalogEntry(entry);
  return entry.entryCatalog === true ? 'catalog.json' : `catalog-${entry.catalogKey}.json`;
}

/** Dateiname der Provenienz-/Integritätsmetadaten eines ausgelieferten Katalogs. */
export function catalogMetadataFileName(entry) {
  assertSupportedCatalogEntry(entry);
  return entry.entryCatalog === true
    ? 'catalog-metadata.json'
    : `catalog-${entry.catalogKey}-metadata.json`;
}

function assertSupportedCatalogEntry(entry) {
  if (
    entry?.kind !== 'oscal' ||
    entry.expectedRootType !== 'catalog' ||
    entry.lifecycle !== 'supported' ||
    !hasRegistryKeyGrammar(entry.catalogKey)
  ) {
    throw new Error(
      `Not a supported catalog registry entry: ${entry?.artifactKey ?? '<unknown>'}`,
    );
  }
}

/**
 * Vollständige Menge der Katalog-Ausgabedateien, abgeleitet aus dem
 * Quellregister. Ausgabe-Allowlist und Auslieferungsprüfung ziehen ihre
 * Erwartung hierher, statt eine gepflegte Liste zu führen.
 */
export function listCatalogArtifactFileNames(entries = SOURCE_REGISTRY) {
  const fileNames = [];
  for (const entry of listSupportedCatalogs(entries)) {
    fileNames.push(catalogDataFileName(entry), catalogMetadataFileName(entry));
  }
  return fileNames;
}

validateSourceRegistry(SOURCE_REGISTRY);

export const SUPPORTED_CATALOGS = Object.freeze(listSupportedCatalogs(SOURCE_REGISTRY));
export const ENTRY_CATALOG = resolveEntryCatalog(SOURCE_REGISTRY);
export const ENTRY_CATALOG_KEY = ENTRY_CATALOG.catalogKey;
export const SUPPORTED_CATALOG_KEYS = Object.freeze(
  SUPPORTED_CATALOGS.map((entry) => entry.catalogKey),
);
