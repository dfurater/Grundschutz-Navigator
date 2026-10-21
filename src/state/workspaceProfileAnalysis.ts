import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { collectProfileHints, type ProfileHint } from '@/domain/profileHints';
import { buildTargetControlIndex, type TargetControlIndex } from '@/domain/profileTargetControls';
import { buildWorkspaceGraph } from '@/domain/workspaceGraph';
import { applyCatalogPins, catalogPinStatus, withCatalogPins, type CatalogDelivery } from '@/domain/workspaceCatalogPin';
import type { WorkspaceClass1Artifact, WorkspaceGraph, WorkspaceGraphEdge } from '@/domain/workspaceGraphModel';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import type { LocalId, VerbundId, WorkspaceBinding, WorkspaceEnvelope, WorkspaceResult } from '@/domain/workspaceModel';
import {
  loadMembers, projectEdges, unavailableClass1Bindings,
  type WorkspaceEdgeView, type WorkspacePort,
} from '@/state/workspaceVerbundView';

/*
 * Analyse des Arbeitsstands eines Profils (GSPP-292): Der Verbundgraph wird
 * mit der ungespeicherten Quelle und den Bindungen des Editors abgeleitet,
 * ohne etwas zu speichern. Die Ableitung (`deriveProfileAnalysis`) läuft im
 * Modul-Worker `src/workers/profileWorkbench.worker.ts`, weil Schemastufe und
 * Profile Resolution Ajv brauchen und die CSP des Main Threads keine
 * Codeerzeugung erlaubt. Das Ergebnis hält nur Codes, Pfade, Zählungen und die
 * Anforderungen der Importziele; kein Quellgraph kehrt zurück.
 */

export type ProfileSchemaCheck =
  | { readonly status: 'passed' }
  | { readonly status: 'failed'; readonly code: string; readonly path: string };

export type ProfileResolutionView =
  | { readonly status: 'resolved'; readonly index: TargetControlIndex }
  | { readonly status: 'not-evaluable' }
  | { readonly status: 'error'; readonly code: string; readonly path: string };

export interface ProfileAnalysis {
  readonly schema: ProfileSchemaCheck;
  readonly hints: readonly ProfileHint[];
  /** Die `profile-import`-Kanten dieses Dokuments. */
  readonly imports: readonly WorkspaceEdgeView[];
  readonly resolution: ProfileResolutionView;
  /** Anforderungen je gebundenem Import, nach JSON Pointer seines `href`; zwei Importe teilen nie einen Eintrag. */
  readonly targets: ReadonlyMap<string, TargetControlIndex>;
}

export interface ProfileAnalysisInput {
  readonly verbundId: VerbundId;
  readonly localId: LocalId;
  readonly source: unknown;
  /** Der vollständige ausgehende Bindungssatz dieses Dokuments im Editor. */
  readonly bindings: readonly WorkspaceBinding[];
}

/** Alles, was die Ableitung braucht; strukturklonbar für die Übergabe an den Worker. */
export interface ProfileAnalysisSnapshot {
  readonly localId: LocalId;
  readonly source: unknown;
  readonly members: readonly WorkspaceEnvelope[];
  readonly bindings: readonly WorkspaceBinding[];
  /** Nur geladene, hash-verifizierte BSI-Artefakte, auf die eine Bindung zeigt. */
  readonly class1Artifacts: readonly WorkspaceClass1Artifact[];
  readonly delivery: CatalogDelivery;
}

/** Schemaprüfung über die Klasse-2-Kette ab den Bytes; nur innerhalb eines Workers aufrufen. */
export async function checkSchemaInProcess(source: unknown): Promise<ProfileSchemaCheck> {
  let bytes: Uint8Array;
  try {
    bytes = new TextEncoder().encode(serializeWorkspaceJson(source));
  } catch {
    return { status: 'failed', code: 'OSCAL_EXPORT_SOURCE_INVALID', path: '/' };
  }
  const result = await processClass2OscalBytes(bytes, { trustClass: 'class-2-local-user' });
  return result.ok ? { status: 'passed' } : { status: 'failed', code: result.diagnostic.code, path: result.diagnostic.path };
}

function targetSource(edge: WorkspaceGraphEdge, graph: WorkspaceGraph, members: readonly WorkspaceEnvelope[], class1: readonly WorkspaceClass1Artifact[]): unknown {
  const target = edge.to?.document;
  if (edge.state !== 'resolved' || !target) return undefined;
  if (target.kind === 'class-1') return class1.find((artifact) => artifact.artifactKey === target.artifactKey)?.source;
  const member = members.find((entry) => entry.localId === target.localId);
  if (member?.rootType === 'catalog') return member.source;
  const resolution = graph.resolutions.find((entry) => entry.document.kind === 'local' && entry.document.localId === target.localId);
  return resolution?.status === 'resolved' ? resolution.source : undefined;
}

function resolutionView(graph: WorkspaceGraph, localId: LocalId, suppressed: ReadonlySet<unknown>): ProfileResolutionView {
  const resolution = graph.resolutions.find((entry) => entry.document.kind === 'local' && entry.document.localId === localId);
  if (resolution?.status === 'resolved') {
    const index = buildTargetControlIndex(resolution.source);
    return index ? { status: 'resolved', index } : { status: 'not-evaluable' };
  }
  if (resolution?.status !== 'error' || !resolution.diagnostic || suppressed.has(resolution.diagnostic)) return { status: 'not-evaluable' };
  return { status: 'error', code: resolution.diagnostic.code, path: resolution.diagnostic.path };
}

/** Reine Ableitung aus einem Schnappschuss; schreibt nichts und lädt nichts. */
export async function deriveProfileAnalysis(snapshot: ProfileAnalysisSnapshot): Promise<ProfileAnalysis> {
  const { localId, source, members, class1Artifacts, delivery } = snapshot;
  const { bindings, withheld } = applyCatalogPins(members, snapshot.bindings, delivery);
  const unavailable = unavailableClass1Bindings(bindings, new Set(class1Artifacts.map((artifact) => artifact.artifactKey)));
  const [graph, schema] = await Promise.all([
    buildWorkspaceGraph({ members, bindings, class1Artifacts }),
    checkSchemaInProcess(source),
  ]);
  const sources = new Map(members.map((member) => [member.localId, member.source] as const));
  const { edges, suppressed } = projectEdges(graph, sources, unavailable, withheld);
  const targets = new Map<string, TargetControlIndex>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'profile-import' || edge.from.document.kind !== 'local' || edge.from.document.localId !== localId) continue;
    const index = buildTargetControlIndex(targetSource(edge, graph, members, class1Artifacts));
    if (index) targets.set(edge.path, index);
  }
  return {
    schema,
    hints: collectProfileHints(source),
    imports: (edges.get(localId) ?? []).filter((edge) => edge.kind === 'profile-import'),
    resolution: resolutionView(graph, localId, suppressed),
    targets,
  };
}

/** Liest Verbund und Bindungen aus dem Speicher und setzt den Arbeitsstand ein. */
export async function profileAnalysisSnapshot(
  port: WorkspacePort,
  input: ProfileAnalysisInput,
  class1Artifacts: readonly WorkspaceClass1Artifact[] = [],
  delivery: CatalogDelivery = new Map(),
): Promise<WorkspaceResult<ProfileAnalysisSnapshot>> {
  const loaded = await loadMembers(port, input.verbundId);
  if (!loaded.ok) return loaded;
  const stored = await port.listBindings();
  if (!stored.ok) return stored;
  // Ein gesperrtes Dokument bleibt beim gespeicherten Stand; sonst zählt das Paar, das Speichern schreiben würde.
  const saved = loaded.value.find((member) => member.localId === input.localId);
  const savedPin = saved && catalogPinStatus(saved.source, saved.rootType, stored.value.filter((binding) => binding.fromLocalId === input.localId), delivery);
  const preview = savedPin && savedPin.state !== 'bound' ? undefined : withCatalogPins(input.source, 'profile', input.bindings, delivery);
  const pinned = preview?.ok ? preview.source : input.source;
  const members = loaded.value.map((member) => member.localId === input.localId ? { ...member, source: pinned } : member);
  const memberIds = new Set<string>(members.map((member) => member.localId));
  const bindings = [
    ...stored.value.filter((binding) => memberIds.has(binding.fromLocalId) && binding.fromLocalId !== input.localId),
    ...input.bindings,
  ];
  const bound = new Set(bindings.flatMap((binding) => binding.target.kind === 'class-1' ? [binding.target.artifactKey] : []));
  return {
    ok: true,
    value: {
      localId: input.localId,
      source: input.source,
      members,
      bindings,
      class1Artifacts: class1Artifacts.filter((artifact) => bound.has(artifact.artifactKey)),
      delivery,
    },
  };
}
