// =============================================================================
// Resolver-Orchestrator der Profile Resolution — GSPP-291 Commit B
//
// Führt die drei Phasen in festen Reihenfolge über die Profile des
// Auflösungsplans aus: Import (Selektion je Kante) → Merge (combine und
// Strukturierung flat/as-is/custom) → Modify (set-parameter, alters). Die
// Ausgabe ist ausschließlich ein Dokument mit Root-Key `catalog`, das
// vollständig über den kontrollierten Builder erschaffen wird; Rohobjekte
// fremder Herkunft gelangen nie in den Ergebnisgraphen.
//
// Ergebnisvertrag (ADR-2 §10, ADR-8):
// - Eigene Dokument-UUID als UUIDv5 aus dem festen Projektnamensraum und der
//   UUID des obersten, steuernden Profils — deterministisch, damit der
//   Doppel-Lauf byte-identisch bleibt.
// - Eigenes `last-modified` als dokumentierter Stempelzeitpunkt: Ein
//   Wanduhrwert würde die Byte-Identität brechen; die Entstehungsprovenienz
//   tragen stattdessen die beiden Provenienzträger
//   `prop[name='resolution-tool']` und `link[rel='source-profile']`.
//   `source-profile-uuid` wird an keiner Stelle gesetzt.
// - Vertrauensklasse des Ergebnisses ist unveränderlich
//   `class-2-local-user`, auch wenn alle Eingaben Klasse 1 waren.
//
// Projektentscheidungen dieses Moduls:
// - Eine fehlende Merge-Direktive bedeutet `as-is`. Belegt durch die vom BSI
//   veröffentlichten aufgelösten Kataloge, deren Gruppenhierarchie erhalten
//   ist; der Orakelvergleich gegen genau diese Artefakte prüft die Entscheidung.
// - `set-parameter`-Direktiven werden vor Anwendung auf die kebab-case-
//   Schlüssel der Modify-Schicht abgebildet (`depends-on`), denn die
//   Modify-Funktionen lesen Direktivenfelder bewusst deskriptorbasiert.
// - Die Emissionskopie läuft rekursiv; die Tiefe ist durch dieselbe
//   maximale Verschachtelungstiefe begrenzt, die der Entry-Scanner bereits
//   durchgesetzt hat — innerhalb dieser Grenze ist der Stack-Bedarf klein
//   (dieselbe Argumentation wie in der Merge-Phase).
// =============================================================================

import type { JsonObject } from '@/adapters/oscalProfileReaders';
import type { ProfileDocument } from '@/adapters/oscalProfileDocument';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  PROFILE_RESOLUTION_STAGE,
  PROFILE_RESOLUTION_VALIDATOR,
  type ProfileResolutionEdge,
  type ProfileResolutionPlan,
} from './profileResolutionImportGraph';
import {
  applyCombine,
  buildAsIsGroups,
  buildCustomGroups,
  stripNestedChildren,
  type ControlInclusion,
} from './profileResolutionMerge';
import {
  applyAlteration,
  type AlterationDirective,
  applySetParametersToControl,
} from './profileResolutionModify';
import {
  indexCatalogControls,
  isJsonObject,
  ownArrayDataElements,
  ownDataValue,
  resolveSelectionIds,
} from './profileResolutionSelection';
import type { ProfileSetParameter } from './profileModel';
import {
  createOscalDerivedGraph,
  type DerivedGraphValue,
  type DerivedJsonTree,
  type DerivedObjectHandle,
} from './oscalDerivedGraph';
import { processClass2OscalValue } from './oscalObjectPipeline';
import { walkOwnContainers } from './oscalObjectWalk';
import { CLASS_2_IMPORT_LIMITS } from './oscalImportContract';
import {
  deriveUuidV5,
  PROFILE_RESOLUTION_NAMESPACE_UUID,
} from './uuidV5';

/** Stabile Codes der Engine-Ebene (über den Phasencodes). */
export const PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES = Object.freeze({
  /** Merge fehlt oder trägt eine mehrdeutige Strukturdirektive. */
  MERGE_STRUCTURE_UNRESOLVED: 'PROFILE_RESOLUTION_MERGE_STRUCTURE_UNRESOLVED',
  /** combine.method außerhalb use-first/keep. */
  COMBINE_METHOD_INVALID: 'PROFILE_RESOLUTION_COMBINE_METHOD_INVALID',
  /** Ein Import lässt sich keiner Plan-Kante zuordnen. */
  IMPORT_UNMAPPED: 'PROFILE_RESOLUTION_IMPORT_UNMAPPED',
  /** Das steuernde Profil trägt keine verwertbare Dokument-UUID. */
  TOP_PROFILE_UUID_MISSING: 'PROFILE_RESOLUTION_TOP_PROFILE_UUID_MISSING',
  /** Ein aufzulösendes Zwischenprofil trägt keine verwertbare Dokument-UUID. */
  PROFILE_UUID_MISSING: 'PROFILE_RESOLUTION_PROFILE_UUID_MISSING',
  /** Das steuernde Profil wurde nicht als Profilprojektion bereitgestellt. */
  TOP_PROFILE_UNRESOLVED: 'PROFILE_RESOLUTION_TOP_PROFILE_UNRESOLVED',
  /** Ein importiertes Profilziel war bei der Auswertung noch nicht aufgelöst. */
  IMPORT_PROFILE_UNRESOLVED: 'PROFILE_RESOLUTION_IMPORT_PROFILE_UNRESOLVED',
} as const);

/**
 * Stempelzeitpunkt des Ergebnisdokuments. Bewusst konstant: Jeder echte
 * Uhrwert wäre nicht reproduzierbar, und Determinismus ist keine Verifikation
 * — die Herkunft tragen die Provenienzträger, nicht das Datum.
 */
export const PROFILE_RESOLUTION_TIMESTAMP = '1970-01-01T00:00:00.000Z';

export interface ProfileResolutionRequest {
  readonly plan: ProfileResolutionPlan;
  readonly edgesByArtifactKey: ReadonlyMap<string, readonly ProfileResolutionEdge[]>;
  /** Geparste Profilprojektionen nach Artefaktschlüssel (nur Profilwurzeln). */
  readonly profileViews: ReadonlyMap<string, ProfileDocument>;
}

export interface ResolvedCatalogOutput {
  /** Registriertes Wurzelhandle des Builder-Graphen (Dokument mit Root `catalog`). */
  readonly tree: DerivedJsonTree;
  readonly trustClass: 'class-2-local-user';
  readonly oscalVersion: string;
  readonly topProfileArtifactKey: string;
}

export type ProfileResolutionOutcome =
  | { readonly ok: true; readonly output: ResolvedCatalogOutput }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

interface SelectionRecord {
  readonly artifactKey: string;
  readonly ids: ReadonlySet<string>;
  readonly sourceDocument: unknown;
}

function reject(
  code: string,
  path: string,
  artifact?: { readonly key: string; readonly rootType: 'catalog' | 'profile'; readonly oscalVersion: string },
): { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  return {
    ok: false,
    diagnostic: createOscalDiagnostic({
      code,
      stage: PROFILE_RESOLUTION_STAGE,
      validator: PROFILE_RESOLUTION_VALIDATOR,
      path,
      artifact,
    }),
  };
}

function failure(result: { readonly ok: false; readonly diagnostic: OscalDiagnostic }): {
  readonly ok: false;
  readonly diagnostic: OscalDiagnostic;
} {
  return { ok: false, diagnostic: result.diagnostic };
}

/** Ergänzt den geschlossenen Plan-Kontext, ohne die Pipelinestufe umzudeuten. */
function withResolvedCatalogArtifact(
  diagnostic: OscalDiagnostic,
  artifactKey: string,
  oscalVersion: string,
): OscalDiagnostic {
  return createOscalDiagnostic({
    code: diagnostic.code,
    stage: diagnostic.stage,
    validator: diagnostic.validator,
    path: diagnostic.path,
    artifact: { key: artifactKey, rootType: 'catalog', oscalVersion },
    params: diagnostic.params,
  });
}

/** Einzelner plain-object-Körper eines Dokuments (Root-Key-Eintrag). */
function readRootBody(document: unknown): JsonObject {
  if (!isJsonObject(document) || Array.isArray(document)) return {};
  const keys = Reflect.ownKeys(document).filter(
    (key): key is string =>
      typeof key === 'string' &&
      isJsonObject(ownDataValue(document, key)) &&
      !Array.isArray(ownDataValue(document, key)),
  );
  if (keys.length !== 1) return {};
  return ownDataValue(document, keys[0]!) as JsonObject;
}

/**
 * Extrahiert die Raw-Gruppen aus `merge/custom/groups` des Quelldokuments —
 * rein deskriptorbasiert, damit die exakte Kopie unbekannte Mitglieder
 * erhält, die die getypte Projektion nicht kennt.
 */
function readRawCustomGroups(source: unknown): readonly JsonObject[] {
  const body = readRootBody(source);
  const merge = ownDataValue(body, 'merge');
  if (!isJsonObject(merge)) return [];
  const custom = ownDataValue(merge, 'custom');
  if (!isJsonObject(custom)) return [];
  const groups = ownDataValue(custom, 'groups');
  if (!Array.isArray(groups)) return [];
  return ownArrayDataElements(groups).filter((group): group is JsonObject =>
    isJsonObject(group),
  );
}

/**
 * Bildet die kebab-case-Direktivenform ab, die die Modify-Schicht
 * deskriptorbasiert liest; ohne diese Abbildung würde `dependsOn` still
 * fallen (die getypte Projektion trägt camelCase).
 */
function toSetParameterDirective(parameter: ProfileSetParameter): ProfileSetParameter {
  const directive: Record<string, unknown> = {
    paramId: parameter.paramId,
  };
  if (parameter.class !== undefined) directive['class'] = parameter.class;
  if (parameter.dependsOn !== undefined) directive['depends-on'] = parameter.dependsOn;
  if (parameter.label !== undefined) directive['label'] = parameter.label;
  if (parameter.usage !== undefined) directive['usage'] = parameter.usage;
  if (parameter.values !== undefined) directive['values'] = parameter.values;
  // Sammelfelder nur bei echtem Inhalt: Die Projektion trägt stets Arrays
  // (leer statt abwesend); eine leere Anreicherung würde dem Ziel sonst
  // Phantom-Mitglieder injizieren.
  if (parameter.props.length > 0) directive['props'] = parameter.props;
  if (parameter.links.length > 0) directive['links'] = parameter.links;
  return directive as unknown as ProfileSetParameter;
}

function optionalString(node: JsonObject, key: string): string | undefined {
  const value = ownDataValue(node, key);
  return typeof value === 'string' ? value : undefined;
}

/** Paare aus Raw-Schlüssel (kebab-case) und Direktivenschlüssel. */
type MemberPair = readonly [rawKey: string, directiveKey: string];

const ALTERATION_STRING_MEMBERS: readonly MemberPair[] = [
  ['position', 'position'],
  ['by-id', 'byId'],
  ['title', 'title'],
] as const;

const ALTERATION_LIST_MEMBERS: readonly MemberPair[] = [
  ['params', 'params'],
  ['props', 'props'],
  ['links', 'links'],
  ['parts', 'parts'],
] as const;

const REMOVAL_STRING_MEMBERS: readonly MemberPair[] = [
  ['by-name', 'byName'],
  ['by-class', 'byClass'],
  ['by-id', 'byId'],
  ['by-item-name', 'byItemName'],
  ['by-ns', 'byNs'],
] as const;

/**
 * Projiziert die tabellierten Mitglieder eines Rohknotens in ein neues
 * Direktivenobjekt — nur vorhandene Werte, keine Phantom-Mitglieder.
 */
function projectMembers(
  source: JsonObject,
  stringPairs: readonly MemberPair[],
  listPairs: readonly MemberPair[],
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const [rawKey, directiveKey] of stringPairs) {
    const value = ownDataValue(source, rawKey);
    if (typeof value === 'string') projected[directiveKey] = value;
  }
  for (const [rawKey, directiveKey] of listPairs) {
    const value = ownDataValue(source, rawKey);
    if (Array.isArray(value)) projected[directiveKey] = value;
  }
  return projected;
}

function objectEntriesOf(node: JsonObject, key: string): JsonObject[] {
  const value = ownDataValue(node, key);
  if (!Array.isArray(value)) return [];
  return ownArrayDataElements(value).filter((entry): entry is JsonObject =>
    isJsonObject(entry),
  );
}

/**
 * Bildet einen Raw-`alter`-Knoten auf die Loose-Direktivenform der
 * Modify-Schicht ab (`by-id` → `byId` usw.). Bewusst aus dem QUELLDOKUMENT
 * und nicht aus der Projektion: Die verlustfreie Projektion ergänzt leere
 * Sammelfelder, die als Phantom-Mitglieder im Ergebnisdokument enden
 * würden.
 */
function toAlterationDirective(alterNode: JsonObject): AlterationDirective {
  const controlId = optionalString(alterNode, 'control-id');
  return {
    ...(controlId !== undefined && { controlId }),
    adds: objectEntriesOf(alterNode, 'adds').map(
      (entry) => projectMembers(entry, ALTERATION_STRING_MEMBERS, ALTERATION_LIST_MEMBERS) as NonNullable<AlterationDirective['adds']>[number],
    ),
    // Das Schema kennt ausschließlich `removes` (Plural); ein Singular-Key
    // existiert nicht — Stille hier würde Remove-Anweisungen verlieren
    // (Orakelbefund WLAN: alter verschiebt ASST.2.2_gdn per removes+adds).
    removes: objectEntriesOf(alterNode, 'removes').map(
      (entry) => projectMembers(entry, REMOVAL_STRING_MEMBERS, []) as NonNullable<AlterationDirective['removes']>[number],
    ),
  };
}

/**
 * Liest die Raw-`alter`-Knoten aus dem Quelldokument in Quellreihenfolge.
 */
function readRawAlters(source: unknown): readonly JsonObject[] {
  const body = readRootBody(source);
  const modify = ownDataValue(body, 'modify');
  if (!isJsonObject(modify)) return [];
  return objectEntriesOf(modify, 'alters');
}

type ControlTransform = (control: JsonObject) => JsonObject;

function identity(control: JsonObject): JsonObject {
  return control;
}

/**
 * Flache Kopie über Data-Property-Deskriptoren mit Ausschlussliste —
 * Accessor-Slots erscheinen als abwesend, Schlüsselordnung bleibt erhalten.
 */
function copyOwnDataMembersSkipping(node: JsonObject, skipKeys: readonly string[]): JsonObject {
  const skip = new Set(skipKeys);
  const copy: JsonObject = {};
  for (const key of Reflect.ownKeys(node)) {
    if (typeof key === 'string' && !skip.has(key)) {
      const value = ownDataValue(node, key);
      if (value !== undefined) copy[key] = value;
    }
  }
  return copy;
}

function createControlTransform(
  setParameters: readonly ProfileSetParameter[],
  altersByControlId: ReadonlyMap<string, readonly AlterationDirective[]>,
): ControlTransform {
  if (setParameters.length === 0 && altersByControlId.size === 0) return identity;

  const controlIdOf = (control: JsonObject): string | null => {
    const id = ownDataValue(control, 'id');
    return typeof id === 'string' ? id : null;
  };

  const applyShallow = (control: JsonObject): JsonObject => {
    let transformed = applySetParametersToControl(control, setParameters);
    const id = controlIdOf(transformed);
    if (id === null) return transformed;
    const alterations = altersByControlId.get(id);
    if (alterations === undefined) return transformed;
    for (const alteration of alterations) {
      transformed = applyAlteration(transformed, alteration);
    }
    return transformed;
  };

  // Modify wirkt auf die ganze Control-Hierarchie: verschachtelte
  // Subcontrols werden mit derselben Transformation behandelt. Die
  // Rekursionstiefe ist durch die Entry-Scanner-Grenze gedeckt.
  const applyDeep = (control: JsonObject): JsonObject => {
    const transformed = applyShallow(control);
    const children = ownDataValue(transformed, 'controls');
    if (Array.isArray(children)) {
      transformed['controls'] = ownArrayDataElements(children).map((child) =>
        isJsonObject(child) ? applyDeep(child) : child,
      );
    }
    return transformed;
  };
  return applyDeep;
}

/**
 * Wendet den Transform auf alle Controls einer Gruppenliste an. Die Gruppen-
 * Container sind frische Erzeugnisse der Merge-Phase und dürfen deshalb
 * in-place umgeschrieben werden — die Eingabedokumente bleiben unangetastet.
 * Der Stack trägt die Verschachtelungstiefe (keine Rekursion).
 */
function applyTransformToGroups(groups: readonly JsonObject[], transform: ControlTransform): void {
  const stack: JsonObject[] = [...groups];
  while (stack.length > 0) {
    const group = stack.pop()!;
    const controls = ownDataValue(group, 'controls');
    if (Array.isArray(controls)) {
      group['controls'] = ownArrayDataElements(controls).map((child) =>
        isJsonObject(child) ? transform(child) : child,
      );
    }
    const nested = ownDataValue(group, 'groups');
    if (Array.isArray(nested)) {
      for (const child of ownArrayDataElements(nested)) {
        if (isJsonObject(child)) stack.push(child);
      }
    }
  }
}

/**
 * Emissionskopie eines geprüften Werts in den Builder-Graphen. Liest nur
 * über Data-Property-Deskriptoren (Accessor-Slots erscheinen als abwesend),
 * erhält Schlüsselordnung und Arrayindizes und nimmt keine fremden Container
 * an. Die Rekursionstiefe ist durch die Entry-Scanner-Grenze gedeckt.
 */
function emitValue(graph: ReturnType<typeof createOscalDerivedGraph>, value: unknown, depth: number): DerivedGraphValue {
  if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) {
    throw new TypeError('Emissionstiefe überschreitet die geprüfte Dokumenttiefe');
  }
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (typeof value !== 'object') {
    throw new TypeError('Emissionswert ist kein unterstützter JSON-Wert');
  }

  if (Array.isArray(value)) {
    const handle = graph.array();
    for (const element of ownArrayDataElements(value)) {
      graph.pushArrayItem(handle, emitValue(graph, element, depth + 1));
    }
    return handle;
  }

  const handle = graph.object();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') continue;
    const member = ownDataValue(value, key);
    if (member === undefined) continue;
    graph.setObjectMember(handle, key, emitValue(graph, member, depth + 1));
  }
  return handle;
}

interface SingleProfileInput {
  readonly artifactKey: string;
  readonly document: ProfileDocument;
  readonly plan: Extract<ProfileResolutionPlan, { ok: true }>;
  readonly edgesByArtifactKey: ReadonlyMap<string, readonly ProfileResolutionEdge[]>;
  readonly resolvedByArtifact: ReadonlyMap<string, unknown>;
}

type PhaseOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };

function selectedControlNodes(
  index: ReturnType<typeof indexCatalogControls>,
  ids: ReadonlySet<string>,
): JsonObject[] {
  const controls: JsonObject[] = [];
  for (const id of ids) {
    const node = index.byId.get(id);
    if (node !== undefined) controls.push(node);
  }
  return controls;
}

/** Phase 1 — Selektion je Import gegen sein Quelldokument. */
function collectPhaseOne(
  input: SingleProfileInput,
): PhaseOutcome<{ records: SelectionRecord[]; inclusions: ControlInclusion[]; consumedResourceUuids: Set<string> }> {
  const records: SelectionRecord[] = [];
  const inclusions: ControlInclusion[] = [];
  const consumedResourceUuids = new Set<string>();

  for (const profileImport of input.document.view.imports) {
    const href = profileImport.href;
    if (href === undefined) {
      return reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_UNMAPPED, profileImport.path);
    }
    const edge = (input.edgesByArtifactKey.get(input.artifactKey) ?? []).find(
      (candidate) => candidate.href === href,
    );
    if (edge === undefined) {
      return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_UNMAPPED, profileImport.path));
    }

    const resolvedSource = input.resolvedByArtifact.get(edge.artifactKey);
    const plannedSource = input.plan.documents.get(edge.artifactKey);
    if (
      resolvedSource === undefined &&
      input.plan.rootTypesByArtifactKey.get(edge.artifactKey) === 'profile'
    ) {
      return failure(reject(
        PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_PROFILE_UNRESOLVED,
        profileImport.path,
      ));
    }
    const sourceDocument = resolvedSource ?? plannedSource;
    if (sourceDocument === undefined) {
      return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_UNMAPPED, profileImport.path));
    }

    const index = indexCatalogControls(sourceDocument);
    const outcome = resolveSelectionIds(index, {
      selection: profileImport.selection,
      excludeControls: profileImport.excludeControls,
    });
    if (!outcome.ok) return outcome;

    const controls = selectedControlNodes(index, outcome.ids);
    records.push({ artifactKey: edge.artifactKey, ids: outcome.ids, sourceDocument });
    if (href.startsWith('#')) {
      consumedResourceUuids.add(href.slice(1).toLowerCase());
    }
    inclusions.push({ documentKey: edge.artifactKey, controls });
  }
  return { ok: true, value: { records, inclusions, consumedResourceUuids } };
}

/** Führt die as-is-Filterung je Quelldokument in Importreihenfolge zusammen. */
function collectAsIsOutput(records: readonly SelectionRecord[]): {
  groups: JsonObject[];
  controls: JsonObject[];
} {
  const groups: JsonObject[] = [];
  const controls: JsonObject[] = [];
  const append = (candidates: readonly unknown[], target: JsonObject[]): void => {
    for (const candidate of candidates) {
      if (isJsonObject(candidate)) target.push(candidate);
    }
  };
  for (const record of records) {
    const filtered = buildAsIsGroups(readRootBody(record.sourceDocument), record.ids);
    const filteredGroups = ownDataValue(filtered, 'groups');
    const filteredControls = ownDataValue(filtered, 'controls');
    if (Array.isArray(filteredGroups)) append(filteredGroups, groups);
    if (Array.isArray(filteredControls)) append(filteredControls, controls);
  }
  return { groups, controls };
}

/** Phase 2 — combine-Richtung und Strukturdirektive. */
function buildStructuredOutput(
  input: SingleProfileInput,
  records: readonly SelectionRecord[],
  inclusions: readonly ControlInclusion[],
): PhaseOutcome<{ groups: JsonObject[]; controls: JsonObject[] }> {
  const merge = input.document.view.merge;
  const declaredMethod = merge?.combine?.method ?? 'use-first';
  if (declaredMethod !== 'use-first' && declaredMethod !== 'keep') {
    return reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.COMBINE_METHOD_INVALID, merge?.path ?? '/');
  }
  const combined = applyCombine(inclusions, declaredMethod);

  // Fehlende Merge-Direktive bedeutet as-is (Projektentscheidung, siehe
  // Modulkopf).
  if (merge === null) {
    return { ok: true, value: collectAsIsOutput(records) };
  }

  switch (merge.structure.kind) {
    case 'flat': {
      const flatControls = combined.order.map(stripNestedChildren);
      return { ok: true, value: { groups: [], controls: flatControls } };
    }
    case 'as-is':
      return { ok: true, value: collectAsIsOutput(records) };
    case 'custom': {
      const assembly = buildCustomGroups(
        {
          rawGroups: readRawCustomGroups(input.document.source),
          typedGroups: merge.structure.custom.groups,
          insertControls: merge.structure.custom.insertControls,
        },
        combined,
      );
      if (!assembly.ok) return assembly;
      return {
        ok: true,
        value: { groups: [...assembly.groups], controls: [...assembly.controls] },
      };
    }
    default:
      return reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.MERGE_STRUCTURE_UNRESOLVED, merge.path);
  }
}

/** Phase 3 — Modify-Direktiven als Transformation über alle platzierten Controls. */
function collectModifyTransform(document: ProfileDocument): ControlTransform {
  const setParameters = (document.view.modify?.setParameters ?? []).map(toSetParameterDirective);
  const altersByControlId = new Map<string, AlterationDirective[]>();
  for (const alterNode of readRawAlters(document.source)) {
    const directive = toAlterationDirective(alterNode);
    if (directive.controlId === undefined) continue;
    const bucket = altersByControlId.get(directive.controlId) ?? [];
    bucket.push(directive);
    altersByControlId.set(directive.controlId, bucket);
  }
  return createControlTransform(setParameters, altersByControlId);
}

/**
 * Baut das Metadaten-Handle: ererbte Mitglieder (ohne werkzeugspezifische
 * Felder), danach Stempel, gebundene OSCAL-Version und die beiden
 * Provenienzträger. Die Dokument-UUID gehört schema-gemäß an `catalog.uuid`,
 * nicht in die Metadaten.
 */
function emitMetadataHandle(
  graph: ReturnType<typeof createOscalDerivedGraph>,
  sourceMetadata: JsonObject,
  oscalVersion: string,
  topUuid: string,
): DerivedObjectHandle {
  const inheritedMetadata = copyOwnDataMembersSkipping(sourceMetadata, [
    'uuid',
    'last-modified',
    'oscal-version',
    'props',
    'links',
  ]);
  const metadataHandle = emitValue(graph, inheritedMetadata, 0) as DerivedObjectHandle;
  graph.setObjectMember(metadataHandle, 'last-modified', PROFILE_RESOLUTION_TIMESTAMP);
  graph.setObjectMember(metadataHandle, 'oscal-version', oscalVersion);

  const propsHandle = emitCarrierEntries(graph, ownDataValue(sourceMetadata, 'props'));
  const toolProp = graph.object();
  graph.setObjectMember(toolProp, 'name', 'resolution-tool');
  graph.setObjectMember(toolProp, 'value', `${PROFILE_RESOLUTION_VALIDATOR.name}@${PROFILE_RESOLUTION_VALIDATOR.version}`);
  graph.pushArrayItem(propsHandle, toolProp);
  graph.setObjectMember(metadataHandle, 'props', propsHandle);

  const linksHandle = emitCarrierEntries(graph, ownDataValue(sourceMetadata, 'links'));
  const sourceLink = graph.object();
  graph.setObjectMember(sourceLink, 'rel', 'source-profile');
  graph.setObjectMember(sourceLink, 'href', `urn:uuid:${topUuid}`);
  graph.pushArrayItem(linksHandle, sourceLink);
  graph.setObjectMember(metadataHandle, 'links', linksHandle);

  return metadataHandle;
}

/** Trägerliste: ererbte Einträge gefolgt vom projektspezifischen. */
function emitCarrierEntries(
  graph: ReturnType<typeof createOscalDerivedGraph>,
  inherited: unknown,
): ReturnType<typeof graph.array> {
  const handle = graph.array();
  if (Array.isArray(inherited)) {
    for (const entry of ownArrayDataElements(inherited)) {
      if (isJsonObject(entry)) graph.pushArrayItem(handle, emitValue(graph, entry, 1));
    }
  }
  return handle;
}

/**
 * Back-matter fortgeführt MINUS die als Importbindung verbrauchten
 * Ressourcen; ohne verbleibende Ressourcen entfällt das Mitglied.
 */
function filteredBackMatter(
  sourceBody: JsonObject,
  consumedResourceUuids: ReadonlySet<string>,
): JsonObject | null {
  const backMatter = ownDataValue(sourceBody, 'back-matter');
  if (!isJsonObject(backMatter)) return null;

  const resources = ownDataValue(backMatter, 'resources');
  if (!Array.isArray(resources)) return { ...backMatter };

  const kept = ownArrayDataElements(resources).filter((entry) => {
    if (!isJsonObject(entry)) return true;
    const uuid = ownDataValue(entry, 'uuid');
    return !(typeof uuid === 'string' && consumedResourceUuids.has(uuid.toLowerCase()));
  });
  const filtered: JsonObject = { ...backMatter, resources: kept };
  if (kept.length === 0) delete filtered['resources'];
  return filtered;
}

const RESOURCE_FRAGMENT_PATTERN = /#([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/gi;

/** Sammelt UUID-Fragmente aus allen Stringwerten ohne Accessors auszuführen. */
function collectReferencedResourceUuids(values: readonly unknown[]): Set<string> {
  const referenced = new Set<string>();
  walkOwnContainers(values, (container) => {
    for (const key of Reflect.ownKeys(container)) {
      const descriptor = Object.getOwnPropertyDescriptor(container, key);
      if (descriptor === undefined || !('value' in descriptor)) continue;
      if (typeof descriptor.value !== 'string') continue;
      for (const match of descriptor.value.matchAll(RESOURCE_FRAGMENT_PATTERN)) {
        referenced.add(match[1]!.toLowerCase());
      }
    }
    return true;
  });
  return referenced;
}

/** Übernimmt referenzierte Quellressourcen in stabiler Import-/Quellordnung. */
function referencedSourceResources(
  records: readonly SelectionRecord[],
  referencedUuids: ReadonlySet<string>,
): JsonObject[] {
  const resources: JsonObject[] = [];
  for (const record of records) {
    const sourceBody = readRootBody(record.sourceDocument);
    const backMatter = ownDataValue(sourceBody, 'back-matter');
    if (!isJsonObject(backMatter)) continue;
    const sourceResources = ownDataValue(backMatter, 'resources');
    if (!Array.isArray(sourceResources)) continue;
    for (const resource of ownArrayDataElements(sourceResources)) {
      if (!isJsonObject(resource)) continue;
      const uuid = ownDataValue(resource, 'uuid');
      if (typeof uuid === 'string' && referencedUuids.has(uuid.toLowerCase())) {
        resources.push(resource);
      }
    }
  }
  return resources;
}

/** Ergänzt Quellressourcen, bis kein mitgeführter Fragmentverweis mehr fehlt. */
function referencedSourceResourcesAtFixpoint(
  records: readonly SelectionRecord[],
  initialReferencedUuids: ReadonlySet<string>,
): JsonObject[] {
  const referencedUuids = new Set(initialReferencedUuids);
  let resources = referencedSourceResources(records, referencedUuids);

  while (true) {
    const discoveredUuids = collectReferencedResourceUuids(resources);
    let changed = false;
    for (const uuid of discoveredUuids) {
      if (referencedUuids.has(uuid)) continue;
      referencedUuids.add(uuid);
      changed = true;
    }
    if (!changed) return resources;
    resources = referencedSourceResources(records, referencedUuids);
  }
}

/** Entfernt UUID-Duplikate case-insensitiv; die erste Quelle gewinnt stabil. */
function uniqueResources(resources: readonly JsonObject[]): JsonObject[] {
  const seenUuids = new Set<string>();
  const unique: JsonObject[] = [];
  for (const resource of resources) {
    const uuid = ownDataValue(resource, 'uuid');
    if (typeof uuid === 'string') {
      const normalizedUuid = uuid.toLowerCase();
      if (seenUuids.has(normalizedUuid)) continue;
      seenUuids.add(normalizedUuid);
    }
    unique.push(resource);
  }
  return unique;
}

/** Verschmilzt referenzierte Quellressourcen mit unverbrauchtem Profil-Back-matter. */
function mergedBackMatter(
  profileBackMatter: JsonObject | null,
  records: readonly SelectionRecord[],
  referencedUuids: ReadonlySet<string>,
): JsonObject | null {
  const profileResources = isJsonObject(profileBackMatter)
    ? ownDataValue(profileBackMatter, 'resources')
    : undefined;
  const resources = uniqueResources([
    ...referencedSourceResourcesAtFixpoint(records, referencedUuids),
    ...(Array.isArray(profileResources)
      ? ownArrayDataElements(profileResources).filter(isJsonObject)
      : []),
  ]);
  const merged = profileBackMatter === null
    ? {}
    : copyOwnDataMembersSkipping(profileBackMatter, ['resources']);
  if (resources.length > 0) merged['resources'] = resources;
  return Object.keys(merged).length > 0 ? merged : null;
}

interface ResolvedCatalogEmission {
  readonly plan: Extract<ProfileResolutionPlan, { ok: true }>;
  readonly document: ProfileDocument;
  readonly topUuid: string;
  readonly derivedUuid: string;
  readonly groups: readonly JsonObject[];
  readonly controls: readonly JsonObject[];
  readonly records: readonly SelectionRecord[];
  readonly consumedResourceUuids: ReadonlySet<string>;
}

/**
 * Emittiert das Ergebnis ausschließlich über den kontrollierten Builder.
 * Metadaten und unverbrauchtes Profil-Back-matter bleiben erhalten;
 * referenzierte Quellressourcen werden davor in stabiler Import- und
 * Quellreihenfolge ergänzt. Die Dokument-UUID steht an `catalog.uuid`.
 */
function emitResolvedCatalog(input: ResolvedCatalogEmission): DerivedJsonTree {
  const {
    plan,
    document,
    topUuid,
    derivedUuid,
    groups,
    controls,
    records,
    consumedResourceUuids,
  } = input;
  const graph = createOscalDerivedGraph();

  const sourceBody = readRootBody(document.source);
  const sourceMetadataValue = ownDataValue(sourceBody, 'metadata');
  const sourceMetadata = isJsonObject(sourceMetadataValue) ? sourceMetadataValue : {};
  const metadataHandle = emitMetadataHandle(
    graph,
    sourceMetadata,
    plan.oscalVersion,
    topUuid,
  );

  const bodyHandle = graph.object();
  graph.setObjectMember(bodyHandle, 'uuid', derivedUuid);
  graph.setObjectMember(bodyHandle, 'metadata', metadataHandle);
  if (groups.length > 0) {
    graph.setObjectMember(bodyHandle, 'groups', emitValue(graph, groups, 0));
  }
  if (controls.length > 0) {
    graph.setObjectMember(bodyHandle, 'controls', emitValue(graph, controls, 0));
  }
  const profileBackMatter = filteredBackMatter(sourceBody, consumedResourceUuids);
  const referencedUuids = collectReferencedResourceUuids([
    sourceMetadata,
    groups,
    controls,
    profileBackMatter,
  ]);
  const backMatter = mergedBackMatter(
    profileBackMatter,
    records,
    referencedUuids,
  );
  if (backMatter !== null) {
    graph.setObjectMember(bodyHandle, 'back-matter', emitValue(graph, backMatter, 0));
  }

  const rootHandle = graph.object();
  graph.setObjectMember(rootHandle, 'catalog', bodyHandle);
  return graph.finishRoot(rootHandle);
}

function resolveSingleProfile(input: SingleProfileInput): { readonly ok: true; readonly tree: DerivedJsonTree } | { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  const phaseOne = collectPhaseOne(input);
  if (!phaseOne.ok) return failure(phaseOne);

  const structured = buildStructuredOutput(input, phaseOne.value.records, phaseOne.value.inclusions);
  if (!structured.ok) return failure(structured);

  const transform = collectModifyTransform(input.document);
  const groups = structured.value.groups;
  const controls = structured.value.controls.map(transform);
  applyTransformToGroups(groups, transform);

  // Interne Fragment-Links werden bewusst NICHT beschnitten: Das
  // unabhängige NIST-Orakel behält Verweise auf nicht aufgelöste Ziele
  // (pm-9/pm-24 in der LOW-Baseline), während das BSI-Werkzeug sie
  // entfernt (#SENS.8.6 in lieferkette). Die Werkzeuge widersprechen sich;
  // ADR-2-Verlustlosigkeit und das unabhängigere Orakel entscheiden — die
  // verbleibende BSI-Differenz ist als bekannte Differenz im Harniss
  // laut registriert und dem Review zur Entscheidung vorgelegt.

  const profileUuid = input.document.view.uuid;
  if (profileUuid === undefined) {
    const isTopProfile = input.artifactKey === input.plan.topProfileArtifactKey;
    return failure(reject(
      isTopProfile
        ? PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.TOP_PROFILE_UUID_MISSING
        : PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.PROFILE_UUID_MISSING,
      '/uuid',
      {
        key: input.artifactKey,
        rootType: 'profile',
        oscalVersion: input.plan.oscalVersion,
      },
    ));
  }
  const derivedUuid = deriveUuidV5(PROFILE_RESOLUTION_NAMESPACE_UUID, profileUuid);

  return {
    ok: true,
    tree: emitResolvedCatalog({
      plan: input.plan,
      document: input.document,
      topUuid: profileUuid,
      derivedUuid,
      groups,
      controls,
      records: phaseOne.value.records,
      consumedResourceUuids: phaseOne.value.consumedResourceUuids,
    }),
  };
}

/**
 * Löst den gesamten Postorder-Plan vorwärts auf: Jedes importierte Profil
 * steht vor allen Importeuren und ist deshalb beim Zugriff bereits fertig.
 */
export async function resolveProfile(
  request: ProfileResolutionRequest,
): Promise<ProfileResolutionOutcome> {
  const plan = request.plan;
  if (!plan.ok) return { ok: false, diagnostic: plan.diagnostic };

  const resolvedByArtifact = new Map<string, unknown>();
  for (const artifactKey of plan.order) {
    const document = request.profileViews.get(artifactKey);
    if (document === undefined) continue;

    const outcome = resolveSingleProfile({
      artifactKey,
      document,
      plan,
      edgesByArtifactKey: request.edgesByArtifactKey,
      resolvedByArtifact,
    });
    if (!outcome.ok) return failure(outcome);
    const validated = await processClass2OscalValue(outcome.tree, {
      trustClass: 'class-2-local-user',
    });
    if (!validated.ok) {
      return failure({
        ok: false,
        diagnostic: withResolvedCatalogArtifact(
          validated.diagnostic,
          artifactKey,
          plan.oscalVersion,
        ),
      });
    }
    resolvedByArtifact.set(artifactKey, outcome.tree);
  }

  const topLevel = plan.topProfileArtifactKey;
  if (!resolvedByArtifact.has(topLevel)) {
    return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.TOP_PROFILE_UNRESOLVED, '/'));
  }
  return {
    ok: true,
    output: {
      tree: resolvedByArtifact.get(topLevel)! as DerivedJsonTree,
      trustClass: 'class-2-local-user',
      oscalVersion: plan.oscalVersion,
      topProfileArtifactKey: topLevel,
    },
  };
}
