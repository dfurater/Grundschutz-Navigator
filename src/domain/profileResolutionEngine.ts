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
  type CombinedControls,
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

function optionalArray(node: JsonObject, key: string): readonly unknown[] | undefined {
  const value = ownDataValue(node, key);
  return Array.isArray(value) ? value : undefined;
}

/**
 * Bildet einen Raw-`alter`-Knoten auf die Loose-Direktivenform der
 * Modify-Schicht ab (`by-id` → `byId` usw.). Bewusst aus dem QUELLDOKUMENT
 * und nicht aus der Projektion: Die verlustfreie Projektion ergänzt leere
 * Sammelfelder, die als Phantom-Mitglieder im Ergebnisdokument enden
 * würden. Nur vorhandene Listen werden durchgereicht.
 */
function toAlterationDirective(alterNode: JsonObject): AlterationDirective {
  const adds: NonNullable<AlterationDirective['adds']> = [];
  const addsValue = optionalArray(alterNode, 'adds');
  if (addsValue !== undefined) {
    for (const entry of ownArrayDataElements(addsValue)) {
      if (!isJsonObject(entry)) continue;
      adds.push({
        ...(optionalString(entry, 'position') !== undefined && { position: optionalString(entry, 'position') }),
        ...(optionalString(entry, 'by-id') !== undefined && { byId: optionalString(entry, 'by-id') }),
        ...(optionalString(entry, 'title') !== undefined && { title: optionalString(entry, 'title') }),
        ...(optionalArray(entry, 'params') !== undefined && { params: optionalArray(entry, 'params') }),
        ...(optionalArray(entry, 'props') !== undefined && { props: optionalArray(entry, 'props') }),
        ...(optionalArray(entry, 'links') !== undefined && { links: optionalArray(entry, 'links') }),
        ...(optionalArray(entry, 'parts') !== undefined && { parts: optionalArray(entry, 'parts') }),
      });
    }
  }

  const removes: NonNullable<AlterationDirective['removes']> = [];
  const removesValue = optionalArray(alterNode, 'remove');
  if (removesValue !== undefined) {
    for (const entry of ownArrayDataElements(removesValue)) {
      if (!isJsonObject(entry)) continue;
      removes.push({
        ...(optionalString(entry, 'by-name') !== undefined && { byName: optionalString(entry, 'by-name') }),
        ...(optionalString(entry, 'by-class') !== undefined && { byClass: optionalString(entry, 'by-class') }),
        ...(optionalString(entry, 'by-id') !== undefined && { byId: optionalString(entry, 'by-id') }),
        ...(optionalString(entry, 'by-item-name') !== undefined && { byItemName: optionalString(entry, 'by-item-name') }),
        ...(optionalString(entry, 'by-ns') !== undefined && { byNs: optionalString(entry, 'by-ns') }),
      });
    }
  }

  const controlId = optionalString(alterNode, 'control-id');
  return {
    ...(controlId !== undefined && { controlId }),
    adds,
    removes,
  };
}

/**
 * Liest die Raw-`alter`-Knoten aus dem Quelldokument in Quellreihenfolge.
 */
function readRawAlters(source: unknown): readonly JsonObject[] {
  const body = readRootBody(source);
  const modify = ownDataValue(body, 'modify');
  if (!isJsonObject(modify)) return [];
  const alters = ownDataValue(modify, 'alters');
  if (!Array.isArray(alters)) return [];
  return ownArrayDataElements(alters).filter((entry): entry is JsonObject => isJsonObject(entry));
}

type ControlTransform = (control: JsonObject) => JsonObject;

function identity(control: JsonObject): JsonObject {
  return control;
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

  return (control: JsonObject): JsonObject => {
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

function resolveSingleProfile(input: SingleProfileInput): { readonly ok: true; readonly tree: DerivedJsonTree } | { readonly ok: false; readonly diagnostic: OscalDiagnostic } {
  const { artifactKey, document, plan } = input;
  const view = document.view;

  /* Phase 1 — Selektion je Import gegen sein Quelldokument. */
  const records: SelectionRecord[] = [];
  const inclusions: ControlInclusion[] = [];

  for (const profileImport of view.imports) {
    const edge = (input.edgesByArtifactKey.get(artifactKey) ?? []).find(
      (candidate) => candidate.href === profileImport.href,
    );
    if (edge === undefined) {
      return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_UNMAPPED, profileImport.path));
    }

    const sourceDocument = input.resolvedByArtifact.get(edge.artifactKey) ?? plan.documents.get(edge.artifactKey);
    if (sourceDocument === undefined) {
      return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.IMPORT_UNMAPPED, profileImport.path));
    }

    const index = indexCatalogControls(sourceDocument);
    const outcome = resolveSelectionIds(index, {
      selection: profileImport.selection,
      excludeControls: profileImport.excludeControls,
    });
    if (!outcome.ok) return failure(outcome);

    const controls: JsonObject[] = [];
    for (const id of outcome.ids) {
      const node = index.byId.get(id);
      if (node !== undefined) controls.push(node);
    }
    records.push({ artifactKey: edge.artifactKey, ids: outcome.ids, sourceDocument });
    inclusions.push({ documentKey: edge.artifactKey, controls });
  }

  /* Phase 2a — combine-Richtung. */
  const declaredMethod = view.merge?.combine?.method ?? 'use-first';
  if (declaredMethod !== 'use-first' && declaredMethod !== 'keep') {
    return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.COMBINE_METHOD_INVALID, view.merge?.path ?? '/'));
  }
  const combined: CombinedControls = applyCombine(inclusions, declaredMethod);

  /* Phase 2b — Strukturdirektive. */
  const structureKind = view.merge === null ? ('as-is' as const) : view.merge.structure.kind;
  let groups: JsonObject[] = [];
  let controls: JsonObject[];

  if (structureKind === 'flat') {
    controls = [...combined.order];
  } else if (structureKind === 'as-is') {
    controls = [];
    for (const record of records) {
      const body = readRootBody(record.sourceDocument);
      const filtered = buildAsIsGroups(body, record.ids);
      for (const group of filtered['groups'] ?? []) {
        if (isJsonObject(group)) groups.push(group);
      }
      for (const control of filtered['controls'] ?? []) {
        if (isJsonObject(control)) controls.push(control);
      }
    }
  } else if (structureKind === 'custom') {
    if (view.merge!.structure.kind !== 'custom') {
      return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.MERGE_STRUCTURE_UNRESOLVED, view.merge?.path ?? '/'));
    }
    const assembly = buildCustomGroups(
      {
        rawGroups: readRawCustomGroups(document.source),
        insertControls: view.merge!.structure.custom.insertControls,
      },
      combined,
    );
    if (!assembly.ok) return failure(assembly);
    groups = [...assembly.groups];
    controls = [...assembly.controls];
  } else {
    return failure(reject(
      PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.MERGE_STRUCTURE_UNRESOLVED,
      view.merge?.path ?? '/',
    ));
  }

  /* Phase 3 — Modify über alle platzierten Controls. */
  const setParameters = (view.modify?.setParameters ?? []).map(toSetParameterDirective);
  const altersByControlId = new Map<string, AlterationDirective[]>();
  for (const alterNode of readRawAlters(document.source)) {
    const directive = toAlterationDirective(alterNode);
    if (directive.controlId === undefined) continue;
    const bucket = altersByControlId.get(directive.controlId) ?? [];
    bucket.push(directive);
    altersByControlId.set(directive.controlId, bucket);
  }
  const transform = createControlTransform(setParameters, altersByControlId);
  controls = controls.map(transform);
  applyTransformToGroups(groups, transform);

  /* Emission — ausschließlich über den kontrollierten Builder. */
  const graph = createOscalDerivedGraph();

  const topUuid = view.uuid;
  if (topUuid === undefined) {
    return failure(reject(PROFILE_RESOLUTION_ENGINE_DIAGNOSTIC_CODES.TOP_PROFILE_UUID_MISSING, '/'));
  }
  const derivedUuid = deriveUuidV5(PROFILE_RESOLUTION_NAMESPACE_UUID, topUuid);

  const metadataHandle = graph.object();
  const title = view.metadata.title;
  if (title !== undefined) graph.setObjectMember(metadataHandle, 'title', title);
  graph.setObjectMember(metadataHandle, 'uuid', derivedUuid);
  graph.setObjectMember(metadataHandle, 'last-modified', PROFILE_RESOLUTION_TIMESTAMP);
  graph.setObjectMember(metadataHandle, 'oscal-version', plan.oscalVersion);

  const propsHandle = graph.array();
  const toolProp = graph.object();
  graph.setObjectMember(toolProp, 'name', 'resolution-tool');
  graph.setObjectMember(toolProp, 'value', `${PROFILE_RESOLUTION_VALIDATOR.name}@${PROFILE_RESOLUTION_VALIDATOR.version}`);
  graph.pushArrayItem(propsHandle, toolProp);
  graph.setObjectMember(metadataHandle, 'props', propsHandle);

  const linksHandle = graph.array();
  const sourceLink = graph.object();
  graph.setObjectMember(sourceLink, 'rel', 'source-profile');
  graph.setObjectMember(sourceLink, 'href', `urn:uuid:${topUuid}`);
  graph.pushArrayItem(linksHandle, sourceLink);
  graph.setObjectMember(metadataHandle, 'links', linksHandle);

  const bodyHandle = graph.object();
  graph.setObjectMember(bodyHandle, 'metadata', metadataHandle);
  if (groups.length > 0) {
    graph.setObjectMember(bodyHandle, 'groups', emitValue(graph, groups, 0));
  }
  if (controls.length > 0) {
    graph.setObjectMember(bodyHandle, 'controls', emitValue(graph, controls, 0));
  }

  const rootHandle = graph.object();
  graph.setObjectMember(rootHandle, 'catalog', bodyHandle);
  return { ok: true, tree: graph.finishRoot(rootHandle) };
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
