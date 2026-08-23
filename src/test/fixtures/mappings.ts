// =============================================================================
// Fixture-Korpus — OSCAL Mapping Collections (GSPP-245)
//
// Die beiden realen BSI-Mappings liegen **nicht** im Repository: `npm run
// fetch-catalog` materialisiert ausschließlich `supported`-Artefakte, und die
// beiden sind `preview` beziehungsweise `blocked-by-upstream`
// (`src/domain/sourceRegistry.mjs`). Der verbindliche Korpus ist deshalb
// fixture-basiert — dieselbe Konvention wie in `oscalRootDispatch.corpus.test.ts`,
// GSPP-286, GSPP-248 und GSPP-240.
//
// Eingefroren sind hier die am Snapshot `80694713a7a430d12eb2099893de23ad8bb6f780`
// **gemessenen Strukturen**: Zahl der Mapping Sets, Zahl der `maps` je Set, die
// Verteilung der Beziehungstypen, die maximale Zahl der `targets` je Eintrag,
// `status` und `method`, die sechs relativen Ressourcen-`href`, das
// Top-Level-`$schema` des ITGS-Mappings und die beiden schemafremden
// `provenance`-Felder des ISO-Mappings. Die Prosa und die Identitäten sind
// erfunden; die Strukturzahlen und die Pfade sind es nicht.
//
// `upstreamPath` und `oscalVersion` kommen aus dem Quellregister und werden
// hier nie zweitgepflegt (ADR-1, GSPP-283); das `$schema` des ITGS-Mappings
// kommt aus der Versionsmatrix und nicht aus einem zweiten Literal.
// =============================================================================

import { getSchemaPin, PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { listOscalArtifacts } from '@/domain/sourceRegistry';

type JsonObject = Record<string, unknown>;

/**
 * Die Versionen, in denen es das Mapping-Modell überhaupt gibt — aus der Matrix
 * abgeleitet, nicht aufgezählt. Vor OSCAL 1.2.0 existiert der Root nicht.
 */
export const MAPPING_PINNED_VERSIONS: readonly PinnedOscalVersion[] =
  PINNED_OSCAL_VERSIONS.filter((version) => getSchemaPin('mapping-collection', version) !== null);

/** Die jüngste gepinnte Mapping-Zelle; Vorgabe der synthetischen Fixtures. */
const DEFAULT_VERSION = MAPPING_PINNED_VERSIONS.at(-1)!;

/**
 * Die sechs am Bestand erhobenen Ressourcen-`href`.
 *
 * Alle sind relative Dateinamen, und außer `ISO27001-AnnexA-catalog.json` ist
 * keiner im Quellregister vertreten. Genau so bleiben sie: nicht normalisiert,
 * nicht aufgelöst und nicht als Traversal-Angriff etikettiert (GSPP-286).
 */
export const MAPPING_RESOURCE_HREFS = Object.freeze({
  isoSource: 'ISO27001-AnnexA-catalog.json',
  isoMethodik: 'BSI-Methodik-Grundschutz++-catalog.json',
  isoKernel: 'BSI-Stand-der-Technik-Kernel-catalog.json',
  itgsSource: 'itgs-source-catalog.json',
  itgsKernel: 'target-catalogs/05160af58864-BSI-Stand-der-Technik-Kernel-catalog.json',
  itgsMethodik: 'target-catalogs/30dc66259164-BSI-Methodik-Grundschutz__-catalog.json',
});

/**
 * Deterministische, schemagültige UUIDs (Typ 4, Variante 8). Ein Zähler statt
 * `crypto.randomUUID()`: Ein Fixture, das bei jedem Lauf andere Identitäten
 * trägt, taugt nicht als eingefrorener Korpus.
 */
function makeUuid(seed: string, index: number): string {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}-0000-4000-8000-${index.toString(16).padStart(12, '0')}`;
}

/* ------------------------------------------------------------------ */
/*  Strukturbeschreibung der beiden registrierten Mappings             */
/* ------------------------------------------------------------------ */

interface MappingSetSpec {
  readonly sourceHref: string;
  readonly targetHref: string;
  readonly status: string;
  readonly method: string;
  readonly matchingRationale: string;
  /** Beziehungstyp → Zahl der Einträge, am Bestand gezählt. */
  readonly relationships: Readonly<Record<string, number>>;
  /** Maximale Zahl der `targets` eines Eintrags in diesem Set. */
  readonly maxTargets: number;
  /** Ob `map` und `mapping-item` `props` tragen — im ITGS-Mapping tun sie es. */
  readonly entryProps: boolean;
}

export interface MappingArtifactSpec {
  readonly artifactKey: string;
  /** Aus dem Quellregister abgeleitet — hier nie zweitgepflegt (ADR-1). */
  readonly upstreamPath: string;
  /** Aus dem Quellregister abgeleitet — hier nie zweitgepflegt (GSPP-283). */
  readonly oscalVersion: PinnedOscalVersion;
  /** Ob das Dokument gegen sein gepinntes Schema valide ist (ADR-7). */
  readonly schemaValid: boolean;
  /** Ob das Dokument ein Top-Level-`$schema` trägt — das ITGS-Mapping tut es. */
  readonly schemaDirective: boolean;
  /**
   * Schemafremde `provenance`-Felder. Im ISO-Mapping sind das real
   * `qa-reviewed` und `qa-note`; sie verletzen `additionalProperties: false`
   * und sind zugleich der Beleg, dass ein projizierender Adapter Inhalt
   * verlöre.
   */
  readonly provenanceExtras?: Readonly<Record<string, string>>;
  readonly sets: readonly MappingSetSpec[];
}

const REGISTERED_MAPPING_ARTIFACTS = new Map(
  listOscalArtifacts()
    .filter((entry) => entry.expectedRootType === 'mapping-collection')
    .map((entry) => [entry.artifactKey, entry] as const),
);

function compareStringsByCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Die Schlüssel der registrierten Mappings, alphabetisch. */
export function listRegisteredMappingArtifactKeys(): readonly string[] {
  return [...REGISTERED_MAPPING_ARTIFACTS.keys()].sort(compareStringsByCodeUnit);
}

function registryFactsFor(artifactKey: string): {
  readonly artifactKey: string;
  readonly upstreamPath: string;
  readonly oscalVersion: PinnedOscalVersion;
} {
  const entry = REGISTERED_MAPPING_ARTIFACTS.get(artifactKey);
  if (!entry) {
    // Fail-loud statt eines Ersatzwerts: Ein Fixture für ein nicht (mehr)
    // registriertes Artefakt bildet nichts Reales nach.
    throw new Error(
      `Kein registriertes mapping-collection-Artefakt mit dem Schlüssel "${artifactKey}"`,
    );
  }
  return {
    artifactKey: entry.artifactKey,
    upstreamPath: entry.upstreamPath,
    oscalVersion: entry.oscalVersion,
  };
}

/**
 * Die beiden registrierten Mappings mit ihren gemessenen Strukturzahlen.
 *
 * Auffällig und bewusst so übernommen: `no-relationship` kommt in **keinem**
 * der beiden Artefakte vor, `sources` ist überall einelementig, und
 * `qualifiers`, `confidence-score`, `coverage` sowie die Gap-Summaries fehlen
 * ganz. Diese Fälle stehen deshalb als synthetische Fixtures weiter unten —
 * nicht, weil sie unwichtig wären, sondern weil der Bestand sie nicht belegt.
 */
export const MAPPING_ARTIFACT_SPECS: readonly MappingArtifactSpec[] = Object.freeze([
  {
    ...registryFactsFor('mapping-iso27001-annex-a-zu-gspp'),
    // `provenance.qa-reviewed` und `provenance.qa-note` verletzen
    // `additionalProperties: false` — genau zwei Befunde (ADR-7).
    schemaValid: false,
    schemaDirective: false,
    provenanceExtras: {
      'qa-reviewed': '2026-05-27',
      'qa-note': 'Formale Konsistenz gegen die JSON- und Excel-Ausgaben geprüft.',
    },
    sets: [
      {
        sourceHref: MAPPING_RESOURCE_HREFS.isoSource,
        targetHref: MAPPING_RESOURCE_HREFS.isoMethodik,
        status: 'complete',
        method: 'human',
        matchingRationale: 'semantic',
        relationships: { 'subset-of': 10, 'equivalent-to': 2, 'intersects-with': 1 },
        maxTargets: 4,
        entryProps: false,
      },
      {
        sourceHref: MAPPING_RESOURCE_HREFS.isoSource,
        targetHref: MAPPING_RESOURCE_HREFS.isoKernel,
        status: 'complete',
        method: 'human',
        matchingRationale: 'semantic',
        relationships: { 'subset-of': 65, 'equivalent-to': 14, 'intersects-with': 4 },
        maxTargets: 10,
        entryProps: false,
      },
    ],
  },
  {
    ...registryFactsFor('mapping-itgs2023-zu-gspp'),
    schemaValid: true,
    schemaDirective: true,
    sets: [
      {
        sourceHref: MAPPING_RESOURCE_HREFS.itgsSource,
        targetHref: MAPPING_RESOURCE_HREFS.itgsKernel,
        status: 'draft',
        method: 'human',
        matchingRationale: 'semantic',
        relationships: {
          'subset-of': 391,
          'equivalent-to': 105,
          'intersects-with': 333,
          'superset-of': 168,
          'equal-to': 16,
        },
        maxTargets: 1,
        entryProps: true,
      },
      {
        sourceHref: MAPPING_RESOURCE_HREFS.itgsSource,
        targetHref: MAPPING_RESOURCE_HREFS.itgsMethodik,
        status: 'draft',
        method: 'human',
        matchingRationale: 'semantic',
        relationships: {
          'subset-of': 73,
          'equivalent-to': 13,
          'intersects-with': 62,
          'superset-of': 19,
          'equal-to': 5,
        },
        maxTargets: 1,
        entryProps: true,
      },
    ],
  },
]);

export function mappingSpecFor(artifactKey: string): MappingArtifactSpec {
  const specification = MAPPING_ARTIFACT_SPECS.find(
    (entry) => entry.artifactKey === artifactKey,
  );
  if (!specification) {
    throw new Error(`Kein Mapping-Fixture für den Artefaktschlüssel "${artifactKey}"`);
  }
  return specification;
}

/* ------------------------------------------------------------------ */
/*  Aufbau der Dokumente                                               */
/* ------------------------------------------------------------------ */

function makeItem(type: string, idRef: string, withProps: boolean): JsonObject {
  return withProps
    ? { type, 'id-ref': idRef, props: [{ name: 'itgs-id', value: idRef }] }
    : { type, 'id-ref': idRef };
}

function makeSet(spec: MappingSetSpec, seed: string, setIndex: number): JsonObject {
  let entryIndex = 0;
  const maps = Object.entries(spec.relationships).flatMap(([relationship, count]) =>
    Array.from({ length: count }, () => {
      const index = entryIndex;
      entryIndex += 1;
      // Nur der erste Eintrag trägt die gemessene Maximalzahl an `targets`;
      // entscheidend ist, dass die Kardinalität überhaupt vorkommt.
      const targetCount = index === 0 ? spec.maxTargets : 1;

      const entry: JsonObject = {
        uuid: makeUuid(`${seed}-map-${setIndex}`, index),
        relationship,
        sources: [makeItem('control', `SRC-${setIndex}.${index}`, spec.entryProps)],
        targets: Array.from({ length: targetCount }, (_unused, target) =>
          makeItem('control', `TGT-${setIndex}.${index}.${target}`, spec.entryProps),
        ),
      };
      if (spec.entryProps) {
        entry.props = [{ name: 'relationship-defaulted', value: 'false' }];
      }
      return entry;
    }),
  );

  return {
    uuid: makeUuid(`${seed}-set`, setIndex),
    method: spec.method,
    'matching-rationale': spec.matchingRationale,
    status: spec.status,
    'source-resource': { type: 'catalog', href: spec.sourceHref },
    'target-resource': { type: 'catalog', href: spec.targetHref },
    maps,
  };
}

function makeMetadata(oscalVersion: PinnedOscalVersion, title: string): JsonObject {
  return {
    title,
    'last-modified': '2026-08-17T00:00:00Z',
    version: '1.0.1-qa',
    'oscal-version': oscalVersion,
  };
}

/** Baut ein Dokument aus seiner gemessenen Strukturbeschreibung. */
export function makeMappingSource(spec: MappingArtifactSpec): JsonObject {
  const pin = getSchemaPin('mapping-collection', spec.oscalVersion);
  if (!pin) {
    throw new Error(`Die Versionsmatrix pinnt mapping-collection@${spec.oscalVersion} nicht`);
  }

  const collection: JsonObject = {
    uuid: makeUuid(spec.artifactKey, 0),
    metadata: makeMetadata(spec.oscalVersion, `Mapping ${spec.artifactKey}`),
    provenance: {
      method: 'human',
      'matching-rationale': 'semantic',
      status: spec.sets[0]?.status ?? 'draft',
      'mapping-description': 'Fixture-Nachbildung der gemessenen Struktur.',
      ...spec.provenanceExtras,
    },
    mappings: spec.sets.map((set, index) => makeSet(set, spec.artifactKey, index)),
  };

  // Das ITGS-Mapping trägt ein Top-Level-`$schema`. Es muss erhalten bleiben,
  // wählt aber nie aus — das tut allein `metadata.oscal-version`.
  return spec.schemaDirective
    ? { $schema: pin.schemaId, 'mapping-collection': collection }
    : { 'mapping-collection': collection };
}

/** Beide registrierten Mappings mit ihrer Strukturbeschreibung. */
export function makeAllMappingSources(): readonly {
  readonly specification: MappingArtifactSpec;
  readonly source: JsonObject;
}[] {
  return MAPPING_ARTIFACT_SPECS.map((specification) => ({
    specification,
    source: makeMappingSource(specification),
  }));
}

/* ------------------------------------------------------------------ */
/*  Synthetische Fixtures — normativ vorhanden, im Bestand nicht belegt */
/* ------------------------------------------------------------------ */

interface MinimalMappingOptions {
  readonly oscalVersion?: PinnedOscalVersion;
  /** Ersetzt den einzigen `map`-Eintrag vollständig. */
  readonly entry?: JsonObject;
  /** Ergänzt oder überschreibt Felder des Mapping Sets. */
  readonly set?: JsonObject;
  /** Ergänzt oder überschreibt Felder der `provenance`; `null` entfernt sie. */
  readonly provenance?: JsonObject | null;
  /** Ergänzt oder überschreibt Felder des Sammlungskörpers. */
  readonly collection?: JsonObject;
  /** Top-Level-`$schema`-Wert, falls das Dokument einen tragen soll. */
  readonly schemaDirective?: string;
}

/**
 * Das kleinste schemavalide Mapping-Dokument: eine Sammlung, ein Set, ein
 * Eintrag. Grundlage aller synthetischen Varianten — jede Variante ändert
 * genau das, worum es ihr geht.
 */
export function makeMinimalMappingSource(options: MinimalMappingOptions = {}): JsonObject {
  const oscalVersion = options.oscalVersion ?? DEFAULT_VERSION;
  const entry: JsonObject = options.entry ?? {
    uuid: makeUuid('minimal-map', 0),
    relationship: 'subset-of',
    sources: [{ type: 'control', 'id-ref': 'SRC-1' }],
    targets: [{ type: 'control', 'id-ref': 'TGT-1' }],
  };

  const collection: JsonObject = {
    uuid: makeUuid('minimal-collection', 0),
    metadata: makeMetadata(oscalVersion, 'Synthetisches Mapping'),
    mappings: [{
      uuid: makeUuid('minimal-set', 0),
      'source-resource': { type: 'catalog', href: MAPPING_RESOURCE_HREFS.isoSource },
      'target-resource': { type: 'catalog', href: MAPPING_RESOURCE_HREFS.isoKernel },
      maps: [entry],
      ...options.set,
    }],
  };

  if (options.provenance !== null) {
    collection.provenance = {
      method: 'human',
      'matching-rationale': 'semantic',
      status: 'draft',
      'mapping-description': 'Synthetisches Fixture.',
      ...options.provenance,
    };
  }

  const document: JsonObject = {
    'mapping-collection': { ...collection, ...options.collection },
  };
  return options.schemaDirective === undefined
    ? document
    : { $schema: options.schemaDirective, ...document };
}

/**
 * Die **explizite** Lücke. Im BSI-Bestand kommt `no-relationship` nicht vor;
 * ohne dieses Fixture bliebe die Kernsemantik des Modells ungeprüft.
 */
export function makeMappingWithExplicitGap(): JsonObject {
  return makeMinimalMappingSource({
    set: {
      maps: [
        {
          uuid: makeUuid('gap-map', 0),
          relationship: 'no-relationship',
          sources: [{ type: 'control', 'id-ref': 'SRC-GAP' }],
          targets: [{ type: 'control', 'id-ref': 'TGT-GAP' }],
        },
        {
          uuid: makeUuid('gap-map', 1),
          relationship: 'equivalent-to',
          sources: [{ type: 'control', 'id-ref': 'SRC-MAPPED' }],
          targets: [{ type: 'control', 'id-ref': 'TGT-MAPPED' }],
        },
      ],
    },
  });
}

/**
 * Die **zweite** Ausdrucksform der Lücke: Controls, die ausschließlich in den
 * Gap-Summaries beider Seiten namentlich als ungemappt geführt werden. Dazu ein
 * Widerspruch — eine ID, die zugleich abgebildet und als ungemappt aufgezählt
 * ist — und ein Muster, das nie ausgewertet wird.
 */
export function makeMappingWithGapSummaryIds(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('gap-summary-map', 0),
      relationship: 'subset-of',
      sources: [{ type: 'control', 'id-ref': 'SRC-WIDERSPRUCH' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-1' }],
    },
    set: {
      'source-gap-summary': {
        uuid: makeUuid('gap-summary-ids', 0),
        'unmapped-controls': [
          { 'with-ids': ['SRC-NUR-SUMMARY', 'SRC-WIDERSPRUCH'] },
          { matching: [{ pattern: 'SRC-MUSTER-*' }] },
        ],
      },
      'target-gap-summary': {
        uuid: makeUuid('gap-summary-ids', 1),
        'unmapped-controls': [{ 'with-ids': ['TGT-NUR-SUMMARY'] }],
      },
    },
  });
}

/** Echtes m:n plus `statement`-Granularität — beides im Bestand nicht belegt. */
export function makeMappingWithManyToMany(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('many-to-many', 0),
      relationship: 'intersects-with',
      sources: [
        { type: 'control', 'id-ref': 'SRC-A' },
        { type: 'statement', 'id-ref': 'SRC-B_smt.1' },
      ],
      targets: [
        { type: 'control', 'id-ref': 'TGT-A' },
        { type: 'control', 'id-ref': 'TGT-B' },
        { type: 'statement', 'id-ref': 'TGT-C_smt.2' },
      ],
    },
  });
}

/**
 * Die im Bestand fehlenden Qualitätsangaben: `qualifiers`, `confidence-score`,
 * `coverage`, beide Gap-Summaries, `matching-rationale` auf `map`-Ebene und ein
 * Ziel vom Typ `profile`.
 */
export function makeMappingWithQualityAnnotations(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('annotated-map', 0),
      relationship: 'subset-of',
      'matching-rationale': 'functional',
      sources: [{ type: 'control', 'id-ref': 'SRC-Q' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-Q' }],
      qualifiers: [{
        subject: 'both',
        predicate: 'has-requirement',
        category: 'addressable',
        description: 'Die Zielanforderung verlangt eine zusätzliche Freigabe.',
      }],
      'confidence-score': { category: 'high' },
      coverage: { 'generation-method': 'arbitrary', 'target-coverage': 0.5 },
    },
    set: {
      'target-resource': { type: 'profile', href: MAPPING_RESOURCE_HREFS.isoKernel },
      'source-gap-summary': {
        uuid: makeUuid('gap-summary', 0),
        'unmapped-controls': [{ 'with-ids': ['SRC-UNMAPPED'] }],
      },
      'target-gap-summary': {
        uuid: makeUuid('gap-summary', 1),
        'unmapped-controls': [{ matching: [{ pattern: 'TGT-*' }] }],
      },
      'confidence-score': { percentage: 0.75 },
      coverage: { 'target-coverage': 0.25 },
    },
  });
}

/**
 * `mappings` in der **Einzelform**. Sie ist schemavalide: Das Schema führt
 * `mappings` als `anyOf` aus einem Mapping-Objekt und einem Array.
 */
export function makeMappingWithSingleMappingObject(): JsonObject {
  const source = makeMinimalMappingSource();
  const collection = source['mapping-collection'] as JsonObject;
  const mappings = collection.mappings as JsonObject[];

  return { 'mapping-collection': { ...collection, mappings: mappings[0] } };
}

/**
 * Ein Dokument mit allem, was ein projizierender Adapter verlieren würde:
 * unbekannte Felder auf drei Ebenen, ein bedeutungstragendes leeres Objekt, ein
 * leeres Array, ein `prop.remarks` — ein reguläres OSCAL-Feld, das das
 * Domänenmodell nicht kennt — sowie `links` und `remarks` an jedem Knoten.
 */
export function makeRichMappingSource(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('rich-map', 0),
      relationship: 'equal-to',
      'matching-rationale': 'syntactic',
      sources: [{
        type: 'control',
        'id-ref': 'SRC-RICH',
        props: [{ name: 'herkunft', value: 'fixture', remarks: 'Unbekannt im Modell.' }],
        links: [{ href: '#ressource', rel: 'related' }],
        remarks: 'Ein Hinweis am Item.',
      }],
      targets: [{ type: 'control', 'id-ref': 'TGT-RICH' }],
      remarks: 'Ein Hinweis am Eintrag.',
      'x-bsi-leeres-objekt': {},
      'x-bsi-leere-liste': [],
    },
    set: {
      remarks: 'Ein Hinweis am Mapping Set.',
      'x-bsi-erweiterung': { hinweis: 'Unbekanntes Feld.' },
    },
    provenance: {
      'qa-reviewed': '2026-05-27',
      'qa-note': 'Schemafremd, aber nicht verlierbar.',
    },
    collection: {
      metadata: {
        title: 'Reiches Mapping',
        'last-modified': '2026-08-17T00:00:00Z',
        version: '1',
        'oscal-version': DEFAULT_VERSION,
        'x-bsi-metadatenfeld': ['a', 'b'],
      },
    },
  });
}

/** Ein Beziehungstyp aus einem **fremden** Namensraum — laut Metaschema zulässig. */
export function makeMappingWithNamespacedRelationship(ns: string): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('namespaced-map', 0),
      ns,
      relationship: 'partially-implements',
      sources: [{ type: 'control', 'id-ref': 'SRC-NS' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-NS' }],
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Negativkorpus                                                      */
/* ------------------------------------------------------------------ */

/** Ein erfundener Beziehungstyp — vom JSON-Schema **nicht** abgewiesen. */
export function makeMappingWithUnknownRelationship(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('unknown-relationship', 0),
      relationship: 'maps-to',
      sources: [{ type: 'control', 'id-ref': 'SRC-X' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-X' }],
    },
  });
}

export function makeMappingWithoutRelationship(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('missing-relationship', 0),
      sources: [{ type: 'control', 'id-ref': 'SRC-X' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-X' }],
    },
  });
}

/** `mapping-item.type: "group"` — eine Granularität, die das Modell nicht kennt. */
export function makeMappingWithUnknownItemType(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('unknown-item-type', 0),
      relationship: 'subset-of',
      sources: [{ type: 'group', 'id-ref': 'SRC-GROUP' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-X' }],
    },
  });
}

/** `mapping-resource-reference.type: "component-definition"`. */
export function makeMappingWithUnknownResourceType(): JsonObject {
  return makeMinimalMappingSource({
    set: {
      'target-resource': {
        type: 'component-definition',
        href: MAPPING_RESOURCE_HREFS.isoKernel,
      },
    },
  });
}

export function makeMappingWithUnknownStatus(): JsonObject {
  return makeMinimalMappingSource({ set: { status: 'published' } });
}

export function makeMappingWithoutProvenance(): JsonObject {
  return makeMinimalMappingSource({ provenance: null });
}

export function makeMappingWithoutMappings(): JsonObject {
  return makeMinimalMappingSource({ collection: { mappings: [] } });
}

/** Ein Eintrag ohne Subjekt: `sources` fehlt ganz. */
export function makeMappingWithoutSources(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('without-sources', 0),
      relationship: 'subset-of',
      targets: [{ type: 'control', 'id-ref': 'TGT-X' }],
    },
  });
}

export function makeMappingWithoutResourceHref(): JsonObject {
  return makeMinimalMappingSource({ set: { 'source-resource': { type: 'catalog' } } });
}

/** Ein `href` auf einen fremden Host — er darf keinen Netzzugriff auslösen. */
export function makeMappingWithExternalHref(href: string): JsonObject {
  return makeMinimalMappingSource({
    set: { 'target-resource': { type: 'catalog', href } },
  });
}

/** Zwei `map`-Einträge unter derselben `uuid`. */
export function makeMappingWithDuplicateUuid(): JsonObject {
  const uuid = makeUuid('duplicate', 0);
  return makeMinimalMappingSource({
    set: {
      maps: [
        {
          uuid,
          relationship: 'subset-of',
          sources: [{ type: 'control', 'id-ref': 'SRC-1' }],
          targets: [{ type: 'control', 'id-ref': 'TGT-1' }],
        },
        {
          uuid,
          relationship: 'superset-of',
          sources: [{ type: 'control', 'id-ref': 'SRC-2' }],
          targets: [{ type: 'control', 'id-ref': 'TGT-2' }],
        },
      ],
    },
  });
}

/**
 * Eine Version, in der es das Mapping-Modell **nicht gibt**. Der Unterschied zu
 * „nicht gepinnt" ist der Kern des Negativtests: Ein `oscal_mapping_schema.json`
 * existiert in den Releases v1.1.2 und v1.1.3 nicht.
 */
export function makeMappingWithImpossibleVersion(version: string): JsonObject {
  const source = makeMinimalMappingSource();
  const collection = source['mapping-collection'] as JsonObject;
  const metadata = collection.metadata as JsonObject;

  return {
    'mapping-collection': {
      ...collection,
      metadata: { ...metadata, 'oscal-version': version },
    },
  };
}

/** Eine syntaktisch gültige, aber nicht gepinnte Version oberhalb des Modells. */
export function makeMappingWithUnpinnedVersion(version = '1.3.0'): JsonObject {
  return makeMappingWithImpossibleVersion(version);
}

export function makeMappingWithoutVersion(): JsonObject {
  const source = makeMinimalMappingSource();
  const collection = source['mapping-collection'] as JsonObject;
  const metadata = Object.fromEntries(
    Object.entries(collection.metadata as JsonObject).filter(
      ([key]) => key !== 'oscal-version',
    ),
  );

  return { 'mapping-collection': { ...collection, metadata } };
}

/** Ein Dokument mit Top-Level-`$schema`; der Wert wird vom Test gewählt. */
export function makeMappingWithSchemaDirective(
  oscalVersion: PinnedOscalVersion,
  schemaDirective: string,
): JsonObject {
  return makeMinimalMappingSource({ oscalVersion, schemaDirective });
}

/**
 * Zwei Einträge auf **derselben** Quell-`id-ref`: eine erklärte Lücke und eine
 * Abbildung. Der Fall entscheidet die Abdeckungsregel — eine Aussage über eine
 * Beziehung wiegt schwerer als die Aussage, dass es keine gibt.
 */
export function makeMappingWithRepeatedSourceIdRef(): JsonObject {
  return makeMinimalMappingSource({
    set: {
      maps: [
        {
          uuid: makeUuid('repeated', 0),
          relationship: 'no-relationship',
          sources: [{ type: 'control', 'id-ref': 'SRC-DOPPELT' }],
          targets: [{ type: 'control', 'id-ref': 'TGT-1' }],
        },
        {
          uuid: makeUuid('repeated', 1),
          relationship: 'subset-of',
          // Dieselbe ID zweimal im selben Eintrag: Sie zählt trotzdem einmal.
          sources: [
            { type: 'control', 'id-ref': 'SRC-DOPPELT' },
            { type: 'control', 'id-ref': 'SRC-DOPPELT' },
          ],
          targets: [{ type: 'control', 'id-ref': 'TGT-2' }],
        },
      ],
    },
  });
}

/**
 * Ein Mapping Set ohne benannte Seiten und mit einem `maps`-Eintrag, der gar
 * kein Objekt ist. Ohne `source-resource` und `target-resource` ist nicht mehr
 * gesagt, **worüber** die Einträge etwas aussagen.
 */
export function makeMappingWithoutResources(): JsonObject {
  const source = makeMinimalMappingSource({
    set: { maps: ['kein Objekt'] },
  });
  const collection = source['mapping-collection'] as JsonObject;
  const [set] = collection.mappings as JsonObject[];
  const reduced = Object.fromEntries(
    Object.entries(set!).filter(
      ([key]) => key !== 'source-resource' && key !== 'target-resource',
    ),
  );

  return { 'mapping-collection': { ...collection, mappings: [reduced] } };
}

/** Eine Ressource ohne `type` — die Seite ist da, ihre Art ist unbenannt. */
export function makeMappingWithoutResourceType(): JsonObject {
  return makeMinimalMappingSource({
    set: { 'source-resource': { href: MAPPING_RESOURCE_HREFS.isoSource } },
  });
}

/** Ein Item ohne `id-ref` — das Subjekt der Beziehung fehlt. */
export function makeMappingWithoutItemIdRef(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('without-id-ref', 0),
      relationship: 'subset-of',
      sources: [{ type: 'control' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-X' }],
    },
  });
}

/**
 * Formfremde Werte an den Detailknoten: ein nicht-textueller `relationship`,
 * eine Ressource und ein `confidence-score` als Skalar, eine `coverage` ohne
 * Pflichtwert, ein `prop` ohne `value`, ein `link` ohne `href` und ein
 * `with-ids`-Eintrag, der kein String ist.
 *
 * Sie stehen alle in **einem** Dokument, weil die Leserregel eine ist: Ein
 * vorhandener Wert der falschen Form wird diagnostiziert, nicht verschluckt.
 */
export function makeMappingWithMalformedDetails(): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('malformed-details', 0),
      relationship: 42,
      sources: [{
        type: 'control',
        'id-ref': 'SRC-1',
        props: 'keine Liste',
        links: [{ rel: 'related' }],
      }],
      targets: [{ type: 'control', 'id-ref': 'TGT-1' }],
      'confidence-score': 'kein Objekt',
      coverage: { 'generation-method': 'arbitrary' },
      props: [{ name: 'ohne-wert' }],
    },
    set: {
      'source-resource': 'kein Objekt',
      'source-gap-summary': 'kein Objekt',
      'target-gap-summary': {
        uuid: makeUuid('malformed-details', 1),
        'unmapped-controls': [{ 'with-ids': ['TGT-1', 7] }],
      },
      'confidence-score': { category: 5, percentage: 'kein Wert' },
    },
  });
}

/**
 * Ein erfundener Beziehungstyp unter dem **ausdrücklich** deklarierten
 * OSCAL-Namensraum. Er darf keinen Freibrief bekommen: Die Vokabularbindung
 * gilt genau dort.
 */
export function makeMappingWithOscalNamespacedRelationship(ns: string): JsonObject {
  return makeMinimalMappingSource({
    entry: {
      uuid: makeUuid('oscal-ns-map', 0),
      ns,
      relationship: 'maps-to',
      sources: [{ type: 'control', 'id-ref': 'SRC-NS' }],
      targets: [{ type: 'control', 'id-ref': 'TGT-NS' }],
    },
  });
}

/** Ein Ressourcentyp unter fremdem Namensraum — laut Metaschema eine Erweiterung. */
export function makeMappingWithNamespacedResourceType(ns: string): JsonObject {
  return makeMinimalMappingSource({
    set: {
      'target-resource': {
        ns,
        type: 'katalogauszug',
        href: MAPPING_RESOURCE_HREFS.isoKernel,
      },
    },
  });
}

/**
 * Formfremde Knoten an den Stellen, an denen ein naives `?? []` still zu einer
 * leeren Liste würde: `maps` als Objekt, `sources` als String, `props` als
 * String, `provenance` als Skalar.
 */
export function makeMalformedMappingSource(): JsonObject {
  return makeMinimalMappingSource({
    set: {
      maps: { uuid: makeUuid('malformed', 0), relationship: 'subset-of' },
      props: 'keine Liste',
    },
    collection: { provenance: 'kein Objekt' },
  });
}

/** Zwei Root-Keys — der Dispatch muss das abweisen, nicht auswählen. */
export function makeMappingWithTwoRootKeys(): JsonObject {
  const source = makeMinimalMappingSource();
  return {
    ...source,
    catalog: { metadata: makeMetadata(DEFAULT_VERSION, 'Zweiter Root') },
  };
}

/** Ein fremder Root im Mapping-Einstieg. */
export function makeCatalogSourceForMappingEntry(): JsonObject {
  return {
    catalog: {
      uuid: makeUuid('foreign-root', 0),
      metadata: makeMetadata(DEFAULT_VERSION, 'Katalog statt Mapping'),
    },
  };
}
