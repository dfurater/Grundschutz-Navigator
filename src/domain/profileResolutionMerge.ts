// =============================================================================
// Merge (Phase 2) der Profile Resolution — GSPP-291 Commit B
//
// Kombiniert die Inklusionen der Import-Phase nach der combine-Richtung
// (use-first behält die erste Definition, keep erhält Kollisionen und
// meldet sie) und formt je Strukturrichtlinie das Ergebnis: flat gibt
// kombinierte Controls flach aus, as-is reproduziert die Quellhierarchie
// mit Up-Levelling nicht inkludierter Zwischenelemente.
//
// Semantik laut gepinnter NIST-Draft-Spezifikation; rein
// deskriptorbasierte Lesehilfen aus profileResolutionSelection.
// =============================================================================

import type { JsonObject } from '@/adapters/oscalProfileReaders';
import { isJsonObject, ownArrayDataElements } from './profileResolutionSelection';

export type CombineMethod = 'use-first' | 'keep';

function readIdOrEmpty(node: JsonObject): string {
  const id = node['id'];
  return typeof id === 'string' ? id : '';
}

/** Array-Wert eines Mitglieds, sofern vorhanden. */
function arrayMember(node: JsonObject, key: string): readonly unknown[] | undefined {
  const value = node[key];
  return Array.isArray(value) ? value : undefined;
}

/** Eine Inklusion aus Phase 1: selektierte Controls eines Quelldokuments. */
export interface ControlInclusion {
  readonly documentKey: string;
  readonly controls: readonly JsonObject[];
}

export type CombinedControls = {
  /** Control-Knoten nach ID (bei use-first: die erste Definition). */
  readonly controls: ReadonlyMap<string, JsonObject>;
  /** IDs in Erscheinungsreihenfolge (Tiefendurchlauf der Importe). */
  readonly order: readonly string[];
  /** Bei keep: IDs, deren Definitionen kollidieren. */
  readonly clashes: readonly string[];
};

function readId(node: JsonObject): string | null {
  const id = node['id'];
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Wendet die combine-Richtung auf alle Inklusionen an. Reihenfolge:
 * Tiefendurchlauf in Importreihenfolge; bei use-first gewinnt das erste
 * Vorkommen, bei keep bleiben alle Einträge erhalten und Kollisionen
 * werden gemeldet.
 */
export function applyCombine(
  inclusions: readonly ControlInclusion[],
  method: CombineMethod,
): CombinedControls {
  const controls = new Map<string, JsonObject>();
  const order: string[] = [];
  const clashes = new Set<string>();

  for (const inclusion of inclusions) {
    for (const node of inclusion.controls) {
      const id = readId(node);
      if (id === null) continue;

      if (!controls.has(id)) {
        controls.set(id, node);
        order.push(id);
      } else if (method === 'keep') {
        clashes.add(id);
        order.push(id); // keep: Kollisionen bleiben als eigene Einträge stehen.
      } else if (method === 'use-first') {
        // Erste Definition bleibt; spätere Kollisionen tragen nichts bei.
      }
    }
  }

  const finalOrder =
    method === 'use-first' ? [...controls.keys()] : [...order];

  return { controls, order: finalOrder, clashes: [...clashes] };
}

/** Flache Ausgabe: kombinierte Controls direkt unter catalog. */
export function buildFlatControls(combined: CombinedControls): JsonObject {
  return {
    controls: combined.order.map((id) => combined.controls.get(id)!),
  };
}

/** Filtert eine Control-Hierarchie: nur inkludierte IDs bleiben (rekursiv). */
function filterNestedIncluded(
  control: JsonObject,
  includedIds: ReadonlySet<string>,
): JsonObject {
  const copy: JsonObject = { ...control };
  copy['controls'] = ownArrayDataElements(arrayMember(control, 'controls') ?? [])
    .filter((child) => isJsonObject(child) && includedIds.has(readIdOrEmpty(child)))
    .map((child) => filterNestedIncluded(child as JsonObject, includedIds));
  return copy;
}

/**
 * Reiht eine Control ein, wenn sie inkludiert ist; andernfalls steigen die
 * inkludierten Nachfahren an diese Stelle hoch (as-is Up-Levelling).
 */
function appendIncludedChain(
  control: JsonObject,
  includedIds: ReadonlySet<string>,
  out: JsonObject[],
): void {
  const id = readIdOrEmpty(control);
  if (id.length > 0 && includedIds.has(id)) {
    out.push(filterNestedIncluded(control, includedIds));
    return;
  }
  const children = arrayMember(control, 'controls');
  if (children !== undefined) {
    for (const child of ownArrayDataElements(children)) {
      if (isJsonObject(child)) appendIncludedChain(child as JsonObject, includedIds, out);
    }
  }
}

/** Filtert einen Container für as-is: Gruppen mit Inhalt + eingereihte Controls. */
function filterAsIsNode(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
): { readonly groups: JsonObject[]; readonly controls: JsonObject[] } {
  const groups: JsonObject[] = [];
  const controls: JsonObject[] = [];

  const directControls = arrayMember(containerNode, 'controls');
  if (directControls !== undefined) {
    for (const child of directControls) {
      if (!isJsonObject(child)) continue;
      appendIncludedChain(child, includedIds, controls);
    }
  }

  const nestedGroups = arrayMember(containerNode, 'groups');
  if (nestedGroups !== undefined) {
    for (const group of nestedGroups) {
      if (!isJsonObject(group)) continue;
      const filteredGroup = filterAsIsNode(group, includedIds);
      const groupControls =
        (filteredGroup['controls'] as JsonObject[] | undefined) ?? [];
      const groupSubGroups =
        (filteredGroup['groups'] as JsonObject[] | undefined) ?? [];
      const groupHolds =
        groupControls.length > 0 || groupSubGroups.length > 0;
      if (groupHolds) {
        groups.push({ ...group, ...filteredGroup });
      }
    }
  }

  return { groups, controls };
}

/**
 * Reproduziert die Quellhierarchie für as-is: Gruppen erscheinen, solange
 * sie eine inkludierte Control halten (Non-Control-Kinder intakt);
 * inkludierte Controls unter nicht inkludierten Parents werden rekursiv
 * hochgelevelt.
 */
export function buildAsIsGroups(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
): JsonObject {
  return filterAsIsNode(containerNode, includedIds);
}
