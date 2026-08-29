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
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import {
  PROFILE_RESOLUTION_STAGE,
  PROFILE_RESOLUTION_VALIDATOR,
} from './profileResolutionImportGraph';
import type {
  ProfileControlMatcher,
  ProfileControlSelector,
  ProfileGroup,
  ProfileInsertControls,
  ProfileSelection,
} from './profileModel';
import {
  indexCatalogControls,
  isJsonObject,
  ownArrayDataElements,
  ownDataValue,
  PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES,
  resolveSelectionIds,
} from './profileResolutionSelection';

export type CombineMethod = 'use-first' | 'keep';

function readIdOrEmpty(node: JsonObject): string {
  const id = ownDataValue(node, 'id');
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
  /**
   * Je Definitionsknoten die selektierten IDs DERSELBEN Inklusion.
   *
   * Quellenscharf statt global: Tragen zwei Importe dieselbe Control-ID und
   * selektiert nur einer davon ein verschachteltes Kind, dürfte das Kind auch
   * nur in der Definition dieses einen Imports erscheinen. Gegen die globale
   * ID-Menge aus `controls` geprunt bliebe es in beiden stehen und brächte
   * eine aus dieser Quelle nie selektierte Control in den aufgelösten Katalog.
   */
  readonly sourceIdsByDefinition: ReadonlyMap<JsonObject, ReadonlySet<string>>;
};

function controlsFromInclusion(inclusion: unknown): readonly unknown[] {
  if (!isJsonObject(inclusion)) return [];
  const controls = ownDataValue(inclusion, 'controls');
  return Array.isArray(controls) ? ownArrayDataElements(controls) : [];
}

function registerCombinedControl(
  node: JsonObject,
  method: CombineMethod,
  definitions: Map<string, JsonObject[]>,
  order: JsonObject[],
  clashes: Set<string>,
): void {
  const id = readIdOrEmpty(node);
  if (id.length === 0) return;
  const bucket = definitions.get(id);
  if (bucket === undefined) {
    definitions.set(id, [node]);
    order.push(node);
    return;
  }
  if (method !== 'keep') return;
  bucket.push(node);
  clashes.add(id);
  order.push(node);
}

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
  const sourceIdsByDefinition = new Map<JsonObject, Set<string>>();

  for (const inclusion of ownArrayDataElements(inclusions)) {
    const nodesInInclusion = controlsFromInclusion(inclusion).filter(isJsonObject);
    // Leere IDs ausfiltern: `readIdOrEmpty` liefert '' für ID-lose Knoten, und
    // eine Prune-Menge mit '' würde jedes ID-lose verschachtelte Kind als
    // "selektiert" behandeln und stehen lassen.
    const idsInInclusion = nodesInInclusion
      .map(readIdOrEmpty)
      .filter((id) => id.length > 0);
    for (const node of nodesInInclusion) {
      registerCombinedControl(node, method, definitions, order, clashes);
      // Akkumulieren, nicht überschreiben: Importiert ein Profil denselben
      // href mehrfach mit unterschiedlichen include-controls, liefert Phase 1
      // in jeder Inklusion DASSELBE Knotenobjekt. Als Map-Schlüssel fällt es
      // zusammen — ein `set` gäbe der ersten Inklusion die Auswahl der
      // späteren und prunte ein dort selektiertes Kind weg. Der Knoten wird
      // nur einmal ausgegeben, seine Prune-Menge ist deshalb die Vereinigung
      // aller Inklusionen, aus denen er stammt.
      const scope = sourceIdsByDefinition.get(node);
      if (scope === undefined) sourceIdsByDefinition.set(node, new Set(idsInInclusion));
      else for (const id of idsInInclusion) scope.add(id);
    }
  }

  const finalOrder =
    method === 'use-first'
      ? [...definitions.values()].map((defs) => defs[0]!)
      : [...order];

  return {
    controls: definitions,
    order: finalOrder,
    clashes: [...clashes],
    sourceIdsByDefinition,
  };
}

/** Entfernt verschachtelte Kinder (controls, groups) für echte Flachdarstellung. */
export function stripNestedChildren(node: JsonObject): JsonObject {
  const copy: JsonObject = {};
  for (const key of Reflect.ownKeys(node)) {
    if (typeof key !== 'string') continue;
    if (key === 'controls' || key === 'groups') continue;
    const value = ownDataValue(node, key);
    if (value !== undefined) copy[key] = value;
  }
  return copy;
}

/** Flache Ausgabe: kombinierte Controls direkt unter catalog. */
export function buildFlatControls(combined: CombinedControls): JsonObject {
  const orderValue = ownDataValue(combined as unknown as object, 'order');
  return {
    controls: Array.isArray(orderValue)
      ? ownArrayDataElements(orderValue)
        .filter((node): node is JsonObject => isJsonObject(node))
        .map(stripNestedChildren)
      : [],
  };
}

/**
 * Filtert einen inkludierten Control-Knoten auf seinen inkludierten
 * Nachfahrenbaum; nicht inkludierte Zwischenebenen lösen sich dabei ebenso
 * auf wie an der Gruppenoberkante — ihre inkludierten Nachfahren werden
 * unverhüllt an der Quellposition der Zwischenebene eingereiht.
 */
function filterNestedIncluded(
  control: JsonObject,
  includedIds: ReadonlySet<string>,
  path: ReadonlySet<object>,
): JsonObject {
  const childPath = new Set(path);
  childPath.add(control);
  const copy = copyOwnDataMembers(control);
  const ordered: JsonObject[] = [];
  // Nur setzen, wenn es gefilterte Kinder gibt — keine leeren controls:[]
  // in Blättern injizieren (Gitar-Hinweis zu bce6b68).
  const children = safeArrayMember(control, 'controls') ?? [];
  for (const child of ownArrayDataElements(children)) {
    if (!isJsonObject(child)) continue;
    if (childPath.has(child)) continue;
    if (includedIds.has(readIdOrEmpty(child))) {
      ordered.push(filterNestedIncluded(child, includedIds, childPath));
    } else {
      ordered.push(...promotedControls(child, includedIds, childPath));
    }
  }
  delete copy['controls'];
  if (ordered.length > 0) copy['controls'] = ordered;
  return copy;
}

/**
 * Liefert die Knoten, mit denen eine Control an DERJENIGEN Stelle erscheint,
 * an der sie im Quellbaum steht: inkludierte Controls erscheinen selbst
 * (gefiltert auf inkludierte Nachfahren), nicht inkludierte Zwischenebenen
 * lösen sich auf — ihre inkludierten Nachfahren werden unverhüllt
 * hochgelevelt (Orakelbefund am BSI-Korpus: KONF.2.4.2 erscheint direkt
 * unter KONF.2, nicht in einer KONF.2.4-Schale). Die Rekursionstiefe ist
 * durch den Entry-Scanner (maxDepth) gedeckt.
 */
function promotedControls(
  control: JsonObject,
  includedIds: ReadonlySet<string>,
  path: ReadonlySet<object>,
): JsonObject[] {
  if (path.has(control)) return [];
  const childPath = new Set(path);
  childPath.add(control);
  const kept: JsonObject[] = [];
  const children = safeArrayMember(control, 'controls');
  if (children === undefined) return kept;
  for (const child of ownArrayDataElements(children)) {
    if (!isJsonObject(child)) continue;
    if (childPath.has(child)) continue;
    if (includedIds.has(readIdOrEmpty(child))) {
      kept.push(filterNestedIncluded(child, includedIds, childPath));
    } else {
      kept.push(...promotedControls(child, includedIds, childPath));
    }
  }
  return kept;
}
function pushHierarchyChildren(
  node: JsonObject,
  depth: number,
  stack: Array<{ node: JsonObject; depth: number }>,
): void {
  for (const listKey of ['groups', 'controls'] as const) {
    const nested = safeArrayMember(node, listKey);
    if (nested === undefined) continue;
    for (const child of ownArrayDataElements(nested)) {
      if (isJsonObject(child)) stack.push({ node: child, depth: depth + 1 });
    }
  }
}

/** Misst die maximale Schachtelungstiefe (groups + controls) iterativ. */
function measureGroupsDepth(containerNode: JsonObject): number {
  let maxDepth = 0;
  const stack: Array<{ node: JsonObject; depth: number }> = [{ node: containerNode, depth: 0 }];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    maxDepth = Math.max(maxDepth, depth);
    if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) return depth;
    pushHierarchyChildren(node, depth, stack);
  }
  return maxDepth;
}

/**
 * Reproduziert die Quellhierarchie für as-is: Gruppen erscheinen, solange
 * sie eine inkludierte Control halten (Non-Control-Kinder intakt);
 * inkludierte Controls unter nicht inkludierten Parents werden an deren
 * Quellposition rekursiv hochgelevelt.
 */
export function buildAsIsGroups(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
): JsonObject {
  // Tiefenbegrenzung am exportierten Rand: Eine 12.000-Ebenen-Kette kann die
  // Klasse-2-Kette nicht passieren (maxDepth 64); statt RangeError wird
  // kontrolliert leer zurückgegeben.
  if (measureGroupsDepth(containerNode) > CLASS_2_IMPORT_LIMITS.maxDepth) {
    return { groups: [], controls: [] };
  }
  return filterContainerForAsIs(containerNode, includedIds, new Set<object>());
}

/** Direkte Controls eines Containers einreihen (inkludierte + Up-Level). */
function collectDirectControls(
  containerNode: JsonObject,
  includedIds: ReadonlySet<string>,
  controls: JsonObject[],
): void {
  const children = safeArrayMember(containerNode, 'controls');
  if (children === undefined) return;
  const rootPath = new Set<object>();
  for (const child of ownArrayDataElements(children)) {
    if (!isJsonObject(child)) continue;
    if (includedIds.has(readIdOrEmpty(child))) {
      controls.push(filterNestedIncluded(child, includedIds, rootPath));
    } else {
      controls.push(...promotedControls(child, includedIds, rootPath));
    }
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
      // Die Hierarchielisten werden nur gesetzt, wenn Inhalt erhalten bleibt —
      // leere Gruppen-/Controls-Mitglieder erscheinen im resolved Dokument
      // nicht (Orakelvertrag gegen die BSI-resolved_catalogs).
      // Deskriptorbasiert, um Getter nicht auszuführen.
      const merged = copyOwnDataMembers(group);
      delete merged['controls'];
      delete merged['groups'];
      if (groupControls.length > 0) merged['controls'] = groupControls;
      if (groupSubGroups.length > 0) merged['groups'] = groupSubGroups;
      groups.push(merged);
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

/* ------------------------------------------------------------------ */
/* Custom-Zusammenbauung                                               */
/* ------------------------------------------------------------------ */

/** Auftrag der Custom-Zusammenbauung: Rohgruppen plus Anweisungen. */
export interface CustomAssemblyRequest {
  /**
   * Raw-Gruppenknoten aus `merge/custom/groups` in Dokumentordnung. Die
   * parallele Liste `typedGroups` trägt die projizierten Direktiven
   * derselben Gruppen (gleiche Reihenfolge, gleiche Länge).
   */
  readonly rawGroups: readonly JsonObject[];
  readonly typedGroups: readonly ProfileGroup[];
  /** Anweisungen auf Catalog-Ebene (direkt unter dem Root). */
  readonly insertControls: readonly ProfileInsertControls[];
}

export type CustomAssemblyResult =
  | {
    readonly ok: true;
    /** Zusammengebaute Gruppen einschließlich ihrer eingefügten Controls. */
    readonly groups: readonly JsonObject[];
    /** Eingesetzte Controls auf Catalog-Ebene in anweisungsweiser Reihenfolge. */
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
 *
 * Gruppen ohne eigenes props-Mitglied erhalten einen Label-Träger aus
 * ihrer ID (`prop[@name='label']`): Die Quellkataloge des BSI-Korpus
 * tragen durchweg Gruppen-Labels, und die BSI-resolved_catalogs setzen
 * diese Konvention auch über die custom-Zusammenbauung fort — der
 * Orakelvergleich nagelt das Verhalten fest.
 */
function copyCustomGroup(group: JsonObject): JsonObject {
  const copy = copyOwnDataMembers(group);
  delete copy['insert-controls'];

  if (!('props' in copy)) {
    const groupId = ownDataValue(group, 'id');
    if (typeof groupId === 'string' && groupId.length > 0) {
      copy['props'] = [{ name: 'label', value: groupId }];
    }
  }

  return copy;
}

/** Liest die ID eines Part-Eintrags als String; ohne ID zählt leer. */
function partIdOf(part: unknown): string {
  if (!isJsonObject(part)) return '';
  const id = ownDataValue(part, 'id');
  return typeof id === 'string' ? id : '';
}

function byPartId(left: unknown, right: unknown): number {
  const leftId = partIdOf(left);
  const rightId = partIdOf(right);
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function measureControlDepth(control: JsonObject): number {
  let maxDepth = 0;
  const stack: Array<{ node: JsonObject; depth: number }> = [{ node: control, depth: 1 }];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (visited.has(node)) continue;
    visited.add(node);
    maxDepth = Math.max(maxDepth, depth);
    if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) return depth;
    const children = safeArrayMember(node, 'controls') ?? [];
    for (const child of ownArrayDataElements(children)) {
      if (isJsonObject(child)) stack.push({ node: child, depth: depth + 1 });
    }
  }
  return maxDepth;
}

function copyWithSortedParts(control: JsonObject, label: string): JsonObject {
  const copy = copyWithLabel(control, label);
  const parts = safeArrayMember(control, 'parts');
  if (parts !== undefined) copy['parts'] = ownArrayDataElements(parts).sort(byPartId);
  return copy;
}

type LabelStackFrame = { original: JsonObject; copy: JsonObject; label: string };

function createLabeledChild(
  child: unknown,
  index: number,
  frame: LabelStackFrame,
  visited: Set<object>,
  stack: LabelStackFrame[],
): unknown {
  if (!isJsonObject(child) || visited.has(child)) return child;
  visited.add(child);
  const childLabel = `${frame.label}.${index + 1}`;
  const childCopy = copyWithSortedParts(child, childLabel);
  stack.push({ original: child, copy: childCopy, label: childLabel });
  return childCopy;
}

/**
 * Versieht eine eingefügte Control und ihre gesamte verschachtelte
 * Subcontrol-Hierarchie mit Positions-Labels (`<Gruppe>.<n>`, darunter
 * `<Gruppe>.<n>.<m>` …) und trägt die Parts jeder Ebene aufsteigend nach
 * ID. Der BSI-Korpus nagelt beide Konventionen für den Custom-Pfad fest;
 * der as-is-Pfad bewahrt dagegen Quellordnung und ursprüngliche Labels.
 */
function withPositionalLabels(
  control: JsonObject,
  label: string,
): JsonObject {
  // Tiefenmessung: Eine 12.000-Ebenen-Kette kann die Klasse-2-Kette nicht
  // passieren (maxDepth 64); statt RangeError wird die Beschriftung nur
  // für die erreichbare Tiefe vergeben und tiefere Ebenen bleiben unverändert.
  // Iterative Beschriftung mit explizitem Stack, um tiefe Hierarchien ohne
  // Call-Stack-Überlauf zu verarbeiten.
  const rootCopy = copyWithSortedParts(control, label);
  if (measureControlDepth(control) > CLASS_2_IMPORT_LIMITS.maxDepth) {
    // Zu tief für vollständige Beschriftung — nur die Wurzel wird beschriftet.
    return rootCopy;
  }
  const stack: LabelStackFrame[] = [{ original: control, copy: rootCopy, label }];
  const visited = new Set<object>([control]);
  while (stack.length > 0) {
    const frame = stack.pop()!;
    const children = safeArrayMember(frame.original, 'controls');
    if (children === undefined) continue;
    frame.copy['controls'] = ownArrayDataElements(children).map((child, index) =>
      createLabeledChild(child, index, frame, visited, stack));
  }
  return rootCopy;
}

function copyWithLabel(control: JsonObject, label: string): JsonObject {
  const sourcePropsValue = ownDataValue(control, 'props');
  const sourceProps = Array.isArray(sourcePropsValue)
    ? ownArrayDataElements(sourcePropsValue)
    : [];
  const copy = copyOwnDataMembers(control);
  copy['props'] = [{ name: 'label', value: label }, ...sourceProps];
  return copy;
}

/**
 * Wertet die insert-controls-Direktiven EINER Gruppe gegen den Pool aus
 * und liefert die getroffenen Definitionen mit Positions-Labels. Mehrere
 * Anweisungen wirken kumulativ; Deduplizierung läuft je Gruppe.
 */
function assembleGroupControls(
  groupId: string,
  directives: readonly ProfileInsertControls[],
  context: AssemblyContext,
  groupDefinitions: Set<object>,
): { readonly ok: true; readonly placed: readonly JsonObject[] } | { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  const placed: JsonObject[] = [];

  for (const directive of directives) {
    const outcome = resolveSelectionIds(context.poolIndex, {
      selection: directive.selection,
      excludeControls: directive.excludeControls,
    });
    if (!outcome.ok) return outcome;

    for (const id of orderedInsertIds(outcome.ids, directive)) {
      for (const definition of context.combined.controls.get(id) ?? []) {
        if (groupDefinitions.has(definition)) continue;
        groupDefinitions.add(definition);
        // Gegen die Selektion DERSELBEN Inklusion prunen, bevor die Definition
        // platziert wird: Ohne diesen Schritt fahren nicht selektierte
        // verschachtelte Kinder unverändert mit (GSPP-377). Der as-is-Zweig
        // tut dasselbe über filterContainerForAsIs.
        placed.push(withPositionalLabels(
          filterNestedIncluded(definition, selectionScopeFor(definition, context), new Set<object>()),
          `${groupId}.${placed.length + 1}`,
        ));
      }
    }
  }
  return { ok: true, placed };
}

interface AssemblyContext {
  readonly poolIndex: ReturnType<typeof indexCatalogControls>;
  readonly combined: CombinedControls;
  /**
   * Alle in dieser Assemblierung durch Direktiven aufgelösten Control-IDs.
   * Zweite Quelle der Prune-Menge, siehe `selectionScopeFor`.
   */
  readonly selectedIds: ReadonlySet<string>;
}

type GroupAssemblyResult =
  | { readonly ok: true; readonly groups: readonly JsonObject[] }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

/**
 * Baut die Gruppenhierarchie rekuriv auf: Rohknoten und projizierte
 * Direktiven werden über den Index gekoppelt; jede Gruppe erhält ihre
 * eigenen insert-controls als `controls`-Mitglied, verschachtelte Gruppen
 * werden genauso behandelt. Die Rekursionstiefe ist durch den Entry-
 * Scanner (maxDepth) gedeckt.
 */
/**
 * Sammelt alle Direktiven des custom-Bildes: die der Catalog-Ebene und die
 * jeder Gruppe, rekursiv über verschachtelte Gruppen. Grundlage der zweiten
 * Quelle in `selectionScopeFor`; die Tiefe ist am exportierten Rand bereits
 * durch `measureCustomGroupsDepth` begrenzt, `visited` deckt Zyklen ab.
 */
function collectAllDirectives(
  typedGroups: readonly unknown[],
  rootDirectives: readonly ProfileInsertControls[],
): ProfileInsertControls[] {
  const all = [...rootDirectives];
  const stack: unknown[] = [...typedGroups];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null || visited.has(node)) continue;
    visited.add(node);
    const projected = projectAssemblyGroup(node);
    all.push(...projected.insertControls);
    for (const nested of projected.groups) stack.push(nested);
  }
  return all;
}

/**
 * Vereinigt die aufgelösten IDs aller Direktiven. Eine Direktive, deren
 * Selektion nicht auflösbar ist, trägt hier nichts bei — ihre Diagnose
 * entsteht an der Stelle, die sie tatsächlich ausführt.
 */
function resolveSelectedIds(
  directives: readonly ProfileInsertControls[],
  poolIndex: ReturnType<typeof indexCatalogControls>,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const directive of directives) {
    const outcome = resolveSelectionIds(poolIndex, {
      selection: directive.selection,
      excludeControls: directive.excludeControls,
    });
    if (!outcome.ok) continue;
    for (const id of outcome.ids) ids.add(id);
  }
  return ids;
}

function assembleGroups(
  rawGroups: readonly JsonObject[],
  typedGroups: readonly unknown[],
  context: AssemblyContext,
): GroupAssemblyResult {
  const assembled: JsonObject[] = [];

  for (let index = 0; index < rawGroups.length; index += 1) {
    const assembledGroup = assembleSingleGroup(
      rawGroups[index]!,
      typedGroups[index],
      context,
    );
    if (!assembledGroup.ok) return assembledGroup;
    assembled.push(assembledGroup.group);
  }
  return { ok: true, groups: assembled };
}

/** Baut eine einzelne Custom-Gruppe samt Direktiven und Untergruppen. */
function assembleSingleGroup(
  raw: JsonObject,
  typed: unknown,
  context: AssemblyContext,
): { readonly ok: true; readonly group: JsonObject } | { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  const copy = copyCustomGroup(raw);
  const projected = projectAssemblyGroup(typed);

  // Die Projektion liest dasselbe Array in derselben Ordnung; bei einer
  // Abweichung (sollte unmöglich sein) bleibt die Gruppe ohne Direktiven.
  if (projected.id !== undefined && projected.insertControls.length > 0) {
    const placed = assembleGroupControls(
      projected.id,
      projected.insertControls,
      context,
      new Set<object>(),
    );
    if (!placed.ok) return placed;
    if (placed.placed.length > 0) {
      copy['controls'] = placed.placed;
    }
  }

  const nestedFailure = attachNestedGroups(copy, raw, projected, context);
  if (nestedFailure !== null) return nestedFailure;
  return { ok: true, group: copy };
}

/**
 * Baut die Untergruppen einer Raw-Gruppe nach; ohne Raw-Kinder entfällt
 * das Mitglied. Rückgabe: Diagnose beim Scheitern, sonst null.
 */
function attachNestedGroups(
  copy: JsonObject,
  raw: JsonObject,
  typed: ProjectedAssemblyGroup,
  context: AssemblyContext,
): { readonly ok: false; readonly diagnostic: OscalDiagnostic } | null {
  const nestedRawValue = ownDataValue(raw, 'groups');
  if (!Array.isArray(nestedRawValue)) return null;

  const nestedRaw = ownArrayDataElements(nestedRawValue).filter(
    (child): child is JsonObject => isJsonObject(child),
  );
  const nestedResult = assembleGroups(nestedRaw, typed.groups, context);
  if (!nestedResult.ok) return nestedResult;
  if (nestedResult.groups.length > 0 || nestedRaw.length > 0) {
    copy['groups'] = nestedResult.groups;
  } else {
    delete copy['groups'];
  }
  return null;
}

/**
 * Wendet die order-Richtlinie auf die selektierten IDs an. Aufsteigend/
 * absteigend sortiert nach UTF-16-Codepunkten. Ohne order (`keep`) gilt:
 * Eine with-ids-Deklaration ordnet nach ihrer eigenen Liste (Orakelbefund
 * WLAN.3: ARCH.3.2 vor BES.2.1.4.2, obwohl BES im Quelldokument früher
 * liegt); Selektionen ohne Deklaration (include-all, matching) behalten
 * die Pool-Erscheinungsreihenfolge, nicht deklarierte Treffer schließen
 * sich ebensolcher an. Bewusst KEIN localeCompare: Dessen Kollation hängt
 * von der ICU-Umgebung ab und würde die Byte-Identität des Doppel-Laufs
 * brechen (SonarQube S2871).
 */
function orderedInsertIds(
  ids: ReadonlySet<string>,
  directive: ProfileInsertControls,
): readonly string[] {
  const ascending = (left: string, right: string): number => {
    if (left < right) return -1;
    if (left > right) return 1;
    return 0;
  };
  const descending = (left: string, right: string): number => {
    if (left > right) return -1;
    if (left < right) return 1;
    return 0;
  };
  if (directive.order === 'ascending') return [...ids].sort(ascending);
  if (directive.order === 'descending') return [...ids].sort(descending);

  const declared: string[] = [];
  if (directive.selection.kind === 'include-controls') {
    for (const selector of directive.selection.includeControls) {
      for (const id of selector.withIds) {
        if (ids.has(id) && !declared.includes(id)) declared.push(id);
      }
    }
  }
  if (declared.length === ids.size) return declared;
  const rest = [...ids].filter((id) => !declared.includes(id));
  return [...declared, ...rest];
}

function nestedCustomGroups(group: unknown): readonly JsonObject[] {
  if (!isJsonObject(group)) return [];
  const nested = ownDataValue(group, 'groups');
  if (!Array.isArray(nested)) return [];
  return ownArrayDataElements(nested).filter(
    (child): child is JsonObject => isJsonObject(child),
  );
}

/** Misst die maximale Schachtelungstiefe von Custom-Gruppen iterativ. */
function measureCustomGroupsDepth(rawGroups: readonly JsonObject[]): number {
  let maxDepth = 0;
  const stack: Array<{ groups: readonly JsonObject[]; depth: number }> = [
    { groups: rawGroups, depth: 1 },
  ];
  const visited = new Set<object>();
  while (stack.length > 0) {
    const { groups, depth } = stack.pop()!;
    if (visited.has(groups as object)) continue;
    visited.add(groups as object);
    maxDepth = Math.max(maxDepth, depth);
    if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) return depth;
    for (const group of ownArrayDataElements(groups)) {
      const nested = nestedCustomGroups(group);
      if (nested.length > 0) stack.push({ groups: nested, depth: depth + 1 });
    }
  }
  return maxDepth;
}

function jsonObjectArrayMember(node: object, key: string): readonly JsonObject[] {
  const value = ownDataValue(node, key);
  if (!Array.isArray(value)) return [];
  return ownArrayDataElements(value).filter(
    (entry): entry is JsonObject => isJsonObject(entry),
  );
}

function arrayMember<T>(node: object, key: string): readonly T[] {
  const value = ownDataValue(node, key);
  return Array.isArray(value) ? ownArrayDataElements(value) as T[] : [];
}

function projectMatcher(value: unknown): ProfileControlMatcher {
  if (!isJsonObject(value)) return {};
  const pattern = ownDataValue(value, 'pattern');
  const remarks = ownDataValue(value, 'remarks');
  return {
    ...(typeof pattern === 'string' && { pattern }),
    ...(typeof remarks === 'string' && { remarks }),
  };
}

function projectSelector(value: unknown): ProfileControlSelector {
  if (!isJsonObject(value)) {
    return { withIds: [], matching: [], path: '/' };
  }
  const withChildControls = ownDataValue(value, 'withChildControls');
  const withIds = ownDataValue(value, 'withIds');
  const matching = ownDataValue(value, 'matching');
  const path = ownDataValue(value, 'path');
  return {
    ...(typeof withChildControls === 'string' && { withChildControls }),
    withIds: Array.isArray(withIds)
      ? ownArrayDataElements(withIds).filter((id): id is string => typeof id === 'string')
      : [],
    matching: Array.isArray(matching)
      ? ownArrayDataElements(matching).map(projectMatcher)
      : [],
    path: typeof path === 'string' ? path : '/',
  };
}

function invalidSelection(): ProfileSelection {
  return {
    kind: 'none',
    diagnostic: createOscalDiagnostic({
      code: PROFILE_RESOLUTION_SELECTION_DIAGNOSTIC_CODES.SELECTION_INVALID,
      stage: PROFILE_RESOLUTION_STAGE,
      validator: PROFILE_RESOLUTION_VALIDATOR,
      path: '/',
    }),
  };
}

function projectSelection(value: unknown): ProfileSelection {
  if (!isJsonObject(value)) return invalidSelection();
  const kind = ownDataValue(value, 'kind');
  if (kind === 'include-all') return { kind };
  if (kind !== 'include-controls') return invalidSelection();
  const includeControls = ownDataValue(value, 'includeControls');
  return {
    kind,
    includeControls: Array.isArray(includeControls)
      ? ownArrayDataElements(includeControls).map(projectSelector)
      : [],
  };
}

function projectInsertControls(value: unknown): ProfileInsertControls {
  if (!isJsonObject(value)) {
    return {
      selection: invalidSelection(),
      excludeControls: [],
      path: '/',
    };
  }
  const order = ownDataValue(value, 'order');
  const excludeControls = ownDataValue(value, 'excludeControls');
  const path = ownDataValue(value, 'path');
  return {
    ...(typeof order === 'string' && { order }),
    selection: projectSelection(ownDataValue(value, 'selection')),
    excludeControls: Array.isArray(excludeControls)
      ? ownArrayDataElements(excludeControls).map(projectSelector)
      : [],
    path: typeof path === 'string' ? path : '/',
  };
}

interface ProjectedAssemblyGroup {
  readonly id?: string;
  readonly insertControls: readonly ProfileInsertControls[];
  readonly groups: readonly unknown[];
}

function projectAssemblyGroup(value: unknown): ProjectedAssemblyGroup {
  if (!isJsonObject(value)) return { insertControls: [], groups: [] };
  const id = ownDataValue(value, 'id');
  const insertControls = ownDataValue(value, 'insertControls');
  const groups = ownDataValue(value, 'groups');
  return {
    ...(typeof id === 'string' && { id }),
    insertControls: Array.isArray(insertControls)
      ? ownArrayDataElements(insertControls).map(projectInsertControls)
      : [],
    groups: Array.isArray(groups) ? ownArrayDataElements(groups) : [],
  };
}

function sanitizeCombinedControls(combined: CombinedControls): CombinedControls {
  const controls = ownDataValue(combined as unknown as object, 'controls');
  const sourceIds = ownDataValue(combined as unknown as object, 'sourceIdsByDefinition');
  return {
    order: jsonObjectArrayMember(combined as unknown as object, 'order'),
    controls: controls instanceof Map ? controls : new Map(),
    clashes: arrayMember<unknown>(combined as unknown as object, 'clashes').filter(
      (clash): clash is string => typeof clash === 'string',
    ),
    // Fehlt die Zuordnung, bleibt sie leer: Das prunt jede verschachtelte
    // Control weg, statt eine nicht selektierte durchzulassen — fail-closed
    // in Richtung "nur Selektiertes erscheint".
    sourceIdsByDefinition: sourceIds instanceof Map ? sourceIds : new Map(),
  };
}

function hasEmittedAncestor(
  id: string,
  index: ReturnType<typeof indexCatalogControls>,
  combined: CombinedControls,
  emittedDefinitions: ReadonlySet<object>,
): boolean {
  const visited = new Set<string>();
  let ancestorId = index.parentOf.get(id);
  while (ancestorId !== undefined && !visited.has(ancestorId)) {
    visited.add(ancestorId);
    const definitions = combined.controls.get(ancestorId);
    if (
      Array.isArray(definitions) &&
      ownArrayDataElements(definitions).some(
        (definition) => isJsonObject(definition) && emittedDefinitions.has(definition),
      )
    ) {
      return true;
    }
    const nestedDefinition = index.byId.get(ancestorId);
    if (nestedDefinition !== undefined && emittedDefinitions.has(nestedDefinition)) return true;
    ancestorId = index.parentOf.get(ancestorId);
  }
  return false;
}

/**
 * Die Prune-Menge einer Definition — welche verschachtelten Nachfahren beim
 * Platzieren erhalten bleiben.
 *
 * Zwei Quellen, vereinigt:
 *
 * 1. Die Phase-1-Selektion DERSELBEN Inklusion. Quellenscharf statt global:
 *    Tragen zwei Importe dieselbe Control-ID und hat nur einer das Kind
 *    eigenständig inkludiert, erscheint es auch nur dort.
 * 2. Die in dieser Assemblierung durch Direktiven aufgelösten IDs. Ein Kind,
 *    das eine Direktive ausdrücklich selektiert, gehört ins Ergebnis, auch
 *    wenn Phase 1 es nur als Teil des Elternteilbaums geliefert hat.
 *
 * Am BSI-WLAN-Profil gemessen: Dort stehen Eltern und Kinder einzeln in
 * `with-ids` — `ARCH.2.2` und elf seiner zwölf Kernel-Kinder, aber nicht
 * `ARCH.2.2.12`. Das nicht selektierte zwölfte Kind fällt damit durch beide
 * Quellen und verschwindet, wie es BSIs eigener Resolver auch tut.
 *
 * Fehlt die Inklusionszuordnung — bei einem Knoten, den
 * `definitionsForInsertion` aus `poolIndex.byId` holt, weil er nur
 * verschachtelt existiert — trägt allein die Direktiven-Selektion. Eine leere
 * Menge wäre dort falsch: Sie verwürfe auch ausdrücklich selektierte Kinder.
 */
function selectionScopeFor(
  definition: JsonObject,
  context: AssemblyContext,
): ReadonlySet<string> {
  const fromInclusion = context.combined.sourceIdsByDefinition.get(definition);
  if (fromInclusion === undefined) return context.selectedIds;
  const scope = new Set(fromInclusion);
  for (const id of context.selectedIds) scope.add(id);
  return scope;
}

function definitionsForInsertion(
  id: string,
  context: AssemblyContext,
  emittedDefinitions: ReadonlySet<object>,
): readonly JsonObject[] {
  const direct = context.combined.controls.get(id);
  if (Array.isArray(direct)) return ownArrayDataElements(direct).filter(
    (definition): definition is JsonObject => isJsonObject(definition),
  );
  if (hasEmittedAncestor(id, context.poolIndex, context.combined, emittedDefinitions)) return [];
  const nested = context.poolIndex.byId.get(id);
  return nested === undefined ? [] : [nested];
}

interface RootControlEmissionState {
  /** Projizierte Ausgabe — auf die Selektion geprunte Kopien. */
  readonly controls: JsonObject[];
  /**
   * Rückabbildung projizierte Kopie → Originaldefinition.
   *
   * Die Dedup- und Nested-only-Logik dieses Pfads ist identitätsbasiert
   * (`emittedDefinitions`, `nestedOnlyDefinitions` halten Originalknoten).
   * Das Pruning erzeugt aber Kopien; ohne diese Rückabbildung verlöre jede
   * spätere Identitätsprüfung ihren Bezug.
   */
  readonly originalByEmitted: Map<JsonObject, JsonObject>;
  readonly emittedDefinitions: Set<object>;
  readonly nestedOnlyDefinitions: Set<object>;
}

function isDescendantId(
  candidateId: string,
  ancestorId: string,
  index: ReturnType<typeof indexCatalogControls>,
): boolean {
  const visited = new Set<string>();
  let parentId = index.parentOf.get(candidateId);
  while (parentId !== undefined && !visited.has(parentId)) {
    if (parentId === ancestorId) return true;
    visited.add(parentId);
    parentId = index.parentOf.get(parentId);
  }
  return false;
}

function removeEarlierNestedDescendants(
  ancestorId: string,
  context: AssemblyContext,
  state: RootControlEmissionState,
): void {
  for (let index = state.controls.length - 1; index >= 0; index -= 1) {
    const emitted = state.controls[index]!;
    const definition = state.originalByEmitted.get(emitted) ?? emitted;
    if (!state.nestedOnlyDefinitions.has(definition)) continue;
    if (!isDescendantId(readIdOrEmpty(definition), ancestorId, context.poolIndex)) continue;
    state.controls.splice(index, 1);
    state.originalByEmitted.delete(emitted);
    state.emittedDefinitions.delete(definition);
    state.nestedOnlyDefinitions.delete(definition);
  }
}

function emitRootControlId(
  id: string,
  context: AssemblyContext,
  state: RootControlEmissionState,
): void {
  const hasDirectDefinitions = context.combined.controls.has(id);
  removeEarlierNestedDescendants(id, context, state);
  const definitions = definitionsForInsertion(id, context, state.emittedDefinitions);
  for (const definition of ownArrayDataElements(definitions)) {
    if (!isJsonObject(definition) || state.emittedDefinitions.has(definition)) continue;
    state.emittedDefinitions.add(definition);
    if (!hasDirectDefinitions) state.nestedOnlyDefinitions.add(definition);
    const emitted = filterNestedIncluded(
      definition,
      selectionScopeFor(definition, context),
      new Set<object>(),
    );
    state.originalByEmitted.set(emitted, definition);
    state.controls.push(emitted);
  }
}

type RootControlsResult =
  | { readonly ok: true; readonly controls: readonly JsonObject[] }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

function collectRootControls(
  directives: readonly ProfileInsertControls[],
  context: AssemblyContext,
): RootControlsResult {
  const state: RootControlEmissionState = {
    controls: [],
    originalByEmitted: new Map<JsonObject, JsonObject>(),
    emittedDefinitions: new Set<object>(),
    nestedOnlyDefinitions: new Set<object>(),
  };
  for (const directive of directives) {
    const outcome = resolveSelectionIds(context.poolIndex, {
      selection: directive.selection,
      excludeControls: directive.excludeControls,
    });
    if (!outcome.ok) return outcome;
    for (const id of orderedInsertIds(outcome.ids, directive)) {
      emitRootControlId(id, context, state);
    }
  }
  return { ok: true, controls: state.controls };
}

/**
 * Baut das custom-Strukturbild: Gruppen werden mit ihren eigenen
 * insert-controls zusammengesetzt (eingefügte Controls tragen
 * Positions-Labels `<Gruppen-ID>.<n>`), die Anweisungen der Custom-Ebene
 * füllen die Controls auf Catalog-Ebene. Nicht getroffene Selektionen
 * tragen nichts bei und sind kein Fehler.
 */
export function buildCustomGroups(
  request: CustomAssemblyRequest,
  combined: CombinedControls,
): CustomAssemblyResult {
  const requestObject = request as unknown as object;
  const rawGroups = jsonObjectArrayMember(requestObject, 'rawGroups');
  const typedGroups = arrayMember<unknown>(requestObject, 'typedGroups');
  const insertControls = arrayMember<unknown>(requestObject, 'insertControls')
    .map(projectInsertControls);
  const safeCombined = sanitizeCombinedControls(combined);
  // Tiefenbegrenzung am exportierten Rand: Eine 12.000-Ebenen-Kette kann die
  // Klasse-2-Kette nicht passieren (maxDepth 64); statt RangeError wird
  // kontrolliert mit Diagnose abgebrochen.
  if (measureCustomGroupsDepth(rawGroups) > CLASS_2_IMPORT_LIMITS.maxDepth) {
    return {
      ok: false,
      diagnostic: createOscalDiagnostic({
        code: 'PROFILE_RESOLUTION_CUSTOM_DEPTH_LIMIT_EXCEEDED',
        stage: PROFILE_RESOLUTION_STAGE,
        validator: PROFILE_RESOLUTION_VALIDATOR,
        path: '/',
      }),
    };
  }
  // Synthetischer Index über den kombinierten Pool: Die Selektormechanik
  // (with-ids, matching, with-child-controls, Ausschlüsse) verhält sich
  // damit exakt wie in Phase 1 — ein zweiter Selektionscodepfad entsteht
  // nicht. Verschachtelte Kind-Controls eines Pool-Knotens registriert
  // derselbe Tiefendurchlauf, sodass with-child-controls echte Struktur
  // sieht.
  const poolIndex = indexCatalogControls({ pool: { controls: safeCombined.order } });
  const context: AssemblyContext = {
    poolIndex,
    combined: safeCombined,
    selectedIds: resolveSelectedIds(
      collectAllDirectives(typedGroups, insertControls),
      poolIndex,
    ),
  };

  const groupsResult = assembleGroups(rawGroups, typedGroups, context);
  if (!groupsResult.ok) return groupsResult;
  const controlsResult = collectRootControls(insertControls, context);
  if (!controlsResult.ok) return controlsResult;
  return { ok: true, groups: groupsResult.groups, controls: controlsResult.controls };
}
