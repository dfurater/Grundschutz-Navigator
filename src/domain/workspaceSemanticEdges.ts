import { isJsonObject } from '@/domain/jsonGuards';
import { buildWorkspaceCatalog, type WorkspaceCatalogControl, type WorkspaceCatalogResult } from '@/domain/workspaceCatalog';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { WORKSPACE_DIAGNOSTIC_CODES } from '@/domain/workspaceDiagnostics';
import { readWorkspaceDocumentEdges } from '@/domain/workspaceEdges';
import { REFERENCE_GRAPH_CODES } from '@/domain/referenceGraphModel';
import { workspaceDocumentToken, type WorkspaceGraphDocument, type WorkspaceGraphEdge, type WorkspaceProfileResolution, type WorkspaceNodeId } from '@/domain/workspaceGraphModel';

const SEMANTIC_EDGES_VALIDATOR = Object.freeze({ name: 'workspace-semantic-edges', version: '1' });
const object = (value: unknown): Record<string, unknown> => isJsonObject(value) ? value : {};
const list = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : [];

function semanticRequirementKind(component: boolean, statement: boolean): WorkspaceGraphEdge['kind'] {
  if (component) return 'component-control';
  return statement ? 'ssp-statement' : 'ssp-control';
}

function createSemanticLookup(
  edges: readonly WorkspaceGraphEdge[],
  resolutions: readonly WorkspaceProfileResolution[],
) {
  const outgoingByDocument = new Map<string, Map<WorkspaceGraphEdge['kind'], { first: WorkspaceGraphEdge; byPath: Map<string, WorkspaceGraphEdge> }>>();
  for (const edge of edges) {
    const token = workspaceDocumentToken(edge.from.document);
    let byKind = outgoingByDocument.get(token);
    if (!byKind) { byKind = new Map(); outgoingByDocument.set(token, byKind); }
    let indexed = byKind.get(edge.kind);
    if (!indexed) { indexed = { first: edge, byPath: new Map() }; byKind.set(edge.kind, indexed); }
    if (!indexed.byPath.has(edge.path)) indexed.byPath.set(edge.path, edge);
  }
  const outgoing = (document: WorkspaceGraphDocument, kind: WorkspaceGraphEdge['kind'], path?: string) => {
    const indexed = outgoingByDocument.get(workspaceDocumentToken(document.key))?.get(kind);
    return path === undefined ? indexed?.first : indexed?.byPath.get(path);
  };
  const resolutionByDocument = new Map<string, WorkspaceProfileResolution>();
  for (const resolution of resolutions) {
    const token = workspaceDocumentToken(resolution.document);
    if (!resolutionByDocument.has(token)) resolutionByDocument.set(token, resolution);
  }
  const projections = new Map<string, WorkspaceCatalogResult | undefined>();
  const statements = new Map<WorkspaceCatalogControl, ReadonlySet<string>>();
  const project = (target: WorkspaceGraphDocument | undefined): WorkspaceCatalogResult | undefined => {
    if (!target) return undefined;
    const token = workspaceDocumentToken(target.key);
    if (projections.has(token)) return projections.get(token);
    const resolution = target.rootType === 'profile' ? resolutionByDocument.get(token) : undefined;
    let source: unknown;
    if (target.rootType === 'catalog') source = target.source;
    else if (resolution?.status === 'resolved') source = resolution.source;
    const projection = source === undefined ? undefined : buildWorkspaceCatalog(source);
    if (projection?.status === 'success') {
      for (const control of projection.catalog.controlsById.values()) statements.set(control, new Set(control.statementIds));
    }
    projections.set(token, projection);
    return projection;
  };
  const hasStatement = (control: WorkspaceCatalogControl, id: string) => statements.get(control)?.has(id) === true;
  return { outgoing, project, hasStatement };
}

function indexComponents(document: WorkspaceGraphDocument, components: Map<string, WorkspaceNodeId[]>): void {
  const body = object(object(document.source)['component-definition']);
  for (const component of list(body.components)) {
    const id = object(component).uuid;
    if (typeof id !== 'string') continue;
    const key = id.toLowerCase();
    const matches = components.get(key) ?? [];
    matches.push({ document: document.key, kind: 'component', localId: id });
    components.set(key, matches);
  }
}

function collectReachableComponents(
  document: WorkspaceGraphDocument,
  byKey: ReadonlyMap<string, WorkspaceGraphDocument>,
  outgoing: ReturnType<typeof createSemanticLookup>['outgoing'],
) {
  const pending = [document];
  const visited = new Set<string>();
  const components = new Map<string, WorkspaceNodeId[]>();
  let incomplete = false;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const token = workspaceDocumentToken(current.key);
    if (visited.has(token)) continue;
    visited.add(token);
    indexComponents(current, components);
    for (const reference of readWorkspaceDocumentEdges(current.source, 'component-definition').filter(item => item.kind === 'component-import')) {
      const edge = outgoing(current, 'component-import', reference.path);
      const target = edge?.state === 'resolved' && edge.to ? byKey.get(workspaceDocumentToken(edge.to.document)) : undefined;
      if (target?.rootType === 'component-definition') pending.push(target);
      else incomplete = true;
    }
  }
  return { components, incomplete };
}

/** Derives scoped semantic references from explicit document edges only. */
export function deriveWorkspaceSemanticEdges(
  documents: readonly WorkspaceGraphDocument[],
  edges: readonly WorkspaceGraphEdge[],
  resolutions: readonly WorkspaceProfileResolution[],
): readonly WorkspaceGraphEdge[] {
  const result: WorkspaceGraphEdge[] = [];
  const byKey = new Map(documents.map(document => [workspaceDocumentToken(document.key), document]));
  const { outgoing, project, hasStatement } = createSemanticLookup(edges, resolutions);
  const artifact = (document: WorkspaceGraphDocument): WorkspaceNodeId => ({ document: document.key, kind: 'artifact', localId: null });
  const emit = (document: WorkspaceGraphDocument, kind: WorkspaceGraphEdge['kind'], path: string, state: WorkspaceGraphEdge['state'], to?: WorkspaceNodeId, code?: string) => {
    const diagnostic = code === undefined ? undefined : createOscalDiagnostic({
      code,
      path,
      stage: 'reference',
      validator: SEMANTIC_EDGES_VALIDATOR,
      artifact: { rootType: document.rootType },
    });
    result.push({ kind, from: artifact(document), path, state, ...(to ? { to } : {}), ...(diagnostic ? { diagnostic } : {}) });
  };
  const requirements = (document: WorkspaceGraphDocument, values: unknown, path: string, context: WorkspaceGraphEdge | undefined, component: boolean) => {
    const target = context?.state === 'resolved' && context.to ? byKey.get(workspaceDocumentToken(context.to.document)) : undefined;
    const projection = project(target);
    const diagnose = (id: unknown, controlId: unknown, statement: boolean, referencePath: string) => {
      const kind = semanticRequirementKind(component, statement);
      if (context?.state === 'error') { emit(document, kind, referencePath, 'error', undefined, WORKSPACE_DIAGNOSTIC_CODES.contextInvalid); return; }
      if (!target || !projection) { emit(document, kind, referencePath, 'not-evaluable'); return; }
      if (projection.status === 'failure') {
        const ambiguous = projection.diagnostics.some(item => item.code.endsWith('_AMBIGUOUS'));
        emit(document, kind, referencePath, 'error', undefined, ambiguous ? REFERENCE_GRAPH_CODES.targetAmbiguous : REFERENCE_GRAPH_CODES.targetNotFound);
        return;
      }
      const control = typeof controlId === 'string' ? projection.catalog.controlsById.get(controlId) : undefined;
      const found = control && typeof id === 'string' && (!statement || hasStatement(control, id));
      if (!found) { emit(document, kind, referencePath, 'error', undefined, REFERENCE_GRAPH_CODES.targetNotFound); return; }
      emit(document, kind, referencePath, 'resolved', { document: target.key, kind: statement ? 'statement' : 'control', localId: id, ...(statement ? { controlId: control.id } : {}) });
    };
    list(values).forEach((value, index) => {
      const requirement = object(value);
      const requirementPath = `${path}/${index}`;
      diagnose(requirement['control-id'], requirement['control-id'], false, `${requirementPath}/control-id`);
      list(requirement.statements).forEach((statement, statementIndex) => {
        diagnose(object(statement)['statement-id'], requirement['control-id'], true, `${requirementPath}/statements/${statementIndex}/statement-id`);
      });
    });
  };
  const incorporates = (document: WorkspaceGraphDocument, body: Record<string, unknown>) => {
    const { components, incomplete } = collectReachableComponents(document, byKey, outgoing);
    list(body.capabilities).forEach((capability, index) => {
      list(object(capability)['incorporates-components']).forEach((entry, entryIndex) => {
        const id = object(entry)['component-uuid'];
        const matches = typeof id === 'string' ? components.get(id.toLowerCase()) ?? [] : [];
        const path = `/component-definition/capabilities/${index}/incorporates-components/${entryIndex}/component-uuid`;
        if (matches.length > 1) emit(document, 'component-incorporates', path, 'error', undefined, REFERENCE_GRAPH_CODES.targetAmbiguous);
        else if (matches.length === 1) emit(document, 'component-incorporates', path, 'resolved', matches[0]);
        else if (incomplete) emit(document, 'component-incorporates', path, 'not-evaluable');
        else emit(document, 'component-incorporates', path, 'error', undefined, REFERENCE_GRAPH_CODES.targetNotFound);
      });
    });
  };
  for (const document of documents) {
    const body = object(object(document.source)[document.rootType]);
    if (document.rootType === 'system-security-plan') {
      requirements(document, object(body['control-implementation'])['implemented-requirements'], '/system-security-plan/control-implementation/implemented-requirements', outgoing(document, 'ssp-import-profile'), false);
    } else if (document.rootType === 'component-definition') {
      for (const collection of ['components', 'capabilities']) {
        list(body[collection]).forEach((entry, index) => {
          list(object(entry)['control-implementations']).forEach((implementation, implementationIndex) => {
            const path = `/component-definition/${collection}/${index}/control-implementations/${implementationIndex}`;
            requirements(document, object(implementation)['implemented-requirements'], `${path}/implemented-requirements`, outgoing(document, 'component-source', `${path}/source`), true);
          });
        });
      }
      incorporates(document, body);
    }
  }
  return result;
}
