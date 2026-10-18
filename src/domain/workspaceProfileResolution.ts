import { parseProfileDocument, type ProfileDocument } from '@/adapters/oscalProfileDocument';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { resolveProfile } from '@/domain/profileResolutionEngine';
import { buildProfileResolutionPlan, type ProfileResolutionEdge } from '@/domain/profileResolutionImportGraph';
import { readWorkspaceDocumentEdges } from '@/domain/workspaceEdges';
import { workspaceDocumentToken, type WorkspaceGraphDocument, type WorkspaceGraphEdge, type WorkspaceProfileResolution } from '@/domain/workspaceGraphModel';

function diagnostic(code: string, path = '/'): OscalDiagnostic {
  return createOscalDiagnostic({ code, path, stage: 'profile-resolution',
    validator: { name: 'workspace-profile-resolution', version: '1' } });
}
function redact(value: OscalDiagnostic): OscalDiagnostic {
  return createOscalDiagnostic({ code: value.code, path: value.path, stage: value.stage,
    validator: value.validator, artifact: { rootType: value.artifact.rootType, oscalVersion: value.artifact.oscalVersion } });
}

type Problem = { readonly status: 'not-evaluable' | 'error'; readonly diagnostic?: OscalDiagnostic };

type EdgeIndex = Map<string, Map<string, WorkspaceGraphEdge[]>>;
type ImportIndex = ReadonlyMap<string, readonly ProfileResolutionEdge[]>;
type Sources = ReadonlyMap<string, unknown>;

function indexEdges(edges: readonly WorkspaceGraphEdge[]): EdgeIndex {
  const edgesByDocument: EdgeIndex = new Map();
  for (const edge of edges) {
    if (edge.kind !== 'profile-import') continue;
    const token = workspaceDocumentToken(edge.from.document);
    let byPath = edgesByDocument.get(token);
    if (byPath === undefined) { byPath = new Map(); edgesByDocument.set(token, byPath); }
    const matches = byPath.get(edge.path) ?? [];
    matches.push(edge);
    byPath.set(edge.path, matches);
  }
  return edgesByDocument;
}

function normalizeImports(doc: WorkspaceGraphDocument, edgesByDocument: EdgeIndex, sources: Sources): {
  readonly imports: readonly ProfileResolutionEdge[];
  readonly problem?: Problem;
} {
  const token = workspaceDocumentToken(doc.key);
  const normalized: ProfileResolutionEdge[] = [];
  for (const reference of readWorkspaceDocumentEdges(doc.source, 'profile')) {
    const matches = edgesByDocument.get(token)?.get(reference.path) ?? [];
    if (matches.some((edge) => edge.diagnostic?.code === 'OSCAL_GRAPH_IMPORT_CYCLE')) {
      return { imports: normalized, problem: { status: 'error', diagnostic: diagnostic('PROFILE_RESOLUTION_CYCLE') } };
    }
    if (matches.length > 1) {
      return { imports: normalized, problem: { status: 'error', diagnostic: diagnostic('OSCAL_WORKSPACE_BINDING_AMBIGUOUS', reference.path) } };
    }
    const edge = matches[0];
    if (reference.href === undefined || edge?.state !== 'resolved' || edge.to?.kind !== 'artifact') {
      return { imports: normalized, problem: { status: 'not-evaluable' } };
    }
    const target = workspaceDocumentToken(edge.to.document);
    if (!sources.has(target)) return { imports: normalized, problem: { status: 'not-evaluable' } };
    normalized.push({ href: reference.href, artifactKey: target, importPath: reference.path.slice(0, -'/href'.length) });
  }
  return { imports: normalized };
}

function reachableProblem(token: string, imports: ImportIndex, problems: ReadonlyMap<string, Problem>): Problem | undefined {
  const seen = new Set<string>();
  const pending = [token];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const problem = problems.get(current);
    if (problem !== undefined) return problem;
    for (const edge of imports.get(current) ?? []) pending.push(edge.artifactKey);
  }
  return undefined;
}

function profileViews(profiles: readonly WorkspaceGraphDocument[], order: readonly string[]): ReadonlyMap<string, ProfileDocument> {
  const views = new Map<string, ProfileDocument>();
  const included = new Set(order);
  for (const profile of profiles) {
    const key = workspaceDocumentToken(profile.key);
    if (included.has(key)) views.set(key, parseProfileDocument(profile.source, { trustClass: profile.trustClass }));
  }
  return views;
}

async function resolveOneProfile(doc: WorkspaceGraphDocument, profiles: readonly WorkspaceGraphDocument[], sources: Sources,
  imports: ImportIndex, problems: ReadonlyMap<string, Problem>): Promise<WorkspaceProfileResolution> {
  const token = workspaceDocumentToken(doc.key);
  const problem = reachableProblem(token, imports, problems);
  if (problem !== undefined) return { document: doc.key, ...problem };
  const plan = buildProfileResolutionPlan({ topProfileArtifactKey: token, documents: sources, edgesByArtifactKey: imports });
  if (!plan.ok) return { document: doc.key, status: 'error', diagnostic: redact(plan.diagnostic) };
  try {
    const outcome = await resolveProfile({ plan, edgesByArtifactKey: imports, profileViews: profileViews(profiles, plan.order) });
    return outcome.ok
      ? { document: doc.key, status: 'resolved', derived: true, transient: true,
        specificationStatus: 'work-in-progress', source: outcome.output.tree }
      : { document: doc.key, status: 'error', diagnostic: redact(outcome.diagnostic) };
  } catch {
    return { document: doc.key, status: 'error', diagnostic: diagnostic('OSCAL_WORKSPACE_PROFILE_RESOLUTION_FAILED') };
  }
}

/** Pure transient resolution: every invocation uses current document sources and bindings. */
export async function resolveWorkspaceProfiles(
  documents: readonly WorkspaceGraphDocument[], edges: readonly WorkspaceGraphEdge[],
): Promise<readonly WorkspaceProfileResolution[]> {
  const edgesByDocument = indexEdges(edges);
  const sources = new Map(documents.map((doc) => [workspaceDocumentToken(doc.key), doc.source]));
  const imports = new Map<string, readonly ProfileResolutionEdge[]>();
  const problems = new Map<string, Problem>();
  const profiles = documents.filter((doc) => doc.rootType === 'profile');
  for (const doc of profiles) {
    const token = workspaceDocumentToken(doc.key);
    const normalized = normalizeImports(doc, edgesByDocument, sources);
    imports.set(token, normalized.imports);
    if (normalized.problem !== undefined) problems.set(token, normalized.problem);
  }
  const results: WorkspaceProfileResolution[] = [];
  for (const doc of profiles) results.push(await resolveOneProfile(doc, profiles, sources, imports, problems));
  return results;
}
