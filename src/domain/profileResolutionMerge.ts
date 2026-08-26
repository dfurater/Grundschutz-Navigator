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
//
// Custom-Zusammenbauung (`merge: { custom }`): Die Gruppen werden
// mitgliedergenau kopiert — unbekannte Mitglieder bleiben erhalten (ADR-2),
// ihre `insert-controls`-Direktiven jedoch werden weder ausgeführt noch
// fortgetragen, denn ein unaufgelöster Direktivtext darf im resolvierten
// Dokument nicht als Inhalt erscheinen. Die insert-controls-Anweisungen der
// Custom-Ebene selektieren gegen einen synthetischen Index des kombinierten
// Pools mit exakt derselben Selektormechanik wie Phase 1 (einschließlich
// des Vorfahren-Defaults); mehrere Anweisungen wirken kumulativ ohne
// Doppelausgabe derselben Definition. `order` sortiert aufsteigend oder
// absteigend nach Control-ID; fehlende, `keep` und unbekannte Werte
// bewahren die Pool-Erscheinungsreihenfolge.
// =============================================================================

import type { JsonObject } from '@/adapters/oscalProfileReaders';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { ProfileInsertControls } from './profileModel';
import {
  indexCatalogControls,
  isJsonObject,
  ownArrayDataElements,
  ownDataValue,
  resolveSelectionIds,
} from './profileResolutionSelection';

export type CombineMethod = 'use-first' | 'keep';

function readIdOrEmpty(node: JsonObject): string {
  const id = node['id'];
  return typeof id === 'string' ? id : '';
}

/** Array-Wert eines Mitglieds, rein deskriptorbasiert gelesen. */
function safeArrayMember(node: JsonObject, key: string): readonly unknown[] | undefined {
  const value = ownDataValue(node, key);
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
  const filtered = ownArrayDataElements(safeArrayMember(control, 'controls') ?? [])
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
  const children = safeArrayMember(control, 'controls');
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
/** Direkte Controls eines Containers einreihen (inkludierte + Up-Level). */
function collectDirectControls(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
  controls: JsonObject[],
): void {
  const directControls = safeArrayMember(containerNode, 'controls');
  if (directControls === undefined) return;
  for (const child of ownArrayDataElements(directControls)) {
    if (!isJsonObject(child)) continue;
    appendIncludedChain(child, includedIds, controls);
  }
}

/** Gefilterte Untergruppen eines Containers sammeln. */
function collectNestedGroups(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
  visited: Set<object>,
  groups: JsonObject[],
): void {
  const nestedGroups = safeArrayMember(containerNode, 'groups');
  if (nestedGroups === undefined) return;
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

/** Filtert einen Container rekursiv für die as-is-Ausgabe. */
function filterContainerForAsIs(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
  visited: Set<object>,
): JsonObject {
  if (visited.has(containerNode)) return { groups: [], controls: [] };
  visited.add(containerNode);

  const groups: JsonObject[] = [];
  const controls: JsonObject[] = [];
  collectDirectControls(containerNode, includedIds, controls);
  collectNestedGroups(containerNode, includedIds, visited, groups);

  return { groups, controls };
}

/* ------------------------------------------------------------------ */
/* Custom-Zusammenbauung                                               */
/* ------------------------------------------------------------------ */

/** Auftrag der Custom-Zusammenbauung: Rohgruppen plus Anweisungen. */
export interface CustomAssemblyRequest {
  /** Raw-Gruppenknoten aus `merge/custom/groups` in Dokumentordnung. */
  readonly rawGroups: readonly JsonObject[];
  readonly insertControls: readonly ProfileInsertControls[];
}

export type CustomAssemblyResult =
  | {
    readonly ok: true;
    /** Exakt kopierte Gruppen ohne ihre insert-controls-Direktiven. */
    readonly groups: readonly JsonObject[];
    /** Eingesetzte Controls in anweisungsweiser Reihenfolge. */
    readonly controls: readonly JsonObject[];
  }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

/**
 * Kopiert alle eigenen Mitglieder über Data-Property-Deskriptoren.
 * Accessor-Slots erscheinen als abwesend und werden nie ausgeführt —
 * dieselbe Semantik wie in der Selektionsphase.
 */
function copyOwnDataMembers(node: JsonObject): JsonObject {
  const copy: JsonObject = {};
  for (const key of Reflect.ownKeys(node)) {
    if (typeof key !== 'string') continue;
    const value = ownDataValue(node, key);
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}

/**
 * Kopiert eine Custom-Gruppe mitgliedergenau; verschachtelte Gruppen
 * werden ebenso behandelt. Die Rekursionstiefe entspricht der Gruppen-
 * Verschachtelung des Quelldokuments und ist durch den Entry-Scanner
 * (maxDepth) begrenzt.
 */
function copyCustomGroup(group: JsonObject): JsonObject {
  const copy = copyOwnDataMembers(group);
  delete copy['insert-controls'];

  const nested = ownDataValue(group, 'groups');
  if (Array.isArray(nested)) {
    copy['groups'] = ownArrayDataElements(nested).map((child) =>
      isJsonObject(child) ? copyCustomGroup(child as JsonObject) : child,
    );
  }
  return copy;
}

/**
 * Wendet die order-Richtlinie auf die selektierten IDs an (bereits in
 * Pool-Erscheinungsreihenfolge). Aufsteigend/absteigend sortiert nach
 * UTF-16-Codepunkten; jeder andere Wert bewahrt die Reihenfolge.
 * Bewusst KEIN localeCompare: Dessen Kollation hängt von der ICU-Umgebung
 * ab und würde die geforderte byte-identische Determinismus brechen
 * (SonarQube S2871).
 */
function orderedInsertIds(
  ids: ReadonlySet<string>,
  order: string | undefined,
): readonly string[] {
  const byCodeUnit = (left: string, right: string): number =>
    left < right ? -1 : left > right ? 1 : 0;
  if (order === 'ascending') return [...ids].sort(byCodeUnit);
  if (order === 'descending') {
    return [...ids].sort((left, right) => byCodeUnit(right, left));
  }
  return [...ids];
}

/**
 * Baut das custom-Strukturbild: Gruppen exakt kopiert (ohne Ausführung
 * ihrer insert-controls), Controls ausschließlich aus den Anweisungen der
 * Custom-Ebene gegen den kombinierten Pool. Nicht getroffene Selektionen
 * tragen nichts bei und sind kein Fehler.
 */
export function buildCustomGroups(
  request: CustomAssemblyRequest,
  combined: CombinedControls,
): CustomAssemblyResult {
  // Synthetischer Index über den kombinierten Pool: Die Selektormechanik
  // (with-ids, matching, with-child-controls, Ausschlüsse) verhält sich
  // damit exakt wie in Phase 1 — ein zweiter Selektionscodepfad entsteht
  // nicht. Verschachtelte Kind-Controls eines Pool-Knotens registriert
  // derselbe Tiefendurchlauf, sodass with-child-controls echte Struktur
  // sieht.
  const poolIndex = indexCatalogControls({ pool: { controls: [...combined.order] } });

  const controls: JsonObject[] = [];
  const emittedDefinitions = new Set<object>();

  for (const directive of request.insertControls) {
    const outcome = resolveSelectionIds(poolIndex, {
      selection: directive.selection,
      excludeControls: directive.excludeControls,
    });
    if (!outcome.ok) return outcome;

    for (const id of orderedInsertIds(outcome.ids, directive.order)) {
      for (const definition of combined.controls.get(id) ?? []) {
        if (emittedDefinitions.has(definition)) continue;
        emittedDefinitions.add(definition);
        controls.push(definition);
      }
    }
  }

  return {
    ok: true,
    groups: request.rawGroups.filter((group) => isJsonObject(group)).map(copyCustomGroup),
    controls,
  };
}
