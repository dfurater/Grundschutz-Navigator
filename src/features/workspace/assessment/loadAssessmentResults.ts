import { parseAssessmentResultsDocument } from '@/adapters/oscalAssessmentResultsDocument';
import { parseAssessmentPlanDocument } from '@/adapters/oscalAssessmentPlanDocument';
import { parseSspDocument } from '@/adapters/oscalSspDocument';
import type { ArReference, AssessmentResults } from '@/domain/assessmentResultsModel';
import { isJsonObject, pointerString, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import type { ResolvedResource } from '@/domain/referenceResolution';
import type { LocalId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import type { VerbundView, WorkspacePort } from '@/state/workspaceVerbundView';
import { createAssessmentRelations, type AssessmentRelations } from '@/features/workspace/assessment/assessmentRelations';

export interface AssessmentResultsContent {
  readonly model: AssessmentResults;
  readonly relations: AssessmentRelations;
  readonly resources: ReadonlyMap<string, { readonly resource: JsonObject; readonly resolved: ResolvedResource }>;
  readonly actorNames: ReadonlyMap<string, string>;
  readonly sspStatements: ReadonlyMap<string, string>;
  readonly evidenceDescriptions: ReadonlyMap<string, string>;
  readonly planTitle?: string;
}

/** Nur bereits aufgelöste, zum aktuellen href passende Kanten desselben Verbunds liefern Kontext. */
async function boundDocument(port: Pick<WorkspacePort, 'getDocument'>, view: VerbundView, from: WorkspaceEnvelope, kind: 'ar-import-ap' | 'ap-import-ssp', rootType: WorkspaceEnvelope['rootType']) {
  const matches = (view.edges.get(from.localId) ?? []).filter(edge => edge.kind === kind);
  if (matches.length !== 1) return;
  const [edge] = matches;
  if (edge.state !== 'resolved' || !edge.targetLocalId || edge.href !== pointerString(from.source, edge.path)) return;
  if (!view.documents.some(member => member.localId === edge.targetLocalId && member.rootType === rootType)) return;
  const loaded = await port.getDocument(edge.targetLocalId);
  if (!loaded.ok) throw new Error('ASSESSMENT_CONTEXT_LOAD_FAILED');
  const target = loaded.value;
  if (target?.rootType === rootType && target.verbundId === from.verbundId && target.trustClass === 'class-2-local-user') return target;
}

function referenceText(reference: ArReference, sources: ReadonlyMap<string, unknown>, fields: readonly string[]): string | undefined {
  if (reference.status !== 'resolved') return;
  const source = sources.get(reference.origin);
  for (const field of fields) {
    const value = pointerString(source, `${reference.path}/${field}`);
    if (value !== undefined) return value;
  }
}

function readDisplayTexts(model: AssessmentResults, source: unknown, sources: ReadonlyMap<string, unknown>) {
  const actorNames = new Map<string, string>();
  const entities = model.results.flatMap(result => [...result.findings, ...result.observations, ...result.risks, ...result.risks.flatMap(risk => risk.remediations)]);
  for (const actor of entities.flatMap(entity => entity.origins).flatMap(origin => origin.actors)) {
    const name = referenceText(actor.reference, sources, ['name', 'title', 'short-name']);
    if (name !== undefined) actorNames.set(actor.path, name);
  }
  const sspStatements = new Map<string, string>();
  for (const finding of model.results.flatMap(result => result.findings)) {
    if (!finding.implementationStatement) continue;
    const description = referenceText(finding.implementationStatement, sources, ['description']);
    if (description !== undefined) sspStatements.set(finding.path, description);
  }
  const evidenceDescriptions = new Map<string, string>();
  for (const entry of model.evidence.observations.flatMap(observation => observation.evidence)) {
    const description = pointerString(source, `${entry.path}/description`);
    if (description !== undefined) evidenceDescriptions.set(entry.path, description);
  }
  return { actorNames, sspStatements, evidenceDescriptions };
}

function readResources(source: unknown, model: AssessmentResults) {
  const body = isJsonObject(source) && source['assessment-results'];
  const backMatter = isJsonObject(body) && body['back-matter'];
  const rawResources = isJsonObject(backMatter) ? readArray(backMatter.resources).filter(isJsonObject) : [];
  const rawByUuid = new Map<string, JsonObject | null>();
  for (const resource of rawResources) {
    const uuid = readString(resource.uuid)?.toLowerCase();
    if (uuid !== undefined) rawByUuid.set(uuid, rawByUuid.has(uuid) ? null : resource);
  }
  const resources = new Map<string, { resource: JsonObject; resolved: ResolvedResource }>();
  for (const resolved of model.evidence.resources) {
    const resource = rawByUuid.get(resolved.uuid.toLowerCase());
    if (resource) resources.set(resolved.uuid.toLowerCase(), { resource, resolved });
  }
  return resources;
}

export async function loadAssessmentResults(port: Pick<WorkspacePort, 'getDocument'>, view: VerbundView, localId: LocalId): Promise<AssessmentResultsContent> {
  const loaded = await port.getDocument(localId);
  if (!loaded.ok || loaded.value?.rootType !== 'assessment-results' || loaded.value.verbundId !== view.verbund.verbundId) throw new Error('ASSESSMENT_LOAD_FAILED');
  const envelope = loaded.value;
  const plan = await boundDocument(port, view, envelope, 'ar-import-ap', 'assessment-plan');
  const ssp = plan && await boundDocument(port, view, plan, 'ap-import-ssp', 'system-security-plan');
  const sspDocument = ssp && parseSspDocument(ssp.source, { trustClass: ssp.trustClass });
  const assessmentPlan = plan && parseAssessmentPlanDocument(plan.source, { trustClass: plan.trustClass }, { ssp: sspDocument });
  const at = new Date();
  const model = parseAssessmentResultsDocument(envelope.source, { trustClass: envelope.trustClass }, { assessmentPlan, ssp: sspDocument, at }).view;
  const sources = new Map<string, unknown>([['local', envelope.source], ['assessment-plan', plan?.source], ['ssp', ssp?.source]]);
  return {
    model,
    relations: createAssessmentRelations(model),
    ...readDisplayTexts(model, envelope.source, sources),
    resources: readResources(envelope.source, model),
    planTitle: assessmentPlan?.view.metadata.title,
  };
}
