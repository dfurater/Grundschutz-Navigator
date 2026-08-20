// =============================================================================
// Raw-Typen des OSCAL-Root-Modells `mapping-collection` (GSPP-245)
//
// Eine Mapping Collection ist kein Katalog und keine Anweisung auf einen
// Katalog: Sie beschreibt **Beziehungen** zwischen Controls oder
// Control-Statements zweier autoritativer Quellen. Kein anderes OSCAL-Modell
// importiert sie; sie steht neben der Kette Catalog → Profile → SSP.
//
// Anders als beim Profile (GSPP-240) und beim Component-Modell (GSPP-248) sind
// diese Typen **nicht** über `PinnedOscalVersion` parametrisiert — und das ist
// eine gemessene Aussage, keine Bequemlichkeit: Das Modell existiert erst ab
// OSCAL 1.2.0 (`oscalVersionMatrix.mjs`), gepinnt sind damit genau zwei Zellen,
// und deren vendorierte Schemas sind bis auf ihre `$id` **definitionsgleich**.
// Ein Feldprädikat hätte hier keine Partition zu beschreiben. Gegen ein stilles
// Abdriften — etwa durch eine fünfte gepinnte Version — schützt
// `oscalMapping.versionDrift.test.ts`: Er misst die Gleichheit an den Dateien,
// statt sie hier zu behaupten.
//
// Verlustfreiheit (ADR-2) liegt nicht an diesen Typen: Die Wahrheit ist der
// unveränderte `source`. Die Typen beschreiben, was die Projektion lesen darf.
// =============================================================================

import type { RawOscalLink, RawOscalMetadata, RawOscalProp } from '@/domain/models';

/**
 * Eine Kante innerhalb einer Quelle oder eines Ziels.
 *
 * `type` ist im Schema per `allOf` auf `control` und `statement` begrenzt —
 * andere Granularitäten (Gruppe, Praktik, Thema) sind im Modell **nicht**
 * vorgesehen. `id-ref` ist eine Control- oder Statement-ID im Kontext der
 * jeweiligen Ressource und ohne diesen Kontext mehrdeutig.
 */
export interface RawOscalMappingItem {
  type: string;
  'id-ref': string;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  remarks?: string;
}

/**
 * Die Quell- oder Zielseite einer `mapping`.
 *
 * `type` trägt im Schema `anyOf: [TokenDatatype, enum]` — das Muster, das
 * Metaschema für `allow-other="yes"` erzeugt. Die Aufzählung `catalog | profile`
 * bindet dort also **nicht**; sie ist im Metaschema zusätzlich an den
 * OSCAL-Namensraum von `ns` gebunden.
 */
export interface RawOscalMappingResourceReference {
  ns?: string;
  type: string;
  href: string;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  remarks?: string;
}

/** Beschreibt Anforderungen, Unverträglichkeiten und Lücken einer `map`. */
export interface RawOscalMappingQualifier {
  subject: string;
  predicate: string;
  category: string;
  /** Markup; wird nie als HTML gerendert. */
  description: string;
  remarks?: string;
}

/**
 * Entweder eine Kategorie **oder** ein Prozentwert — das Schema führt beide
 * Zweige als `anyOf` mit je `additionalProperties: false`. Beides gleichzeitig
 * ist damit schemawidrig, und der Typ bildet die Alternative nach.
 */
export type RawOscalConfidenceScore =
  | { category?: string; percentage?: never }
  | { category?: never; percentage?: number };

/** `target-coverage` ist Pflichtfeld; `generation-method` erlaubt Fremdwerte. */
export interface RawOscalCoverage {
  'generation-method'?: string;
  'target-coverage': number;
}

/**
 * Ein Selektor aus `unmapped-controls`.
 *
 * Bewusst lokal definiert statt aus `@/domain/oscalProfile` importiert: Beide
 * Schemas verweisen zwar auf dieselbe geteilte Assembly
 * `select-control-by-id`, aber der Profile-Typ ist über `PinnedOscalVersion`
 * parametrisiert, weil er dort eine reale Partition trägt. Diesen
 * Versionsparameter in ein Modell zu ziehen, das nur zwei definitionsgleiche
 * Zellen kennt, würde eine Drift behaupten, die es hier nicht gibt.
 */
export interface RawOscalMappingSelectControlById {
  'with-child-controls'?: 'yes' | 'no';
  'with-ids'?: string[];
  matching?: Array<{ pattern?: string; remarks?: string }>;
}

/**
 * Die ungemappten Controls einer Seite.
 *
 * Sie sind eine **positive** Aussage über nicht abgebildete Controls und damit
 * die zweite Ausdrucksform der Lücke neben `relationship: "no-relationship"`.
 */
export interface RawOscalMappingGapSummary {
  uuid: string;
  'unmapped-controls': RawOscalMappingSelectControlById[];
}

/**
 * Ein Mappingeintrag: n Quellen auf m Ziele mit genau einer Beziehung.
 *
 * `sources` und `targets` tragen beide `minItems: 1` — n:m ist modellseitig der
 * Normalfall. `relationship` ist im JSON-Schema nur `TokenDatatype` **ohne**
 * Enum; das kontrollierte Vokabular steht allein als Metaschema-Constraint.
 * `ns` qualifiziert genau diesen Wert und hat den OSCAL-Namensraum als Default.
 */
export interface RawOscalMap {
  uuid: string;
  ns?: string;
  'matching-rationale'?: string;
  relationship: string;
  sources: RawOscalMappingItem[];
  targets: RawOscalMappingItem[];
  qualifiers?: RawOscalMappingQualifier[];
  'confidence-score'?: RawOscalConfidenceScore;
  coverage?: RawOscalCoverage;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  remarks?: string;
}

/**
 * Ein Mapping Set: genau eine Quell- und eine Zielressource mit ihren
 * Einträgen. `method`, `matching-rationale` und `status` überschreiben hier
 * lokal, was `provenance` global setzt.
 */
export interface RawOscalMapping {
  uuid: string;
  method?: string;
  'matching-rationale'?: string;
  status?: string;
  'source-resource': RawOscalMappingResourceReference;
  'target-resource': RawOscalMappingResourceReference;
  maps: RawOscalMap[];
  'mapping-description'?: string;
  'source-gap-summary'?: RawOscalMappingGapSummary;
  'target-gap-summary'?: RawOscalMappingGapSummary;
  'confidence-score'?: RawOscalConfidenceScore;
  coverage?: RawOscalCoverage;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  remarks?: string;
}

/**
 * Die global gültige Methodik der Sammlung.
 *
 * `provenance` ist **Pflichtfeld** der `mapping-collection` und trägt selbst
 * vier Pflichtfelder. Das Objekt ist mit `additionalProperties: false`
 * geschlossen — im BSI-Bestand ist genau das der Grund, warum das ISO-Mapping
 * schemainvalide ist (`qa-reviewed`, `qa-note`; ADR-7). Verloren gehen dürfen
 * diese Felder trotzdem nicht.
 */
export interface RawOscalMappingProvenance {
  method: string;
  'matching-rationale': string;
  status: string;
  /** Markup; wird nie als HTML gerendert. */
  'mapping-description': string;
  'confidence-score'?: RawOscalConfidenceScore;
  coverage?: RawOscalCoverage;
  'responsible-parties'?: Array<{ 'role-id': string; 'party-uuids': string[] }>;
  props?: RawOscalProp[];
  links?: RawOscalLink[];
  remarks?: string;
}

/**
 * Der Körper der Mapping Collection. Pflicht sind `uuid`, `metadata`,
 * `provenance` und `mappings`; `back-matter` ist optional.
 *
 * `mappings` ist im Schema ein `anyOf` aus **einem** Mapping-Objekt und einem
 * Array mit `minItems: 1`. Die Einzelform ist damit schemavalide, auch wenn im
 * BSI-Bestand beide Artefakte die Arrayform verwenden — ein Adapter, der nur
 * `Array.isArray` prüft, würde ein gültiges Dokument leer parsen.
 */
export interface RawOscalMappingCollection {
  uuid: string;
  metadata: RawOscalMetadata;
  provenance: RawOscalMappingProvenance;
  mappings: RawOscalMapping | RawOscalMapping[];
  'back-matter'?: {
    resources?: Array<{
      uuid: string;
      title?: string;
      description?: string;
      citation?: { text: string };
      rlinks?: Array<{
        href: string;
        'media-type'?: string;
        hashes?: Array<{ algorithm: string; value: string }>;
      }>;
    }>;
  };
}
