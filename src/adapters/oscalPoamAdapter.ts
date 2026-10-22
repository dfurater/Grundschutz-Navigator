import { isJsonObject, readArray } from '@/domain/jsonGuards';
import type { JsonObject } from '@/domain/jsonGuards';
import { POAM_ROOT_TYPE, type Poam, type PoamDeriveOptions } from '@/domain/poamModel';
import type { OscalDocumentContext } from '@/domain/models';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { deriveEvidenceReadModel } from '@/domain/evidenceReadModel';
import { readRootMetadata } from '@/domain/oscalRootDispatch';
import { resolveOscalReference } from '@/domain/referenceResolution';
import { openRootDerive } from '@/adapters/oscalRootDocumentParse';
import { deriveAssets, indexMetadata, indexSspSource, indexTasks } from '@/adapters/oscalAssessmentPlanAdapter';
import {
  componentEntity, diagnose, entity, indexNodes, inventoryEntity, objectField,
  POAM_ADAPTER_VALIDATOR, readObjectArrayField, stringField, unexpected,
} from '@/adapters/oscalAssessmentPlanReaders';
import { deriveFinding, deriveRisk } from '@/adapters/oscalAssessmentResultsFindings';
import { diagnoseTaskCycles, origins, subjectReferences } from '@/adapters/oscalAssessmentResultsReaders';
import { countPoamUuids, POAM_BASE_PATH, poamItem, type PoamDeriveState } from '@/adapters/oscalPoamReaders';

export { POAM_ROOT_TYPE } from '@/domain/poamModel';
export class PoamTrustClassError extends Error {
  readonly diagnostic = createOscalDiagnostic({
    code: 'OSCAL_POAM_TRUST_CLASS_REJECTED',
    stage: 'domain',
    validator: POAM_ADAPTER_VALIDATOR,
    path: '/',
    artifact: { rootType: POAM_ROOT_TYPE },
  });
  constructor() {
    super('POA&M-Ableitung abgewiesen: OSCAL_POAM_TRUST_CLASS_REJECTED');
    this.name = 'PoamTrustClassError';
  }
}
function indexFindings(root: JsonObject, path: string, state: PoamDeriveState, external = false): void {
  const index = external ? state.resultsContext : state.document;
  for (const [key, type] of [
    ['observations', 'observation'], ['risks', 'risk'],
    ['findings', 'finding'], ['poam-items', 'poam-item'],
  ] as const)
    indexNodes(state, root, key, type, path, external ? undefined : `${type.toUpperCase().replaceAll('-', '_')}_UUID_DUPLICATE`, index);
  readArray(root.risks).forEach((risk, i) => {
    if (!isJsonObject(risk)) return;
    const rp = `${path}/risks/${i}`;
    indexNodes(state, risk, 'remediations', 'response', rp, external ? undefined : 'RESPONSE_UUID_DUPLICATE', index);
    if (external) return;
    readArray(risk.remediations).forEach((response, j) => {
      if (isJsonObject(response)) indexTasks(response, `${rp}/remediations/${j}`, state);
    });
  });
}
function bindContext(state: PoamDeriveState): void {
  const { ssp, assessmentResults } = state.options;
  for (const binding of [ssp, assessmentResults])
    if (binding !== undefined && binding.context.trustClass !== 'class-2-local-user') throw new PoamTrustClassError();
  if (ssp !== undefined) {
    state.sspAvailable = indexSspSource(ssp.source, state.ssp);
    if (!state.sspAvailable) diagnose(state, 'SSP_BINDING_INVALID', `${POAM_BASE_PATH}/import-ssp`);
  }
  if (assessmentResults === undefined) return;
  if (!isJsonObject(assessmentResults.source) || !isJsonObject(assessmentResults.source['assessment-results'])) {
    diagnose(state, 'ASSESSMENT_RESULTS_BINDING_INVALID', POAM_BASE_PATH);
    return;
  }
  state.resultsAvailable = true;
  readArray(assessmentResults.source['assessment-results'].results).forEach((result, i) => {
    if (isJsonObject(result)) indexFindings(result, `/assessment-results/results/${i}`, state, true);
  });
}
function importSsp(root: JsonObject, state: PoamDeriveState): Poam['importSsp'] {
  const node = objectField(root, 'import-ssp', POAM_BASE_PATH, state);
  if (node === null) return null;
  const path = `${POAM_BASE_PATH}/import-ssp`;
  const href = stringField(node, 'href', path, state, true);
  if (href === undefined) return null;
  return {
    href,
    path,
    remarks: stringField(node, 'remarks', path, state),
    reference: resolveOscalReference({ href, path: `${path}/href` }, { document: state.referenceDocument }),
    status: state.sspAvailable ? 'bound' : 'not-resolvable-in-context',
  };
}
export function derivePoam(body: unknown, context: OscalDocumentContext, options: PoamDeriveOptions = {}): Poam {
  if (context.trustClass !== 'class-2-local-user') throw new PoamTrustClassError();
  const frame = openRootDerive(body, context, POAM_ROOT_TYPE);
  const state: PoamDeriveState = {
    ...frame,
    scope: POAM_ROOT_TYPE,
    options,
    diagnostics: [],
    local: new Map(),
    ssp: new Map(),
    assets: new Map(),
    document: new Map(),
    documentUuidCounts: countPoamUuids(frame.rootBody),
    plan: new Map(),
    planAssets: new Map(),
    planAvailable: false,
    resultsContext: new Map(),
    resultsAvailable: false,
    resultsBound: options.assessmentResults !== undefined,
    sspAvailable: false,
    evidenceByPath: new Map(),
    observationReferences: new Map(),
  };
  if (!frame.bodyIsObject) unexpected(state, POAM_BASE_PATH);
  const root = frame.rootBody;
  bindContext(state);
  indexMetadata(root, state.local, POAM_BASE_PATH);
  indexFindings(root, POAM_BASE_PATH, state);
  const local = objectField(root, 'local-definitions', POAM_BASE_PATH, state) ?? {};
  const lp = `${POAM_BASE_PATH}/local-definitions`;
  indexNodes(state, local, 'components', 'component', lp, 'COMPONENT_UUID_DUPLICATE');
  indexNodes(state, local, 'inventory-items', 'inventory-item', lp, 'INVENTORY_UUID_DUPLICATE');
  const backMatter = objectField(root, 'back-matter', POAM_BASE_PATH, state);
  if (backMatter !== null) indexNodes(state, backMatter, 'resources', 'resource', `${POAM_BASE_PATH}/back-matter`);
  const assessmentAssets = deriveAssets(local, state, lp);
  const assetSource = objectField(local, 'assessment-assets', lp, state);
  if (assetSource !== null)
    indexNodes(state, assetSource, 'assessment-platforms', 'assessment-platform', `${lp}/assessment-assets`, 'PLATFORM_UUID_DUPLICATE', state.assets);
  const contextUuids = new Set(
    [state.local, state.ssp].flatMap((index) =>
      ['component', 'inventory-item', 'user', 'party', 'location'].flatMap((type) =>
        [...(index.get(type)?.keys() ?? [])],
      ),
    ),
  );
  const observationContext = {
    counts: new Map([...(state.resultsContext.get('observation') ?? [])].map(([uuid, paths]) => [uuid, paths.length])),
    available: state.resultsAvailable,
  };
  const evidence = deriveEvidenceReadModel({
    source: { [POAM_ROOT_TYPE]: root },
    rootType: POAM_ROOT_TYPE,
    oscalVersion: state.oscalVersion ?? 'unknown',
    at: options.at ?? new Date(),
    contextUuids,
    observationContext,
    documentUuidCounts: state.documentUuidCounts,
  });
  for (const observation of evidence.observations) state.evidenceByPath.set(observation.path, observation);
  for (const reference of evidence.observationReferences) state.observationReferences.set(reference.path, reference);
  const risks = readObjectArrayField(root, 'risks', POAM_BASE_PATH, state).map(({ node, path }) => deriveRisk(node, path, state));
  diagnoseTaskCycles(risks.flatMap((risk) => risk.remediations.flatMap((response) => response.tasks)), state);
  const systemId = objectField(root, 'system-id', POAM_BASE_PATH, state);
  if (root['import-ssp'] === undefined && systemId === null) diagnose(state, 'SYSTEM_CONTEXT_MISSING', POAM_BASE_PATH);
  if (!Array.isArray(root['poam-items']) || root['poam-items'].length === 0) unexpected(state, `${POAM_BASE_PATH}/poam-items`);
  const poamItems = readObjectArrayField(root, 'poam-items', POAM_BASE_PATH, state).map(({ node, path }) => poamItem(node, path, state));
  const observations = readObjectArrayField(root, 'observations', POAM_BASE_PATH, state).map(({ node, path }) => ({
    ...entity(node, path, state),
    origins: origins(node, path, state),
    subjects: subjectReferences(node, path, state),
    evidence: state.evidenceByPath.get(path) ?? null,
  }));
  const findings = readObjectArrayField(root, 'findings', POAM_BASE_PATH, state).map(({ node, path }) => deriveFinding(node, path, state));
  return {
    uuid: stringField(root, 'uuid', POAM_BASE_PATH, state, true),
    metadata: readRootMetadata(root),
    importSsp: importSsp(root, state),
    systemId: systemId === null ? null : {
      id: stringField(systemId, 'id', `${POAM_BASE_PATH}/system-id`, state, true),
      identifierType: stringField(systemId, 'identifier-type', `${POAM_BASE_PATH}/system-id`, state),
      path: `${POAM_BASE_PATH}/system-id`,
    },
    localDefinitions: {
      components: readObjectArrayField(local, 'components', lp, state).map(({ node, path }) =>
        componentEntity(node, path, state),
      ),
      inventoryItems: readObjectArrayField(local, 'inventory-items', lp, state).map(({ node, path }) =>
        inventoryEntity(node, path, state),
      ),
      assessmentAssets,
      remarks: stringField(local, 'remarks', lp, state),
    },
    poamItems,
    observations,
    risks,
    findings,
    evidence,
    diagnostics: Object.freeze([...state.diagnostics, ...evidence.diagnostics]),
  };
}
