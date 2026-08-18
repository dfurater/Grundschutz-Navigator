// =============================================================================
// Modell des OSCAL-Referenzgraphen (GSPP-251) — Stufe 5 des Validierungsvertrags
//
// Der Graph verbindet die Root-Modelle des Control Layers (`catalog`,
// `profile`, `mapping-collection`) mit dem Implementation Layer
// (`component-definition`). Er trägt selbst **keine** Klassifikation von
// Referenzformen: was ein `href` ist und ob er auflösbar ist, entscheidet
// ausschließlich `src/domain/referenceResolution.ts` (GSPP-286).
//
// Drei Modellentscheidungen prägen die Typen:
//
//  1. **Ein Knoten ist nie eine nackte ID.** `control/@id` trägt im
//     Catalog-Metaschema `identifier-uniqueness="local"` — dieselbe Control-ID
//     bezeichnet in zwei Katalogen zwei verschiedene Controls. Jeder Knoten
//     führt deshalb die Dokumentidentität mit, und es gibt keinen Typ, der eine
//     kontextlose ID ausdrücken könnte.
//  2. **Vier Zustände, nicht drei.** Eine Kante ist `resolved`, `unresolvable`
//     (Referenzfehler) oder `not-evaluable` (das Ziel liegt außerhalb des
//     geprüften Kontexts und wird bewusst nicht aufgelöst). Die vierte Aussage
//     `no-relationship` ist gar keine Kante, sondern eine fachliche Aussage
//     über ein Paar — sie steht in `gapAssertions`.
//  3. **Jeder Knoten trägt die Version seines Quelldokuments.** Der Korpus führt
//     vier gleichzeitig deklarierte `oscal-version`-Werte; eine gemeinsame
//     Versionsannahme wäre falsch (GSPP-283).
// =============================================================================

import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { ArtifactLifecycle, CatalogKey } from '@/domain/sourceRegistry';

/** Der Validatorpin dieses Prüfers; er geht in jede Diagnosesignatur ein. */
export const REFERENCE_GRAPH_VALIDATOR = Object.freeze({
  name: 'reference-graph',
  version: '1',
});

/* ------------------------------------------------------------------ */
/*  Diagnostic-Codes                                                   */
/* ------------------------------------------------------------------ */

/**
 * Die stabilen Codes dieser Stufe. Sie sind Teil der Diagnosesignatur und
 * damit des Matchschlüssels der CI-Policy — sie ändern sich nicht still.
 */
export const REFERENCE_GRAPH_CODES = Object.freeze({
  /**
   * Das Ziel liegt im geprüften Kontext und ist dort nicht vorhanden.
   * Der einzige echte Referenzfehler auf ID-Ebene.
   */
  targetNotFound: 'OSCAL_GRAPH_TARGET_NOT_FOUND',
  /** Die ID ist im Zielkontext mehrfach vergeben; das Ziel ist mehrdeutig. */
  targetAmbiguous: 'OSCAL_GRAPH_TARGET_AMBIGUOUS',
  /** Zwei Knoten desselben Dokuments tragen dieselbe lokale Identität. */
  duplicateNodeId: 'OSCAL_GRAPH_DUPLICATE_NODE_ID',
  /** Das gebundene Zieldokument hat für diese Kante den falschen Root-Typ. */
  rootTypeMismatch: 'OSCAL_GRAPH_ROOT_TYPE_MISMATCH',
  /**
   * Ein Kontextverweis zeigt nach außen. Er wird nach GSPP-286 **nie**
   * aufgelöst und ist damit weder gepinnt noch versionsstabil überprüfbar —
   * eine andere Aussage als „ID nicht gefunden".
   */
  externalContextUnpinned: 'OSCAL_GRAPH_EXTERNAL_CONTEXT_UNPINNED',
  /** `mapping-item.type` außerhalb von {`control`, `statement`}. */
  itemTypeUnsupported: 'OSCAL_GRAPH_ITEM_TYPE_UNSUPPORTED',
  /** `mapping-resource-reference.type` außerhalb von {`catalog`, `profile`}. */
  resourceTypeUnsupported: 'OSCAL_GRAPH_RESOURCE_TYPE_UNSUPPORTED',
  /** Eine Profilkette schließt sich; die Auswertung bricht dort ab. */
  importCycle: 'OSCAL_GRAPH_IMPORT_CYCLE',
} as const);

export type ReferenceGraphCode =
  (typeof REFERENCE_GRAPH_CODES)[keyof typeof REFERENCE_GRAPH_CODES];

/* ------------------------------------------------------------------ */
/*  Knoten                                                             */
/* ------------------------------------------------------------------ */

/**
 * Die Knotenarten des ersten Slices. Der Assessment Layer (`system-security-plan`,
 * `assessment-plan`, `assessment-results`, `plan-of-action-and-milestones`) ist
 * bewusst noch nicht enthalten; er ergänzt diese Aufzählung später, ohne die
 * Kantendefinition umzubauen.
 */
export const REFERENCE_NODE_KINDS = Object.freeze([
  'artifact',
  'group',
  'control',
  'statement',
  'resource',
  'component',
  'capability',
] as const);

export type ReferenceNodeKind = (typeof REFERENCE_NODE_KINDS)[number];

/**
 * Die Identität eines Knotens: Dokument **und** lokale ID. Beides zusammen,
 * nie einzeln — eine lokale ID ohne Dokument ist im OSCAL-Identitätsmodell
 * bedeutungslos.
 */
export interface ReferenceNodeId {
  /** Registry-Schlüssel des tragenden Artefakts (geschlossene Menge). */
  readonly documentKey: string;
  readonly kind: ReferenceNodeKind;
  /** Lokale Identität im Dokument; `null` für den Artefaktknoten selbst. */
  readonly localId: string | null;
}

export interface ReferenceNode extends ReferenceNodeId {
  /** Die deklarierte `oscal-version` des Quelldokuments (GSPP-283). */
  readonly oscalVersion: string;
  readonly rootType: OscalRootKey;
  /** Dokument-`uuid` des tragenden Artefakts, soweit vorhanden. */
  readonly documentUuid: string | null;
  readonly catalogKey: CatalogKey | null;
}

/* ------------------------------------------------------------------ */
/*  Kanten                                                             */
/* ------------------------------------------------------------------ */

/** Die Kanten, über die OSCAL seine Layer verbindet. */
export const REFERENCE_EDGE_KINDS = Object.freeze([
  /** `profile.imports[].href` → Catalog oder Profile */
  'profile-import',
  /** `include-controls[].with-ids` → Control im importierten Kontext */
  'profile-selection',
  /** `mapping.source-resource.href` / `target-resource.href` → Catalog/Profile */
  'mapping-resource',
  /** `mapping-item.id-ref` → Control oder Statement im Ressourcenkontext */
  'mapping-item',
  /** `control-implementation.source` → Catalog oder Profile */
  'component-source',
  /** `implemented-requirement.control-id` → Control im Kontext der `source` */
  'component-control',
  /** `link.href = "#<uuid>"` → Ressource in `back-matter/resources` */
  'document-internal',
] as const);

export type ReferenceEdgeKind = (typeof REFERENCE_EDGE_KINDS)[number];

/**
 * Warum eine Kante nicht bewertbar ist. Jeder Grund benennt eine Lage, in der
 * das Ziel **außerhalb** des geprüften Kontexts liegt — keiner davon ist ein
 * Datenqualitätsbefund.
 */
export type NotEvaluableReason =
  /** Relativer Dateiname; wird nach GSPP-286 nie aufgelöst. */
  | 'relative'
  /** Externes Ziel; wird nie abgerufen und nie aufgelöst. */
  | 'external'
  /** Fragmentverweis in ein Dokument, das der Aufrufer nicht bereitgestellt hat. */
  | 'document-not-provided'
  /** Der tragende Kontext ist selbst nicht bewertbar. */
  | 'context-not-evaluable'
  /** Der Kontext ist eine `back-matter`-Ressource; in ihr liegen keine Controls. */
  | 'resource-context'
  /** Der deklarierte Typ liegt außerhalb des OSCAL-Vokabulars (fremder `ns`). */
  | 'vocabulary-extension';

export type ReferenceEdgeState = 'resolved' | 'unresolvable' | 'not-evaluable';

interface ReferenceEdgeBase {
  readonly kind: ReferenceEdgeKind;
  readonly from: ReferenceNodeId;
  /** Struktureller JSON Pointer auf den Quellknoten der Referenz. */
  readonly path: string;
}

export interface ResolvedReferenceEdge extends ReferenceEdgeBase {
  readonly state: 'resolved';
  readonly to: ReferenceNodeId;
  /** Gesetzt, wenn das Ziel vorhanden ist, die Kette aber zyklisch schließt. */
  readonly diagnostic?: OscalDiagnostic;
}

export interface UnresolvableReferenceEdge extends ReferenceEdgeBase {
  readonly state: 'unresolvable';
  readonly diagnostic: OscalDiagnostic;
}

export interface NotEvaluableReferenceEdge extends ReferenceEdgeBase {
  readonly state: 'not-evaluable';
  readonly reason: NotEvaluableReason;
  /**
   * Nur für Kontextverweise nach außen gesetzt: die Aussage „extern und
   * damit nicht versionsstabil überprüfbar". Ein nicht bewertbares Ziel ist
   * ansonsten befundfrei.
   */
  readonly diagnostic?: OscalDiagnostic;
}

export type ReferenceEdge =
  | ResolvedReferenceEdge
  | UnresolvableReferenceEdge
  | NotEvaluableReferenceEdge;

/* ------------------------------------------------------------------ */
/*  Fachliche Lückenaussage                                            */
/* ------------------------------------------------------------------ */

/**
 * `relationship: "no-relationship"` — die ausdrückliche Aussage „zwischen
 * diesen beiden Seiten besteht keine Beziehung".
 *
 * Sie ist **keine** Kante: Es gibt kein Ziel, das vorhanden sein müsste, und
 * sie erzeugt deshalb nie einen Referenzfehler. Sie steht getrennt, damit sie
 * in keiner Auswertung mit „kein Eintrag" verschmilzt.
 */
export interface ReferenceGapAssertion {
  readonly documentKey: string;
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Eingabe                                                            */
/* ------------------------------------------------------------------ */

/**
 * Ein geladenes Artefakt als Graphquelle.
 *
 * `source` ist der unveränderte Root-Envelope (`{ [rootType]: body }`), `view`
 * die Projektion des zuständigen Adapters. Beides zusammen, weil der Graph
 * seine Knoten aus dem Quellgraphen bildet (dort sind auch Duplikate noch
 * sichtbar), die Kanten aber aus der Projektion nimmt, statt sie ein zweites
 * Mal abzuleiten.
 */
export interface ReferenceGraphDocument {
  /** Registry-Schlüssel; eine geschlossene Menge, nie Dokumentinhalt. */
  readonly artifactKey: string;
  readonly lifecycle: ArtifactLifecycle;
  readonly rootType: OscalRootKey;
  /** Ausschließlich aus `metadata.oscal-version` (GSPP-283). */
  readonly oscalVersion: string;
  readonly source: unknown;
  readonly view: unknown;
  readonly catalogKey?: CatalogKey;
}

/**
 * Die vom Aufrufer **behauptete** Zuordnung eines Referenzwerts zu einem
 * geladenen Artefakt.
 *
 * Sie ist der einzige Weg, wie eine dokumentübergreifende Referenz überhaupt
 * auflösbar wird — der Graph leitet eine solche Zuordnung nie selbst ab.
 * Insbesondere werden Dateinamen, Titel und Fremd-Namespace-`props` (etwa die
 * `catalog_uuid`-Werte der ITGS-Zielressourcen) niemals dafür herangezogen.
 */
export interface ReferenceGraphBinding {
  /** Der unveränderte Referenzwert, ohne Pfadnormalisierung. */
  readonly href: string;
  readonly artifactKey: string;
}

export interface ReferenceGraphInput {
  readonly documents: readonly ReferenceGraphDocument[];
  readonly bindings?: readonly ReferenceGraphBinding[];
}

/* ------------------------------------------------------------------ */
/*  Ergebnis                                                           */
/* ------------------------------------------------------------------ */

export interface ReferenceGraphArtifactSummary {
  readonly artifactKey: string;
  readonly lifecycle: ArtifactLifecycle;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly nodes: number;
  readonly resolved: number;
  readonly unresolvable: number;
  readonly notEvaluable: number;
  readonly gapAssertions: number;
  readonly diagnostics: number;
}

export interface ReferenceGraph {
  readonly nodes: readonly ReferenceNode[];
  readonly edges: readonly ReferenceEdge[];
  /** Fachliche Lückenaussagen; ausdrücklich keine Kanten. */
  readonly gapAssertions: readonly ReferenceGapAssertion[];
  /** Alle Befunde, ausschließlich über `createOscalDiagnostic` erzeugt. */
  readonly diagnostics: readonly OscalDiagnostic[];
  readonly artifacts: readonly ReferenceGraphArtifactSummary[];
}
