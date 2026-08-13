/**
 * Quellregister für BSI-Upstream-Artefakte (ADR-1).
 *
 * Einzige Quelle der Wahrheit dafür, welche Upstream-Pfade das Projekt kennt,
 * welcher OSCAL-Root-Typ dort erwartet wird und welche Artefakte produktiv
 * ausgeliefert werden (`lifecycle: 'supported'`). Wird sowohl von den
 * Build-Skripten (`scripts/security-guards.mjs`) als auch von der App
 * importiert; deshalb reines ESM ohne Node-Abhängigkeiten.
 *
 * Nur Einträge mit `lifecycle: 'supported'` weiten die produktive Fetch- und
 * Auslieferungs-Allowlist. `preview`, `draft` und `blocked-by-upstream` dürfen
 * ausschließlich transient für Manifest-Provenienz und Root-Typ-Validierung
 * gelesen werden; ihre Bytes werden nie als App-Artefakte ausgegeben.
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

const KEY_GRAMMAR = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const OSCAL_ROOT_TYPES = Object.freeze([
  'catalog',
  'profile',
  'mapping-collection',
  'component-definition',
]);

const LIFECYCLES = Object.freeze(['supported', 'preview', 'draft', 'blocked-by-upstream']);
const BSI_UPSTREAM_ISSUE_URL =
  /^https:\/\/github\.com\/BSI-Bund\/Stand-der-Technik-Bibliothek\/issues\/[1-9]\d*$/;

const COMPONENT_DIRECTORY = 'implementation_layer';

/**
 * Read-only discovery roots for upstream tree comparisons. These roots do not
 * widen the fetch allowlist: only materialized SOURCE_REGISTRY entries may be
 * read, validated or shipped.
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
      lifecycle: 'supported',
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
      lifecycle: 'preview',
      title: 'Anwenderkatalog Lieferkettensicherheit',
    },
    {
      artifactKey: 'catalog-wlan',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      catalogKey: 'wlan',
      upstreamPath: 'control_layer/WLAN/WLAN-resolved_catalog.json',
      lifecycle: 'preview',
      title: 'Anwenderkatalog WLAN',
    },
    {
      artifactKey: 'catalog-iso27001-annex-a',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      catalogKey: 'iso27001-annex-a',
      upstreamPath: 'control_layer/ISO27001/ISO27001-AnnexA-catalog.json',
      lifecycle: 'blocked-by-upstream',
      upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/69',
      title: 'ISO/IEC 27001 Annex A Referenzkatalog',
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
    {
      artifactKey: 'profile-gspp',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'profile',
      upstreamPath: 'control_layer/Grundschutz++/sources/profiles/Grundschutz++-profile.json',
      lifecycle: 'preview',
      title: 'Grundschutz++ Profil',
    },
    {
      artifactKey: 'profile-lieferkette',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'profile',
      upstreamPath: 'control_layer/Lieferkettensicherheit/sources/profiles/Lieferkettensicherheit-profile.json',
      lifecycle: 'preview',
      title: 'Lieferkettensicherheit Profil',
    },
    {
      artifactKey: 'profile-wlan',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'profile',
      upstreamPath: 'control_layer/WLAN/sources/profiles/WLAN-profile.json',
      lifecycle: 'blocked-by-upstream',
      upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/87',
      title: 'WLAN Profil',
    },
    {
      artifactKey: 'mapping-iso27001-annex-a-zu-gspp',
      kind: 'oscal',
      oscalVersion: '1.2.2',
      expectedRootType: 'mapping-collection',
      upstreamPath: 'control_layer/Mappings/ISO-27001-zu-GSpp/ISO27001-AnnexA-to-GS++-mapping_collection.json',
      lifecycle: 'blocked-by-upstream',
      upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/68',
      title: 'Mapping ISO/IEC 27001 Annex A zu Grundschutz++',
    },
    {
      artifactKey: 'mapping-itgs2023-zu-gspp',
      kind: 'oscal',
      oscalVersion: '1.2.1',
      expectedRootType: 'mapping-collection',
      upstreamPath: 'control_layer/Mappings/IT-GS2023-zu-GSpp/ITGS-to-GS++-mapping_collection.json',
      lifecycle: 'preview',
      title: 'Mapping IT-Grundschutz 2023 zu Grundschutz++',
    },
    {
      artifactKey: 'component-aws-security-hub',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'component-definition',
      upstreamPath: `${COMPONENT_DIRECTORY}/AWS Beispiel-Components/AWS Security Hub-component_definition.json`,
      lifecycle: 'preview',
      title: 'Component Definition AWS Security Hub V2/Essentials',
    },
    {
      artifactKey: 'component-ga-lotse-grundmodul',
      kind: 'oscal',
      oscalVersion: '1.1.2',
      expectedRootType: 'component-definition',
      upstreamPath: `${COMPONENT_DIRECTORY}/GA-Lotse_Grundmodul/GA-Lotse_Grundmodul-component_definition.json`,
      lifecycle: 'blocked-by-upstream',
      upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/70',
      title: 'Component Definition GA-Lotse Grundmodul',
    },
    {
      artifactKey: 'component-lieferkette',
      kind: 'oscal',
      oscalVersion: '1.1.2',
      expectedRootType: 'component-definition',
      upstreamPath: `${COMPONENT_DIRECTORY}/Lieferkettensicherheit/Lieferkettensicherheit-component_definition.json`,
      lifecycle: 'blocked-by-upstream',
      upstreamIssue: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/issues/71',
      title: 'Component Definition Lieferkettensicherheit',
    },
    {
      artifactKey: 'component-netzarchitektur',
      kind: 'oscal',
      oscalVersion: '1.2.2',
      expectedRootType: 'component-definition',
      upstreamPath: `${COMPONENT_DIRECTORY}/Netzarchitektur/Netzarchitektur-component_definition.json`,
      lifecycle: 'preview',
      title: 'Component Definition Netzarchitektur',
    },
    {
      artifactKey: 'component-passwortrichtlinie',
      kind: 'oscal',
      oscalVersion: '1.1.2',
      expectedRootType: 'component-definition',
      upstreamPath: `${COMPONENT_DIRECTORY}/Passwortrichtlinie/Passwortrichtlinie-component_definition.json`,
      lifecycle: 'preview',
      title: 'Component Definition Passwortrichtlinie',
    },
    {
      artifactKey: 'component-keycloak',
      kind: 'oscal',
      oscalVersion: '1.2.2',
      expectedRootType: 'component-definition',
      upstreamPath: `${COMPONENT_DIRECTORY}/Keycloak/Keycloak-component_definition.json`,
      lifecycle: 'preview',
      title: 'Component Definition Keycloak',
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

export function validateSourceRegistry(entries = SOURCE_REGISTRY) {
  const artifactKeys = new Set();
  const upstreamPaths = new Set();
  const catalogKeys = new Set();

  for (const entry of entries) {
    if (!KEY_GRAMMAR.test(entry.artifactKey ?? '')) {
      throw new Error(`artifactKey violates the key grammar: ${entry.artifactKey}`);
    }
    if (artifactKeys.has(entry.artifactKey)) {
      throw new Error(`Duplicate artifactKey in source registry: ${entry.artifactKey}`);
    }
    artifactKeys.add(entry.artifactKey);

    if (!LIFECYCLES.includes(entry.lifecycle)) {
      throw new Error(`Unknown lifecycle in source registry entry ${entry.artifactKey}: ${entry.lifecycle}`);
    }
    if (entry.lifecycle === 'blocked-by-upstream') {
      if (entry.kind !== 'oscal' || !BSI_UPSTREAM_ISSUE_URL.test(entry.upstreamIssue ?? '')) {
        throw new Error(`Blocked source registry entry requires a BSI upstream issue: ${entry.artifactKey}`);
      }
    } else if (entry.upstreamIssue !== undefined) {
      throw new Error(`Only blocked source registry entries may declare an upstream issue: ${entry.artifactKey}`);
    }
    if (!isNonEmptyString(entry.title)) {
      throw new Error(`Missing title in source registry entry ${entry.artifactKey}`);
    }

    if (entry.kind === 'oscal') {
      if (!OSCAL_ROOT_TYPES.includes(entry.expectedRootType)) {
        throw new Error(
          `Unknown OSCAL root type in source registry entry ${entry.artifactKey}: ${entry.expectedRootType}`,
        );
      }
      assertMatrixCompatibleVersion(entry);
      if (!isSafeRepoPath(entry.upstreamPath)) {
        throw new Error(`Unsafe upstream path in source registry: ${entry.upstreamPath}`);
      }
      if (upstreamPaths.has(entry.upstreamPath)) {
        throw new Error(`Duplicate upstreamPath in source registry: ${entry.upstreamPath}`);
      }
      upstreamPaths.add(entry.upstreamPath);

      const isCatalog = entry.expectedRootType === 'catalog';
      if (isCatalog !== (entry.catalogKey !== undefined)) {
        throw new Error(
          `Entry ${entry.artifactKey} must define catalogKey exactly for root type "catalog"`,
        );
      }
      if (isCatalog) {
        if (!KEY_GRAMMAR.test(entry.catalogKey)) {
          throw new Error(`catalogKey violates the key grammar: ${entry.catalogKey}`);
        }
        if (catalogKeys.has(entry.catalogKey)) {
          throw new Error(`Duplicate catalogKey in source registry: ${entry.catalogKey}`);
        }
        catalogKeys.add(entry.catalogKey);
      }
    } else if (entry.kind === 'vocabulary-collection') {
      if (!isSafeRepoPath(entry.upstreamDirectory)) {
        throw new Error(`Unsafe upstream path in source registry: ${entry.upstreamDirectory}`);
      }
      if (!isNonEmptyString(entry.fileSuffix) || !entry.fileSuffix.startsWith('.')) {
        throw new Error(`Invalid fileSuffix in source registry entry ${entry.artifactKey}`);
      }
    } else {
      throw new Error(`Unknown kind in source registry entry ${entry.artifactKey}: ${entry.kind}`);
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

validateSourceRegistry(SOURCE_REGISTRY);

const supportedCatalogs = SOURCE_REGISTRY.filter(
  (entry) => entry.kind === 'oscal' && entry.expectedRootType === 'catalog' && entry.lifecycle === 'supported',
);
if (supportedCatalogs.length !== 1) {
  // Ein-Katalog-Contract der aktuellen Fetch-Lane; wird erst mit GRU-249 aufgeweicht.
  throw new Error(`Source registry must declare exactly one supported catalog, found ${supportedCatalogs.length}`);
}

export const SUPPORTED_CATALOG = supportedCatalogs[0];
export const SUPPORTED_CATALOG_KEY = SUPPORTED_CATALOG.catalogKey;
