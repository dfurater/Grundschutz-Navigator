// =============================================================================
// Strukturleser der OSCAL-Adapter
//
// Ein **vorhandener** Wert der falschen Form wird diagnostiziert, statt still
// zu `[]` zu werden — sonst verschwände eine Kardinalitätsverletzung spurlos
// aus der Projektion. Normalisiert wird nichts: Aus einem Einzelobjekt wird
// kein Array, und der Quellgraph bleibt, wie er ist (ADR-2).
//
// Jeder Adapter bindet die Leser an seine eigene Diagnosefunktion; Code,
// Stufe, Validator und Root-Typ der Diagnose kommen damit aus dem Adapter.
// =============================================================================

import { isJsonObject, type JsonObject } from '@/domain/jsonGuards';

export interface StructureReaders<TState> {
  /** Liest ein Arrayfeld; `undefined` und `null` gelten als abwesend. */
  readArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly unknown[];
  /** Wie `readArrayField`, liefert aber nur die Objekteinträge und diagnostiziert den Rest. */
  readObjectArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly { readonly node: JsonObject; readonly path: string }[];
  /** Wie `readArrayField`, liefert aber nur die String-Einträge und diagnostiziert den Rest. */
  readStringArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly string[];
}

/**
 * Erzeugt die Strukturleser eines Adapters. `diagnoseUnexpected` meldet einen
 * Knoten unerwarteter Form am übergebenen JSON-Pointer-Pfad.
 */
export function createStructureReaders<TState>(
  diagnoseUnexpected: (state: TState, path: string) => void,
): StructureReaders<TState> {
  function readArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly unknown[] {
    const value = node[key];
    if (value === undefined || value === null) return [];
    if (Array.isArray(value)) return value;

    diagnoseUnexpected(state, `${path}/${key}`);
    return [];
  }

  function readObjectArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly { readonly node: JsonObject; readonly path: string }[] {
    return readArrayField(node, key, path, state).flatMap((entry, index) => {
      const entryPath = `${path}/${key}/${index}`;
      if (!isJsonObject(entry)) {
        diagnoseUnexpected(state, entryPath);
        return [];
      }
      return [{ node: entry, path: entryPath }];
    });
  }

  function readStringArrayField(
    node: JsonObject,
    key: string,
    path: string,
    state: TState,
  ): readonly string[] {
    return readArrayField(node, key, path, state).flatMap((entry, index) => {
      if (typeof entry !== 'string') {
        diagnoseUnexpected(state, `${path}/${key}/${index}`);
        return [];
      }
      return [entry];
    });
  }

  return { readArrayField, readObjectArrayField, readStringArrayField };
}
