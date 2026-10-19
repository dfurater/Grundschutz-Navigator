// Verlustfreie, rein lokale Ableitung des Assessment Plans (GSPP-295).
import { openRootDerive } from '@/adapters/oscalRootDocumentParse';
import { ASSESSMENT_PLAN_ROOT_TYPE } from '@/domain/assessmentPlanModel';
import type { AssessmentPlan, AssessmentPlanDeriveOptions } from '@/domain/assessmentPlanModel';
import { isJsonObject, readString, type JsonObject } from '@/domain/jsonGuards';
import { readRootMetadata } from '@/domain/oscalRootDispatch';
import type { OscalDocumentContext } from '@/domain/models';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { resolveOscalReference } from '@/domain/referenceResolution';
import {
  AP_ADAPTER_VALIDATOR,
  AP_BASE_PATH,
  addIndex,
  controlReference,
  diagnose,
  componentEntity,
  userEntity,
  inventoryEntity,
  indexNodes,
  objectField,
  readElements,
  readObjectArrayField,
  reference,
  stringField,
} from '@/adapters/oscalAssessmentPlanReaders';
import type { ApDeriveState } from '@/adapters/oscalAssessmentPlanReaders';
import { parts, reviewedControls, subjects } from '@/adapters/oscalAssessmentPlanSelections';
import { activities, tasks } from '@/adapters/oscalAssessmentPlanTasks';
export type * from '@/domain/assessmentPlanModel';
export { ASSESSMENT_PLAN_ROOT_TYPE } from '@/domain/assessmentPlanModel';

export class AssessmentPlanTrustClassError extends Error {
  readonly diagnostic = createOscalDiagnostic({
    code: 'OSCAL_AP_TRUST_CLASS_REJECTED',
    stage: 'domain',
    validator: AP_ADAPTER_VALIDATOR,
    path: '/',
    artifact: { rootType: 'assessment-plan' },
  });
  constructor() {
    super('Assessment-Plan-Ableitung abgewiesen: OSCAL_AP_TRUST_CLASS_REJECTED');
    this.name = 'AssessmentPlanTrustClassError';
  }
}

function indexMetadata(body: JsonObject, index: ApDeriveState['local'], rootPath: string): void {
  if (!isJsonObject(body.metadata)) return;
  for (const [key, type, field] of [
    ['roles', 'role', 'id'],
    ['parties', 'party', 'uuid'],
    ['locations', 'location', 'uuid'],
  ] as const) {
    const values = body.metadata[key];
    if (!Array.isArray(values)) continue;
    values.forEach((node: unknown, i) => {
      const id = isJsonObject(node) ? readString(node[field]) : undefined;
      if (id !== undefined) addIndex(index, type, id, `${rootPath}/metadata/${key}/${i}`);
    });
  }
}
function indexTasks(body: JsonObject, path: string, state: ApDeriveState): void {
  indexNodes(state, body, 'tasks', 'task', path, 'TASK_UUID_DUPLICATE');
  if (Array.isArray(body.tasks))
    body.tasks.forEach((task: unknown, i) => {
      if (isJsonObject(task)) indexTasks(task, `${path}/tasks/${i}`, state);
    });
}
function indexLocal(body: JsonObject, local: JsonObject, state: ApDeriveState): void {
  const p = `${AP_BASE_PATH}/local-definitions`;
  indexNodes(state, local, 'components', 'component', p, 'COMPONENT_UUID_DUPLICATE');
  indexNodes(state, local, 'users', 'user', p, 'USER_UUID_DUPLICATE');
  indexNodes(state, local, 'inventory-items', 'inventory-item', p, 'INVENTORY_UUID_DUPLICATE');
  indexNodes(state, local, 'activities', 'activity', p, 'ACTIVITY_UUID_DUPLICATE');
  const backMatter = objectField(body, 'back-matter', AP_BASE_PATH, state);
  if (backMatter !== null)
    indexNodes(state, backMatter, 'resources', 'resource', `${AP_BASE_PATH}/back-matter`);
  indexMetadata(body, state.local, AP_BASE_PATH);
  indexTasks(body, AP_BASE_PATH, state);
}
function indexBoundSsp(state: ApDeriveState): void {
  const binding = state.options.ssp;
  if (binding === undefined) return;
  if (binding.context.trustClass !== 'class-2-local-user')
    throw new AssessmentPlanTrustClassError();
  const source = binding.source;
  if (!isJsonObject(source) || !isJsonObject(source['system-security-plan'])) {
    diagnose(state, 'SSP_BINDING_INVALID', `${AP_BASE_PATH}/import-ssp`);
    return;
  }
  state.sspAvailable = true;
  const root = source['system-security-plan'];
  indexMetadata(root, state.ssp, '/system-security-plan');
  const collect = (parent: unknown, key: string, type: string, path: string) => {
    if (!isJsonObject(parent) || !Array.isArray(parent[key])) return;
    parent[key].forEach((node: unknown, i: number) => {
      const uuid = isJsonObject(node) ? readString(node.uuid) : undefined;
      if (uuid !== undefined) addIndex(state.ssp, type, uuid, `${path}/${key}/${i}`);
    });
  };
  for (const [key, type] of [
    ['components', 'component'],
    ['inventory-items', 'inventory-item'],
    ['users', 'user'],
  ]) {
    collect(
      root['system-implementation'],
      key,
      type,
      '/system-security-plan/system-implementation',
    );
  }
  collect(root['back-matter'], 'resources', 'resource', '/system-security-plan/back-matter');
}
function deriveImportSsp(body: JsonObject, state: ApDeriveState): AssessmentPlan['importSsp'] {
  const node = objectField(body, 'import-ssp', AP_BASE_PATH, state, true);
  if (node === null) return null;
  const path = `${AP_BASE_PATH}/import-ssp`;
  const href = stringField(node, 'href', path, state, true);
  if (href === undefined) return null;
  return {
    href,
    remarks: stringField(node, 'remarks', path, state),
    path,
    reference: resolveOscalReference(
      { href, path: `${path}/href` },
      { document: state.referenceDocument },
    ),
    ssp: {
      status: state.sspAvailable ? 'bound' : 'not-resolvable-in-context',
    },
  };
}
function deriveAssets(body: JsonObject, state: ApDeriveState): AssessmentPlan['assessmentAssets'] {
  const node = objectField(body, 'assessment-assets', AP_BASE_PATH, state);
  if (node === null) return null;
  const p = `${AP_BASE_PATH}/assessment-assets`;
  indexNodes(state, node, 'components', 'component', p, 'COMPONENT_UUID_DUPLICATE');
  return {
    components: readObjectArrayField(node, 'components', p, state).map((entry) =>
      componentEntity(entry.node, entry.path, state),
    ),
    assessmentPlatforms: readObjectArrayField(node, 'assessment-platforms', p, state).map(
      ({ node: platform, path: pp }) => ({
        ...readElements(platform, pp, state),
        uuid: stringField(platform, 'uuid', pp, state, true),
        title: stringField(platform, 'title', pp, state),
        usesComponents: readObjectArrayField(platform, 'uses-components', pp, state).map(
          ({ node: use, path: up }) => {
            const componentUuid = stringField(use, 'component-uuid', up, state, true);
            return {
              ...readElements(use, up, state),
              componentUuid,
              reference: reference(
                state,
                'component',
                componentUuid,
                `${up}/component-uuid`,
                true,
                'COMPONENT_REFERENCE_UNRESOLVED',
              ),
            };
          },
        ),
      }),
    ),
  };
}
export function deriveAssessmentPlan(
  body: unknown,
  context: OscalDocumentContext,
  options: AssessmentPlanDeriveOptions = {},
): AssessmentPlan {
  if (context.trustClass !== 'class-2-local-user') throw new AssessmentPlanTrustClassError();
  const frame = openRootDerive(body, context, ASSESSMENT_PLAN_ROOT_TYPE);
  const state: ApDeriveState = {
    ...frame,
    diagnostics: [],
    options,
    local: new Map(),
    ssp: new Map(),
    sspAvailable: false,
  };
  if (!frame.bodyIsObject) diagnose(state, 'STRUCTURE_UNEXPECTED', AP_BASE_PATH);
  const root = frame.rootBody;
  const local = objectField(root, 'local-definitions', AP_BASE_PATH, state) ?? {};
  indexLocal(root, local, state);
  indexBoundSsp(state);
  const assessmentAssets = deriveAssets(root, state);
  const lp = `${AP_BASE_PATH}/local-definitions`;
  const terms = objectField(root, 'terms-and-conditions', AP_BASE_PATH, state);
  return {
    uuid: stringField(root, 'uuid', AP_BASE_PATH, state, true),
    metadata: readRootMetadata(root),
    importSsp: deriveImportSsp(root, state),
    reviewedControls: reviewedControls(root, 'reviewed-controls', AP_BASE_PATH, state, true),
    localDefinitions: {
      components: readObjectArrayField(local, 'components', lp, state).map((entry) =>
        componentEntity(entry.node, entry.path, state),
      ),
      users: readObjectArrayField(local, 'users', lp, state).map((entry) =>
        userEntity(entry.node, entry.path, state),
      ),
      inventoryItems: readObjectArrayField(local, 'inventory-items', lp, state).map((entry) =>
        inventoryEntity(entry.node, entry.path, state),
      ),
      activities: activities(local, lp, state),
      objectivesAndMethods: readObjectArrayField(local, 'objectives-and-methods', lp, state).map(
        ({ node, path }) => {
          const controlId = stringField(node, 'control-id', path, state, true);
          return {
            ...readElements(node, path, state),
            controlId,
            control: controlReference(controlId, `${path}/control-id`, state),
            description: stringField(node, 'description', path, state),
            parts: parts(node, path, state),
          };
        },
      ),
      remarks: stringField(local, 'remarks', lp, state),
    },
    termsAndConditions:
      terms === null
        ? []
        : parts(terms, `${AP_BASE_PATH}/terms-and-conditions`, state, { assessmentPart: true }),
    assessmentSubjects: subjects(root, 'assessment-subjects', AP_BASE_PATH, state),
    assessmentAssets,
    tasks: tasks(root, AP_BASE_PATH, state),
    diagnostics: Object.freeze(state.diagnostics),
  };
}
