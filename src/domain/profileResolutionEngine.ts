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

function reject(code: string, path: string): { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  return {
    ok: false,
    diagnostic: createOscalDiagnostic({
      code,
      stage: PROFILE_RESOLUTION_STAGE,
      validator: PROFILE_RESOLUTION_VALIDATOR,
      path,
    }),
  };
}

function failure(result: { readonly ok: false; readonly diagnostic: OscalDiagnostic }): ProfileResolutionOutcome {
  return { ok: false, diagnostic: result.diagnostic };
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
  if (value === null || typeof value !== 'object') return value;

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

/** Phase 1 — Selektion je Import gegen sein Quelldokument. */
function collectPhaseOne(
  input: SingleProfileInput,
): PhaseOutcome<{ records: SelectionRecord[]; inclusions: ControlInclusion[]; consumedResourceUuids: Set<string> }> {
  const records: SelectionRecord[] = [];
  const inclusions: ControlInclusion[] = [];
  const consumedResourceUuids = new Set<string>();

  for (const profileImport of input.document.view.imports) {
    const edge = (input.edgesByArtifactKey.get(input.artifactKey) ?? []).find(
      (candidate) => candidate.href === profileImport.href,
    );
    if (edge === undefined) {
      return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_UNMAPPED, profileImport.path));
    }

    const sourceDocument = input.resolvedByArtifact.get(edge.artifactKey) ?? input.plan.documents.get(edge.artifactKey);
    if (sourceDocument === undefined) {
      return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_UNMAPPED, profileImport.path));
    }

    const index = indexCatalogControls(sourceDocument);
    const outcome = resolveSelectionIds(index, {
      selection: profileImport.selection,
      excludeControls: profileImport.excludeControls,
    });
    if (!outcome.ok) return outcome;

    const controls: JsonObject[] = [];
    for (const id of outcome.ids) {
      const node = index.byId.get(id);
      if (node !== undefined) controls.push(node);
    }
    records.push({ artifactKey: edge.artifactKey, ids: outcome.ids, sourceDocument });
    if (profileImport.href.startsWith('#')) {
      consumedResourceUuids.add(profileImport.href.slice(1));
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
    append(filtered['groups'] ?? [], groups);
    append(filtered['controls'] ?? [], controls);
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
    case 'flat':
      return { ok: true, value: { groups: [], controls: [...combined.order] } };
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
 * Emission — ausschließlich über den kontrollierten Builder. Erzeugt das
 * Dokument mit Root-Key `catalog`.
 *
 * Metadaten-Erbvertrag: Die Metadaten des Ergebnisses stammen vollständig
 * aus dem steuernden Profil (Titel, Version, document-ids, roles, parties,
 * remarks und unbekannte Mitglieder bleiben gemäß ADR-2 erhalten). Nur die
 * werkzeugspezifischen Felder werden ersetzt — eigene UUID (UUIDv5),
 * Stempel-`last-modified`, gebundene `oscal-version` — und die beiden
 * Provenienzträger werden angehängt (`resolution-tool`-prop,
 * `source-profile`-link). Die BSI-resolved_catalogs erben dieselben
 * Metadaten ebenso, sodass der Orakelvergleich nur die dokumentierten
 * Volatile unterscheidet.
 */
function emitResolvedCatalog(
  plan: Extract<ProfileResolutionPlan, { ok: true }>,
  document: ProfileDocument,
  topUuid: string,
  derivedUuid: string,
  groups: readonly JsonObject[],
  controls: readonly JsonObject[],
  consumedResourceUuids: ReadonlySet<string>,
): DerivedJsonTree {
  const graph = createOscalDerivedGraph();

  const sourceBody = readRootBody(document.source);
  const sourceMetadataValue = ownDataValue(sourceBody, 'metadata');
  const sourceMetadata = isJsonObject(sourceMetadataValue) ? sourceMetadataValue : {};
  // Werkzeugspezifische Mitglieder werden nicht übernommen, sondern unten
  // neu gesetzt; die Trägerlisten werden separat aufgebaut, damit unsere
  // Einträge hinter den ererbten stehen.
  const inheritedMetadata = copyOwnDataMembersSkipping(sourceMetadata, [
    'uuid',
    'last-modified',
    'oscal-version',
    'props',
    'links',
  ]);
  const metadataHandle = emitValue(graph, inheritedMetadata, 0) as DerivedObjectHandle;
  graph.setObjectMember(metadataHandle, 'uuid', derivedUuid);
  graph.setObjectMember(metadataHandle, 'last-modified', PROFILE_RESOLUTION_TIMESTAMP);
  graph.setObjectMember(metadataHandle, 'oscal-version', plan.oscalVersion);

  const propsHandle = graph.array();
  const inheritedProps = ownDataValue(sourceMetadata, 'props');
  if (Array.isArray(inheritedProps)) {
    for (const entry of ownArrayDataElements(inheritedProps)) {
      if (isJsonObject(entry)) graph.pushArrayItem(propsHandle, emitValue(graph, entry, 1));
    }
  }
  const toolProp = graph.object();
  graph.setObjectMember(toolProp, 'name', 'resolution-tool');
  graph.setObjectMember(toolProp, 'value', `${PROFILE_RESOLUTION_VALIDATOR.name}@${PROFILE_RESOLUTION_VALIDATOR.version}`);
  graph.pushArrayItem(propsHandle, toolProp);
  graph.setObjectMember(metadataHandle, 'props', propsHandle);

  const linksHandle = graph.array();
  const inheritedLinks = ownDataValue(sourceMetadata, 'links');
  if (Array.isArray(inheritedLinks)) {
    for (const entry of ownArrayDataElements(inheritedLinks)) {
      if (isJsonObject(entry)) graph.pushArrayItem(linksHandle, emitValue(graph, entry, 1));
    }
  }
  const sourceLink = graph.object();
  graph.setObjectMember(sourceLink, 'rel', 'source-profile');
  graph.setObjectMember(sourceLink, 'href', `urn:uuid:${topUuid}`);
  graph.pushArrayItem(linksHandle, sourceLink);
  graph.setObjectMember(metadataHandle, 'links', linksHandle);

  const bodyHandle = graph.object();
  graph.setObjectMember(bodyHandle, 'uuid', derivedUuid);
  graph.setObjectMember(bodyHandle, 'metadata', metadataHandle);
  if (groups.length > 0) {
    graph.setObjectMember(bodyHandle, 'groups', emitValue(graph, groups, 0));
  }
  if (controls.length > 0) {
    graph.setObjectMember(bodyHandle, 'controls', emitValue(graph, controls, 0));
  }
  // Das Back-matter des steuernden Profils wird fortgeführt, MINUS die
  // Ressourcen, deren rlink als Importbindung verbraucht wurde — die BSI-
  // resolved_catalogs streichen genau diese und behalten die externen
  // Referenzen (Orakelbefund gspp: drei Import-Ressourcen fallen,
  // die BSI-Website-Referenz bleibt).
  const backMatter = ownDataValue(sourceBody, 'back-matter');
  if (isJsonObject(backMatter)) {
    let filteredBackMatter: JsonObject = backMatter;
    const resources = ownDataValue(backMatter, 'resources');
    if (Array.isArray(resources)) {
      const kept = ownArrayDataElements(resources).filter((entry) => {
        if (!isJsonObject(entry)) return true;
        const uuid = ownDataValue(entry, 'uuid');
        return !(typeof uuid === 'string' && consumedResourceUuids.has(uuid));
      });
      filteredBackMatter = { ...backMatter, resources: kept };
      if (kept.length === 0) delete filteredBackMatter['resources'];
    }
    if (Object.keys(filteredBackMatter).length > 0) {
      graph.setObjectMember(bodyHandle, 'back-matter', emitValue(graph, filteredBackMatter, 0));
    }
  }

  const rootHandle = graph.object();
  graph.setObjectMember(rootHandle, 'catalog', bodyHandle);
  return graph.finishRoot(rootHandle);
}

/**
 * Sammelt alle platzierten Control- und Gruppen-IDs des zusammengebauten
 * Baums (iterativ über den frischen Engine-Baum).
 */
function collectPlacedIds(
  groups: readonly JsonObject[],
  controls: readonly JsonObject[],
): Set<string> {
  const ids = new Set<string>();
  const stack: JsonObject[] = [...groups, ...controls];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const id = ownDataValue(node, 'id');
    if (typeof id === 'string') ids.add(id);
    for (const listKey of ['controls', 'groups'] as const) {
      const value = ownDataValue(node, listKey);
      if (!Array.isArray(value)) continue;
      for (const child of ownArrayDataElements(value)) {
        if (isJsonObject(child)) stack.push(child);
      }
    }
  }
  return ids;
}

/**
 * Schneidet interne Fragment-Links (`#<id>`) ab, deren Ziel nicht Teil des
 * zusammengebauten Dokuments ist: Der resolvierte Katalog ist
 * selbst-contained und trägt keine ins Leere zeigenden Verweise (Orakel-
 * befund am BSI-Korpus: ASST.5.6 → #SENS.8.6 entfällt mit dem Ziel).
 * Verschwindet das letzte Mitglied, entfällt das Mitglied selbst.
 */
function pruneUnresolvedInternalLinks(nodes: readonly JsonObject[], placedIds: ReadonlySet<string>): void {
  const stack: JsonObject[] = [...nodes];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const links = ownDataValue(node, 'links');
    if (Array.isArray(links)) {
      const kept = ownArrayDataElements(links).filter((link) => {
        if (!isJsonObject(link)) return true;
        const href = ownDataValue(link, 'href');
        if (typeof href !== 'string' || !href.startsWith('#')) return true;
        return placedIds.has(href.slice(1));
      });
      if (kept.length === 0) delete node['links'];
      else if (kept.length !== links.length) node['links'] = kept;
    }
    for (const listKey of ['controls', 'groups'] as const) {
      const value = ownDataValue(node, listKey);
      if (!Array.isArray(value)) continue;
      for (const child of ownArrayDataElements(value)) {
        if (isJsonObject(child)) stack.push(child);
      }
    }
  }
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

  // Interne Links auf nicht platzierte Ziele werden abgeschnitten — der
  // resolvierte Katalog ist selbst-contained.
  const placedIds = collectPlacedIds(groups, controls);
  pruneUnresolvedInternalLinks([...groups, ...controls], placedIds);

  const topUuid = input.document.view.uuid;
  if (topUuid === undefined) {
    return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.TOP_PROFILE_UUID_MISSING, '/'));
  }
  const derivedUuid = deriveUuidV5(PROFILE_RESOLUTION_NAMESPACE_UUID, topUuid);

  return {
    ok: true,
    tree: emitResolvedCatalog(input.plan, input.document, topUuid, derivedUuid, groups, controls, phaseOne.value.consumedResourceUuids),
  };
}

/**
 * Löst den gesamten Plan nachgelagert auf: Kinder (Kataloge wie importierte
 * Profile) stehen nach Umkehrung der Preorder vor ihren Eltern, sodass ein
 * importierendes Profil stets auf fertige Quellen zugreift.
 */
export function resolveProfile(request: ProfileResolutionRequest): ProfileResolutionOutcome {
  const plan = request.plan;
  if (!plan.ok) return { ok: false, diagnostic: plan.diagnostic };

  const resolvedByArtifact = new Map<string, unknown>();
  for (let index = plan.order.length - 1; index >= 0; index -= 1) {
    const artifactKey = plan.order[index]!;
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
    resolvedByArtifact.set(artifactKey, outcome.tree);
  }

  const topLevel = plan.order[0]!;
  if (!resolvedByArtifact.has(topLevel)) {
    return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.TOP_PROFILE_UUID_MISSING, '/'));
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
