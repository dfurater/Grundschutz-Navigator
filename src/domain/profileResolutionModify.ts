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

import { isJsonObject, ownDataValue } from './profileResolutionSelection';

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
    if (key in node) result[key] = node[key];
  }
  for (const key of Object.keys(node)) {
    if (!(key in result)) result[key] = node[key];
  }
  return result;
}

function arrayMember(node: JsonObject, key: string): readonly unknown[] | undefined {
  const value = node[key];
  return Array.isArray(value) ? value : undefined;
}

function readStringMember(node: JsonObject, key: string): string | undefined {
  const value = node[key];
  return typeof value === 'string' ? value : undefined;
}

/** Wendet alle set-parameter-Anweisungen in Profilreihenfolge auf eine Control an. */
export function applySetParametersToControl(
  control: JsonObject,
  setParameters: readonly ProfileSetParameter[],
): JsonObject {
  if (setParameters.length === 0) return control;

  const sourceParams = arrayMember(control, 'params') ?? [];
  let params: readonly unknown[] = sourceParams;

  for (const directive of setParameters) {
    params = applySingleSetParameter(params, directive);
  }

  return canonicalizeControlKeys({ ...control, params });
}

function applySingleSetParameter(
  params: readonly unknown[],
  directive: ProfileSetParameter,
): readonly unknown[] {
  return params.map((param) => {
    if (!isJsonObject(param)) return param;
    if (readStringMember(param, 'id') !== directive.paramId) return param;

    const target: JsonObject = { ...param };

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
      const existing = arrayMember(target, field) ?? [];
      target[field] = [...existing, ...additions];
    }

    return target;
  });
}

/** Ergebnis einer Alteration: gefilterter/neuer Control-Knoten. */
export function applyAlteration(
  control: JsonObject,
  alteration: AlterationDirective,
): JsonObject {
  let working = control;

  for (const addition of alteration.adds ?? []) {
    working = applyAddition(working, addition);
  }
  for (const removal of alteration.removes ?? []) {
    working = applyRemovals(working, removal);
  }

  return canonicalizeControlKeys(working);
}

function applyAddition(
  control: JsonObject,
  addition: NonNullable<AlterationDirective['adds']>[number],
): JsonObject {
  const explicitPartId = addition.byId;
  if (explicitPartId !== undefined) {
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
  const position = addition.position ?? 'ending';
  const startLike = position === 'starting' || position === 'before';

  const result: JsonObject = { ...control };
  const pendingLists = new Map<string, readonly unknown[]>();

  for (const listKey of ['params', 'props', 'links', 'parts'] as const) {
    const additions = ownDataValue(addition as JsonObject, listKey);
    if (Array.isArray(additions) && additions.length > 0) {
      pendingLists.set(listKey, additions);
    } else if (listKey === 'parts' && Array.isArray(additions) && additions.length === 0) {
      pendingLists.set(listKey, []);
    }
  }

  const addTitle = ownDataValue(addition as JsonObject, 'title');
  if (typeof addTitle === 'string' && !('title' in result)) {
    result['title'] = addTitle;
  }

  for (const [listKey, additions] of pendingLists) {
    const existing = arrayMember(result, listKey) ?? [];
    result[listKey] = startLike ? [...additions, ...existing] : [...existing, ...additions];
  }

  return canonicalizeControlKeys(result);
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
    return canonicalizeControlKeys({ ...control, parts: updatedParts.value });
  }

  // Ziel-Part nicht gefunden: unverändert (fail-silent gemäß Draft-Vertrag
  // für fehlende Ziele — kontrolliert, ohne Teilergebnis zu behaupten).
  return control;
}

function insertIntoPartsTree(
  partsValue: unknown,
  targetPartId: string,
  addition: NonNullable<AlterationDirective['adds']>[number],
): { readonly inserted: boolean; readonly value: unknown } {
  if (!Array.isArray(partsValue)) return { inserted: false, value: partsValue };

  const parts = [...partsValue];

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!isJsonObject(part)) continue;
    const partId = readStringMember(part, 'id');
    if (partId === targetPartId) {
      const position = addition.position ?? 'ending';
      const additions = collectAdditionLists(addition);

      if (position === 'before') {
        return { inserted: true, value: [...parts.slice(0, index), ...additions, ...parts.slice(index)] };
      }
      if (position === 'after' || position === 'ending') {
        return { inserted: true, value: [...parts.slice(0, index + 1), ...additions, ...parts.slice(index + 1)] };
      }
      // starting: innerhalb des Ziel-Parts am Anfang einfügen.
      const inner = filterAsIsInnerParts(part);
      const merged = [...additions, ...inner];
      return { inserted: true, value: { ...part, parts: merged } as JsonObject };
    }

    // Rekursiv in verschachtelte parts absteigen.
    const nestedParts = ownDataValue(part, 'parts');
    if (nestedParts !== undefined) {
      const nestedResult = insertIntoPartsTree(nestedParts, targetPartId, addition);
      if (nestedResult.inserted) {
        const copy: JsonObject = { ...part, parts: nestedResult.value };
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
  return Array.isArray(value) ? [...value] : [];
}


function collectAdditionLists(
  addition: NonNullable<AlterationDirective['adds']>[number],
): readonly JsonObject[] {
  const lists: JsonObject[] = [];
  for (const key of ['params', 'props', 'links', 'parts'] as const) {
    const value = ownDataValue(addition as JsonObject, key);
    if (Array.isArray(value)) {
      for (const entry of value) {
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
  const result: JsonObject = { ...control };

  for (const listKey of ['params', 'props', 'links', 'parts'] as const) {
    const members = arrayMember(control, listKey);
    if (members === undefined) continue;
    result[listKey] = members.filter((member) => {
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
  if (removal.byName !== undefined && member['name'] === removal.byName) return true;
  if (removal.byClass !== undefined && member['class'] === removal.byClass) return true;
  if (removal.byId !== undefined && member['id'] === removal.byId) return true;
  if (removal.byNs !== undefined && member['ns'] === removal.byNs) return true;
  if (removal.byItemName !== undefined && listKey === 'parts' && member['name'] === removal.byItemName) {
    return true;
  }
  return false;
}
