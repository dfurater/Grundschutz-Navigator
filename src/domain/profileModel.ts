// =============================================================================
// Domänenmodell eines OSCAL Profile (GSPP-240)
//
// Die Projektion des Control Layers auf die **Anweisung**, nicht auf ihr
// Ergebnis. Sie trägt bewusst keine Logik: Abgeleitet wird sie in
// `src/adapters/oscalProfileAdapter.ts`, erhalten bleibt der Quellgraph daneben
// (ADR-2).
//
// Drei Modellentscheidungen prägen die Typen:
//
//  1. **Selektion und Merge sind Varianten, keine Felder.** `include-all` und
//     `include-controls` sind zwei verschiedene Aussagen, nicht zwei
//     Ausprägungen einer „Selektion"; dasselbe gilt für `flat`, `as-is` und
//     `custom`. Sie werden deshalb als diskriminierte Unions geführt und nie zu
//     einem generischen Feld verschmolzen.
//  2. **Nichts wird aufgelöst.** `merge` und `modify` tragen einen expliziten
//     `resolution`-Marker mit dem Status `not-resolved`. Es gibt in diesem
//     Modell kein Feld, das ein aufgelöstes Control-Set behaupten könnte —
//     Profile Resolution ist GSPP-291.
//  3. **Mehrere `alter`-Einträge auf derselben `control-id` bleiben mehrere.**
//     `alters` ist eine Liste in Quellreihenfolge; `altersByControlId` gruppiert
//     sie, ohne zu deduplizieren.
// =============================================================================

import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { ResolvedOscalReference } from '@/domain/referenceResolution';

/** Der JSON-Root-Key dieses Modells. Er ist kein Versionsschalter. */
export const PROFILE_ROOT_TYPE = 'profile' as const;

/**
 * Der Auflösungsstand jeder Selektions-, Merge- und Modify-Anweisung dieses
 * Slices. Ein einziger eingefrorener Wert, damit keine Stelle im Code ihn
 * versehentlich anders schreiben kann.
 */
export const PROFILE_RESOLUTION_STATE = Object.freeze({
  status: 'not-resolved' as const,
  /** Warum: Dieser Slice liest, er löst nicht auf (GSPP-291). */
  reason: 'profile-resolution-out-of-scope' as const,
});

export type ProfileResolutionState = typeof PROFILE_RESOLUTION_STATE;

/* ------------------------------------------------------------------ */
/*  Gemeinsame Knoten                                                  */
/* ------------------------------------------------------------------ */

export interface ProfileMetadata {
  readonly title?: string;
  readonly lastModified?: string;
  readonly version?: string;
  /** Die deklarierte `oscal-version` — die alleinige Versionsautorität. */
  readonly oscalVersion?: string;
}

export interface ProfileProp {
  readonly name: string;
  readonly value: string;
  readonly ns?: string;
  readonly class?: string;
}

export interface ProfileLink {
  readonly href: string;
  readonly rel?: string;
  readonly text?: string;
}

/** Rekursiver `part`-Knoten, wie ihn `alters[].adds[].parts` führt. */
export interface ProfilePart {
  readonly id?: string;
  readonly name?: string;
  readonly ns?: string;
  readonly class?: string;
  readonly title?: string;
  /** Markup; wird nie als HTML gerendert. */
  readonly prose?: string;
  readonly props: readonly ProfileProp[];
  readonly links: readonly ProfileLink[];
  readonly parts: readonly ProfilePart[];
}

export interface ProfileParam {
  readonly id?: string;
  readonly class?: string;
  readonly label?: string;
  readonly usage?: string;
  readonly values: readonly string[];
  readonly props: readonly ProfileProp[];
  readonly links: readonly ProfileLink[];
}

/* ------------------------------------------------------------------ */
/*  Selektion                                                          */
/* ------------------------------------------------------------------ */

/**
 * Ein Glob-Muster-Selektor. Er wird in diesem Slice **nicht** ausgewertet —
 * erhalten, nicht angewandt.
 */
export interface ProfileControlMatcher {
  readonly pattern?: string;
  /** Ab 1.2.1 schemaseitig zulässig; darunter ein Schemabefund (Stufe 3). */
  readonly remarks?: string;
}

/**
 * Ein Selektor aus `include-controls` oder `exclude-controls`.
 *
 * `withIds` und `matching` sind getrennte Listen und werden nicht vereinigt:
 * Eine aufgezählte Auswahl und eine gemusterte Auswahl sind verschiedene
 * Aussagen über dieselbe Quelle.
 */
export interface ProfileControlSelector {
  readonly withChildControls?: string;
  readonly withIds: readonly string[];
  readonly matching: readonly ProfileControlMatcher[];
  readonly path: string;
}

/**
 * Welche der beiden Selektionsformen ein `import` (oder ein
 * `insert-controls`) trägt.
 *
 * `ambiguous` und `none` sind keine erfundenen Zustände, sondern der ehrliche
 * Befund über einen realen Knoten: Ab OSCAL 1.2.1 verlangt das Schema genau
 * eine der beiden Formen, unter 1.1.2/1.1.3 ist beides und keines schemavalide.
 * Die Projektion trägt den Befund; ob er ein Schemaverstoß ist, entscheidet
 * Stufe 3 gegen die deklarierte Version.
 */
export type ProfileSelection =
  | { readonly kind: 'include-all' }
  | {
    readonly kind: 'include-controls';
    readonly includeControls: readonly ProfileControlSelector[];
  }
  | {
    readonly kind: 'ambiguous';
    readonly includeControls: readonly ProfileControlSelector[];
    readonly diagnostic: OscalDiagnostic;
  }
  | { readonly kind: 'none'; readonly diagnostic: OscalDiagnostic };

/* ------------------------------------------------------------------ */
/*  Import                                                             */
/* ------------------------------------------------------------------ */

export interface ProfileImport {
  /** Der unveränderte `href`-Wert; `undefined`, wenn der Knoten keinen trägt. */
  readonly href?: string;
  /**
   * Die Klassifikation aus `src/domain/referenceResolution.ts`. `null` genau
   * dann, wenn kein `href` vorhanden ist — geraten wird nichts.
   */
  readonly reference: ResolvedOscalReference | null;
  readonly selection: ProfileSelection;
  readonly excludeControls: readonly ProfileControlSelector[];
  /** Struktureller JSON Pointer auf den Quellknoten. */
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Merge                                                              */
/* ------------------------------------------------------------------ */

export interface ProfileInsertControls {
  readonly order?: string;
  readonly selection: ProfileSelection;
  readonly excludeControls: readonly ProfileControlSelector[];
  readonly path: string;
}

export interface ProfileGroup {
  readonly id?: string;
  readonly class?: string;
  readonly title?: string;
  readonly params: readonly ProfileParam[];
  readonly props: readonly ProfileProp[];
  readonly links: readonly ProfileLink[];
  readonly parts: readonly ProfilePart[];
  readonly groups: readonly ProfileGroup[];
  readonly insertControls: readonly ProfileInsertControls[];
  readonly path: string;
}

export interface ProfileCustomGrouping {
  readonly groups: readonly ProfileGroup[];
  readonly insertControls: readonly ProfileInsertControls[];
}

/** Wie doppelte Control-IDs aufgelöst werden sollen — hier nur erhalten. */
export interface ProfileCombine {
  readonly method?: string;
}

/**
 * Die Strukturdirektive eines `merge`.
 *
 * `as-is` trägt seinen Booleschen Wert mit: `"as-is": false` ist eine andere
 * Aussage als ein fehlendes `as-is`, und beides darf nicht auf denselben
 * Modellzustand abbilden.
 */
export type ProfileMergeStructure =
  | { readonly kind: 'flat' }
  /** `asIs` ist `undefined`, wenn der Knoten vorhanden, aber kein Boolescher ist. */
  | { readonly kind: 'as-is'; readonly asIs?: boolean }
  | { readonly kind: 'custom'; readonly custom: ProfileCustomGrouping }
  | {
    readonly kind: 'ambiguous';
    readonly declared: readonly ('flat' | 'as-is' | 'custom')[];
    readonly custom?: ProfileCustomGrouping;
    readonly diagnostic: OscalDiagnostic;
  }
  | { readonly kind: 'none'; readonly diagnostic: OscalDiagnostic };

export interface ProfileMerge {
  readonly structure: ProfileMergeStructure;
  readonly combine?: ProfileCombine;
  /** Immer `not-resolved`: Diese Anweisung wird erhalten, nicht ausgeführt. */
  readonly resolution: ProfileResolutionState;
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Modify                                                             */
/* ------------------------------------------------------------------ */

export interface ProfileRemoval {
  readonly byName?: string;
  readonly byClass?: string;
  readonly byId?: string;
  readonly byItemName?: string;
  readonly byNs?: string;
  readonly path: string;
}

export interface ProfileAddition {
  /** `before` | `after` | `starting` | `ending`, unverändert übernommen. */
  readonly position?: string;
  readonly byId?: string;
  readonly title?: string;
  readonly params: readonly ProfileParam[];
  readonly props: readonly ProfileProp[];
  readonly links: readonly ProfileLink[];
  readonly parts: readonly ProfilePart[];
  readonly path: string;
}

export interface ProfileAlteration {
  readonly controlId?: string;
  readonly adds: readonly ProfileAddition[];
  readonly removes: readonly ProfileRemoval[];
  readonly path: string;
}

export interface ProfileSetParameter {
  readonly paramId: string;
  readonly class?: string;
  readonly dependsOn?: string;
  readonly label?: string;
  readonly usage?: string;
  readonly values: readonly string[];
  readonly props: readonly ProfileProp[];
  readonly links: readonly ProfileLink[];
  readonly path: string;
}

export interface ProfileModify {
  readonly setParameters: readonly ProfileSetParameter[];
  /** Alle Änderungsanweisungen in Quellreihenfolge, ohne Deduplizierung. */
  readonly alters: readonly ProfileAlteration[];
  /**
   * Dieselben Anweisungen, gruppiert nach `control-id`. Der Wert ist eine
   * **Liste**: Im WLAN-Profil adressieren bis zu fünf Einträge dieselbe
   * Control, und ihre kombinierte Wirkung entsteht erst aus allen zusammen.
   */
  readonly altersByControlId: ReadonlyMap<string, readonly ProfileAlteration[]>;
  /** Immer `not-resolved`: Diese Anweisungen werden erhalten, nicht ausgeführt. */
  readonly resolution: ProfileResolutionState;
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  Dokumentprojektion                                                 */
/* ------------------------------------------------------------------ */

export interface Profile {
  readonly uuid?: string;
  readonly metadata: ProfileMetadata;
  /** Mindestens ein Import ist Pflicht; fehlt er, steht das in `diagnostics`. */
  readonly imports: readonly ProfileImport[];
  readonly merge: ProfileMerge | null;
  readonly modify: ProfileModify | null;
  /**
   * Der Auflösungsstand des gesamten Dokuments. Er ist in diesem Slice
   * unveränderlich `not-resolved` — kein Feld dieses Modells behauptet ein
   * aufgelöstes Control-Set.
   */
  readonly resolution: ProfileResolutionState;
  /** Modellinterne Befunde. Sie verwerfen das Dokument nie (ADR-2, ADR-7). */
  readonly diagnostics: readonly OscalDiagnostic[];
}
