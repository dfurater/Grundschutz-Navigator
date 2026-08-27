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
// adressiert einen Part innerhalb der Control. Nach jeder Ergänzung steht
// der Control-Knoten in kanonischer Schlüsselordnung
// (id, class, title, params, props, links, parts, controls).
//
// Alle Transformationen erzeugen Kopien; Eingabeknoten bleiben unangetastet.
// =============================================================================

import type { JsonObject } from '@/adapters/oscalProfileReaders';
import type { ProfileSetParameter } from './profileModel';

/** Loose Direktivenform für Tests und Resolver-Mapping (ohne Pflichtpfade). */
export interface AlterationDirective {
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
  isJsonObject,
  ownArrayDataElements,
  ownDataValue,
} from './profileResolutionSelection';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';

/** Array-Wert eines Mitglieds, rein deskriptorbasiert gelesen. */
function safeArrayMember(node: JsonObject, key: string): readonly unknown[] | undefined {
  const value = ownDataValue(node, key);
  return Array.isArray(value) ? value : undefined;
}

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
export function canonicalizeControlKeys(node: JsonObject): JsonObject {
  const result: JsonObject = {};
  for (const key of CANONICAL_CONTROL_KEYS) {
    const value = ownDataValue(node, key);
    if (value !== undefined) result[key] = value;
  }
  for (const key of Reflect.ownKeys(node)) {
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

function copyOwnDataMembers(node: JsonObject): JsonObject {
  const copy: JsonObject = {};
  for (const key of Reflect.ownKeys(node)) {
    if (typeof key !== 'string') continue;
    const value = ownDataValue(node, key);
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}

function canonicalCopyWithParams(control: JsonObject, params: readonly unknown[]): JsonObject {
  const copy = copyOwnDataMembers(control);
  copy['params'] = params;
  return canonicalizeControlKeys(copy);
}

function firstEffectiveParameterDirective(
  directives: readonly ProfileSetParameter[],
): readonly unknown[] | undefined {
  for (const directive of directives) {
    const matched = applySingleSetParameter([], directive);
    if (matched.length > 0) return matched;
  }
  return undefined;
}

/** Wendet alle set-parameter-Anweisungen in Profilreihenfolge auf eine Control an. */
export function applySetParametersToControl(
  control: JsonObject,
  setParameters: readonly ProfileSetParameter[],
): JsonObject {
  const directives = ownArrayDataElements(setParameters).filter(
    (directive): directive is ProfileSetParameter => isJsonObject(directive),
  );
  if (directives.length === 0) return control;

  const sourceParams = safeArrayMember(control, 'params');
  if (sourceParams === undefined) {
    // Ohne bestehende Params-Mitglied wird die Control nur berührt, wenn
    // eine Anweisung tatsächlich einen Parameter trägt — ein leeres
    // params-Mitglied wird nicht erfunden (Orakelvertrag gegen die
    // BSI-resolved_catalogs).
    const matched = firstEffectiveParameterDirective(directives);
    return matched === undefined
      ? canonicalizeControlKeys(control)
      : canonicalCopyWithParams(control, matched);
  }

  let params: readonly unknown[] = sourceParams;
  for (const directive of directives) {
    params = applySingleSetParameter(params, directive);
  }

  return canonicalCopyWithParams(control, params);
}

function applySingleSetParameter(
  params: readonly unknown[],
  directive: ProfileSetParameter,
): readonly unknown[] {
  let changed = false;
  const directiveParamId = readStringMember(directive as unknown as JsonObject, 'paramId');
  const next = ownArrayDataElements(params).map((param) => {
    if (!isJsonObject(param)) return param;
    if (readStringMember(param, 'id') !== directiveParamId) return param;

    changed = true;
    const target: JsonObject = {};
    for (const key of Reflect.ownKeys(param)) {
      if (typeof key !== 'string') continue;
      const value = ownDataValue(param, key);
      if (value !== undefined) target[key] = value;
    }

    // Skalarfelder: ersetzen, sofern in der Anweisung vorhanden.
    for (const field of ['class', 'depends-on', 'label', 'usage'] as const) {
      const value = ownDataValue(directive as unknown as JsonObject, field);
      if (value !== undefined) target[field] = value;
    }
    const values = ownDataValue(directive as unknown as JsonObject, 'values');
    if (values !== undefined) target['values'] = values;

    // Sammelfelder: anreichern.
    for (const field of ['props', 'links'] as const) {
      const additions = ownDataValue(directive as unknown as JsonObject, field);
      if (!Array.isArray(additions)) continue;
      const existing = safeArrayMember(target, field) ?? [];
      target[field] = [
        ...ownArrayDataElements(existing),
        ...ownArrayDataElements(additions),
      ];
    }

    return target;
  });
  // Ohne Treffer bleibt die ursprüngliche Liste erhalten — Referenz- und
  // inhaltsgleich, damit Aufrufer Abwesenheit von Wirkung zuverlässig sehen.
  return changed ? next : params;
}

/** Ergebnis einer Alteration: gefilterter/neuer Control-Knoten. */
export function applyAlteration(
  control: JsonObject,
  alteration: AlterationDirective,
): JsonObject {
  let working = control;
  const removesValue = ownDataValue(alteration as unknown as JsonObject, 'removes');
  const addsValue = ownDataValue(alteration as unknown as JsonObject, 'adds');
  const removals = Array.isArray(removesValue) ? ownArrayDataElements(removesValue) : [];
  const additions = Array.isArray(addsValue) ? ownArrayDataElements(addsValue) : [];

  // Removes wirken VOR den Adds (Orakelbefund am WLAN-Profil: `removes`
  // nimmt das Original-Part heraus, `adds` setzt es an neuer Position
  // wieder ein — umgekehrte Reihenfolge würde den Einsatz doppelt
  // entfernen).
  for (const removal of removals) {
    if (isJsonObject(removal)) {
      working = applyRemovals(
        working,
        removal as NonNullable<AlterationDirective['removes']>[number],
      );
    }
  }
  for (const addition of additions) {
    if (isJsonObject(addition)) {
      working = applyAddition(
        working,
        addition as NonNullable<AlterationDirective['adds']>[number],
      );
    }
  }

  return canonicalizeControlKeys(working);
}

function applyAddition(
  control: JsonObject,
  addition: NonNullable<AlterationDirective['adds']>[number],
): JsonObject {
  const explicitPartId = ownDataValue(addition as JsonObject, 'byId');
  if (typeof explicitPartId === 'string' && explicitPartId.length > 0) {
    return applyExplicitAddition(control, explicitPartId, addition);
  }
  return applyImplicitAddition(control, addition);
}

/**
 * Implizite Bindung: Neue Inhalte wirken auf die ganze Control. Je Liste
 * stehen die neuen Elemente vor (starting/before) oder hinter (ending/
 * after/ohne) den bestehenden; anschließend kanonische Schlüsselordnung.
 */
function applyImplicitAddition(
  control: JsonObject,
  addition: NonNullable<AlterationDirective['adds']>[number],
): JsonObject {
  const positionValue = ownDataValue(addition as JsonObject, 'position');
  const position = typeof positionValue === 'string' ? positionValue : 'ending';
  const startLike = position === 'starting' || position === 'before';

  const result = copyOwnDataMembers(control);
  const pendingLists = collectPendingAdditionLists(addition);

  const addTitle = ownDataValue(addition as JsonObject, 'title');
  if (typeof addTitle === 'string' && !('title' in result)) {
    result['title'] = addTitle;
  }

  for (const [listKey, additions] of pendingLists) {
    const existing = safeArrayMember(result, listKey) ?? [];
    const existingElements = ownArrayDataElements(existing);
    result[listKey] = startLike
      ? [...additions, ...existingElements]
      : [...existingElements, ...additions];
  }

  return canonicalizeControlKeys(result);
}

function collectPendingAdditionLists(
  addition: NonNullable<AlterationDirective['adds']>[number],
): ReadonlyMap<string, readonly unknown[]> {
  const pending = new Map<string, readonly unknown[]>();
  for (const listKey of ['params', 'props', 'links', 'parts'] as const) {
    const additions = ownDataValue(addition as JsonObject, listKey);
    if (!Array.isArray(additions)) continue;
    if (additions.length > 0 || listKey === 'parts') {
      pending.set(listKey, ownArrayDataElements(additions));
    }
  }
  return pending;
}

/**
 * Explizite Bindung: Der Ziel-Part (by-id) wird im parts-Baum gesucht und
 * die Inhalte relativ zu ihm eingefügt. before → vor dem Part, after →
 * danach, starting → innerhalb des Parts am Anfang, ending → innerhalb am
 * Ende. Fehlt der Ziel-Part, bleibt die Control unverändert.
 */
function applyExplicitAddition(
  control: JsonObject,
  targetPartId: string,
  addition: NonNullable<AlterationDirective['adds']>[number],
): JsonObject {
  const updatedParts = insertIntoPartsTree(
    ownDataValue(control, 'parts'),
    targetPartId,
    addition,
  );
  if (updatedParts.inserted) {
    const copyExp: JsonObject = {};
    for (const key of Reflect.ownKeys(control)) {
      if (typeof key !== 'string') continue;
      const value = ownDataValue(control, key);
      if (value !== undefined) copyExp[key] = value;
    }
    copyExp['parts'] = updatedParts.value;
    return canonicalizeControlKeys(copyExp);
  }

  // Ziel-Part nicht gefunden: unverändert (fail-silent gemäß Draft-Vertrag
  // für fehlende Ziele — kontrolliert, ohne Teilergebnis zu behaupten).
  return control;
}

/** Fügt die Addition relativ zum getroffenen Part ein. */
function insertAtPart(
  parts: JsonObject[],
  index: number,
  addition: NonNullable<AlterationDirective['adds']>[number],
): { readonly inserted: boolean; readonly value: unknown } {
  const positionValue = ownDataValue(addition as JsonObject, 'position');
  const position = typeof positionValue === 'string' ? positionValue : 'ending';
  const additions = collectAdditionLists(addition);

  if (position === 'before') {
    return { inserted: true, value: [...parts.slice(0, index), ...additions, ...parts.slice(index)] };
  }
  if (position === 'after' || position === 'ending') {
    return { inserted: true, value: [...parts.slice(0, index + 1), ...additions, ...parts.slice(index + 1)] };
  }
  // starting: innerhalb des Ziel-Parts am Anfang einfügen.
  const inner = filterAsIsInnerParts(parts[index]!);
  const merged = [...additions, ...inner];
  const copyStart: JsonObject = {};
  for (const key of Reflect.ownKeys(parts[index]!)) {
    if (typeof key !== 'string') continue;
    const value = ownDataValue(parts[index]! as object, key);
    if (value !== undefined) copyStart[key] = value;
  }
  copyStart['parts'] = merged;
  return { inserted: true, value: copyStart as JsonObject };
}

/** Misst die maximale Schachtelungstiefe eines Parts-Baums iterativ. */
function measurePartsDepth(partsValue: unknown): number {
  if (!Array.isArray(partsValue)) return 0;
  let maxDepth = 0;
  const stack: Array<{ parts: unknown[]; depth: number }> = [
    { parts: partsValue as unknown[], depth: 1 },
  ];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const { parts, depth } = stack.pop()!;
    if (visited.has(parts as object)) continue;
    visited.add(parts as object);
    maxDepth = Math.max(maxDepth, depth);
    if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) return depth;
    for (const part of ownArrayDataElements(parts)) {
      if (isJsonObject(part)) {
        const nested = ownDataValue(part, 'parts');
        if (Array.isArray(nested)) {
          stack.push({ parts: nested as unknown[], depth: depth + 1 });
        }
      }
    }
  }
  return maxDepth;
}

function insertIntoPartsTree(
  partsValue: unknown,
  targetPartId: string,
  addition: NonNullable<AlterationDirective['adds']>[number],
): { readonly inserted: boolean; readonly value: unknown } {
  if (!Array.isArray(partsValue)) return { inserted: false, value: partsValue };
  // Tiefenbegrenzung am exportierten Rand: Eine 12.000-Ebenen-Kette kann die
  // Klasse-2-Kette nicht passieren (maxDepth 64); statt RangeError wird
  // kontrolliert nicht eingefügt.
  if (measurePartsDepth(partsValue) > CLASS_2_IMPORT_LIMITS.maxDepth) {
    return { inserted: false, value: partsValue };
  }

  const parts = ownArrayDataElements(partsValue).filter(
    (part): part is JsonObject => isJsonObject(part),
  );

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!isJsonObject(part)) continue;
    const partId = readStringMember(part, 'id');
    if (partId === targetPartId) {
      return insertAtPart(parts, index, addition);
    }

    // Rekursiv in verschachtelte parts absteigen.
    const nestedParts = ownDataValue(part, 'parts');
    if (nestedParts !== undefined) {
      const nestedResult = insertIntoPartsTree(nestedParts, targetPartId, addition);
      if (nestedResult.inserted) {
        const copy = copyOwnDataMembers(part);
        copy['parts'] = nestedResult.value;
        parts[index] = copy;
        return { inserted: true, value: parts };
      }
    }
  }

  return { inserted: false, value: parts };
}

/** Bestehende parts-Liste eines Parts als Kopie. */
function filterAsIsInnerParts(part: JsonObject): readonly unknown[] {
  const value = ownDataValue(part, 'parts');
  return Array.isArray(value) ? ownArrayDataElements(value) : [];
}


function collectAdditionLists(
  addition: NonNullable<AlterationDirective['adds']>[number],
): readonly JsonObject[] {
  const lists: JsonObject[] = [];
  for (const key of ['params', 'props', 'links', 'parts'] as const) {
    const value = ownDataValue(addition as JsonObject, key);
    if (Array.isArray(value)) {
      for (const entry of ownArrayDataElements(value)) {
        if (isJsonObject(entry)) lists.push(entry);
      }
    }
  }
  return lists;
}

/** Wendet eine remove-Anweisung auf alle Mitgliedslisten einer Control an. */
function applyRemovals(
  control: JsonObject,
  removal: NonNullable<AlterationDirective['removes']>[number],
): JsonObject {
  const result: JsonObject = {};
  for (const key of Reflect.ownKeys(control)) {
    if (typeof key !== 'string') continue;
    const value = ownDataValue(control, key);
    if (value !== undefined) result[key] = value;
  }

  for (const listKey of ['params', 'props', 'links', 'parts'] as const) {
    const members = safeArrayMember(control, listKey);
    if (members === undefined) continue;
    result[listKey] = ownArrayDataElements(members).filter((member) => {
      if (!isJsonObject(member)) return true;
      return !removalMatches(member, removal, listKey);
    });
  }

  return result;
}

function removalMatches(
  member: JsonObject,
  removal: NonNullable<AlterationDirective['removes']>[number],
  listKey: string,
): boolean {
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
