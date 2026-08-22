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
      lifecycle: 'supported',
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
      artifactKey: 'catalog-source-gspp-kernel-g0',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      upstreamPath:
        'control_layer/Grundschutz++/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
      lifecycle: 'preview',
      title: 'BSI Stand der Technik Kernel G0',
    },
    {
      artifactKey: 'catalog-source-gspp-methodik',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      upstreamPath:
        'control_layer/Grundschutz++/sources/catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
      lifecycle: 'preview',
      title: 'BSI Methodik Grundschutz++',
    },
    {
      artifactKey: 'catalog-source-risikomanagement',
      kind: 'oscal',
      oscalVersion: '1.1.3',
      expectedRootType: 'catalog',
      upstreamPath: 'control_layer/Risikomanagement/BSI-Anforderungen-zum-Risikomanagement-catalog.json',
      lifecycle: 'preview',
      title: 'BSI Anforderungen zum Risikomanagement',
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
      lifecycle: 'preview',
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

/**
 * Explizite, unveränderte Zuordnung zwischen den relativen `rlinks.href` des
 * Grundschutz++-Profils und den materialisierten Registry-Artefakten.
 *
 * Die Resolver-Logik normalisiert relative Referenzen absichtlich nicht. Die
 * Zuordnung bleibt deshalb hier prüfbar und darf keine Pfadheuristik oder
 * Netzauflösung ersetzen.
 */
export const CATALOG_LINEAGES = Object.freeze([
  Object.freeze({
    catalogKey: 'gspp',
    profileArtifactKey: 'profile-gspp',
    imports: Object.freeze([
      Object.freeze({
        href: '../catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json',
        artifactKey: 'catalog-source-gspp-kernel-g0',
      }),
      Object.freeze({
        href: '../catalogs/Methodik-Grundschutz++/BSI-Methodik-Grundschutz++-catalog.json',
        artifactKey: 'catalog-source-gspp-methodik',
      }),
      Object.freeze({
        href: '../../../Risikomanagement/BSI-Anforderungen-zum-Risikomanagement-catalog.json',
        artifactKey: 'catalog-source-risikomanagement',
      }),
    ]),
  }),
]);

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
      if (!isCatalog && entry.catalogKey !== undefined) {
        throw new Error(
          `Entry ${entry.artifactKey} may define catalogKey only for root type "catalog"`,
        );
      }
      if (entry.catalogKey !== undefined) {
        if (!KEY_GRAMMAR.test(entry.catalogKey)) {
          throw new Error(`catalogKey violates the key grammar: ${entry.catalogKey}`);
        }
        if (catalogKeys.has(entry.catalogKey)) {
          throw new Error(`Duplicate catalogKey in source registry: ${entry.catalogKey}`);
        }
        catalogKeys.add(entry.catalogKey);
      }
      if (isCatalog && entry.lifecycle === 'supported' && entry.catalogKey === undefined) {
        throw new Error(
          `Supported catalog entry ${entry.artifactKey} requires a catalogKey for app delivery`,
        );
      }
      if (entry.entryCatalog !== undefined) {
        if (entry.entryCatalog !== true) {
          throw new Error(`entryCatalog must be true when present: ${entry.artifactKey}`);
        }
        if (!isCatalog || entry.lifecycle !== 'supported') {
          throw new Error(
            `Only a supported catalog entry may be the entry catalog: ${entry.artifactKey}`,
          );
        }
      }
    } else if (entry.kind === 'vocabulary-collection') {
      if (entry.entryCatalog !== undefined) {
        throw new Error(`Only a supported catalog entry may be the entry catalog: ${entry.artifactKey}`);
      }
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

function isInternalPreviewCatalogSource(entry) {
  return (
    entry?.kind === 'oscal' &&
    entry.expectedRootType === 'catalog' &&
    entry.lifecycle === 'preview' &&
    entry.catalogKey === undefined
  );
}

function validateCatalogLineageImport(importedCatalog, hrefs, artifactKeys, entriesByKey) {
  if (!isNonEmptyString(importedCatalog.href) || hrefs.has(importedCatalog.href)) {
    throw new Error(`Catalog lineage has duplicate or invalid href: ${importedCatalog.href}`);
  }
  hrefs.add(importedCatalog.href);

  if (!isNonEmptyString(importedCatalog.artifactKey) || artifactKeys.has(importedCatalog.artifactKey)) {
    throw new Error(
      `Catalog lineage has duplicate or invalid source artifact: ${importedCatalog.artifactKey}`,
    );
  }
  artifactKeys.add(importedCatalog.artifactKey);

  const source = entriesByKey.get(importedCatalog.artifactKey);
  if (!isInternalPreviewCatalogSource(source)) {
    throw new Error(
      `Catalog lineage source must be an internal preview catalog: ${importedCatalog.artifactKey}`,
    );
  }
}

function validateCatalogLineageImports(lineage, entriesByKey) {
  if (!Array.isArray(lineage.imports) || lineage.imports.length === 0) {
    throw new Error(`Catalog lineage requires at least one import: ${lineage.catalogKey}`);
  }

  const hrefs = new Set();
  const artifactKeys = new Set();
  for (const importedCatalog of lineage.imports) {
    validateCatalogLineageImport(importedCatalog, hrefs, artifactKeys, entriesByKey);
  }
}

/** Validiert, dass jede Lineage rein explizite, Registry-gebundene Kanten enthält. */
export function validateCatalogLineages(lineages = CATALOG_LINEAGES, entries = SOURCE_REGISTRY) {
  const lineagesByCatalog = new Set();
  const entriesByKey = new Map(entries.map((entry) => [entry.artifactKey, entry]));

  for (const lineage of lineages) {
    if (!isNonEmptyString(lineage.catalogKey) || lineagesByCatalog.has(lineage.catalogKey)) {
      throw new Error(`Duplicate or invalid catalog lineage key: ${lineage.catalogKey}`);
    }
    lineagesByCatalog.add(lineage.catalogKey);

    const hasTargetCatalog = entries.some(
      (entry) => entry.kind === 'oscal' && entry.catalogKey === lineage.catalogKey,
    );
    if (!hasTargetCatalog) {
      throw new Error(`Catalog lineage references unknown catalogKey: ${lineage.catalogKey}`);
    }

    const profile = entriesByKey.get(lineage.profileArtifactKey);
    if (profile?.kind !== 'oscal' || profile.expectedRootType !== 'profile') {
      throw new Error(`Catalog lineage references no profile artifact: ${lineage.profileArtifactKey}`);
    }

    validateCatalogLineageImports(lineage, entriesByKey);
  }
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
    !KEY_GRAMMAR.test(entry.catalogKey ?? '')
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
validateCatalogLineages(CATALOG_LINEAGES, SOURCE_REGISTRY);

export const SUPPORTED_CATALOGS = Object.freeze(listSupportedCatalogs(SOURCE_REGISTRY));
export const ENTRY_CATALOG = resolveEntryCatalog(SOURCE_REGISTRY);
export const ENTRY_CATALOG_KEY = ENTRY_CATALOG.catalogKey;
export const SUPPORTED_CATALOG_KEYS = Object.freeze(
  SUPPORTED_CATALOGS.map((entry) => entry.catalogKey),
);
