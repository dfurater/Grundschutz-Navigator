import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { dispatchOscalDocument } from '@/domain/oscalRootDispatch';
import { SOURCE_REGISTRY } from '@/domain/sourceRegistry';
import { buildWorkspaceCatalog } from '@/domain/workspaceCatalog';
import { readWorkspaceDocumentEdges } from '@/domain/workspaceEdges';
import { localDocumentKey, workspaceDocumentToken, type WorkspaceClass1Artifact, type WorkspaceGraph, type WorkspaceGraphInput, type WorkspaceGraphDocument, type WorkspaceGraphNode, type WorkspaceGraphEdge, type WorkspaceProfileResolution } from '@/domain/workspaceGraphModel';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import { prepareWorkspaceDocument, evaluateWorkspaceDocumentReference, deriveWorkspaceInternalEdges, markWorkspaceCycles, workspaceDiagnostic, type PreparedWorkspaceDocument } from '@/domain/workspaceGraphContext';
import { resolveWorkspaceProfiles } from '@/domain/workspaceProfileResolution';
import { deriveWorkspaceSemanticEdges } from '@/domain/workspaceSemanticEdges';
import type { WorkspaceBinding } from '@/domain/workspaceModel';
import { REFERENCE_GRAPH_CODES } from '@/domain/referenceGraphModel';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';

export type * from '@/domain/workspaceGraphModel';

function emptyGraph(diagnostic: OscalDiagnostic): WorkspaceGraph {
  return { members: [], nodes: [], edges: [], diagnostics: [diagnostic], resolutions: [] };
}

function validateGraphDocument(document: WorkspaceGraphDocument): OscalDiagnostic | undefined {
  const structuralFailure = enforceClass2ObjectGraphInvariants(document.source);
  if (structuralFailure) return structuralFailure;
  const dispatch = dispatchOscalDocument(document.source, { trustClass: document.trustClass });
  if (!dispatch.ok) return dispatch.diagnostic;
  if (dispatch.rootType !== document.rootType || dispatch.oscalVersion !== document.oscalVersion) {
    return workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.documentInvalid);
  }
}

function memberDocument(member: WorkspaceGraphInput['members'][number], verbundId: string | undefined): WorkspaceGraphDocument | OscalDiagnostic {
  if (member.verbundId !== verbundId) return workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.verbundMismatch);
  if (member.trustClass !== 'class-2-local-user') return workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.trustClassRejected);
  if (member.rootType === 'mapping-collection') return workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.rootNotAllowed);
  return {
    key: localDocumentKey(member.localId),
    source: member.source,
    rootType: member.rootType,
    oscalVersion: member.oscalVersion,
    trustClass: member.trustClass,
    savedAt: member.savedAt,
  };
}

function class1Document(artifact: WorkspaceClass1Artifact): WorkspaceGraphDocument | OscalDiagnostic {
  const registered = SOURCE_REGISTRY.find(entry => entry.artifactKey === artifact.artifactKey);
  const supported = artifact.lifecycle === 'supported'
    && artifact.trustClass === 'class-1-verified-public'
    && registered?.lifecycle === 'supported'
    && registered.kind === 'oscal'
    && registered.expectedRootType === artifact.rootType
    && registered.oscalVersion === artifact.oscalVersion;
  if (!supported) return workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.artifactUnsupported);
  return {
    key: { kind: 'class-1', artifactKey: artifact.artifactKey, lifecycle: 'supported' },
    source: artifact.source,
    rootType: artifact.rootType,
    oscalVersion: artifact.oscalVersion,
    trustClass: artifact.trustClass,
  };
}

function isDiagnostic(value: WorkspaceGraphDocument | OscalDiagnostic): value is OscalDiagnostic {
  return 'code' in value;
}

function graphDocuments(input: WorkspaceGraphInput): WorkspaceGraphDocument[] | OscalDiagnostic {
  const verbundId = input.members[0]?.verbundId;
  const documents: WorkspaceGraphDocument[] = [];
  for (const candidate of [
    ...input.members.map(member => memberDocument(member, verbundId)),
    ...(input.class1Artifacts ?? []).map(class1Document),
  ]) {
    if (isDiagnostic(candidate)) return candidate;
    documents.push(candidate);
  }
  const seen = new Set<string>();
  for (const document of documents) {
    const token = workspaceDocumentToken(document.key);
    if (seen.has(token)) return workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.documentDuplicate);
    seen.add(token);
    const failure = validateGraphDocument(document);
    if (failure) return failure;
  }
  return documents;
}

/** Adds only semantic lookup nodes; the source document already owns artifact and resource nodes. */
function appendCatalogProjectionNodes(
  document: WorkspaceGraphDocument,
  source: unknown,
  nodes: WorkspaceGraphNode[],
  diagnostics: OscalDiagnostic[],
  derived = false,
): void {
  const projection = buildWorkspaceCatalog(source);
  if (projection.status === 'failure') {
    for (const diagnostic of projection.diagnostics) diagnostics.push(diagnostic);
    return;
  }
  const context = {
    document: document.key,
    rootType: 'catalog' as const,
    oscalVersion: document.oscalVersion,
    trustClass: derived ? 'class-2-local-user' as const : document.trustClass,
    ...(derived ? { derived: true as const } : {}),
  };
  for (const control of projection.catalog.controlsById.values()) {
    nodes.push({ ...context, kind: 'control', localId: control.id });
    for (const statementId of control.statementIds) {
      nodes.push({ ...context, kind: 'statement', localId: statementId, controlId: control.id });
    }
  }
}

interface PreparedGraph {
  readonly documents: Map<string, PreparedWorkspaceDocument>;
  readonly nodes: WorkspaceGraphNode[];
  readonly diagnostics: OscalDiagnostic[];
}

type BindingIndex = Map<string, Pick<WorkspaceBinding, 'href' | 'target'>[]>;

function prepareGraph(sources: readonly WorkspaceGraphDocument[]): PreparedGraph {
  const documents = new Map<string, PreparedWorkspaceDocument>();
  const nodes: WorkspaceGraphNode[] = [];
  const diagnostics: OscalDiagnostic[] = [];
  for (const document of sources) {
    const prepared = prepareWorkspaceDocument(document);
    documents.set(workspaceDocumentToken(document.key), prepared);
    appendSourceNodes(prepared, nodes);
    if (document.rootType === 'catalog') appendCatalogProjectionNodes(document, document.source, nodes, diagnostics);
    for (const diagnostic of prepared.index.diagnostics) {
      // Catalog statements use the control-scoped workspace projection above.
      if (document.rootType === 'catalog' && diagnostic.code === REFERENCE_GRAPH_CODES.duplicateNodeId && diagnostic.params.nodeKind === 'statement') continue;
      diagnostics.push(workspaceDiagnostic(diagnostic.code, diagnostic.path));
    }
  }
  return { documents, nodes, diagnostics };
}

function appendSourceNodes(prepared: PreparedWorkspaceDocument, nodes: WorkspaceGraphNode[]): void {
  const document = prepared.document;
  for (const node of prepared.index.nodes) {
    if (document.rootType === 'catalog' && (node.kind === 'control' || node.kind === 'statement')) continue;
    nodes.push({
      document: document.key, kind: node.kind, localId: node.localId,
      rootType: node.rootType, oscalVersion: node.oscalVersion, trustClass: document.trustClass,
    });
  }
}

function addBinding(index: BindingIndex, token: string, binding: Pick<WorkspaceBinding, 'href' | 'target'>): void {
  const matches = index.get(token) ?? [];
  matches.push(binding);
  index.set(token, matches);
}

function indexBindings(input: WorkspaceGraphInput): BindingIndex {
  const bindings: BindingIndex = new Map();
  for (const binding of input.bindings ?? []) {
    const token = `${workspaceDocumentToken(localDocumentKey(binding.fromLocalId))}|${binding.pointer}`;
    addBinding(bindings, token, binding);
  }
  for (const artifact of input.class1Artifacts ?? []) {
    const sourceToken = workspaceDocumentToken({ kind: 'class-1', artifactKey: artifact.artifactKey, lifecycle: 'supported' });
    for (const binding of artifact.bindings ?? []) {
      addBinding(bindings, `${sourceToken}|${binding.pointer}`, {
        href: binding.href, target: { kind: 'class-1', artifactKey: binding.artifactKey },
      });
    }
  }
  return bindings;
}

function documentEdges(documents: ReadonlyMap<string, PreparedWorkspaceDocument>, bindings: BindingIndex): WorkspaceGraphEdge[] {
  return [...documents.values()].flatMap(prepared => [
    ...readWorkspaceDocumentEdges(prepared.document.source, prepared.document.rootType)
      .map(reference => evaluateWorkspaceDocumentReference(prepared, reference, documents, bindings)),
    ...deriveWorkspaceInternalEdges(prepared),
  ]);
}

function appendResolvedProjections(prepared: PreparedGraph, resolutions: readonly WorkspaceProfileResolution[]): void {
  for (const resolution of resolutions) {
    if (resolution.status !== 'resolved') continue;
    const document = prepared.documents.get(workspaceDocumentToken(resolution.document))?.document;
    if (document) appendCatalogProjectionNodes(document, resolution.source, prepared.nodes, prepared.diagnostics, true);
  }
}

function appendResultDiagnostics(
  diagnostics: OscalDiagnostic[],
  edges: readonly WorkspaceGraphEdge[],
  resolutions: readonly WorkspaceProfileResolution[],
): void {
  for (const edge of edges) {
    if (edge.diagnostic) diagnostics.push(edge.diagnostic);
  }
  for (const resolution of resolutions) {
    if (resolution.status !== 'resolved' && resolution.diagnostic) diagnostics.push(resolution.diagnostic);
  }
}

/** Rebuilds one verbund from a caller-owned snapshot, including every transient profile result. */
export async function buildWorkspaceGraph(input: WorkspaceGraphInput): Promise<WorkspaceGraph> {
  const sources = graphDocuments(input);
  if (!Array.isArray(sources)) return emptyGraph(sources);
  const prepared = prepareGraph(sources);
  const edges = documentEdges(prepared.documents, indexBindings(input));
  markWorkspaceCycles(edges);
  const resolutions = await resolveWorkspaceProfiles(sources, edges);
  appendResolvedProjections(prepared, resolutions);
  for (const edge of deriveWorkspaceSemanticEdges(sources, edges, resolutions)) edges.push(edge);
  appendResultDiagnostics(prepared.diagnostics, edges, resolutions);
  return {
    members: input.members.map(({ localId, rootType, oscalVersion, trustClass, savedAt }) => ({ localId, rootType, oscalVersion, trustClass, savedAt })),
    nodes: prepared.nodes, edges, diagnostics: prepared.diagnostics, resolutions,
  };
}
