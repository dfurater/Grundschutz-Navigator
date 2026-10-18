import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { createReferenceDocument, createOscalReferenceClassifier } from '@/domain/referenceResolution';
import { indexDocumentNodes, type DocumentNodeIndex } from '@/domain/referenceGraphIndex';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { REFERENCE_GRAPH_CODES } from '@/domain/referenceGraphModel';
import type { WorkspaceBinding } from '@/domain/workspaceModel';
import { workspaceDocumentToken, type WorkspaceGraphDocument, type WorkspaceGraphEdge, type WorkspaceNodeId } from '@/domain/workspaceGraphModel';
import type { WorkspaceDocumentReference } from '@/domain/workspaceEdges';

export interface PreparedWorkspaceDocument {
  readonly document: WorkspaceGraphDocument;
  readonly index: DocumentNodeIndex;
  readonly classify: ReturnType<typeof createOscalReferenceClassifier>;
}
export const WORKSPACE_GRAPH_VALIDATOR = Object.freeze({ name: 'workspace-graph', version: '1' });
export function workspaceDiagnostic(code: string, path = '/'): OscalDiagnostic {
  return createOscalDiagnostic({ code, path, stage: 'reference', validator: WORKSPACE_GRAPH_VALIDATOR });
}
export function workspaceArtifact(document: WorkspaceGraphDocument): WorkspaceNodeId {
  return { document: document.key, kind: 'artifact', localId: null };
}
export function prepareWorkspaceDocument(document: WorkspaceGraphDocument): PreparedWorkspaceDocument {
  const referenceDocument = createReferenceDocument({ source: document.source, context: { trustClass: document.trustClass }, rootType: document.rootType, oscalVersion: document.oscalVersion });
  return { document, classify: createOscalReferenceClassifier({document:referenceDocument}),
    index: indexDocumentNodes({artifactKey: workspaceDocumentToken(document.key), lifecycle:'supported', rootType:document.rootType, oscalVersion:document.oscalVersion, source:document.source, view:undefined}) };
}

/** Classify before consulting a binding: absolute URIs never acquire a workspace target. */
export function evaluateWorkspaceDocumentReference(
  prepared: PreparedWorkspaceDocument,
  reference: WorkspaceDocumentReference,
  documents: ReadonlyMap<string, PreparedWorkspaceDocument>,
  bindings: ReadonlyMap<string, readonly Pick<WorkspaceBinding, 'href' | 'target'>[]>,
): WorkspaceGraphEdge {
  const from = workspaceArtifact(prepared.document);
  const edge = {kind: reference.kind, from, path: reference.path};
  if (reference.href === undefined) return {...edge, state:'missing-source', diagnostic:workspaceDiagnostic('OSCAL_GRAPH_IMPORT_SOURCE_MISSING',reference.path)};
  const classification = prepared.classify({href:reference.href,path:reference.path});
  if (classification.kind === 'external' || (classification.kind === 'unresolved' && classification.reason === 'unsafe-protocol')) return {...edge,state:'external'};
  const key = prepared.document.key;
  const matches = bindings.get(`${workspaceDocumentToken(key)}|${reference.path}`) ?? [];
  const matching = matches.filter(binding => binding.href === reference.href);
  if (matching.length === 0) return {...edge,state:'not-evaluable'};
  if (matching.length !== 1) return {...edge,state:'error',diagnostic:workspaceDiagnostic('OSCAL_WORKSPACE_BINDING_AMBIGUOUS',reference.path)};
  const targetKey = matching[0].target;
  const token = targetKey.kind === 'local' ? `local:${targetKey.localId}` : `class-1:${targetKey.artifactKey}`;
  const target = documents.get(token);
  if (!target) return {...edge,state:'error',diagnostic:workspaceDiagnostic(REFERENCE_GRAPH_CODES.targetNotFound,reference.path)};
  if (!reference.allowedRoots.includes(target.document.rootType)) return {...edge,state:'error',diagnostic:workspaceDiagnostic(REFERENCE_GRAPH_CODES.rootTypeMismatch,reference.path)};
  return {...edge,state:'resolved',to:workspaceArtifact(target.document)};
}

/** Only known link collections are walked, so diagnostic paths never contain user keys. */
export function deriveWorkspaceInternalEdges(prepared: PreparedWorkspaceDocument): WorkspaceGraphEdge[] {
  const {document,index,classify}=prepared;
  const result:WorkspaceGraphEdge[]=[];
  if(!isJsonObject(document.source)) return result;
  const body=document.source[document.rootType];
  if(!isJsonObject(body)) return result;
  const addLinks=(node:JsonObject,path:string)=>{
    readArray(node.links).forEach((candidate,i)=>{
      if(!isJsonObject(candidate))return;
      const href=readString(candidate.href); if(href===undefined)return;
      const edgePath=`${path}/links/${i}/href`;
      const reference=classify({href,path:edgePath,rel:readString(candidate.rel),resourceFragment:readString(candidate['resource-fragment'])});
      if(reference.kind==='provenance')return;
      const edge={kind:'document-internal' as const,from:workspaceArtifact(document),path:edgePath};
      if(reference.kind==='resource'){
        const count=index.lookup('resource',reference.resource.uuid);
        if(count==='ambiguous') result.push({...edge,state:'error',diagnostic:workspaceDiagnostic(REFERENCE_GRAPH_CODES.targetAmbiguous,edgePath)});
        else result.push({...edge,state:reference.resource.content==='empty'?'resolved-empty':'resolved',to:{document:document.key,kind:'resource',localId:reference.resource.uuid}});
      } else if(reference.kind==='external'||(reference.kind==='unresolved'&&reference.reason==='unsafe-protocol'))result.push({...edge,state:'external'});
      else if(reference.kind==='unresolved'&&reference.reason==='fragment-not-found')result.push({...edge,state:'error',diagnostic:workspaceDiagnostic(REFERENCE_GRAPH_CODES.targetNotFound,edgePath)});
      else result.push({...edge,state:'not-evaluable'});
    });
  };
  const pending=[{node:body,path:`/${document.rootType}`}];
  const collections=['groups','controls','parts','components','capabilities','resources'];
  while(pending.length){
    const current=pending.pop()!;addLinks(current.node,current.path);
    for(const name of ['metadata','back-matter']){const child=current.node[name];if(isJsonObject(child))pending.push({node:child,path:`${current.path}/${name}`});}
    for(const name of collections)readArray(current.node[name]).forEach((child,i)=>{if(isJsonObject(child))pending.push({node:child,path:`${current.path}/${name}/${i}`});});
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
