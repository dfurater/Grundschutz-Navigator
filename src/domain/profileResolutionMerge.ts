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
import type { ProfileGroup, ProfileInsertControls } from './profileModel';
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

/** Entfernt verschachtelte Kinder (controls, groups) für echte Flachdarstellung. */
export function stripNestedChildren(node: JsonObject): JsonObject {
  const copy: JsonObject = {};
  for (const key of Object.keys(node)) {
    if (key === 'controls' || key === 'groups') continue;
    const value = node[key];
    copy[key] = value;
  }
  return copy;
}

/** Flache Ausgabe: kombinierte Controls direkt unter catalog. */
export function buildFlatControls(combined: CombinedControls): JsonObject {
  return {
    controls: combined.order.map(stripNestedChildren),
  };
}

/**
 * Filtert einen inkludierten Control-Knoten auf seinen inkludierten
 * Nachfahrenbaum; nicht inkludierte Zwischenebenen lösen sich dabei ebenso
 * auf wie an der Gruppenoberkante — ihre inkludierten Nachfahren werden
 * unverhüllt hinter die direkten Treffer gereiht.
 */
function filterNestedIncluded(
  control: JsonObject,
  includedIds: ReadonlySet<string>,
): JsonObject {
  const copy: JsonObject = { ...control };
  const kept: JsonObject[] = [];
  const promoted: JsonObject[] = [];
  // Nur setzen, wenn es gefilterte Kinder gibt — keine leeren controls:[]
  // in Blättern injizieren (Gitar-Hinweis zu bce6b68).
  const children = safeArrayMember(control, 'controls') ?? [];
  for (const child of ownArrayDataElements(children)) {
    if (!isJsonObject(child)) continue;
    if (includedIds.has(readIdOrEmpty(child))) {
      kept.push(filterNestedIncluded(child, includedIds));
    } else {
      promoted.push(...promotedControls(child, includedIds));
    }
  }
  delete copy['controls'];
  if (kept.length + promoted.length > 0) copy['controls'] = [...kept, ...promoted];
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
): JsonObject[] {
  const kept: JsonObject[] = [];
  const excludedBranches: JsonObject[] = [];
  collectIncludedAndExcludedChildren(control, includedIds, kept, excludedBranches);
  for (const branch of excludedBranches) {
    kept.push(...promotedControls(branch, includedIds));
  }
  return kept;
}

/** Sortiert die Kinder eines Zweigs in direkte Treffer und Ausschluss-Zweige. */
function collectIncludedAndExcludedChildren(
  control: JsonObject,
  includedIds: ReadonlySet<string>,
  kept: JsonObject[],
  excludedBranches: JsonObject[],
): void {
  const children = safeArrayMember(control, 'controls');
  if (children === undefined) return;
  for (const child of ownArrayDataElements(children)) {
    if (!isJsonObject(child)) continue;
    if (includedIds.has(readIdOrEmpty(child))) {
      kept.push(filterNestedIncluded(child, includedIds));
    } else {
      excludedBranches.push(child);
    }
  }
}


/**
 * Reproduziert die Quellhierarchie für as-is: Gruppen erscheinen, solange
 * sie eine inkludierte Control halten (Non-Control-Kinder intakt);
 * inkludierte Controls unter nicht inkludierten Parents werden rekursiv
 * hochgelevelt.
 */
/** Misst die maximale Gruppen-Schachtelungstiefe iterativ. */
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
    const nestedGroups = safeArrayMember(node, 'groups');
    if (nestedGroups !== undefined) {
      for (const group of ownArrayDataElements(nestedGroups)) {
        if (isJsonObject(group)) {
          stack.push({ node: group, depth: depth + 1 });
        }
      }
    }
  }
  return maxDepth;
}

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
  if (safeArrayMember(containerNode, 'controls') === undefined) return;
  const kept: JsonObject[] = [];
  const excludedBranches: JsonObject[] = [];
  collectIncludedAndExcludedChildren(containerNode, includedIds, kept, excludedBranches);
  // Phase 1 vor Phase 2 (Orakelordnung am BSI-Korpus: KONF.2.7 steht vor
  // dem hochgelevelten KONF.2.4.2).
  controls.push(...kept);
  for (const branch of excludedBranches) {
    controls.push(...promotedControls(branch, includedIds));
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
      const merged: JsonObject = { ...group };
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
  const sourcePropsValue = ownDataValue(control, 'props');
  const sourceProps = Array.isArray(sourcePropsValue) ? [...sourcePropsValue] : [];
  const copy: JsonObject = { ...control, props: [{ name: 'label', value: label }, ...sourceProps] };

  const partsValue = ownDataValue(control, 'parts');
  if (Array.isArray(partsValue)) {
    copy['parts'] = [...partsValue].sort(byPartId);
  }

  const childrenValue = ownDataValue(control, 'controls');
  if (Array.isArray(childrenValue)) {
    copy['controls'] = ownArrayDataElements(childrenValue).map((child, index) =>
      isJsonObject(child) ? withPositionalLabels(child, `${label}.${index + 1}`) : child,
    );
  }
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
        placed.push(withPositionalLabels(definition, `${groupId}.${placed.length + 1}`));
      }
    }
  }
  return { ok: true, placed };
}

interface AssemblyContext {
  readonly poolIndex: ReturnType<typeof indexCatalogControls>;
  readonly combined: CombinedControls;
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
function assembleGroups(
  rawGroups: readonly JsonObject[],
  typedGroups: readonly ProfileGroup[],
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
  typed: ProfileGroup | undefined,
  context: AssemblyContext,
): { readonly ok: true; readonly group: JsonObject } | { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  const copy = copyCustomGroup(raw);

  // Die Projektion liest dasselbe Array in derselben Ordnung; bei einer
  // Abweichung (sollte unmöglich sein) bleibt die Gruppe ohne Direktiven.
  if (typed?.id !== undefined && typed.insertControls.length > 0) {
    const placed = assembleGroupControls(typed.id, typed.insertControls, context, new Set<object>());
    if (!placed.ok) return placed;
    if (placed.placed.length > 0) {
      copy['controls'] = placed.placed;
    }
  }

  const nestedFailure = attachNestedGroups(copy, raw, typed, context);
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
  typed: ProfileGroup | undefined,
  context: AssemblyContext,
): { readonly ok: false; readonly diagnostic: OscalDiagnostic } | null {
  const nestedRawValue = ownDataValue(raw, 'groups');
  if (!Array.isArray(nestedRawValue)) return null;

  const nestedRaw = ownArrayDataElements(nestedRawValue).filter(
    (child): child is JsonObject => isJsonObject(child),
  );
  const nestedResult = assembleGroups(nestedRaw, typed?.groups ?? [], context);
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

/**
 * Baut das custom-Strukturbild: Gruppen werden mit ihren eigenen
 * insert-controls zusammengesetzt (eingefügte Controls tragen
 * Positions-Labels `<Gruppen-ID>.<n>`), die Anweisungen der Custom-Ebene
 * füllen die Controls auf Catalog-Ebene. Nicht getroffene Selektionen
 * tragen nichts bei und sind kein Fehler.
 */
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
    for (const group of groups) {
      const nested = ownDataValue(group, 'groups');
      if (Array.isArray(nested)) {
        const nestedGroups = ownArrayDataElements(nested).filter(
          (child): child is JsonObject => isJsonObject(child),
        );
        if (nestedGroups.length > 0) {
          stack.push({ groups: nestedGroups, depth: depth + 1 });
        }
      }
    }
  }
  return maxDepth;
}

export function buildCustomGroups(
  request: CustomAssemblyRequest,
  combined: CombinedControls,
): CustomAssemblyResult {
  // Tiefenbegrenzung am exportierten Rand: Eine 12.000-Ebenen-Kette kann die
  // Klasse-2-Kette nicht passieren (maxDepth 64); statt RangeError wird
  // kontrolliert mit Diagnose abgebrochen.
  if (measureCustomGroupsDepth(request.rawGroups) > CLASS_2_IMPORT_LIMITS.maxDepth) {
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
  const context: AssemblyContext = {
    poolIndex: indexCatalogControls({ pool: { controls: [...combined.order] } }),
    combined,
  };

  const groupsResult = assembleGroups(request.rawGroups, request.typedGroups, context);
  if (!groupsResult.ok) return groupsResult;

  const controls: JsonObject[] = [];
  const emittedDefinitions = new Set<object>();
  for (const directive of request.insertControls) {
    const outcome = resolveSelectionIds(context.poolIndex, {
      selection: directive.selection,
      excludeControls: directive.excludeControls,
    });
    if (!outcome.ok) return outcome;

    for (const id of orderedInsertIds(outcome.ids, directive)) {
      // Fehlt einer selektierten ID ihr eigener Definitions-Bucket, steckt
      // sie bereits vollständig im Baum eines mitausgegebenen Vorfahren
      // (Gitar-Hinweis zu 7fe9880): Ihre Definition würde sonst doppelt
      // erscheinen. Ein eigener Bucket existiert genau dann, wenn das
      // Dokument den Knoten einzeln trägt — er wird dann ausgegeben.
      for (const definition of combined.controls.get(id) ?? []) {
        if (emittedDefinitions.has(definition)) continue;
        emittedDefinitions.add(definition);
        controls.push(definition);
      }
    }
  }

  return { ok: true, groups: groupsResult.groups, controls };
}
