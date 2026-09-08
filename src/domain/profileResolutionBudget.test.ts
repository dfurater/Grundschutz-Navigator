import { describe, expect, it } from 'vitest';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import {
  createProfileResolutionBudget,
  PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES,
  PROFILE_RESOLUTION_WORK_UNITS,
  ProfileResolutionBudgetExceeded,
  WORK_UNIT_LIMIT,
} from './profileResolutionBudget';

/**
 * Fängt den Abbruch und gibt seine Diagnose zurück. Schlägt fehl, wenn der
 * Aufruf durchläuft — ein stillschweigend erfolgreicher Grenzfall wäre genau
 * der Fehler, den diese Tests ausschließen sollen.
 */
function rejectionOf(run: () => void) {
  try {
    run();
  } catch (error) {
    if (error instanceof ProfileResolutionBudgetExceeded) return error.diagnostic;
    throw error;
  }
  throw new Error('Budget hat den Grenzfall nicht abgewiesen');
}

describe('Arbeitsbudget', () => {
  it('lässt genau den Grenzwert zu und weist den Schritt darüber ab', () => {
    const budget = createProfileResolutionBudget({ workUnits: 3 });

    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE, 3);
    expect(budget.usage().workUnits).toBe(3);

    const diagnostic = rejectionOf(() =>
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE),
    );
    expect(diagnostic.code).toBe(
      PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.WORK_BUDGET_EXCEEDED,
    );
    // Der Zähler bleibt auf dem Grenzwert: Geprüft wird VOR dem Verbrauch,
    // die abgewiesene Arbeit wird also nicht bezahlt.
    expect(budget.usage().workUnits).toBe(3);
  });

  it('weist einen Sammelaufschlag ab, der die Grenze überschreiten würde', () => {
    // Der Aufschlag über die Arraylänge ist die Buchung, die
    // `ownArrayDataElements` vornimmt. Sie darf nicht teilweise durchlaufen.
    const budget = createProfileResolutionBudget({ workUnits: 10 });

    rejectionOf(() => budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.MERGE_STEP, 11));
    expect(budget.usage().workUnits).toBe(0);
  });

  it('trägt Kategorie und Zahlen, aber keinen Dokumentbezug in der Diagnose', () => {
    const budget = createProfileResolutionBudget({ workUnits: 0 });
    const diagnostic = rejectionOf(() =>
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.GLOB_STATE),
    );

    expect(diagnostic.stage).toBe('resource-limit');
    expect(diagnostic.validator).toEqual({ name: 'profile-resolution-budget', version: '1' });
    expect(diagnostic.params).toEqual({ category: 'glob-state', limit: 0, observed: 1 });
    expect(diagnostic.artifact).toEqual({ key: null, rootType: null, oscalVersion: null });
  });

  it('bildet jede Kategorie auf genau einen der vier strukturellen Pfade ab', () => {
    const pathFor = (category: (typeof PROFILE_RESOLUTION_WORK_UNITS)[keyof typeof PROFILE_RESOLUTION_WORK_UNITS]) =>
      rejectionOf(() => createProfileResolutionBudget({ workUnits: 0 }).spendWork(category)).path;

    expect(pathFor(PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE)).toBe('/profile/imports');
    expect(pathFor(PROFILE_RESOLUTION_WORK_UNITS.SELECTOR_COMPARE)).toBe('/profile/imports');
    expect(pathFor(PROFILE_RESOLUTION_WORK_UNITS.GLOB_STATE)).toBe('/profile/imports');
    expect(pathFor(PROFILE_RESOLUTION_WORK_UNITS.MERGE_STEP)).toBe('/profile/merge');
    expect(pathFor(PROFILE_RESOLUTION_WORK_UNITS.ALTER_TARGET_LOOKUP)).toBe('/profile/modify');
    expect(pathFor(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE)).toBe('/profile/modify');
  });
});

describe('Ausgabebudget', () => {
  it('lässt genau die Knotengrenze zu und verhindert den Knoten darüber', () => {
    const budget = createProfileResolutionBudget({ maxNodes: 2 });

    budget.admitNode(1);
    budget.admitNode(2);
    expect(budget.usage().nodes).toBe(2);

    const diagnostic = rejectionOf(() => budget.admitNode(3));
    expect(diagnostic.code).toBe(
      PROFILE_RESOLUTION_BUDGET_DIAGNOSTIC_CODES.OUTPUT_BUDGET_EXCEEDED,
    );
    expect(diagnostic.params).toEqual({ dimension: 'nodes', limit: 2, observed: 3 });
    expect(diagnostic.path).toBe('/catalog');
    // Der Knoten `limit + 1` ist nicht entstanden.
    expect(budget.usage().nodes).toBe(2);
  });

  it('lässt Tiefe 64 zu und weist Tiefe 65 ab — dieselbe Grenze wie die Postcondition', () => {
    const budget = createProfileResolutionBudget();

    budget.admitNode(CLASS_2_IMPORT_LIMITS.maxDepth);
    expect(budget.usage().maxDepth).toBe(64);

    const diagnostic = rejectionOf(() => budget.admitNode(CLASS_2_IMPORT_LIMITS.maxDepth + 1));
    expect(diagnostic.params).toEqual({ dimension: 'depth', limit: 64, observed: 65 });
    // Die abgewiesene Tiefe wird nicht als erreicht verbucht.
    expect(budget.usage().maxDepth).toBe(64);
  });

  it('summiert base64 arithmetisch und weist die Überschreitung ab', () => {
    // 8 kodierte Zeichen ohne Polsterung sind 6 dekodierte Byte.
    const budget = createProfileResolutionBudget({ maxDecodedBase64Bytes: 12 });

    budget.admitBase64('AAAAAAAA');
    budget.admitBase64('AAAAAAAA');
    expect(budget.usage().decodedBase64Bytes).toBe(12);

    const diagnostic = rejectionOf(() => budget.admitBase64('AAAAAAAA'));
    expect(diagnostic.params).toEqual({ dimension: 'base64', limit: 12, observed: 18 });
    expect(budget.usage().decodedBase64Bytes).toBe(12);
  });

  it('senkt keinen Zähler — ein Add/Remove-Zyklus umgeht das Budget nicht', () => {
    // Es gibt keine Rückgabe-, Reset- oder Freigabemethode. Der Test hält das
    // als Vertrag fest: Wer entfernte Knoten gutschreiben wollte, müsste die
    // Schnittstelle erweitern, und dieser Test schlüge fehl.
    const budget = createProfileResolutionBudget({ maxNodes: 3 });
    budget.admitNode(1);
    budget.admitNode(2);
    budget.admitNode(3);

    expect(Object.keys(budget).sort()).toEqual(['admitBase64', 'admitNode', 'spendWork', 'usage']);
    rejectionOf(() => budget.admitNode(2));
  });
});

describe('Budgetinstanz', () => {
  it('ist je Lauf frisch — zwei Instanzen teilen keinen Zähler', () => {
    const first = createProfileResolutionBudget({ workUnits: 2 });
    first.spendWork(PROFILE_RESOLUTION_WORK_UNITS.MERGE_STEP, 2);

    const second = createProfileResolutionBudget({ workUnits: 2 });
    expect(second.usage().workUnits).toBe(0);
    second.spendWork(PROFILE_RESOLUTION_WORK_UNITS.MERGE_STEP, 2);
    expect(first.usage().workUnits).toBe(2);
  });

  it('nimmt ohne Testgrenzen die Produktionsgrenzen', () => {
    const budget = createProfileResolutionBudget();

    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE, WORK_UNIT_LIMIT);
    rejectionOf(() => budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE));
  });

  it('gibt eine eingefrorene Momentaufnahme heraus', () => {
    const usage = createProfileResolutionBudget().usage();
    expect(Object.isFrozen(usage)).toBe(true);
    expect(usage).toEqual({ workUnits: 0, nodes: 0, maxDepth: 0, decodedBase64Bytes: 0 });
  });
});
