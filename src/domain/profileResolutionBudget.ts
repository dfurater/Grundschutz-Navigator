// =============================================================================
// Laufendes Arbeits- und Ausgabebudget der Profile Resolution (GSPP-345,
// ADR-8). Eine Postcondition kann die bereits verbrauchte Arbeit und den
// bereits aufgebauten Zwischenzustand nicht zurückholen; deshalb zählt ein
// Auflösungslauf beides MONOTON mit und prüft VOR der jeweils budgetierten
// Operation beziehungsweise Allokation.
//
// Zwei Erschöpfungswege, die die abschließende Objektprüfung nicht rechtzeitig
// abdeckt:
//   * ausgabeseitig — Import, Merge und `modify.alters[].adds[]` bauen einen
//     Zwischengraphen auf, der größer als jede einzelne Eingabe sein kann;
//     `removes[]` schreiben verbrauchte Allokationen nicht gut;
//   * arbeitsseitig — viele Importe, Selektoren, Glob-Vergleiche oder
//     Alter-Anwendungen kosten viel Arbeit bei kleiner Ausgabe.
//
// Abbruchweg: Die Zählmethoden WERFEN `ProfileResolutionBudgetExceeded`. Der
// Wurf ist bewusst gewählt und keine Bequemlichkeit — die Arbeitseinheiten
// fallen in vier Modulen und rund zwanzig Funktionen an, von denen die meisten
// heute keinen Diagnosekanal führen. Ein durchgereichter Rückgabewert hätte
// zwanzig Signaturen geändert und an jeder Stelle die Möglichkeit eröffnet,
// die Ablehnung zu übersehen und doch ein Teilergebnis zu liefern. Der Wurf
// verlässt den Lauf an genau einer Fangstelle in `resolveProfile`, wo weder
// ein Teilergebnis noch ein Builder-Handle nach außen gelangen kann. In
// `profileResolution*.ts` und `oscalObjectPipeline.ts` existiert kein
// einziges `try`/`catch`, das ihn vorher abfangen könnte.
// =============================================================================

import { decodedBase64ByteLength } from '@/domain/oscalBackMatterBase64';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { WORK_UNIT_LIMIT } from './profileResolutionBudgetLimits.mjs';

export { WORK_UNIT_LIMIT };

/** Eigene Validatoridentität: Das Budget ist eine eigene Prüfstufe. */
export const PROFILE_RESOLUTION_BUDGET_VALIDATOR = Object.freeze({
  name: 'profile-resolution-budget',
  version: '1',
});

/** Die beiden stabilen, redigierten Codes des Budgets. */
export const PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES = Object.freeze({
  /** Arbeitsgrenze erschöpft — unabhängig von der Ausgabegröße. */
  WORK_BUDGET_EXCEEDED: 'OSCAL_RESOLUTION_WORK_BUDGET_EXCEEDED',
  /** Kumulativ erzeugte Ausgabe reißt Knoten-, Tiefen- oder base64-Grenze. */
  OUTPUT_BUDGET_EXCEEDED: 'OSCAL_RESOLUTION_OUTPUT_BUDGET_EXCEEDED',
});

/**
 * Geschlossener Satz der Arbeitseinheiten. Jede potenziell wachsende
 * Resolveroperation rechnet über genau eine dieser Kategorien ab; eine
 * Operation ohne Kategorie ist nicht budgetiert und damit ein Vertragsbruch.
 */
export const PROFILE_RESOLUTION_WORK_UNITS = Object.freeze({
  /** Besuch einer Importkante beziehungsweise eines importierten Dokuments. */
  IMPORT_EDGE: 'import-edge',
  /** Vergleich eines Controls mit einem with-id-, Include- oder Exclude-Selektor. */
  SELECTOR_COMPARE: 'selector-compare',
  /** Besuch eines Zustands beim Glob-Match von `matching.pattern`. */
  GLOB_STATE: 'glob-state',
  /** Vergleich oder Einfügeschritt in Merge, Sortierung, Gruppierung, Dedup. */
  MERGE_STEP: 'merge-step',
  /** Suche eines `alter`-Zielcontrols. */
  ALTER_TARGET_LOOKUP: 'alter-target-lookup',
  /** Besuch eines `adds[]`- oder `removes[]`-Kandidaten. */
  ALTER_CANDIDATE: 'alter-candidate',
} as const);

export type ProfileResolutionWorkUnit =
  (typeof PROFILE_RESOLUTION_WORK_UNITS)[keyof typeof PROFILE_RESOLUTION_WORK_UNITS];

/**
 * Geschlossene Menge der strukturellen Pfade. Ein Budgetabbruch nennt genau
 * einen dieser vier Werte — nie einen aus dem Dokument abgeleiteten Pfad.
 */
const WORK_UNIT_PATHS: Readonly<Record<ProfileResolutionWorkUnit, string>> = Object.freeze({
  'import-edge': '/profile/imports',
  'selector-compare': '/profile/imports',
  'glob-state': '/profile/imports',
  'merge-step': '/profile/merge',
  'alter-target-lookup': '/profile/modify',
  'alter-candidate': '/profile/modify',
});

const OUTPUT_PATH = '/catalog';

/** Welche der drei Ausgabegrenzen gerissen wurde — strukturell, nicht inhaltlich. */
type OutputDimension = 'nodes' | 'depth' | 'base64';

function rejectOutput(dimension: OutputDimension, limit: number, observed: number): never {
  throw new ProfileResolutionBudgetExceeded(
    budgetDiagnostic(
      PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.OUTPUT_BUDGET_EXCEEDED,
      OUTPUT_PATH,
      { dimension, limit, observed },
    ),
  );
}

/**
 * Abbruchsignal des Budgets. Trägt die fertige, redigierte Diagnose; die
 * Fehlermeldung selbst ist konstant und enthält keinen Dokumentbezug.
 */
export class ProfileResolutionBudgetExceeded extends Error {
  readonly diagnostic: OscalDiagnostic;

  constructor(diagnostic: OscalDiagnostic) {
    super('Profile-Resolution-Budget erschöpft');
    this.name = 'ProfileResolutionBudgetExceeded';
    this.diagnostic = diagnostic;
  }
}

/** Die vier Messwerte eines Laufs, für Korpuslauf und Messapparat. */
export interface ProfileResolutionBudgetUsage {
  /** Verbrauchte Arbeitseinheiten über alle Kategorien. */
  readonly workUnits: number;
  /**
   * Kumulativ ERZEUGTE Knoten: emittierte Ausgabeknoten UND die Container des
   * Zwischenzustands, den Merge und Modify vor der Emission anlegen. Beides
   * zählt, weil ADR-8 ausdrücklich den „Zwischen- ODER Ergebnisgraphen" meint
   * — ein Lauf kann Millionen Zwischenkopien allokieren und dabei null
   * Ausgabeknoten erzeugt haben (Greptile-Befund zu 21dd0b3). Entfernen senkt
   * diesen Wert nie.
   */
  readonly nodes: number;
  /** Größte jemals begonnene Ausgabetiefe (Wurzel = 1). */
  readonly maxDepth: number;
  /** Kumulativ übernommene dekodierte base64-Größe. */
  readonly decodedBase64Bytes: number;
}

export interface ProfileResolutionBudget {
  /** Bucht Arbeit VOR ihrer Ausführung. Wirft bei Erschöpfung. */
  spendWork(category: ProfileResolutionWorkUnit, count?: number): void;
  /** Lässt genau einen Ausgabeknoten der Tiefe `depth` zu. Wirft bei Erschöpfung. */
  admitNode(depth: number): void;
  /**
   * Lässt einen Container des ZWISCHENZUSTANDS zu — eine Kopie, die Merge oder
   * Modify anlegt, bevor überhaupt emittiert wird. Wirft bei Erschöpfung.
   */
  admitWorkingNode(): void;
  /** Übernimmt einen kodierten base64-Wert in die Ausgabe. Wirft bei Erschöpfung. */
  admitBase64(encoded: string): void;
  /** Momentaufnahme der Zähler. Rein lesend — es gibt keinen Weg zurück. */
  usage(): ProfileResolutionBudgetUsage;
}

/**
 * Nur für den isolierten Budget-Unit-Test. Der Produktionspfad ruft
 * `createProfileResolutionBudget()` ohne Argument; `resolveProfile` besitzt
 * weder Grenzwert- noch Disable-Parameter, und ein gleichnamiger Wert im
 * Steuerdokument bleibt gewöhnlicher Dokumentinhalt.
 */
export interface ProfileResolutionBudgetTestLimits {
  readonly workUnits?: number;
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxDecodedBase64Bytes?: number;
}

function budgetDiagnostic(
  code: string,
  path: string,
  params: Readonly<Record<string, string | number>>,
): OscalDiagnostic {
  return createOscalDiagnostic({
    code,
    stage: 'resource-limit',
    validator: PROFILE_RESOLUTION_BUDGET_VALIDATOR,
    path,
    params,
  });
}

/**
 * Eine Budgetinstanz je Auflösungslauf. Kein Modulzustand, kein globaler
 * Zähler, keine Wiederverwendung über Läufe: Der einzige Weg an einen Zähler
 * führt über diese Fabrik, und sie gibt nichts heraus, was ihn senken könnte.
 */
export function createProfileResolutionBudget(
  testLimits: ProfileResolutionBudgetTestLimits = {},
): ProfileResolutionBudget {
  const workLimit = testLimits.workUnits ?? WORK_UNIT_LIMIT;
  const nodeLimit = testLimits.maxNodes ?? CLASS_2_IMPORT_LIMITS.maxNodes;
  const depthLimit = testLimits.maxDepth ?? CLASS_2_IMPORT_LIMITS.maxDepth;
  const base64Limit =
    testLimits.maxDecodedBase64Bytes ?? CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes;

  let workUnits = 0;
  let nodes = 0;
  let maxDepth = 0;
  let decodedBase64Bytes = 0;

  return {
    spendWork(category, count = 1) {
      // Vor der Operation, nicht danach: Eine Prüfung im Nachhinein hätte die
      // Arbeit bereits bezahlt.
      if (workUnits + count > workLimit) {
        throw new ProfileResolutionBudgetExceeded(
          budgetDiagnostic(
            PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.WORK_BUDGET_EXCEEDED,
            WORK_UNIT_PATHS[category],
            { category, limit: workLimit, observed: workUnits + count },
          ),
        );
      }
      workUnits += count;
    },

    admitNode(depth) {
      // Genau der Grenzwert ist zulässig; der Knoten `limit + 1` entsteht
      // nicht, weil die Prüfung vor der Allokation im Builder liegt.
      if (nodes + 1 > nodeLimit) rejectOutput('nodes', nodeLimit, nodes + 1);
      if (depth > depthLimit) rejectOutput('depth', depthLimit, depth);
      nodes += 1;
      if (depth > maxDepth) maxDepth = depth;
    },

    admitWorkingNode() {
      // Derselbe Zähler wie die Emission, aber ohne Tiefe: Ein Merge-Zwischen-
      // objekt hat keine Ausgabetiefe, und `maxDepth` soll weiter die Tiefe
      // des AUSGEGEBENEN Graphen nennen.
      if (nodes + 1 > nodeLimit) rejectOutput('nodes', nodeLimit, nodes + 1);
      nodes += 1;
    },

    admitBase64(encoded) {
      const total = decodedBase64Bytes + decodedBase64ByteLength(encoded);
      if (total > base64Limit) rejectOutput('base64', base64Limit, total);
      decodedBase64Bytes = total;
    },

    usage() {
      return Object.freeze({ workUnits, nodes, maxDepth, decodedBase64Bytes });
    },
  };
}
