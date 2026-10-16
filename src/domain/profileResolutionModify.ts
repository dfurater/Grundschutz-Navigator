// =============================================================================
// Modify (Phase 3) der Profile Resolution — GSPP-291 Commit B
//
// Setzt Parameter und wendet Alterationen auf die inkludierten Kontrollen
// an. Semantik laut gepinnter NIST-Draft-Spezifikation (Draft-Stand
// 2026-07-29):
//
// set-parameter: Das Ziel (Parameter mit passender ID unter den
// inkludierten Params) wird gesucht; fehlt es, fährt die Verarbeitung
// fort. Skalarfelder (class, depends-on, label, usage, values) ERSETZEN
// bestehende Werte, sofern in der Anweisung vorhanden; props/links werden
// ANGEREICHERT. Mehrere Anweisungen für denselben Parameter gelten in
// Profilreihenfolge.
//
// alter/add: Implizite Bindung (kein by-id) wirkt auf die ganze Control —
// starting fügt vor bestehende derselben Kategorie ein, ending dahinter;
// before/after gelten wie starting/ending. Explizite Bindung (by-id)
// adressiert Parameter, Parts und Kind-Controls innerhalb der Control. Die
// Platzierung erlaubt nur Kategorien des Zieltyps und der Position. Nach jeder
// Ergänzung steht der Control-Knoten in kanonischer Schlüsselordnung
// (id, class, title, params, props, links, parts, controls).
//
// Alle Transformationen erzeugen Kopien; Eingabeknoten bleiben unangetastet.
// =============================================================================

import { isJsonContainer, type JsonObject } from '@/domain/jsonGuards';
import type { ProfileSetParameter } from './profileModel';

/** Loose Direktivenform für Tests und Resolver-Mapping (ohne Pflichtpfade). */
export interface AlterationDirective {
  readonly path?: string;
  readonly controlId?: string;
  readonly adds?: readonly {
    readonly position?: string;
    readonly byId?: string;
    readonly title?: string;
    readonly params?: readonly unknown[];
    readonly props?: readonly unknown[];
    readonly links?: readonly unknown[];
    readonly parts?: readonly unknown[];
  }[];
  removes?: {
    readonly byName?: string;
    readonly byClass?: string;
    readonly byId?: string;
    readonly byItemName?: string;
    readonly byNs?: string;
  }[];
}

import {
  ownArrayDataElements,
  ownDataValue,
} from './profileResolutionSelection';
import { copyOwnDataMembers, safeArrayMember } from './profileResolutionMembers';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import {
  PROFILE_RESOLUTION_WORK_UNITS,
  type ProfileResolutionBudget,
} from './profileResolutionBudget';

/** Kanonische Schlüsselordnung eines Control-/Group-Knotens. */
const CANONICAL_CONTROL_KEYS = [
  'id',
  'class',
  'title',
  'params',
  'props',
  'links',
  'parts',
  'controls',
] as const;

/** Ordnet die Schlüssel eines Knotens in kanonischer OSCAL-Reihenfolge. */
export function canonicalizeControlKeys(node: JsonObject, budget: ProfileResolutionBudget): JsonObject {
  budget.admitWorkingNode();
  const result: JsonObject = {};
  for (const key of CANONICAL_CONTROL_KEYS) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const value = ownDataValue(node, key);
    if (value !== undefined) result[key] = value;
  }
  for (const key of Reflect.ownKeys(node)) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    if (typeof key !== 'string') continue;
    if (key in result) continue;
    const value = ownDataValue(node, key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}


function readStringMember(node: JsonObject, key: string): string | undefined {
  const value = ownDataValue(node, key);
  return typeof value === 'string' ? value : undefined;
}

function canonicalCopyWithParams(control: JsonObject, params: readonly unknown[], budget: ProfileResolutionBudget): JsonObject {
  const copy = copyOwnDataMembers(control, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
  copy['params'] = params;
  return canonicalizeControlKeys(copy, budget);
}

function firstEffectiveParameterDirective(
  directives: readonly ProfileSetParameter[],
  budget: ProfileResolutionBudget,
): readonly unknown[] | undefined {
  for (const directive of directives) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const matched = applySingleSetParameter([], directive, budget);
    if (matched.length > 0) return matched;
  }
  return undefined;
}

/** Wendet alle set-parameter-Anweisungen in Profilreihenfolge auf eine Control an. */
export function applySetParametersToControl(
  control: JsonObject,
  setParameters: readonly ProfileSetParameter[],
  budget: ProfileResolutionBudget,
): JsonObject {
  const directives = ownArrayDataElements(setParameters, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE).filter(
    (directive): directive is ProfileSetParameter => isJsonContainer(directive),
  );
  if (directives.length === 0) return control;

  const sourceParams = safeArrayMember(control, 'params');
  if (sourceParams === undefined) {
    // Ohne bestehende Params-Mitglied wird die Control nur berührt, wenn
    // eine Anweisung tatsächlich einen Parameter trägt — ein leeres
    // params-Mitglied wird nicht erfunden (Orakelvertrag gegen die
    // BSI-resolved_catalogs).
    const matched = firstEffectiveParameterDirective(directives, budget);
    return matched === undefined
      ? canonicalizeControlKeys(control, budget)
      : canonicalCopyWithParams(control, matched, budget);
  }

  let params: readonly unknown[] = sourceParams;
  for (const directive of directives) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    params = applySingleSetParameter(params, directive, budget);
  }

  return canonicalCopyWithParams(control, params, budget);
}

function applySingleSetParameter(
  params: readonly unknown[],
  directive: ProfileSetParameter,
  budget: ProfileResolutionBudget,
): readonly unknown[] {
  let changed = false;
  const directiveParamId = readStringMember(directive as unknown as JsonObject, 'paramId');
  // Bei einem Treffer ersetzt diese Liste die params-Liste der Control und
  // steht danach im Zwischengraphen — also ein Container vor der Allokation.
  budget.admitWorkingNode();
  const next = ownArrayDataElements(params, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE).map((param) => {
    if (!isJsonContainer(param)) return param;
    if (readStringMember(param, 'id') !== directiveParamId) return param;

    changed = true;
    budget.admitWorkingNode();
    const target: JsonObject = {};
    for (const key of Reflect.ownKeys(param)) {
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
      if (typeof key !== 'string') continue;
      const value = ownDataValue(param, key);
      if (value !== undefined) target[key] = value;
    }

    // Skalarfelder: ersetzen, sofern in der Anweisung vorhanden.
    for (const field of ['class', 'depends-on', 'label', 'usage'] as const) {
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
      const value = ownDataValue(directive as unknown as JsonObject, field);
      if (value !== undefined) target[field] = value;
    }
    const values = ownDataValue(directive as unknown as JsonObject, 'values');
    if (values !== undefined) target['values'] = values;

    // Sammelfelder: anreichern.
    for (const field of ['props', 'links'] as const) {
      budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
      const additions = ownDataValue(directive as unknown as JsonObject, field);
      if (!Array.isArray(additions)) continue;
      const existing = safeArrayMember(target, field) ?? [];
      budget.admitWorkingNode();
      target[field] = [
        ...ownArrayDataElements(existing, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE),
        ...ownArrayDataElements(additions, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE),
      ];
    }

    return target;
  });
  // Ohne Treffer bleibt die ursprüngliche Liste erhalten — Referenz- und
  // inhaltsgleich, damit Aufrufer Abwesenheit von Wirkung zuverlässig sehen.
  return changed ? next : params;
}

export type AlterationResult =
  | { readonly ok: true; readonly value: JsonObject }
  | { readonly ok: false; readonly additionIndex: number };

/** Ergebnis einer Alteration ohne Teilergebnis bei unplatzierbarer Ergänzung. */
export function applyAlteration(
  control: JsonObject,
  alteration: AlterationDirective,
  budget: ProfileResolutionBudget,
): AlterationResult {
  let working = control;
  const removesValue = ownDataValue(alteration as unknown as JsonObject, 'removes');
  const addsValue = ownDataValue(alteration as unknown as JsonObject, 'adds');
  const removals = Array.isArray(removesValue) ? ownArrayDataElements(removesValue, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE) : [];
  const additions = Array.isArray(addsValue) ? ownArrayDataElements(addsValue, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE) : [];

  // Removes wirken VOR den Adds (Orakelbefund am WLAN-Profil: `removes`
  // nimmt das Original-Part heraus, `adds` setzt es an neuer Position
  // wieder ein — umgekehrte Reihenfolge würde den Einsatz doppelt
  // entfernen).
  for (const removal of removals) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    if (isJsonContainer(removal)) {
      working = applyRemovals(
        working,
        removal as NonNullable<AlterationDirective['removes']>[number], budget
      );
    }
  }
  for (const [additionIndex, addition] of additions.entries()) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    if (isJsonContainer(addition)) {
      const result = applyAddition(
        working,
        addition as NonNullable<AlterationDirective['adds']>[number], budget
      );
      if (!result.ok) return { ok: false, additionIndex };
      working = result.value;
    }
  }

  return { ok: true, value: working === control ? control : canonicalizeControlKeys(working, budget) };
}

function applyAddition(
  control: JsonObject,
  addition: NonNullable<AlterationDirective['adds']>[number],
  budget: ProfileResolutionBudget,
): AdditionResult {
  const explicitTargetId = ownDataValue(addition as JsonObject, 'byId');
  if (typeof explicitTargetId === 'string' && explicitTargetId.length > 0) {
    return applyExplicitAddition(control, explicitTargetId, addition, budget);
  }
  return { ok: true, value: applyImplicitAddition(control, addition, budget) };
}

/**
 * Implizite Bindung: Neue Inhalte wirken auf die ganze Control. Je Liste
 * stehen die neuen Elemente vor (starting/before) oder hinter (ending/
 * after/ohne) den bestehenden; anschließend kanonische Schlüsselordnung.
 */
function applyImplicitAddition(
  control: JsonObject,
  addition: NonNullable<AlterationDirective['adds']>[number],
  budget: ProfileResolutionBudget,
): JsonObject {
  const positionValue = ownDataValue(addition as JsonObject, 'position');
  const position = typeof positionValue === 'string' ? positionValue : 'ending';
  const startLike = position === 'starting' || position === 'before';

  const result = copyOwnDataMembers(control, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
  const pendingLists = collectPendingAdditionLists(addition, budget);

  const addTitle = ownDataValue(addition as JsonObject, 'title');
  if (typeof addTitle === 'string' && !('title' in result)) {
    result['title'] = addTitle;
  }

  for (const [listKey, additions] of pendingLists) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const existing = safeArrayMember(result, listKey) ?? [];
    const existingElements = ownArrayDataElements(existing, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    budget.admitWorkingNode();
    result[listKey] = startLike
      ? [...additions, ...existingElements]
      : [...existingElements, ...additions];
  }

  return canonicalizeControlKeys(result, budget);
}

function collectPendingAdditionLists(
  addition: NonNullable<AlterationDirective['adds']>[number],
  budget: ProfileResolutionBudget,
): ReadonlyMap<string, readonly unknown[]> {
  const pending = new Map<string, readonly unknown[]>();
  for (const listKey of ['params', 'props', 'links', 'parts'] as const) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const additions = ownDataValue(addition as JsonObject, listKey);
    if (!Array.isArray(additions)) continue;
    if (additions.length > 0 || listKey === 'parts') {
      pending.set(listKey, ownArrayDataElements(additions, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE));
    }
  }
  return pending;
}

type Addition = NonNullable<AlterationDirective['adds']>[number];
type TargetList = 'params' | 'parts' | 'controls';
type AdditionResult = { readonly ok: true; readonly value: JsonObject } | { readonly ok: false };
type SearchResult =
  | { readonly kind: 'missing' }
  | { readonly kind: 'unplaceable' }
  | { readonly kind: 'inserted'; readonly value: readonly unknown[] };

const TARGET_LISTS = ['params', 'parts', 'controls'] as const;
const CHILD_TARGET_LISTS: Readonly<Record<TargetList, readonly TargetList[]>> = {
  params: [], parts: ['parts'], controls: TARGET_LISTS,
};
const INSIDE_CATEGORIES = {
  params: ['props', 'links'],
  parts: ['props', 'links', 'parts'],
  controls: ['params', 'props', 'links', 'parts'],
} as const;

interface TargetFrame {
  readonly node: JsonObject;
  readonly type: TargetList;
  readonly depth: number;
}

function pushTargetChildren(frame: TargetFrame, stack: TargetFrame[], budget: ProfileResolutionBudget): void {
  for (const key of CHILD_TARGET_LISTS[frame.type]) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const list = safeArrayMember(frame.node, key);
    if (list === undefined) continue;
    for (const child of ownArrayDataElements(list, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE)) {
      if (isJsonContainer(child)) stack.push({ node: child, type: key, depth: frame.depth + 1 });
    }
  }
}

/** Prüft die Tiefe des gesamten Suchbaums vor dem rekursiven Abstieg. */
function exceedsTargetDepth(control: JsonObject, budget: ProfileResolutionBudget): boolean {
  const stack: TargetFrame[] = [{ node: control, type: 'controls', depth: 0 }];
  const visited = new Map<object, number>();
  while (stack.length > 0) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const frame = stack.pop()!;
    const { node, depth } = frame;
    if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) return true;
    if ((visited.get(node) ?? -1) >= depth) continue;
    visited.set(node, depth);
    pushTargetChildren(frame, stack, budget);
  }
  return false;
}

/** Explizite Bindung sucht unterhalb der Control in kanonischer Dokumentordnung. */
function applyExplicitAddition(
  control: JsonObject,
  targetId: string,
  addition: Addition,
  budget: ProfileResolutionBudget,
): AdditionResult {
  if (exceedsTargetDepth(control, budget)) return { ok: true, value: control };
  return insertIntoTargetNode(control, 'controls', targetId, addition, budget);
}

function insertIntoTargetNode(
  node: JsonObject,
  nodeType: TargetList,
  targetId: string,
  addition: Addition,
  budget: ProfileResolutionBudget,
): AdditionResult {
  for (const key of CHILD_TARGET_LISTS[nodeType]) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const list = safeArrayMember(node, key);
    if (list === undefined) continue;
    const result = insertIntoTargetList(list, key, targetId, addition, budget);
    if (result.kind === 'unplaceable') return { ok: false };
    if (result.kind === 'inserted') {
      const copy = copyOwnDataMembers(node, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
      copy[key] = result.value;
      return { ok: true, value: nodeType === 'controls' ? canonicalizeControlKeys(copy, budget) : copy };
    }
  }
  return { ok: true, value: node };
}

function insertIntoTargetList(
  list: readonly unknown[],
  type: TargetList,
  targetId: string,
  addition: Addition,
  budget: ProfileResolutionBudget,
): SearchResult {
  const entries = ownArrayDataElements(list, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
  for (let index = 0; index < entries.length; index += 1) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const node = entries[index];
    if (!isJsonContainer(node)) continue;
    if (readStringMember(node, 'id') === targetId) return insertAtTarget(entries, index, type, addition, budget);
    const nested = insertIntoTargetNode(node, type, targetId, addition, budget);
    if (!nested.ok) return { kind: 'unplaceable' };
    if (nested.value !== node) {
      budget.admitWorkingNode();
      const updated = [...entries];
      updated[index] = nested.value;
      return { kind: 'inserted', value: updated };
    }
  }
  return { kind: 'missing' };
}

/** Validiert jede nicht leere Kategorie vor der ersten Änderung am Ziel. */
function insertAtTarget(
  entries: readonly unknown[],
  index: number,
  type: TargetList,
  addition: Addition,
  budget: ProfileResolutionBudget,
): SearchResult {
  const position = ownDataValue(addition as JsonObject, 'position');
  const beside = position === 'before' || position === 'after';
  if (beside && type === 'controls') return { kind: 'unplaceable' };
  const pending = collectPendingAdditionLists(addition, budget);
  const allowed: readonly string[] = beside ? [type] : INSIDE_CATEGORIES[type];
  for (const [key, values] of pending) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    if (values.length > 0 && !allowed.includes(key)) return { kind: 'unplaceable' };
  }
  if (beside) {
    const additions = (pending.get(type) ?? []).filter(isJsonContainer);
    const offset = position === 'before' ? index : index + 1;
    budget.admitWorkingNode();
    return { kind: 'inserted', value: [...entries.slice(0, offset), ...additions, ...entries.slice(offset)] };
  }
  return insertInsideTarget(entries, index, type, pending, position === 'starting', budget);
}

function insertInsideTarget(
  entries: readonly unknown[],
  index: number,
  type: TargetList,
  pending: ReadonlyMap<string, readonly unknown[]>,
  starting: boolean,
  budget: ProfileResolutionBudget,
): SearchResult {
  const allowed: readonly string[] = INSIDE_CATEGORIES[type];
  const target = copyOwnDataMembers(entries[index] as JsonObject, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
  for (const [key, values] of pending) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    if (!allowed.includes(key)) continue;
    const existing = safeArrayMember(target, key);
    if (existing === undefined && values.length === 0) continue;
    const elements = ownArrayDataElements(existing ?? [], budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    budget.admitWorkingNode();
    target[key] = starting ? [...values, ...elements] : [...elements, ...values];
  }
  budget.admitWorkingNode();
  const updated = [...entries];
  updated[index] = type === 'controls' ? canonicalizeControlKeys(target, budget) : target;
  return { kind: 'inserted', value: updated };
}

/** Wendet eine remove-Anweisung auf alle Mitgliedslisten einer Control an. */
function applyRemovals(
  control: JsonObject,
  removal: NonNullable<AlterationDirective['removes']>[number],
  budget: ProfileResolutionBudget,
): JsonObject {
  budget.admitWorkingNode();
  const result: JsonObject = {};
  for (const key of Reflect.ownKeys(control)) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    if (typeof key !== 'string') continue;
    const value = ownDataValue(control, key);
    if (value !== undefined) result[key] = value;
  }

  for (const listKey of ['params', 'props', 'links', 'parts'] as const) {
    budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
    const members = safeArrayMember(control, listKey);
    if (members === undefined) continue;
    // Die gefilterte Liste ersetzt die bisherige und bleibt stehen; Entfernen
    // schreibt nichts gut, deshalb kostet auch ein reiner `removes`-Lauf.
    budget.admitWorkingNode();
    result[listKey] = ownArrayDataElements(members, budget, PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE).filter((member) => {
      if (!isJsonContainer(member)) return true;
      return !removalMatches(member, removal, listKey, budget);
    });
  }

  return result;
}

function removalMatches(
  member: JsonObject,
  removal: NonNullable<AlterationDirective['removes']>[number],
  listKey: string,
  budget: ProfileResolutionBudget,
): boolean {
  // Vergleich EINES removes-Kandidaten — die Kategorie des Vertrags.
  budget.spendWork(PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE);
  const removalNode = removal as unknown as JsonObject;
  const byName = readStringMember(removalNode, 'byName');
  const byClass = readStringMember(removalNode, 'byClass');
  const byId = readStringMember(removalNode, 'byId');
  const byNs = readStringMember(removalNode, 'byNs');
  const byItemName = readStringMember(removalNode, 'byItemName');
  if (byName !== undefined && readStringMember(member, 'name') === byName) return true;
  if (byClass !== undefined && readStringMember(member, 'class') === byClass) return true;
  if (byId !== undefined && readStringMember(member, 'id') === byId) return true;
  if (byNs !== undefined && readStringMember(member, 'ns') === byNs) return true;
  if (byItemName !== undefined && listKey === 'parts' && readStringMember(member, 'name') === byItemName) {
    return true;
  }
  return false;
}
