// Verlustfreie, rein lokale Ableitung der Assessment Results (GSPP-296).
import { openRootDerive } from '@/adapters/oscalRootDocumentParse';
import { ASSESSMENT_RESULTS_ROOT_TYPE } from '@/domain/assessmentResultsModel';
import type {
  AssessmentResult,
  AssessmentResults,
  AssessmentResultsDeriveOptions,
} from '@/domain/assessmentResultsModel';
import { deriveEvidenceReadModel } from '@/domain/evidenceReadModel';
import { isJsonObject, readArray, type JsonObject } from '@/domain/jsonGuards';
import { readRootMetadata } from '@/domain/oscalRootDispatch';
import type { OscalDocumentContext } from '@/domain/models';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { resolveOscalReference } from '@/domain/referenceResolution';
import {
  AR_ADAPTER_VALIDATOR,
  componentEntity,
  diagnose,
  entity,
  indexNodes,
  inventoryEntity,
  objectField,
  readObjectArrayField,
  readStringArrayField,
  stringField,
  unexpected,
  userEntity,
} from '@/adapters/oscalAssessmentPlanReaders';
import {
  deriveAssets,
  indexMetadata,
  indexSspSource,
  indexTasks,
  objectivesAndMethods,
} from '@/adapters/oscalAssessmentPlanAdapter';
import { parts, reviewedControls } from '@/adapters/oscalAssessmentPlanSelections';
import { activities, tasks } from '@/adapters/oscalAssessmentPlanTasks';
import {
  AR_BASE_PATH,
  diagnoseTaskCycles,
  origins,
  subjectReferences,
} from '@/adapters/oscalAssessmentResultsReaders';
import { deriveFinding, deriveRisk } from '@/adapters/oscalAssessmentResultsFindings';
import type { ArDeriveState } from '@/adapters/oscalAssessmentResultsReaders';
export type * from '@/domain/assessmentResultsModel';
export { ASSESSMENT_RESULTS_ROOT_TYPE } from '@/domain/assessmentResultsModel';

export class AssessmentResultsTrustClassError extends Error {
  readonly diagnostic = createOscalDiagnostic({
    code: 'OSCAL_AR_TRUST_CLASS_REJECTED',
    stage: 'domain',
    validator: AR_ADAPTER_VALIDATOR,
    path: '/',
    artifact: { rootType: ASSESSMENT_RESULTS_ROOT_TYPE },
  });
  constructor() {
    super('Assessment-Results-Ableitung abgewiesen: OSCAL_AR_TRUST_CLASS_REJECTED');
    this.name = 'AssessmentResultsTrustClassError';
  }
}

/** Typen, die Beobachtungssubjekte außerhalb von `back-matter` treffen können. */
const SUBJECT_TYPES = ['component', 'inventory-item', 'user', 'party', 'location'];

function bindContext(state: ArDeriveState): void {
  const { ssp, assessmentPlan } = state.options;
  for (const binding of [ssp, assessmentPlan])
    if (binding !== undefined && binding.context.trustClass !== 'class-2-local-user')
      throw new AssessmentResultsTrustClassError();
  if (ssp !== undefined) {
    state.sspAvailable = indexSspSource(ssp.source, state.ssp);
    if (!state.sspAvailable) diagnose(state, 'SSP_BINDING_INVALID', `${AR_BASE_PATH}/import-ap`);
  }
  if (assessmentPlan === undefined) return;
  const source = assessmentPlan.source;
  if (!isJsonObject(source) || !isJsonObject(source['assessment-plan'])) {
    diagnose(state, 'ASSESSMENT_PLAN_BINDING_INVALID', `${AR_BASE_PATH}/import-ap`);
    return;
  }
  state.planAvailable = true;
  const root = source['assessment-plan'];
  const p = '/assessment-plan';
  // Identitäten des Plans werden nur nachgeschlagen; seine Duplikate meldet der AP-Adapter.
  indexMetadata(root, state.plan, p);
  const local = isJsonObject(root['local-definitions']) ? root['local-definitions'] : {};
  for (const [key, type] of [
    ['components', 'component'],
    ['users', 'user'],
    ['inventory-items', 'inventory-item'],
    ['activities', 'activity'],
  ] as const)
    indexNodes(state, local, key, type, `${p}/local-definitions`, undefined, state.plan);
  const assets = isJsonObject(root['assessment-assets']) ? root['assessment-assets'] : {};
  indexNodes(state, assets, 'components', 'component', `${p}/assessment-assets`, undefined, state.plan);
  indexNodes(state, assets, 'assessment-platforms', 'assessment-platform', `${p}/assessment-assets`, undefined, state.plan);
  indexTasks(root, p, { ...state, local: state.plan, diagnostics: [] });
}
function indexDocument(root: JsonObject, local: JsonObject, state: ArDeriveState): void {
  indexMetadata(root, state.local, AR_BASE_PATH);
  indexNodes(state, local, 'activities', 'activity', `${AR_BASE_PATH}/local-definitions`, 'ACTIVITY_UUID_DUPLICATE');
  const backMatter = objectField(root, 'back-matter', AR_BASE_PATH, state);
  if (backMatter !== null) indexNodes(state, backMatter, 'resources', 'resource', `${AR_BASE_PATH}/back-matter`);
}
/** Je `result` ein eigener lokaler Identitätsbereich über dem Dokumentbereich. */
function resultState(result: JsonObject, rp: string, state: ArDeriveState): ArDeriveState {
  // Flache Kopie: Die inneren Maps der dokumentweiten Typen (Rollen, Parteien, Orte, Aktivitäten,
  // Ressourcen) werden geteilt; ein `result` indexiert nur eigene Typen und legt dafür neue Maps an.
  const scoped: ArDeriveState = { ...state, local: new Map(state.local), assets: new Map() };
  const local = isJsonObject(result['local-definitions']) ? result['local-definitions'] : {};
  const lp = `${rp}/local-definitions`;
  indexNodes(scoped, local, 'components', 'component', lp, 'COMPONENT_UUID_DUPLICATE');
  indexNodes(scoped, local, 'users', 'user', lp, 'USER_UUID_DUPLICATE');
  indexNodes(scoped, local, 'inventory-items', 'inventory-item', lp, 'INVENTORY_UUID_DUPLICATE');
  indexTasks(local, lp, scoped);
  if (isJsonObject(local['assessment-assets']))
    indexNodes(scoped, local['assessment-assets'], 'assessment-platforms', 'assessment-platform', `${lp}/assessment-assets`, 'PLATFORM_UUID_DUPLICATE', scoped.assets);
  for (const [key, type] of [
    ['observations', 'observation'],
    ['risks', 'risk'],
    ['findings', 'finding'],
  ] as const) {
    indexNodes(scoped, result, key, type, rp, `${type.toUpperCase()}_UUID_DUPLICATE`, state.document);
  }
  readArray(result.risks).forEach((risk, i) => {
    if (!isJsonObject(risk)) return;
    const riskPath = `${rp}/risks/${i}`;
    indexNodes(scoped, risk, 'remediations', 'response', riskPath, 'RESPONSE_UUID_DUPLICATE', state.document);
    readArray(risk.remediations).forEach((response, j) => {
      if (isJsonObject(response)) indexTasks(response, `${riskPath}/remediations/${j}`, scoped);
    });
  });
  return scoped;
}
function deriveResult(node: JsonObject, rp: string, state: ArDeriveState): AssessmentResult {
  const local = objectField(node, 'local-definitions', rp, state) ?? {};
  const lp = `${rp}/local-definitions`;
  const assessmentAssets = deriveAssets(local, state, lp);
  const log = objectField(node, 'assessment-log', rp, state);
  const localTasks = tasks(local, lp, state);
  const risks = readObjectArrayField(node, 'risks', rp, state).map((entry) => deriveRisk(entry.node, entry.path, state));
  diagnoseTaskCycles([...localTasks, ...risks.flatMap((risk) => risk.remediations.flatMap((r) => r.tasks))], state);
  return {
    ...entity(node, rp, state),
    start: stringField(node, 'start', rp, state, true),
    end: stringField(node, 'end', rp, state),
    localDefinitions: {
      components: readObjectArrayField(local, 'components', lp, state).map((e) => componentEntity(e.node, e.path, state)),
      inventoryItems: readObjectArrayField(local, 'inventory-items', lp, state).map((e) => inventoryEntity(e.node, e.path, state)),
      users: readObjectArrayField(local, 'users', lp, state).map((e) => userEntity(e.node, e.path, state)),
      assessmentAssets,
      tasks: localTasks,
    },
    reviewedControls: reviewedControls(node, 'reviewed-controls', rp, state, true),
    attestations: readObjectArrayField(node, 'attestations', rp, state).map(({ node: attestation, path: ap }) => ({
      path: ap,
      responsibleParties: readObjectArrayField(attestation, 'responsible-parties', ap, state).map(({ node: party, path: pp }) => ({
        roleId: stringField(party, 'role-id', pp, state, true),
        partyUuids: readStringArrayField(party, 'party-uuids', pp, state),
        path: pp,
      })),
      parts: parts(attestation, ap, state, { assessmentPart: true, validateTermNames: false }),
    })),
    assessmentLog:
      log === null
        ? []
        : readObjectArrayField(log, 'entries', `${rp}/assessment-log`, state).map(({ node: entry, path: ep }) => ({
            ...entity(entry, ep, state),
            start: stringField(entry, 'start', ep, state, true),
            end: stringField(entry, 'end', ep, state),
          })),
    observations: readObjectArrayField(node, 'observations', rp, state).map(({ node: observation, path: op }) => ({
      ...entity(observation, op, state),
      origins: origins(observation, op, state),
      subjects: subjectReferences(observation, op, state),
      evidence: state.evidenceByPath.get(op) ?? null,
    })),
    risks,
    findings: readObjectArrayField(node, 'findings', rp, state).map((entry) => deriveFinding(entry.node, entry.path, state)),
  };
}
function deriveImportAp(root: JsonObject, state: ArDeriveState): AssessmentResults['importAp'] {
  const node = objectField(root, 'import-ap', AR_BASE_PATH, state, true);
  if (node === null) return null;
  const path = `${AR_BASE_PATH}/import-ap`;
  const href = stringField(node, 'href', path, state, true);
  if (href === undefined) return null;
  return {
    href,
    remarks: stringField(node, 'remarks', path, state),
    path,
    reference: resolveOscalReference({ href, path: `${path}/href` }, { document: state.referenceDocument }),
    status: state.planAvailable ? 'bound' : 'not-resolvable-in-context',
  };
}
export function deriveAssessmentResults(
  body: unknown,
  context: OscalDocumentContext,
  options: AssessmentResultsDeriveOptions = {},
): AssessmentResults {
  if (context.trustClass !== 'class-2-local-user') throw new AssessmentResultsTrustClassError();
  const frame = openRootDerive(body, context, ASSESSMENT_RESULTS_ROOT_TYPE);
  const state: ArDeriveState = {
    ...frame,
    scope: ASSESSMENT_RESULTS_ROOT_TYPE,
    diagnostics: [],
    options,
    local: new Map(),
    assets: new Map(),
    ssp: new Map(),
    sspAvailable: false,
    plan: new Map(),
    planAvailable: false,
    planBound: options.assessmentPlan !== undefined,
    document: new Map(),
    evidenceByPath: new Map(),
    observationReferences: new Map(),
  };
  if (!frame.bodyIsObject) diagnose(state, 'STRUCTURE_UNEXPECTED', AR_BASE_PATH);
  const root = frame.rootBody;
  bindContext(state);
  const local = objectField(root, 'local-definitions', AR_BASE_PATH, state) ?? {};
  indexDocument(root, local, state);
  if (!Array.isArray(root.results)) unexpected(state, `${AR_BASE_PATH}/results`);
  const resultNodes = readObjectArrayField(root, 'results', AR_BASE_PATH, state);
  const scopes = resultNodes.map(({ node, path }) => resultState(node, path, state));

  // Nur dokumentweite Bereiche: die Evidenzableitung kennt keine Ergebnisgrenze, lokale
  // Definitionen eines `result` lösen ausschließlich über `subjects[].reference` auf.
  const contextUuids = new Set(
    [state.ssp, state.plan, state.local].flatMap((index) =>
      SUBJECT_TYPES.flatMap((type) => [...(index.get(type)?.keys() ?? [])]),
    ),
  );
  const evidence = deriveEvidenceReadModel({
    // Neue Hülle um denselben Körper; die Evidenzableitung verändert ihn nicht.
    source: { [ASSESSMENT_RESULTS_ROOT_TYPE]: root },
    rootType: ASSESSMENT_RESULTS_ROOT_TYPE,
    oscalVersion: state.oscalVersion ?? 'unknown',
    at: options.at ?? new Date(),
    contextUuids,
  });
  for (const observation of evidence.observations) state.evidenceByPath.set(observation.path, observation);
  for (const reference of evidence.observationReferences) state.observationReferences.set(reference.path, reference);

  const lp = `${AR_BASE_PATH}/local-definitions`;
  const results = resultNodes.map(({ node, path }, i) => deriveResult(node, path, scopes[i]));
  return {
    uuid: stringField(root, 'uuid', AR_BASE_PATH, state, true),
    metadata: readRootMetadata(root),
    importAp: deriveImportAp(root, state),
    localDefinitions: {
      objectivesAndMethods: objectivesAndMethods(local, lp, state),
      activities: activities(local, lp, state),
      remarks: stringField(local, 'remarks', lp, state),
    },
    results,
    evidence,
    diagnostics: Object.freeze([...state.diagnostics, ...evidence.diagnostics]),
  };
}
