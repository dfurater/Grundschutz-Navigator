// =============================================================================
// Selektion (Phase 1 Import) der Profile Resolution — GSPP-291 Commit B
//
// Semantik laut gepinnter NIST-Draft-Spezifikation „OSCAL Profile Resolution"
// (pages.nist.gov, Stand 2026-07-29; Draft, kein Endgültigkeitsanspruch):
// include-all wählt alle Controls inklusive Nachfahren; with-ids und
// matching (Glob gegen die Control-ID) treffen einzelne Controls; ein
// fehlendes Matching-Muster trifft nichts. Inklusion zieht ohne
// `with-child-controls: yes` keine Nachfahren — und auch keine Vorfahren:
// gezogene Ahnen würden im as-is-Bild als leere Schalen materialisieren,
// was der BSI-Realkorpus als Orakel widerlegt (GSPP-291). Ausschlüsse
// nutzen dieselben Mechaniken und schlagen Inklusion unabhängig von deren
// Spezifität; innerhalb eines Imports ist jede Wirkung kumulativ und
// Duplikate zählen einmal.
//
// Alle Abfragen laufen rein identitäts-/strukturbasiert über Data-
// Properties des Rohdokuments; Werte werden nie über Accessoren gelesen.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { JsonObject } from '@/adapters/oscalProfileReaders';
import type { ProfileControlSelector, ProfileSelection } from './profileModel';
import {
  PROFILE_RESOLUTION_STAGE,
  PROFILE_RESOLUTION_VALIDATOR,
} from './profileResolutionImportGraph';
import {
  PROFILE_RESOLUTION_WORK_UNITS,
  type ProfileResolutionBudget,
  type ProfileResolutionWorkUnit,
} from './profileResolutionBudget';

/** Stabile Codes der Selektionsphase. */
export const PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES = Object.freeze({
  /** Die Projektion trägt eine mehrdeutige oder leere Selektion. */
  SELECTION_INVALID: 'PROFILE_RESOLUTION_SELECTION_INVALID',
  /** Ein with-child-controls-Wert außerhalb yes/no. */
  WITH_CHILD_CONTROLS_INVALID: 'PROFILE_RESOLUTION_WITH_CHILD_CONTROLS_INVALID',
} as const);

function reject(code: string): { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  return {
    ok: false,
    diagnostic: createOscalDiagnostic({
      code,
      stage: PROFILE_RESOLUTION_STAGE,
      validator: PROFILE_RESOLUTION_VALIDATOR,
      path: '/',
    }),
  };
}

/** Tiefenfirst-Index aller Controls eines importierten Dokuments. */
export interface CatalogControlIndex {
  /** Control-IDs in Originalordnung (depth-first wie im Dokument). */
  readonly order: readonly string[];
  readonly byId: ReadonlyMap<string, JsonObject>;
  /** Direkte Kind-Control-IDs je Control-ID. */
  readonly childrenOf: ReadonlyMap<string, readonly string[]>;
  /** Parent-Control-ID je Control-ID, sofern verschachtelt. */
  readonly parentOf: ReadonlyMap<string, string>;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object';
}

/** Objekt ohne Array — nur solche Werte zählen als Dokumentbestandteil am Root. */
function isPlainObjectBody(value: unknown): value is JsonObject {
  return isJsonObject(value) && !Array.isArray(value);
}

/**
 * Rein deskriptorbasierter Wertezugriff: Ein Accessor erscheint als
 * abwesend und wird niemals ausgeführt (Greptile-Befund zu 7012528).
 */
export function ownDataValue(container: object, key: string | number): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(container, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

function readControlId(node: JsonObject): string | null {
  const id = ownDataValue(node, 'id');
  return typeof id === 'string' && id.length > 0 ? id : null;
}

interface IndexState {
  order: string[];
  byId: Map<string, JsonObject>;
  childrenOf: Map<string, string[]>;
  parentOf: Map<string, string>;
  /** Besuchte Containeridentitäten — Zyklus-/Teilungsschutz des Stapellaufs. */
  seenContainers: Set<object>;
}

/** Registriert eine Control im Index; Duplikate bleiben beim Erstanteil. */
function registerControl(
  node: JsonObject,
  parentControlId: string | null,
  state: IndexState,
): void {
  const id = readControlId(node);
  if (id === null || state.byId.has(id)) return;

  state.order.push(id);
  state.byId.set(id, node);
  if (parentControlId !== null) {
    state.parentOf.set(id, parentControlId);
    const siblings = state.childrenOf.get(parentControlId) ?? [];
    siblings.push(id);
    state.childrenOf.set(parentControlId, siblings);
  }
}

type IndexTask =
  | { readonly kind: 'container'; readonly node: JsonObject }
  | { readonly kind: 'control'; readonly node: JsonObject; readonly parent: string | null };

/**
 * Elemente eines Arrays über eigene Data-Property-Deskriptoren, in
 * aufsteigender Indexreihenfolge; Accessor-Slots erscheinen als abwesend
 * und werden nie ausgeführt (Greptile-Befund zu 49d0984). Nur echte
 * ECMAScript-Array-Indizes (0 <= i < 2**32 - 1) gelten als Slots —
 * Schlüssel wie "4294967295" erscheinen nicht in der Serialisierung
 * (Greptile-Befund zu bce6b68).
 */
export function ownArrayDataElements(
  array: readonly unknown[],
  budget: ProfileResolutionBudget,
  category: ProfileResolutionWorkUnit,
): unknown[] {
  // DER Engpass jeder Array-Traversierung der vier Profile-Resolution-Module:
  // Selektion, Merge, Modify und Engine lesen Arrayelemente ausschließlich
  // hier. Ein Aufschlag von `length` VOR dem Lesen bucht damit jede
  // Elementberührung dieser Module an genau einer Stelle, statt sie an
  // siebenunddreißig Aufrufstellen einzeln nachzupflegen — und lässt keine
  // Schleife durchrutschen, die jemand später ergänzt. Vorab statt je Element
  // ist die fail-closed Richtung: Ein Array, das die Grenze reißt, wird gar
  // nicht erst durchlaufen. Die Kategorie kommt vom Aufrufer, weil ein
  // gemeinsamer Leser nicht wissen kann, in welcher Phase er steht.
  budget.spendWork(category, array.length);
  const maxExclusive = 2 ** 32 - 1;
  const indices = Reflect.ownKeys(array)
    .filter((key): key is string => {
      if (typeof key !== 'string') return false;
      const index = Number(key);
      return (
        Number.isInteger(index) && index >= 0 && index < maxExclusive && String(index) === key
      );
    })
    .map(Number)
    .sort((a, b) => a - b);

  const elements: unknown[] = [];
  for (const index of indices) {
    const descriptor = Object.getOwnPropertyDescriptor(array, index);
    if (descriptor !== undefined && 'value' in descriptor) elements.push(descriptor.value);
  }
  return elements;
}

/** Gruppenebenen als Container-Aufgaben in Dokumentreihenfolge. */
function pushGroupTasks(value: readonly unknown[], childTasks: IndexTask[], budget: ProfileResolutionBudget): void {
  // Deskriptorbasiert wie bei controls — Accessoren werden nie ausgeführt
  // (Greptile-Befunde zu 49d0984/0034765).
  for (const group of ownArrayDataElements(value, budget, PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE)) {
    if (isPlainObjectBody(group)) childTasks.push({ kind: 'container', node: group });
  }
}

/** Controls als Control-Aufgaben in Dokumentreihenfolge. */
function pushControlTasks(value: readonly unknown[], childTasks: IndexTask[], budget: ProfileResolutionBudget): void {
  for (const node of ownArrayDataElements(value, budget, PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE)) {
    if (isJsonObject(node)) childTasks.push({ kind: 'control', node, parent: null });
  }
}

/** Gruppen- und Control-Kinder eines Containers in Dokumentreihenfolge. */
function collectContainerChildTasks(
  container: JsonObject,
  childTasks: IndexTask[],
  budget: ProfileResolutionBudget,
): void {
  // Dokumentreihenfolge der Schlüssel ist bedeutungstragend.
  for (const key of Reflect.ownKeys(container)) {
    if (typeof key !== 'string') continue;
    const value = ownDataValue(container, key);
    if (!Array.isArray(value)) continue;
    if (key === 'groups') pushGroupTasks(value, childTasks, budget);
    else if (key === 'controls') pushControlTasks(value, childTasks, budget);
  }
}

/** Kind-Controls einer Control in Dokumentreihenfolge. */
function collectControlChildTasks(
  control: JsonObject,
  parentControlId: string,
  childTasks: IndexTask[],
  budget: ProfileResolutionBudget,
): void {
  const children = ownDataValue(control, 'controls');
  if (!Array.isArray(children)) return;
  for (const child of ownArrayDataElements(children, budget, PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE)) {
    if (isJsonObject(child)) childTasks.push({ kind: 'control', node: child, parent: parentControlId });
  }
}

/**
 * Indexiert die komplette Control-Hierarchie eines importierten Dokuments
 * iterativ: Eine explizite Aufgabenliste trägt Container- und Control-
 * Tiefenreihenfolge des Quelldokuments ohne jeden rekursiven Abstieg —
 * tiefe Hierarchien erschöpfen den Aufrufstapel nicht (Greptile-Befund zu
 * 0034765).
 */
function indexCatalogBody(
  body: JsonObject,
  state: IndexState,
  budget: ProfileResolutionBudget,
): void {
  const stack: IndexTask[] = [{ kind: 'container', node: body }];

  while (stack.length > 0) {
    // Der Index ist der Besuch des importierten Dokuments; er wächst mit
    // dessen Breite und Tiefe und wird deshalb je Knoten abgerechnet.
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.IMPORT_EDGE);
    const task = stack.pop()!;
    const childTasks: IndexTask[] = [];

    if (task.kind === 'container') {
      // Zyklus- und Teilungsschutz: Ein Container wird höchstens einmal
      // besucht (Greptile-Befund zu fe06afb).
      if (state.seenContainers.has(task.node)) continue;
      state.seenContainers.add(task.node);
      collectContainerChildTasks(task.node, childTasks, budget);
    } else {
      const id = readControlId(task.node);
      // Bereits registrierte Controls erhalten keine Kindaufgaben mehr —
      // Selbstreferenzen enden kontrolliert statt endlos zu planen.
      if (id === null || state.byId.has(id)) continue;
      registerControl(task.node, task.parent, state);
      collectControlChildTasks(task.node, id, childTasks, budget);
    }

    // Umgekehrt pushen, damit der Stapel die Originalordnung liefert.
    for (let index = childTasks.length - 1; index >= 0; index -= 1) {
      stack.push(childTasks[index]!);
    }
  }
}

/** Indexiert alle Controls eines importierten Katalogdokuments. */
export function indexCatalogControls(
  document: unknown,
  budget: ProfileResolutionBudget,
): CatalogControlIndex {
  const state: IndexState = {
    order: [],
    byId: new Map(),
    childrenOf: new Map(),
    parentOf: new Map(),
    seenContainers: new Set<object>(),
  };
  if (!isPlainObjectBody(document)) return state;

  // Root-Key rein deskriptorbasierend lokalisieren; Arrays zählen nicht als
  // Body, damit ein Array-Geschwister am Root die Eindeutigkeit nicht
  // verwässert (Gitar-Hinweis zu 7012528).
  const bodyKeys = Reflect.ownKeys(document).filter(
    (key): key is string =>
      typeof key === 'string' && isPlainObjectBody(ownDataValue(document, key)),
  );
  if (bodyKeys.length !== 1) return state;

  const body = ownDataValue(document, bodyKeys[0]!) as JsonObject;
  indexCatalogBody(body, state, budget);
  return state;
}

/**
 * Prüft ein `matching`-Muster gegen eine Control-ID — linear, budgetiert und
 * ohne regulären Ausdruck.
 *
 * Das gepinnte Schema 1.1.3 beschreibt den Wert ausschließlich als
 * „a glob expression matching the IDs of one or more controls to be selected"
 * (`oscal-profile-oscal-profile:matching` in
 * `schemas/oscal/v1.1.3/oscal_profile_schema.json`). Welche Platzhalter es
 * gibt und was sie bedeuten, legt es nicht fest. Die hier gewählte Auslegung —
 * `*` beliebig viele Zeichen, `?` genau eines, vollständig verankert — ist
 * deshalb eine Annahme dieser Implementierung und keine gegen
 * `usnistgov/OSCAL` belegte Normaussage. Offen: gegen welchen Tag oder Commit
 * sie sich belegen lässt.
 *
 * WARUM KEIN REGULÄRER AUSDRUCK (GSPP-385, aufgenommen in GSPP-345): Die
 * frühere Fassung `globToRegExp` übersetzte `*` nach `.*` und verankerte das
 * Ergebnis. Für mehrere Sterne entstanden dabei verschachtelte, überlappende
 * Quantoren; scheiterte der Abgleich, probierte die Engine alle Aufteilungen
 * des Subjekts durch. Gemessen (GSPP-382, `docs/OSCAL_VALIDATION.md`): 12
 * Sterne gegen eine 40 Zeichen lange ID kosteten 31,82 s bei einem Dokument
 * von wenigen hundert Byte. Keine Ressourcengrenze griff, und ein
 * Arbeitsbudget hätte auch nicht geholfen — das Backtracking lief innerhalb
 * EINES Aufrufs ab, den keine Zähleinheit unterbrechen kann. Der Zwei-Zeiger-
 * Abgleich hier hat keinen exponentiellen Fall und bucht jeden besuchten
 * Zustand einzeln, ist also von außen abbrechbar.
 *
 * SEMANTISCHE ABWEICHUNG zur RegExp-Fassung, bewusst und einzige: `.` traf in
 * einem regulären Ausdruck ohne `s`-Flag keinen Zeilenumbruch, `*` und `?`
 * konnten eine ID mit `\n` also nie treffen. Der Zeichenvergleich hier
 * behandelt jedes Zeichen gleich. Das ist die naheliegendere Glob-Auslegung;
 * für den BSI-Korpus ist die Änderung wirkungslos, weil dort keine Control-ID
 * einen Zeilenumbruch trägt — der Korpuslauf belegt das als Orakel.
 */
export function matchGlob(
  pattern: string,
  subject: string,
  budget: ProfileResolutionBudget,
): boolean {
  let patternIndex = 0;
  let subjectIndex = 0;
  // Position des zuletzt gesehenen `*` und die Subjektstelle, ab der es
  // erneut verlängert wird. Genau ein Rücksprungpunkt genügt, weil ein
  // späterer Stern jeden früheren ablöst.
  let starPattern = -1;
  let starSubject = -1;

  while (subjectIndex < subject.length) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.GLOB_STATE);
    const patternChar = patternIndex < pattern.length ? pattern[patternIndex] : undefined;
    if (patternChar === '?' || (patternChar !== undefined && patternChar === subject[subjectIndex])) {
      patternIndex += 1;
      subjectIndex += 1;
    } else if (patternChar === '*') {
      starPattern = patternIndex;
      starSubject = subjectIndex;
      patternIndex += 1;
    } else if (starPattern !== -1) {
      starSubject += 1;
      patternIndex = starPattern + 1;
      subjectIndex = starSubject;
    } else {
      return false;
    }
  }

  while (patternIndex < pattern.length && pattern[patternIndex] === '*') {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.GLOB_STATE);
    patternIndex += 1;
  }
  return patternIndex === pattern.length;
}

type MatchOutcome =
  | { readonly matched: ReadonlySet<string> }
  | { readonly diagnostic: OscalDiagnostic };

/** Ergänzt alle IDs, die eines der Glob-Muster trifft. */
function addPatternMatches(
  index: CatalogControlIndex,
  matchers: readonly ProfileControlSelector['matching'][number][],
  matched: Set<string>,
  budget: ProfileResolutionBudget,
): void {
  for (const matcher of matchers) {
    // Ein fehlendes oder leeres Muster trifft nichts — unverändert zur
    // RegExp-Fassung, die dafür `null` lieferte.
    const pattern = matcher.pattern;
    if (pattern === undefined || pattern.length === 0) continue;
    for (const id of index.order) {
      if (matchGlob(pattern, id, budget)) matched.add(id);
    }
  }
}

/** Ergänzt alle IDs aus einer with-ids-Liste, die im Katalog existieren. */
function addWithIdsMatches(
  index: CatalogControlIndex,
  withIds: readonly string[],
  matched: Set<string>,
  budget: ProfileResolutionBudget,
): void {
  for (const id of withIds) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.SELECTOR_COMPARE);
    if (index.byId.has(id)) matched.add(id);
  }
}

/**
 * Wendet die with-child-controls-Richtlinie an: yes erweitert auf alle
 * Nachfahren, no bzw. fehlend belässt den Selbsttreffer, alles andere ist
 * fail-closed.
 */
function applyWithChildPolicy(
  index: CatalogControlIndex,
  matched: ReadonlySet<string>,
  withChild: string | undefined,
  budget: ProfileResolutionBudget,
): MatchOutcome {
  if (withChild === undefined || withChild === 'no') return { matched };
  if (withChild !== 'yes') {
    return {
      diagnostic: reject(
        PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES.WITH_CHILD_CONTROLS_INVALID,
      ).diagnostic,
    };
  }
  return { matched: expandWithDescendants(index, matched, budget) };
}

function selectorMatches(
  index: CatalogControlIndex,
  selector: ProfileControlSelector,
  budget: ProfileResolutionBudget,
): MatchOutcome {
  const matched = new Set<string>();
  addWithIdsMatches(index, selector.withIds, matched, budget);
  addPatternMatches(index, selector.matching, matched, budget);
  return applyWithChildPolicy(index, matched, selector.withChildControls, budget);
}

function expandWithDescendants(
  index: CatalogControlIndex,
  ids: ReadonlySet<string>,
  budget: ProfileResolutionBudget,
): Set<string> {
  const expanded = new Set(ids);
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of index.childrenOf.get(id) ?? []) {
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.SELECTOR_COMPARE);
      if (!expanded.has(child)) {
        expanded.add(child);
        stack.push(child);
      }
    }
  }
  return expanded;
}

function applySelector(
  index: CatalogControlIndex,
  selector: ProfileControlSelector,
  included: Set<string>,
  budget: ProfileResolutionBudget,
): OscalDiagnostic | null {
  const outcome = selectorMatches(index, selector, budget);
  if ('diagnostic' in outcome) return outcome.diagnostic;

  // Bewusst KEINE automatische Vorfahren-Inklusion: Der BSI-Realkorpus
  // beweist am Orakel (lieferkette: KONF.2.4.2 erscheint hochgelevelt,
  // ohne dass KONF.2.4 als Schale materialisiert wird), dass gezogene
  // Ahnen nicht als Kontrollen ausgegeben werden — und die Ausgabe eines
  // Ahnen ohne eigene Selektion wäre genau eine solche Schale. Die
  // Projektion trägt diese Entscheidung; der Draft-Default
  // (with-parent-controls: yes) bleibt in der Dokumentation als
  // Abweichung ausgewiesen.
  for (const id of outcome.matched) included.add(id);
  return null;
}

function applyInclusions(
  index: CatalogControlIndex,
  selection: ProfileSelection & { readonly kind: 'include-all' | 'include-controls' },
  included: Set<string>,
  budget: ProfileResolutionBudget,
): OscalDiagnostic | null {
  if (selection.kind === 'include-all') {
    for (const id of index.order) {
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.SELECTOR_COMPARE);
      included.add(id);
    }
    return null;
  }
  for (const selector of selection.includeControls) {
    const failure = applySelector(index, selector, included, budget);
    if (failure !== null) return failure;
  }
  return null;
}

function applyExcludes(
  index: CatalogControlIndex,
  included: Set<string>,
  excludeControls: readonly ProfileControlSelector[],
  budget: ProfileResolutionBudget,
): OscalDiagnostic | null {
  for (const selector of excludeControls) {
    const excluded = selectorMatches(index, selector, budget);
    if ('diagnostic' in excluded) return excluded.diagnostic;
    // Mit with-child-controls: yes entfällt der ganze Zweig; sonst nur der
    // Selbsttreffer — dieselbe Mechanik wie bei der Inklusion.
    const targets =
      selector.withChildControls === 'yes'
        ? expandWithDescendants(index, excluded.matched, budget)
        : excluded.matched;
    for (const id of targets) {
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.SELECTOR_COMPARE);
      included.delete(id);
    }
  }
  return null;
}

export type SelectionOutcome =
  | { readonly ok: true; readonly ids: ReadonlySet<string> }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

/** Selektionsauftrag eines Imports: Anweisung plus Ausschlüsse (GSPP-240-Modell). */
export interface ImportSelectionRequest {
  readonly selection: ProfileSelection;
  readonly excludeControls: readonly ProfileControlSelector[];
}

/**
 * Löst die Selektion eines Imports gegen einen indexierten Katalog auf:
 * kumulative Inklusion, kumulativer Ausschluss, Ausschluss gewinnt immer.
 * Ergebnis ist die Menge der Control-IDs in Originalordnung des Dokuments.
 */
export function resolveSelectionIds(
  index: CatalogControlIndex,
  request: ImportSelectionRequest,
  budget: ProfileResolutionBudget,
): SelectionOutcome {
  const { selection, excludeControls } = request;
  if (selection.kind !== 'include-all' && selection.kind !== 'include-controls') {
    return reject(PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES.SELECTION_INVALID);
  }

  const included = new Set<string>();
  const inclusionFailure = applyInclusions(index, selection, included, budget);
  if (inclusionFailure !== null) return { ok: false, diagnostic: inclusionFailure };
  const exclusionFailure = applyExcludes(index, included, excludeControls, budget);
  if (exclusionFailure !== null) return { ok: false, diagnostic: exclusionFailure };

  // Ergebnis in Originalordnung des Dokuments.
  const ordered = new Set<string>();
  for (const id of index.order) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.SELECTOR_COMPARE);
    if (included.has(id)) ordered.add(id);
  }
  return { ok: true, ids: ordered };
}
