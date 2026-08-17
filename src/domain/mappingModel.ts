// =============================================================================
// Domänenmodell einer OSCAL Mapping Collection (GSPP-245)
//
// Die Projektion des Control Layers auf den **Crosswalk**: welche Controls
// zweier autoritativer Quellen in welcher Beziehung zueinander stehen. Sie
// trägt bewusst keine Ableitungslogik — abgeleitet wird sie in
// `src/adapters/oscalMappingAdapter.ts`, erhalten bleibt der Quellgraph daneben
// (ADR-2). Die drei Funktionen am Ende sind reine Nachschlagefunktionen über
// die fertige Projektion; sie stehen hier, weil sie die Gap-Semantik gegen die
// naheliegendste Fehlbenutzung sichern (siehe dort).
//
// Vier Modellentscheidungen prägen die Typen:
//
//  1. **Die Lücke ist eine Aussage, kein fehlender Eintrag.** `no-relationship`
//     ist einer der sechs Beziehungstypen und sagt „diese beiden Controls haben
//     nichts miteinander zu tun". Das Fehlen eines `map`-Eintrags sagt
//     ausschließlich, dass nichts ausgesagt wurde. Beides bildet
//     `MappingCoverageState` getrennt ab, und es gibt in diesem Modell keinen
//     Zustand „nicht abgedeckt".
//  2. **Vokabularbindung ist eine Variante, kein String.** Ob ein Wert im
//     OSCAL-Vokabular liegt, ob er über einen fremden `ns` bewusst erweitert
//     wurde oder ob er schlicht unbekannt ist, sind drei verschiedene Befunde.
//     Der Rohwert bleibt in allen dreien erhalten.
//  3. **Nichts wird aufgelöst.** Ressourcen-`href` werden klassifiziert, nie
//     geladen; jede `id-ref` bleibt ohne Ressourcenkontext uninterpretiert und
//     trägt dafür einen expliziten Marker.
//  4. **Reihenfolge und Kardinalität bleiben.** `mappings`, `maps`, `sources`
//     und `targets` sind Listen in Quellreihenfolge; n:m wird nicht auf 1:n
//     verkürzt.
// =============================================================================

import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';

/** Der JSON-Root-Key dieses Modells. Er ist kein Versionsschalter. */
export const MAPPING_COLLECTION_ROOT_TYPE = 'mapping-collection' as const;

/* ------------------------------------------------------------------ */
/*  Kontrollierte Vokabulare                                           */
/* ------------------------------------------------------------------ */

/**
 * Der OSCAL-Namensraum als **Naming-System-Identifier**.
 *
 * Er ist kein Verweis auf ein Dokument: Nichts wird unter dieser Adresse
 * geladen, und sie erreicht die Referenzschicht nie. Sie wird ausschließlich
 * mit einem `ns`-Wert verglichen.
 *
 * Warum der Vergleich überhaupt nötig ist: Das Metaschema bindet die
 * Beziehungs- und Ressourcentyp-Vokabulare an
 * `target=".[has-oscal-namespace('…')]"`. Ein `ns`, der einen **fremden**
 * Namensraum benennt, hebt die Bindung auf — dort sind eigene Beziehungstypen
 * ausdrücklich vorgesehen. Fehlt `ns`, gilt laut Metaschema der OSCAL-Namensraum
 * als Default, und das Vokabular bindet.
 */
export const OSCAL_NAMESPACE = 'http://csrc.nist.gov/ns/oscal';

/**
 * Die sechs Beziehungstypen. `no-relationship` gehört zwingend dazu: Ohne ihn
 * wäre die explizite Lücke nicht ausdrückbar, und genau sie unterscheidet den
 * Crosswalk von einer bloßen Trefferliste.
 *
 * Teilweise umkehrbar: `A subset-of B` heißt `B superset-of A`;
 * `equivalent-to`, `equal-to` und `intersects-with` sind symmetrisch.
 */
export const MAPPING_RELATIONSHIPS = Object.freeze([
  'equivalent-to',
  'equal-to',
  'subset-of',
  'superset-of',
  'intersects-with',
  'no-relationship',
] as const);

export type MappingRelationship = (typeof MAPPING_RELATIONSHIPS)[number];

/** Die **explizite** Lücke — eine positive Aussage, keine Abwesenheit. */
export const MAPPING_RELATIONSHIP_GAP = 'no-relationship' satisfies MappingRelationship;

export const MAPPING_METHODS = Object.freeze(['human', 'automation', 'hybrid'] as const);
export type MappingMethod = (typeof MAPPING_METHODS)[number];

export const MAPPING_MATCHING_RATIONALES = Object.freeze([
  'syntactic',
  'semantic',
  'functional',
] as const);
export type MappingMatchingRationale = (typeof MAPPING_MATCHING_RATIONALES)[number];

export const MAPPING_STATUSES = Object.freeze([
  'complete',
  'not-complete',
  'draft',
  'deprecated',
  'superseded',
] as const);
export type MappingStatus = (typeof MAPPING_STATUSES)[number];

/** Andere Granularitäten sind im Modell nicht vorgesehen. */
export const MAPPING_ITEM_TYPES = Object.freeze(['control', 'statement'] as const);
export type MappingItemType = (typeof MAPPING_ITEM_TYPES)[number];

export const MAPPING_RESOURCE_TYPES = Object.freeze(['catalog', 'profile'] as const);
export type MappingResourceType = (typeof MAPPING_RESOURCE_TYPES)[number];

export const MAPPING_QUALIFIER_SUBJECTS = Object.freeze(['source', 'target', 'both'] as const);
export type MappingQualifierSubject = (typeof MAPPING_QUALIFIER_SUBJECTS)[number];

export const MAPPING_QUALIFIER_PREDICATES = Object.freeze([
  'has-requirement',
  'has-incompatibility',
] as const);
export type MappingQualifierPredicate = (typeof MAPPING_QUALIFIER_PREDICATES)[number];

export const MAPPING_QUALIFIER_CATEGORIES = Object.freeze([
  'restricted',
  'addressable',
  'blocked',
] as const);
export type MappingQualifierCategory = (typeof MAPPING_QUALIFIER_CATEGORIES)[number];

/**
 * Die Bindung eines Feldwerts an sein kontrolliertes Vokabular.
 *
 * `declared` trägt in allen Varianten den unveränderten Rohwert — auch im
 * bekannten Fall, damit eine Projektion nie zwischen „Wert" und „gedeutetem
 * Wert" auseinanderläuft. In Diagnosen erscheint er nie (Redaction-Regel).
 *
 * `extension` ist kein Schlupfloch, sondern die Norm: Ein `ns` mit einem
 * fremden Namensraum hebt die Vokabularbindung ausdrücklich auf.
 */
export type MappingVocabularyBinding<T extends string> =
  | { readonly kind: 'known'; readonly value: T; readonly declared: string }
  | { readonly kind: 'extension'; readonly declared: string; readonly ns: string }
  | { readonly kind: 'unknown'; readonly declared?: string; readonly diagnostic: OscalDiagnostic };

/* ------------------------------------------------------------------ */
/*  Abdeckungssemantik                                                 */
/* ------------------------------------------------------------------ */

/**
 * Die dreistufige Abdeckungsaussage über **eine** `id-ref` innerhalb eines
 * Mapping Sets.
 *
 * Es gibt bewusst keinen vierten Zustand „nicht abgedeckt": Aus dem Fehlen
 * eines Eintrags folgt ausschließlich, dass niemand etwas ausgesagt hat.
 */
export type MappingCoverageState =
  /** Mindestens eine Beziehung, die keine erklärte Lücke ist. */
  | 'mapped'
  /** Ausschließlich `no-relationship` — die ausgesprochene Lücke. */
  | 'explicit-gap'
  /** Keine Aussage — oder nur eine, deren Beziehungstyp unbekannt ist. */
  | 'unknown';

/* ------------------------------------------------------------------ */
/*  Gemeinsame Knoten                                                  */
/* ------------------------------------------------------------------ */

export interface MappingCollectionMetadata {
  readonly title?: string;
  readonly lastModified?: string;
  readonly version?: string;
  /** Die deklarierte `oscal-version` — die alleinige Versionsautorität. */
  readonly oscalVersion?: string;
}

export interface MappingProp {
  readonly name: string;
  readonly value: string;
  readonly ns?: string;
  readonly class?: string;
}

export interface MappingLink {
  readonly href: string;
  readonly rel?: string;
  readonly text?: string;
}

/** Entweder Kategorie oder Prozentwert; beides zugleich ist schemawidrig. */
export interface MappingConfidenceScore {
  readonly category?: string;
  readonly percentage?: number;
  readonly path: string;
}

export interface MappingCoverage {
  /** `arbitrary` ist der einzige benannte Wert; Fremdwerte sind zulässig. */
  readonly generationMethod?: string;
  readonly targetCoverage?: number;
  readonly path: string;
}

export interface MappingQualifier {
  readonly subject: MappingVocabularyBinding<MappingQualifierSubject>;
  readonly predicate: MappingVocabularyBinding<MappingQualifierPredicate>;
  readonly category: MappingVocabularyBinding<MappingQualifierCategory>;
  /** Markup; wird nie als HTML gerendert. */
  readonly description?: string;
  readonly remarks?: string;
  readonly path: string;
}

export interface MappingControlSelector {
  readonly withChildControls?: string;
  readonly withIds: readonly string[];
  /** Glob-Muster; erhalten, nie ausgewertet. */
  readonly matching: readonly { readonly pattern?: string; readonly remarks?: string }[];
  readonly path: string;
}

/**
 * Die zweite Ausdrucksform der Lücke: eine Liste ausdrücklich **nicht**
 * abgebildeter Controls einer Seite.
 */
export interface MappingGapSummary {
  readonly uuid?: string;
  readonly unmappedControls: readonly MappingControlSelector[];
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Ressourcen und Items                                               */
/* ------------------------------------------------------------------ */

/**
 * Der Auflösungsstand einer `id-ref`.
 *
 * Ein eingefrorener Wert statt eines Freitexts, damit keine Stelle im Code ihn
 * anders schreiben kann. Solange der Ressourcenkontext nicht aufgelöst ist,
 * bleibt jede `id-ref` ein Bezeichner ohne Bedeutung — sie kataloglos gegen
 * irgendeinen geladenen Katalog aufzulösen wäre geraten, nicht ermittelt.
 */
export const MAPPING_ID_REF_UNRESOLVED = Object.freeze({
  status: 'unresolved' as const,
  reason: 'resource-context-unresolved' as const,
});

export type MappingIdRefResolution = typeof MAPPING_ID_REF_UNRESOLVED;

export interface MappingResourceReference {
  readonly type: MappingVocabularyBinding<MappingResourceType>;
  /** Der unveränderte `href`-Wert; `undefined`, wenn der Knoten keinen trägt. */
  readonly href?: string;
  /**
   * Die Klassifikation aus `src/domain/referenceResolution.ts`. `null` genau
   * dann, wenn kein `href` vorhanden ist — geraten wird nichts.
   */
  readonly reference: ResolvedOscalReference | null;
  readonly ns?: string;
  readonly props: readonly MappingProp[];
  readonly links: readonly MappingLink[];
  readonly remarks?: string;
  readonly path: string;
}

export interface MappingItem {
  readonly type: MappingVocabularyBinding<MappingItemType>;
  /** Control- oder Statement-ID **im Kontext der jeweiligen Ressource**. */
  readonly idRef?: string;
  /** Immer `unresolved`: ohne Ressourcenkontext wird nichts interpretiert. */
  readonly resolution: MappingIdRefResolution;
  readonly props: readonly MappingProp[];
  readonly links: readonly MappingLink[];
  readonly remarks?: string;
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Einträge und Mapping Sets                                          */
/* ------------------------------------------------------------------ */

export interface MappingEntry {
  readonly uuid?: string;
  readonly relationship: MappingVocabularyBinding<MappingRelationship>;
  /** Der Namensraum, der `relationship` qualifiziert. */
  readonly ns?: string;
  readonly matchingRationale?: MappingVocabularyBinding<MappingMatchingRationale>;
  /** Mindestens ein Eintrag ist Pflicht; fehlt er, steht das in `diagnostics`. */
  readonly sources: readonly MappingItem[];
  readonly targets: readonly MappingItem[];
  readonly qualifiers: readonly MappingQualifier[];
  readonly confidenceScore?: MappingConfidenceScore;
  readonly coverage?: MappingCoverage;
  readonly props: readonly MappingProp[];
  readonly links: readonly MappingLink[];
  readonly remarks?: string;
  readonly path: string;
}

/**
 * Ein Mapping Set über genau eine Quell- und eine Zielressource.
 *
 * Die beiden Indizes sind der einzige Ort, an dem `id-ref`-Werte gruppiert
 * werden — und sie sind bewusst **pro Mapping Set** gebildet: Zwei Sets können
 * verschiedene Quellkataloge haben, in denen dieselbe ID etwas anderes
 * bezeichnet. Ein sammlungsweiter Index würde genau diese Mehrdeutigkeit
 * einebnen.
 */
export interface Mapping {
  readonly uuid?: string;
  readonly method?: MappingVocabularyBinding<MappingMethod>;
  readonly matchingRationale?: MappingVocabularyBinding<MappingMatchingRationale>;
  readonly status?: MappingVocabularyBinding<MappingStatus>;
  readonly sourceResource: MappingResourceReference | null;
  readonly targetResource: MappingResourceReference | null;
  readonly maps: readonly MappingEntry[];
  readonly mapsBySourceIdRef: ReadonlyMap<string, readonly MappingEntry[]>;
  readonly mapsByTargetIdRef: ReadonlyMap<string, readonly MappingEntry[]>;
  readonly mappingDescription?: string;
  readonly sourceGapSummary?: MappingGapSummary;
  readonly targetGapSummary?: MappingGapSummary;
  readonly confidenceScore?: MappingConfidenceScore;
  readonly coverage?: MappingCoverage;
  readonly props: readonly MappingProp[];
  readonly links: readonly MappingLink[];
  readonly remarks?: string;
  readonly path: string;
}

/** Die global gültige Methodik, die einzelne Mapping Sets lokal überschreiben. */
export interface MappingProvenance {
  readonly method?: MappingVocabularyBinding<MappingMethod>;
  readonly matchingRationale?: MappingVocabularyBinding<MappingMatchingRationale>;
  readonly status?: MappingVocabularyBinding<MappingStatus>;
  /** Markup; wird nie als HTML gerendert. */
  readonly mappingDescription?: string;
  readonly confidenceScore?: MappingConfidenceScore;
  readonly coverage?: MappingCoverage;
  readonly props: readonly MappingProp[];
  readonly links: readonly MappingLink[];
  readonly remarks?: string;
  readonly path: string;
}

/**
 * Welche der beiden schemazulässigen Formen `mappings` im Dokument hatte.
 *
 * Die Einzelform ist kein Fehler: Das Schema führt `mappings` als `anyOf` aus
 * einem Mapping-Objekt und einem Array. Die Projektion vereinheitlicht auf eine
 * Liste und hält die Form fest, damit die Vereinheitlichung sichtbar bleibt.
 */
export type MappingsDeclaredForm = 'single' | 'array' | 'missing';

/* ------------------------------------------------------------------ */
/*  Dokumentprojektion                                                 */
/* ------------------------------------------------------------------ */

export interface MappingCollection {
  readonly uuid?: string;
  readonly metadata: MappingCollectionMetadata;
  /** Pflichtfeld; fehlt es, steht das in `diagnostics` (ADR-7). */
  readonly provenance: MappingProvenance | null;
  readonly mappings: readonly Mapping[];
  readonly declaredMappingsForm: MappingsDeclaredForm;
  /** Modellinterne Befunde. Sie verwerfen das Dokument nie (ADR-2, ADR-7). */
  readonly diagnostics: readonly OscalDiagnostic[];
}

/* ------------------------------------------------------------------ */
/*  Nachschlagefunktionen der Abdeckung                                */
/* ------------------------------------------------------------------ */

/**
 * Ob ein Eintrag eine Beziehung behauptet, die keine erklärte Lücke ist.
 *
 * Eine `extension` zählt mit: Ein fremder Namensraum darf eigene
 * Beziehungstypen einführen, und sie sind Beziehungen. Ein `unknown`-Wert zählt
 * ausdrücklich **nicht** — ein unlesbarer Beziehungstyp darf keine Abdeckung
 * behaupten.
 */
function assertsRelationship(entry: MappingEntry): boolean {
  const { relationship } = entry;
  if (relationship.kind === 'extension') return true;
  return relationship.kind === 'known' && relationship.value !== MAPPING_RELATIONSHIP_GAP;
}

function coverageOf(entries: readonly MappingEntry[] | undefined): MappingCoverageState {
  // Kein Eintrag heißt: Es wurde nichts ausgesagt. Diese Zeile ist der Grund
  // für die Funktion — ein `map.get(id) ?? 'not-covered'` an der Aufrufstelle
  // wäre genau die Fehlinterpretation, die das Modell ausschließen soll.
  if (entries === undefined || entries.length === 0) return 'unknown';
  if (entries.some(assertsRelationship)) return 'mapped';

  return entries.some(
    (entry) =>
      entry.relationship.kind === 'known'
      && entry.relationship.value === MAPPING_RELATIONSHIP_GAP,
  )
    ? 'explicit-gap'
    : 'unknown';
}

/** Die Abdeckungsaussage über eine Quell-`id-ref` innerhalb eines Mapping Sets. */
export function coverageForSourceIdRef(mapping: Mapping, idRef: string): MappingCoverageState {
  return coverageOf(mapping.mapsBySourceIdRef.get(idRef));
}

/** Die Abdeckungsaussage über eine Ziel-`id-ref` innerhalb eines Mapping Sets. */
export function coverageForTargetIdRef(mapping: Mapping, idRef: string): MappingCoverageState {
  return coverageOf(mapping.mapsByTargetIdRef.get(idRef));
}
