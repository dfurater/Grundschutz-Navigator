// =============================================================================
// Merge (Phase 2) der Profile Resolution — GSPP-291 Commit B
//
// Kombiniert die Inklusionen der Import-Phase nach der combine-Richtung
// (use-first behält die erste Definition, keep erhält ALLE Definitionen
// und meldet Kollisionen) und formt je Strukturrichtlinie das Ergebnis:
// flat gibt kombinierte Controls flach aus, as-is reproduziert die
// Quellhierarchie mit Up-Levelling nicht inkludierter Zwischenelemente.
//
// Semantik laut gepinnter NIST-Draft-Spezifikation.
//
// Strukturgarantien (aus der Befundserie gelernt):
// - Alle Array-Lesungen über eigene Data-Property-Deskriptoren; Accessoren
//   werden nie ausgeführt.
// - Alle Rekursionen sind durch die maximale Verschachtelungstiefe des
//   JSON-Quellgraphen begrenzt (der Entry-Scanner lehnt >maxDepth ab);
//   innerhalb dieser Grenze ist der Stack-Bedarf konstant klein.
// =============================================================================

import type { JsonObject } from '@/adapters/oscalProfileReaders';
import {
  isJsonObject,
  ownArrayDataElements,
} from './profileResolutionSelection';

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
  /** Selektierte Controls in Originalordnung (Rohknoten). */
  readonly controls: readonly JsonObject[];
}

export type CombinedControls = {
  /**
   * Control-Definitionen je ID. Bei use-first genau eine; bei keep alle
   * kollidierenden — damit buildFlatControls jede echte Definition ausgibt.
   */
  readonly controls: ReadonlyMap<string, readonly JsonObject[]>;
  /** Knoten in Erscheinungsreihenfolge (Tiefendurchlauf der Importe). */
  readonly order: readonly JsonObject[];
  /** Bei keep: IDs, deren Definitionen kollidieren. */
  readonly clashes: readonly string[];
};

/**
 * Wendet die combine-Richtung auf alle Inklusionen an. Reihenfolge:
 * Tiefendurchlauf in Importreihenfolge. Bei use-first gewinnt das erste
 * Vorkommen; bei keep bleiben ALLE Definitionen erhalten (als Liste je ID)
 * und Kollisionen werden gemeldet.
 */
export function applyCombine(
  inclusions: readonly ControlInclusion[],
  method: CombineMethod,
): CombinedControls {
  const definitions = new Map<string, JsonObject[]>();
  const order: JsonObject[] = [];
  const clashes = new Set<string>();

  for (const inclusion of inclusions) {
    for (const node of inclusion.controls) {
      const id = readIdOrEmpty(node);
      if (id.length === 0) continue;

      const bucket = definitions.get(id);
      if (bucket === undefined) {
        definitions.set(id, [node]);
        order.push(node);
      } else if (method === 'keep') {
        bucket.push(node);
        clashes.add(id);
        order.push(node);
      }
      // use-first: Spätere Definitionen tragen nichts bei.
    }
  }

  const finalOrder =
    method === 'use-first'
      ? [...definitions.values()].map((defs) => defs[0]!)
      : [...order];

  return { controls: definitions, order: finalOrder, clashes: [...clashes] };
}

/** Flache Ausgabe: kombinierte Controls direkt unter catalog. */
export function buildFlatControls(combined: CombinedControls): JsonObject {
  return {
    controls: combined.order,
  };
}

/** Filtert eine Control-Hierarchie: nur inkludierte IDs bleiben (rekursiv). */
function filterNestedIncluded(
  control: JsonObject,
  includedIds: ReadonlySet<string>,
): JsonObject {
  const copy: JsonObject = { ...control };
  // Nur setzen, wenn es gefilterte Kinder gibt — keine leeren controls:[]
  // in Blätter injizieren (Gitar-Hinweis zu bce6b68).
  const filtered = ownArrayDataElements(arrayMember(control, 'controls') ?? [])
    .filter((child) => isJsonObject(child) && includedIds.has(readIdOrEmpty(child)))
    .map((child) => filterNestedIncluded(child as JsonObject, includedIds));
  if (filtered.length > 0) copy['controls'] = filtered;
  else delete copy['controls'];
  return copy;
}

/**
 * Reiht eine Control ein, wenn sie inkludiert ist; andernfalls steigen die
 * inkludierten Nachfahren an diese Stelle hoch (as-is Up-Levelling).
 * Die Rekursionstiefe entspricht der Control-Verschachtelung des Quell-
 * dokuments und ist durch den Entry-Scanner (maxDepth) begrenzt.
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
  return filterContainerForAsIs(containerNode, includedIds, new Set<object>());
}

/**
 * Filtert einen Container rekursiv für die as-is-Ausgabe. Die Besuchsmenge
 * schützt gegen Zyklen; der Stack trägt die Tiefenreihenfolge.
 */
function filterContainerForAsIs(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
  visited: Set<object>,
): JsonObject {
  if (visited.has(containerNode)) return { groups: [], controls: [] };
  visited.add(containerNode);

  const groups: JsonObject[] = [];
  const controls: JsonObject[] = [];

  // Direkte Controls: inkludierte behalten (gefiltert auf inkludierte
  // Nachfahren); nicht inkludierte up-leveln ihre inkludierten Nachfahren.
  const directControls = arrayMember(containerNode, 'controls');
  if (directControls !== undefined) {
    for (const child of ownArrayDataElements(directControls)) {
      if (!isJsonObject(child)) continue;
      appendIncludedChain(child, includedIds, controls);
    }
  }

  // Gruppen: rekursiv filtern und behalten, wenn Inhalt übrig bleibt.
  const nestedGroups = arrayMember(containerNode, 'groups');
  if (nestedGroups !== undefined) {
    for (const group of ownArrayDataElements(nestedGroups)) {
      if (!isJsonObject(group)) continue;
      const filteredGroup = filterContainerForAsIs(group, includedIds, visited);
      const groupControls =
        (filteredGroup['controls'] as readonly unknown[] | undefined) ?? [];
      const groupSubGroups =
        (filteredGroup['groups'] as readonly unknown[] | undefined) ?? [];
      if (groupControls.length > 0 || groupSubGroups.length > 0) {
        groups.push({ ...group, ...filteredGroup });
      }
    }
  }

  return { groups, controls };
}
