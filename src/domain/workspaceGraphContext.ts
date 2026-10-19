import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { createReferenceDocument, createOscalReferenceClassifier } from '@/domain/referenceResolution';
import { indexDocumentNodes, type DocumentNodeIndex } from '@/domain/referenceGraphIndex';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { REFERENCE_GRAPH_CODES } from '@/domain/referenceGraphModel';
import type { WorkspaceBinding } from '@/domain/workspaceModel';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import { workspaceDocumentToken, type WorkspaceGraphDocument, type WorkspaceGraphEdge, type WorkspaceNodeId } from '@/domain/workspaceGraphModel';
import type { WorkspaceDocumentReference } from '@/domain/workspaceEdges';
import { buildWorkspaceCatalog } from '@/domain/workspaceCatalog';

export interface PreparedWorkspaceDocument {
  readonly document: WorkspaceGraphDocument;
  readonly index: DocumentNodeIndex;
  readonly classify: ReturnType<typeof createOscalReferenceClassifier>;
}

export const WORKSPACE_GRAPH_VALIDATOR = Object.freeze({ name: 'workspace-graph', version: '1' });

export function workspaceDiagnostic(code: string, path = '/'): OscalDiagnostic {
  return createOscalDiagnostic({ code, path, stage: 'reference', validator: WORKSPACE_GRAPH_VALIDATOR });
}

/** The Profile metaschema requires `import/@href` in every pinned version; JSON Schema 1.2.x does not. */
function importSourceMissing(path: string): OscalDiagnostic {
  return createOscalDiagnostic({
    code: WORKSPACE_DIAGNOSTIC_CODES.importSourceMissing,
    path,
    stage: 'oscal-constraint',
    validator: WORKSPACE_GRAPH_VALIDATOR,
  });
}

export function workspaceArtifact(document: WorkspaceGraphDocument): WorkspaceNodeId {
  return { document: document.key, kind: 'artifact', localId: null };
}

export function prepareWorkspaceDocument(document: WorkspaceGraphDocument): PreparedWorkspaceDocument {
  const referenceDocument = createReferenceDocument({
    source: document.source,
    context: { trustClass: document.trustClass },
    rootType: document.rootType,
    oscalVersion: document.oscalVersion,
  });
  const index = indexDocumentNodes({
    artifactKey: workspaceDocumentToken(document.key),
    lifecycle: 'supported',
    rootType: document.rootType,
    oscalVersion: document.oscalVersion,
    source: document.source,
    view: undefined,
  });
  const projection = document.rootType === 'catalog' ? buildWorkspaceCatalog(document.source) : undefined;
  const localControlLookup = projection
    ? (id: string) => {
      const state = index.lookup('control', id);
      return state === 'found' && projection.status !== 'success' ? 'missing' : state;
    }
    : undefined;
  return {
    document,
    index,
    classify: createOscalReferenceClassifier({ document: referenceDocument, localControlLookup }),
  };
}

/** Classify before consulting a binding: absolute URIs never acquire a workspace target. */
export function evaluateWorkspaceDocumentReference(
  prepared: PreparedWorkspaceDocument,
  reference: WorkspaceDocumentReference,
  documents: ReadonlyMap<string, PreparedWorkspaceDocument>,
  bindings: ReadonlyMap<string, readonly Pick<WorkspaceBinding, 'href' | 'target'>[]>,
): WorkspaceGraphEdge {
  const from = workspaceArtifact(prepared.document);
  const edge = { kind: reference.kind, from, path: reference.path };
  if (reference.href === undefined) {
    return { ...edge, state: 'missing-source', diagnostic: importSourceMissing(reference.path) };
  }
  const classification = prepared.classify({ href: reference.href, path: reference.path });
  if (classification.kind === 'external' || (classification.kind === 'unresolved' && classification.reason === 'unsafe-protocol')) {
    return { ...edge, state: 'external' };
  }
  const matches = bindings.get(`${workspaceDocumentToken(prepared.document.key)}|${reference.path}`) ?? [];
  const matching = matches.filter(binding => binding.href === reference.href);
  if (matching.length === 0) {
    // A binding for this pointer with another href is stale, not absent (docs/PERSISTENCE.md §7).
    return matches.length === 0
      ? { ...edge, state: 'not-evaluable' }
      : { ...edge, state: 'error', diagnostic: workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.bindingStale, reference.path) };
  }
  if (matching.length !== 1) {
    return { ...edge, state: 'error', diagnostic: workspaceDiagnostic(WORKSPACE_DIAGNOSTIC_CODES.bindingAmbiguous, reference.path) };
  }
  const target = documents.get(workspaceDocumentToken(matching[0].target));
  if (!target) {
    return { ...edge, state: 'error', diagnostic: workspaceDiagnostic(REFERENCE_GRAPH_CODES.targetNotFound, reference.path) };
  }
  if (!reference.allowedRoots.includes(target.document.rootType)) {
    return { ...edge, state: 'error', diagnostic: workspaceDiagnostic(REFERENCE_GRAPH_CODES.rootTypeMismatch, reference.path) };
  }
  return { ...edge, state: 'resolved', to: workspaceArtifact(target.document) };
}

function internalReferenceEdge(
  prepared: PreparedWorkspaceDocument,
  reference: ReturnType<PreparedWorkspaceDocument['classify']>,
  edge: Pick<WorkspaceGraphEdge, 'kind' | 'from' | 'path'>,
): WorkspaceGraphEdge {
  const ambiguous = (): WorkspaceGraphEdge => ({
    ...edge,
    state: 'error',
    diagnostic: workspaceDiagnostic(REFERENCE_GRAPH_CODES.targetAmbiguous, edge.path),
  });
  if (reference.kind === 'resource') {
    if (prepared.index.lookup('resource', reference.resource.uuid) === 'ambiguous') return ambiguous();
    return {
      ...edge,
      state: reference.resource.content === 'empty' ? 'resolved-empty' : 'resolved',
      to: { document: prepared.document.key, kind: 'resource', localId: reference.resource.uuid },
    };
  }
  if (reference.kind === 'local-control') {
    if (reference.state === 'ambiguous') return ambiguous();
    return { ...edge, state: 'resolved', to: { document: prepared.document.key, kind: 'control', localId: reference.controlId } };
  }
  if (reference.kind === 'external' || (reference.kind === 'unresolved' && reference.reason === 'unsafe-protocol')) {
    return { ...edge, state: 'external' };
  }
  if (reference.kind === 'unresolved' && reference.reason === 'fragment-not-found') {
    return { ...edge, state: 'error', diagnostic: workspaceDiagnostic(REFERENCE_GRAPH_CODES.targetNotFound, edge.path) };
  }
  return { ...edge, state: 'not-evaluable' };
}

const INTERNAL_LINK_COLLECTIONS = ['groups', 'controls', 'parts', 'components', 'capabilities', 'resources'] as const;
const INTERNAL_LINK_CONTAINERS = ['metadata', 'back-matter'] as const;

/** Only known link collections are walked, so diagnostic paths never contain user keys. */
export function deriveWorkspaceInternalEdges(prepared: PreparedWorkspaceDocument): WorkspaceGraphEdge[] {
  const { document, classify } = prepared;
  const result: WorkspaceGraphEdge[] = [];
  if (!isJsonObject(document.source)) return result;
  const body = document.source[document.rootType];
  if (!isJsonObject(body)) return result;

  const addLinks = (node: JsonObject, path: string) => {
    readArray(node.links).forEach((candidate, index) => {
      if (!isJsonObject(candidate)) return;
      const href = readString(candidate.href);
      if (href === undefined) return;
      const edgePath = `${path}/links/${index}/href`;
      const reference = classify({
        href,
        path: edgePath,
        rel: readString(candidate.rel),
        resourceFragment: readString(candidate['resource-fragment']),
      });
      if (reference.kind === 'provenance') return;
      result.push(internalReferenceEdge(prepared, reference, { kind: 'document-internal', from: workspaceArtifact(document), path: edgePath }));
    });
  };

  const pending = [{ node: body, path: `/${document.rootType}` }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    addLinks(current.node, current.path);
    for (const name of INTERNAL_LINK_CONTAINERS) {
      const child = current.node[name];
      if (isJsonObject(child)) pending.push({ node: child, path: `${current.path}/${name}` });
    }
    for (const name of INTERNAL_LINK_COLLECTIONS) {
      readArray(current.node[name]).forEach((child, index) => {
        if (isJsonObject(child)) pending.push({ node: child, path: `${current.path}/${name}/${index}` });
      });
    }
  }
  return result;
}

function indexCycleEdges(edges: readonly WorkspaceGraphEdge[], kind: WorkspaceGraphEdge['kind']): Map<string, number[]> {
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) => {
    if (edge.kind !== kind || edge.state !== 'resolved' || edge.to?.kind !== 'artifact') return;
    const token = workspaceDocumentToken(edge.from.document);
    const list = outgoing.get(token) ?? [];
    list.push(index);
    outgoing.set(token, list);
  });
  return outgoing;
}

function visitCycleChain(
  token: string,
  edges: WorkspaceGraphEdge[],
  outgoing: ReadonlyMap<string, readonly number[]>,
  finished: Set<string>,
): void {
  const active = new Set([token]);
  const stack = [{ token, index: 0 }];
  while (stack.length) {
    const frame = stack.at(-1)!;
    const next = outgoing.get(frame.token) ?? [];
    if (frame.index >= next.length) {
      active.delete(frame.token);
      finished.add(frame.token);
      stack.pop();
      continue;
    }
    const edgeIndex = next[frame.index++];
    const edge = edges[edgeIndex];
    const target = workspaceDocumentToken(edge.to!.document);
    if (active.has(target)) {
      edges[edgeIndex] = { ...edge, state: 'error', diagnostic: workspaceDiagnostic(REFERENCE_GRAPH_CODES.importCycle, edge.path) };
      continue;
    }
    if (!finished.has(target)) {
      active.add(target);
      stack.push({ token: target, index: 0 });
    }
  }
}

/** Iterative DFS avoids the JS call-stack limit on long inter-document chains. */
export function markWorkspaceCycles(edges: WorkspaceGraphEdge[]): void {
  for (const kind of ['profile-import', 'component-import', 'ssp-leveraged-authorization'] as const) {
    const outgoing = indexCycleEdges(edges, kind);
    const finished = new Set<string>();
    // Tokens are ASCII identifiers; explicit lexical order is independent of locale.
    const tokens = [...outgoing.keys()].sort((left, right) => left.localeCompare(right, 'en'));
    for (const token of tokens) {
      if (!finished.has(token)) visitCycleChain(token, edges, outgoing, finished);
    }
  }
}
