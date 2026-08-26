// =============================================================================
// Selektion (Phase 1 Import) der Profile Resolution — GSPP-291 Commit B
//
// Semantik laut gepinnter NIST-Draft-Spezifikation „OSCAL Profile Resolution"
// (pages.nist.gov, Stand 2026-07-29; Draft, kein Endgültigkeitsanspruch):
// include-all wählt alle Controls inklusive Nachfahren; with-ids und
// matching (Glob gegen die Control-ID) treffen einzelne Controls; ein
// fehlendes Matching-Muster trifft nichts. Inklusion zieht ohne
// `with-child-controls: yes` keine Nachfahren, aber standardmäßig alle
// Vorfahren-Controls. Ausschlüsse nutzen dieselben Mechaniken und schlagen
// Inklusion unabhängig von deren Spezifität; innerhalb eines Imports ist
// jede Wirkung kumulativ und Duplikate zählen einmal.
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

function isJsonObject(value: unknown): value is JsonObject {
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
function ownDataValue(container: object, key: string | number): unknown {
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
 * Indexiert die komplette Control-Hierarchie eines importierten Dokuments
 * iterativ: Eine explizite Aufgabenliste trägt Container- und Control-
 * Tiefenreihenfolge des Quelldokuments ohne jeden rekursiven Abstieg —
 * tiefe Hierarchien erschöpfen den Aufrufstapel nicht (Greptile-Befund zu
 * 0034765). Rein deskriptorbasiert; Accessoren erscheinen als abwesend.
 */
/**
 * Elemente eines Arrays über eigene Data-Property-Deskriptoren, in
 * aufsteigender Indexreihenfolge; Accessor-Slots erscheinen als abwesend
 * und werden nie ausgeführt (Greptile-Befund zu 49d0984).
 */
function ownArrayDataElements(array: readonly unknown[]): unknown[] {
  const indices = Reflect.ownKeys(array)
    .filter((key): key is string => {
      if (typeof key !== 'string') return false;
      const index = Number(key);
      return Number.isInteger(index) && index >= 0 && String(index) === key;
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
function pushGroupTasks(value: readonly unknown[], childTasks: IndexTask[]): void {
  for (const group of value) {
    if (isPlainObjectBody(group)) childTasks.push({ kind: 'container', node: group });
  }
}

/** Controls als Control-Aufgaben in Dokumentreihenfolge. */
function pushControlTasks(value: readonly unknown[], childTasks: IndexTask[]): void {
  for (const node of ownArrayDataElements(value)) {
    if (isJsonObject(node)) childTasks.push({ kind: 'control', node, parent: null });
  }
}

/** Gruppen- und Control-Kinder eines Containers in Dokumentreihenfolge. */
function collectContainerChildTasks(
  container: JsonObject,
  childTasks: IndexTask[],
): void {
  // Dokumentreihenfolge der Schlüssel ist bedeutungstragend.
  for (const key of Reflect.ownKeys(container)) {
    if (typeof key !== 'string') continue;
    const value = ownDataValue(container, key);
    if (!Array.isArray(value)) continue;
    if (key === 'groups') pushGroupTasks(value, childTasks);
    else if (key === 'controls') pushControlTasks(value, childTasks);
  }
}

/** Kind-Controls einer Control in Dokumentreihenfolge. */
function collectControlChildTasks(
  control: JsonObject,
  parentControlId: string,
  childTasks: IndexTask[],
): void {
  const children = ownDataValue(control, 'controls');
  if (!Array.isArray(children)) return;
  for (const child of ownArrayDataElements(children)) {
    if (isJsonObject(child)) childTasks.push({ kind: 'control', node: child, parent: parentControlId });
  }
}

function indexCatalogBody(body: JsonObject, state: IndexState): void {
  const stack: IndexTask[] = [{ kind: 'container', node: body }];

  while (stack.length > 0) {
    const task = stack.pop()!;
    const childTasks: IndexTask[] = [];

    if (task.kind === 'container') {
      collectContainerChildTasks(task.node, childTasks);
    } else {
      registerControl(task.node, task.parent, state);
      const id = readControlId(task.node);
      if (id !== null) collectControlChildTasks(task.node, id, childTasks);
    }

    // Umgekehrt pushen, damit der Stapel die Originalordnung liefert.
    for (let index = childTasks.length - 1; index >= 0; index -= 1) {
      stack.push(childTasks[index]!);
    }
  }
}

/** Indexiert alle Controls eines importierten Katalogdokuments. */
export function indexCatalogControls(document: unknown): CatalogControlIndex {
  const state: IndexState = {
    order: [],
    byId: new Map(),
    childrenOf: new Map(),
    parentOf: new Map(),
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
  indexCatalogBody(body, state);
  return state;
}

/** Glob-Muster nach NIST-Draft (`*` beliebig, `?` genau ein Zeichen); ohne Muster trifft nichts. */
function globToRegExp(pattern: string | undefined): RegExp | null {
  if (pattern === undefined || pattern.length === 0) return null;
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll('*', '.*')
    .replaceAll('?', '.');
  return new RegExp(`^${escaped}$`);
}

type MatchOutcome =
  | { readonly matched: ReadonlySet<string> }
  | { readonly diagnostic: OscalDiagnostic };

/** Ergänzt alle IDs, die eines der Glob-Muster trifft. */
function addPatternMatches(
  index: CatalogControlIndex,
  matchers: readonly ProfileControlSelector['matching'][number][],
  matched: Set<string>,
): void {
  for (const matcher of matchers) {
    const regexp = globToRegExp(matcher.pattern);
    if (regexp === null) continue;
    for (const id of index.order) {
      if (regexp.test(id)) matched.add(id);
    }
  }
}

/** Ergänzt alle IDs aus einer with-ids-Liste, die im Katalog existieren. */
function addWithIdsMatches(
  index: CatalogControlIndex,
  withIds: readonly string[],
  matched: Set<string>,
): void {
  for (const id of withIds) {
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
): MatchOutcome {
  if (withChild === undefined || withChild === 'no') return { matched };
  if (withChild !== 'yes') {
    return {
      diagnostic: reject(
        PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES.WITH_CHILD_CONTROLS_INVALID,
      ).diagnostic,
    };
  }
  return { matched: expandWithDescendants(index, matched) };
}

function selectorMatches(
  index: CatalogControlIndex,
  selector: ProfileControlSelector,
): MatchOutcome {
  const matched = new Set<string>();
  addWithIdsMatches(index, selector.withIds, matched);
  addPatternMatches(index, selector.matching, matched);
  return applyWithChildPolicy(index, matched, selector.withChildControls);
}

function ancestorsOf(index: CatalogControlIndex, id: string): string[] {
  const ancestors: string[] = [];
  let current = index.parentOf.get(id);
  while (current !== undefined) {
    ancestors.push(current);
    current = index.parentOf.get(current) ?? undefined;
  }
  return ancestors;
}

function expandWithDescendants(
  index: CatalogControlIndex,
  ids: ReadonlySet<string>,
): Set<string> {
  const expanded = new Set(ids);
  const stack = [...ids];
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const child of index.childrenOf.get(id) ?? []) {
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
): OscalDiagnostic | null {
  const outcome = selectorMatches(index, selector);
  if ('diagnostic' in outcome) return outcome.diagnostic;

  // Vorfahren-Controls kommen standardmäßig mit (NIST-Draft, Default
  // with-parent-controls: yes).
  for (const id of outcome.matched) {
    included.add(id);
    for (const ancestor of ancestorsOf(index, id)) included.add(ancestor);
  }
  return null;
}

function applyInclusions(
  index: CatalogControlIndex,
  selection: ProfileSelection & { readonly kind: 'include-all' | 'include-controls' },
  included: Set<string>,
): OscalDiagnostic | null {
  if (selection.kind === 'include-all') {
    for (const id of index.order) included.add(id);
    return null;
  }
  for (const selector of selection.includeControls) {
    const failure = applySelector(index, selector, included);
    if (failure !== null) return failure;
  }
  return null;
}

function applyExcludes(
  index: CatalogControlIndex,
  included: Set<string>,
  excludeControls: readonly ProfileControlSelector[],
): OscalDiagnostic | null {
  for (const selector of excludeControls) {
    const excluded = selectorMatches(index, selector);
    if ('diagnostic' in excluded) return excluded.diagnostic;
    // Mit with-child-controls: yes entfällt der ganze Zweig; sonst nur der
    // Selbsttreffer — dieselbe Mechanik wie bei der Inklusion.
    const targets =
      selector.withChildControls === 'yes'
        ? expandWithDescendants(index, excluded.matched)
        : excluded.matched;
    for (const id of targets) included.delete(id);
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
): SelectionOutcome {
  const { selection, excludeControls } = request;
  if (selection.kind !== 'include-all' && selection.kind !== 'include-controls') {
    return reject(PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES.SELECTION_INVALID);
  }

  const included = new Set<string>();
  const inclusionFailure = applyInclusions(index, selection, included);
  if (inclusionFailure !== null) return { ok: false, diagnostic: inclusionFailure };
  const exclusionFailure = applyExcludes(index, included, excludeControls);
  if (exclusionFailure !== null) return { ok: false, diagnostic: exclusionFailure };

  // Ergebnis in Originalordnung des Dokuments.
  const ordered = new Set<string>();
  for (const id of index.order) {
    if (included.has(id)) ordered.add(id);
  }
  return { ok: true, ids: ordered };
}
