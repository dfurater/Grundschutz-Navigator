import { REFERENCE_GRAPH_CODES } from '@/domain/referenceGraphModel';
import { buildWorkspaceGraph } from '@/domain/workspaceGraph';
import type { WorkspaceClass1Artifact, WorkspaceGraph, WorkspaceGraphEdge } from '@/domain/workspaceGraphModel';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type {
  DocumentState, LocalId, VerbundId, WorkspaceBinding, WorkspaceEnvelope, WorkspaceResult, WorkspaceVerbund,
} from '@/domain/workspaceModel';
import type { WorkspaceStore } from '@/adapters/workspaceStore';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';

/** Die Speicheroperationen, die der Bereich Informationsverbünde nutzt. */
export type WorkspacePort = Pick<WorkspaceStore,
  | 'schemaStatus' | 'listVerbuende' | 'listDocuments' | 'getDocument' | 'getDraft' | 'listBindings'
  | 'createVerbund' | 'renameVerbund' | 'deleteVerbund' | 'exportBackup' | 'estimate' | 'close'
  | 'addDocument' | 'saveDocument' | 'autosaveDraft' | 'setBinding' | 'removeBinding' | 'deleteDocument'>;

export interface WorkspaceDocumentView {
  readonly localId: LocalId;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly documentState: DocumentState;
  /** `metadata.title`, nur für den Seiteninhalt. */
  readonly title?: string;
}

export interface WorkspaceEdgeView {
  readonly kind: WorkspaceGraphEdge['kind'];
  /** JSON Pointer des Verweisfelds im Ausgangsdokument. */
  readonly path: string;
  readonly state: WorkspaceGraphEdge['state'];
  /** Wert des Verweisfelds, nur für den Seiteninhalt. */
  readonly href?: string;
  readonly targetLocalId?: LocalId;
  readonly diagnosticCode?: string;
  /** Die Bindung zeigt auf einen BSI-Katalog, der in dieser Sitzung nicht geladen und verifiziert ist. */
  readonly class1Unavailable?: true;
}

export interface WorkspaceDiagnosticView {
  readonly code: string;
  readonly path: string;
}

export interface VerbundView {
  readonly verbund: WorkspaceVerbund;
  readonly documents: readonly WorkspaceDocumentView[];
  readonly edges: ReadonlyMap<LocalId, readonly WorkspaceEdgeView[]>;
  readonly diagnostics: readonly WorkspaceDiagnosticView[];
}

/** Feste Anzeigereihenfolge entlang der Stationen; gleicher Typ nach Titel, dann `localId`. */
const ROOT_ORDER: readonly OscalRootKey[] = [
  'profile', 'system-security-plan', 'assessment-plan', 'assessment-results',
  'plan-of-action-and-milestones', 'component-definition', 'catalog', 'mapping-collection',
];

function compareDocuments(a: WorkspaceDocumentView, b: WorkspaceDocumentView): number {
  return ROOT_ORDER.indexOf(a.rootType) - ROOT_ORDER.indexOf(b.rootType)
    || (a.title ?? '').localeCompare(b.title ?? '', 'de')
    || a.localId.localeCompare(b.localId);
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function documentTitle(envelope: WorkspaceEnvelope): string | undefined {
  const title = record(record(record(envelope.source)?.[envelope.rootType])?.metadata)?.title;
  return typeof title === 'string' ? title : undefined;
}

/** Liest einen Zeichenkettenwert per JSON Pointer; jeder andere Fund ergibt `undefined`. */
export function pointerString(source: unknown, pointer: string): string | undefined {
  let value: unknown = source;
  for (const segment of pointer.slice(1).split('/')) {
    const container = record(value);
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!container || !Object.hasOwn(container, key)) return undefined;
    value = container[key];
  }
  return typeof value === 'string' ? value : undefined;
}

function edgeView(edge: WorkspaceGraphEdge, source: unknown, class1Unavailable: boolean): WorkspaceEdgeView {
  if (class1Unavailable) {
    return { kind: edge.kind, path: edge.path, state: 'not-evaluable', href: pointerString(source, edge.path), class1Unavailable: true };
  }
  return {
    kind: edge.kind,
    path: edge.path,
    state: edge.state,
    href: pointerString(source, edge.path),
    targetLocalId: edge.to?.document.kind === 'local' ? edge.to.document.localId : undefined,
    diagnosticCode: edge.diagnostic?.code,
  };
}

function bindingKey(localId: string, pointer: string, href: string | undefined): string {
  return `${localId}|${pointer}|${href ?? ''}`;
}

/** Bindungen auf BSI-Artefakte, die nicht als geladenes, verifiziertes Artefakt vorliegen. */
export function unavailableClass1Bindings(bindings: readonly WorkspaceBinding[], available: ReadonlySet<string>): Set<string> {
  const keys = new Set<string>();
  for (const binding of bindings) {
    if (binding.target.kind === 'class-1' && !available.has(binding.target.artifactKey)) keys.add(bindingKey(binding.fromLocalId, binding.pointer, binding.href));
  }
  return keys;
}

/**
 * Nur das fehlende Ziel einer passenden Klasse-1-Bindung ist ein Sitzungszustand.
 * Eine veraltete oder mehrdeutige Bindung bleibt ein Dokumentfehler, auch wenn
 * eine ihrer Bindungen auf einen nicht geladenen Katalog zeigt.
 */
function isUnavailableClass1Edge(edge: WorkspaceGraphEdge, href: string | undefined, unavailable: ReadonlySet<string>): boolean {
  return edge.from.document.kind === 'local'
    && edge.state === 'error'
    && edge.diagnostic?.code === REFERENCE_GRAPH_CODES.targetNotFound
    && unavailable.has(bindingKey(edge.from.document.localId, edge.path, href));
}

/** Lädt die vollständigen Envelopes eines Verbunds der Reihe nach. */
export async function loadMembers(port: WorkspacePort, verbundId: VerbundId): Promise<WorkspaceResult<WorkspaceEnvelope[]>> {
  const summaries = await port.listDocuments(verbundId);
  if (!summaries.ok) return summaries;
  const members: WorkspaceEnvelope[] = [];
  for (const summary of summaries.value) {
    const document = await port.getDocument(summary.localId);
    if (!document.ok) return document;
    if (document.value) members.push(document.value);
  }
  return { ok: true, value: members };
}

export interface EdgeProjection {
  readonly edges: Map<LocalId, WorkspaceEdgeView[]>;
  /** Diagnosen, die einen Sitzungszustand statt eines Dokumentfehlers beschreiben. */
  readonly suppressed: Set<unknown>;
}

/** Kanten je lokalem Dokument; Kanten auf nicht geladene BSI-Artefakte werden zum Sitzungszustand. */
export function projectEdges(graph: WorkspaceGraph, sources: ReadonlyMap<string, unknown>, unavailable: ReadonlySet<string>): EdgeProjection {
  const edges = new Map<LocalId, WorkspaceEdgeView[]>();
  const suppressed = new Set<unknown>();
  const missingEdges = new Set<string>();
  for (const edge of graph.edges) {
    if (edge.from.document.kind !== 'local') continue;
    const localId = edge.from.document.localId;
    const source = sources.get(localId);
    const missing = isUnavailableClass1Edge(edge, pointerString(source, edge.path), unavailable);
    if (missing) {
      suppressed.add(edge.diagnostic);
      missingEdges.add(`${localId}|${edge.path}`);
    }
    const list = edges.get(localId) ?? [];
    list.push(edgeView(edge, source, missing));
    edges.set(localId, list);
  }
  // Die Profilauflösung übernimmt eine solche Kantendiagnose als eigenes Objekt mit
  // Code und Pfad der Kante; importierende Profile tragen dasselbe Objekt weiter.
  for (const resolution of graph.resolutions) {
    const diagnostic = resolution.status === 'error' ? resolution.diagnostic : undefined;
    if (resolution.document.kind === 'local' && diagnostic?.code === REFERENCE_GRAPH_CODES.targetNotFound
      && missingEdges.has(`${resolution.document.localId}|${diagnostic.path}`)) suppressed.add(diagnostic);
  }
  return { edges, suppressed };
}

/** Alles, was die Ableitung der Verbundansicht braucht; strukturklonbar für den Worker. */
export interface VerbundViewSnapshot {
  readonly verbund: WorkspaceVerbund;
  readonly members: readonly WorkspaceEnvelope[];
  readonly bindings: readonly WorkspaceBinding[];
  /** Nur geladene, hash-verifizierte BSI-Artefakte, auf die eine Bindung des Verbunds zeigt. */
  readonly class1Artifacts: readonly WorkspaceClass1Artifact[];
}

/**
 * Leitet die Ansicht aus einem Schnappschuss ab. Läuft in
 * `src/workers/profileWorkbench.worker.ts`, weil die Profile Resolution des
 * Dokumentgraphen die Schemastufe (Ajv) braucht.
 */
export async function deriveVerbundView({ verbund, members, bindings, class1Artifacts }: VerbundViewSnapshot): Promise<VerbundView> {
  const unavailable = unavailableClass1Bindings(bindings, new Set(class1Artifacts.map((artifact) => artifact.artifactKey)));
  const graph = await buildWorkspaceGraph({ members, bindings, class1Artifacts });
  // Die Diagnose einer Kante auf ein nicht geladenes BSI-Artefakt beschreibt die Sitzung, nicht das Dokument.
  const { edges, suppressed } = projectEdges(graph, new Map(members.map((member) => [member.localId, member.source])), unavailable);
  return {
    verbund,
    documents: members.map((member) => ({
      localId: member.localId,
      rootType: member.rootType,
      oscalVersion: member.oscalVersion,
      documentState: member.documentState,
      title: documentTitle(member),
    })).sort(compareDocuments),
    edges,
    diagnostics: graph.diagnostics.filter((diagnostic) => !suppressed.has(diagnostic)).map(({ code, path }) => ({ code, path })),
  };
}

/**
 * Baut die Ansicht eines Informationsverbunds aus dem Speicher. Die
 * Quellgraphen dienen nur dem Dokumentgraphen im Worker und werden danach
 * entlassen; die Ansicht hält Envelopemetadaten, Titel, Kanten und Diagnosen.
 * `class1Artifacts` sind bereits geladene, hash-verifizierte BSI-Artefakte;
 * der Graph erhält nur die, auf die eine Bindung des Verbunds zeigt, und legt
 * nichts davon im Speicher ab. `value: null` heißt: Den Verbund gibt es nicht.
 */
export async function loadVerbundView(
  port: WorkspacePort,
  verbundId: VerbundId,
  class1Artifacts: readonly WorkspaceClass1Artifact[] = [],
): Promise<WorkspaceResult<VerbundView | null>> {
  const verbuende = await port.listVerbuende();
  if (!verbuende.ok) return verbuende;
  const verbund = verbuende.value.find((entry) => entry.verbundId === verbundId);
  if (!verbund) return { ok: true, value: null };
  const loaded = await loadMembers(port, verbundId);
  if (!loaded.ok) return loaded;
  const members = loaded.value;
  const bindings = await port.listBindings();
  if (!bindings.ok) return bindings;
  const memberIds = new Set<string>(members.map((member) => member.localId));
  const memberBindings = bindings.value.filter((binding) => memberIds.has(binding.fromLocalId));
  const boundArtifacts = new Set(memberBindings.flatMap((binding) => binding.target.kind === 'class-1' ? [binding.target.artifactKey] : []));
  const supplied = class1Artifacts.filter((artifact) => boundArtifacts.has(artifact.artifactKey));
  const { deriveVerbundViewInWorker } = await import('@/adapters/profileWorkbench');
  const view = await deriveVerbundViewInWorker({ verbund, members, bindings: memberBindings, class1Artifacts: supplied });
  return view ? { ok: true, value: view } : failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));
}
