// Strukturleser und Indizes des Assessment-Plan-Adapters. Diagnosen tragen nur strukturelle Pfade.
import { createElementReaders, createStructureReaders } from '@/adapters/oscalReaders';
import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { isJsonObject, readString, type JsonObject } from '@/domain/jsonGuards';
import { OSCAL_NAMESPACE } from '@/domain/mappingModel';
import type { RootDeriveFrame } from '@/adapters/oscalRootDocumentParse';
import type {
  ApControlReference,
  ApEntity,
  ApReference,
  AssessmentPlanDeriveOptions,
} from '@/domain/assessmentPlanModel';

export const AP_BASE_PATH = '/assessment-plan';
export const AP_ADAPTER_VALIDATOR = Object.freeze({
  name: 'gspp-assessment-plan-adapter',
  version: '1',
});
export interface ApDeriveState extends RootDeriveFrame {
  readonly diagnostics: OscalDiagnostic[];
  readonly options: AssessmentPlanDeriveOptions;
  readonly local: Map<string, Map<string, string[]>>;
  readonly ssp: Map<string, Map<string, string[]>>;
  sspAvailable: boolean;
}
export function diagnose(state: ApDeriveState, code: string, path: string): void {
  state.diagnostics.push(
    createOscalDiagnostic({
      code: `OSCAL_AP_${code}`,
      stage: 'domain',
      validator: AP_ADAPTER_VALIDATOR,
      path,
      artifact: {
        key: state.artifactKey,
        rootType: 'assessment-plan',
        oscalVersion: state.oscalVersion,
      },
    }),
  );
}
export function unexpected(state: ApDeriveState, path: string): void {
  diagnose(state, 'STRUCTURE_UNEXPECTED', path);
}
const readers = createStructureReaders<ApDeriveState>(unexpected);
export const { readObjectArrayField, readStringArrayField } = readers;
const elements = createElementReaders(readers, unexpected, {
  includeProp: (prop) => prop.ns === undefined || prop.ns === OSCAL_NAMESPACE,
});
export function readElements(
  node: JsonObject,
  path: string,
  state: ApDeriveState,
  includeRemarks = true,
) {
  return {
    props: elements.readProps(node, path, state),
    links: elements.readLinks(node, path, state),
    remarks: includeRemarks ? stringField(node, 'remarks', path, state) : undefined,
    path,
  };
}
export function stringField(
  node: JsonObject,
  key: string,
  path: string,
  state: ApDeriveState,
  required = false,
): string | undefined {
  const value = node[key];
  if (typeof value === 'string') return value;
  if (value !== undefined || required) unexpected(state, `${path}/${key}`);
  return undefined;
}
export function objectField(
  node: JsonObject,
  key: string,
  path: string,
  state: ApDeriveState,
  required = false,
): JsonObject | null {
  const value = node[key];
  if (isJsonObject(value)) return value;
  if (value !== undefined || required) unexpected(state, `${path}/${key}`);
  return null;
}
export function entity(node: JsonObject, path: string, state: ApDeriveState): ApEntity {
  return {
    ...readElements(node, path, state),
    uuid: stringField(node, 'uuid', path, state),
    title: stringField(node, 'title', path, state),
    description: stringField(node, 'description', path, state),
  };
}
export function componentEntity(node: JsonObject, path: string, state: ApDeriveState) {
  const status = objectField(node, 'status', path, state);
  return {
    ...entity(node, path, state),
    type: stringField(node, 'type', path, state),
    purpose: stringField(node, 'purpose', path, state),
    status:
      status === null
        ? null
        : {
            state: stringField(status, 'state', `${path}/status`, state),
            remarks: stringField(status, 'remarks', `${path}/status`, state),
          },
  };
}
export function userEntity(node: JsonObject, path: string, state: ApDeriveState) {
  checkIdentityArray(node, 'role-ids', 'role', path, state);
  return {
    ...entity(node, path, state),
    shortName: stringField(node, 'short-name', path, state),
    roleIds: readStringArrayField(node, 'role-ids', path, state),
  };
}
export function inventoryEntity(node: JsonObject, path: string, state: ApDeriveState): ApEntity {
  return {
    ...readElements(node, path, state),
    uuid: stringField(node, 'uuid', path, state),
    description: stringField(node, 'description', path, state),
  };
}
export function addIndex(
  index: ApDeriveState['local'],
  type: string,
  id: string,
  path: string,
): number {
  let byId = index.get(type);
  if (byId === undefined) {
    byId = new Map();
    index.set(type, byId);
  }
  const key = type === 'role' ? id : id.toLowerCase();
  const paths = byId.get(key) ?? [];
  paths.push(path);
  byId.set(key, paths);
  return paths.length;
}
export function indexNodes(
  state: ApDeriveState,
  node: JsonObject,
  key: string,
  type: string,
  path: string,
  duplicateCode?: string,
): void {
  const values = node[key];
  if (!Array.isArray(values)) return;
  values.forEach((value: unknown, index) => {
    const uuid = isJsonObject(value) ? readString(value.uuid) : undefined;
    if (
      uuid !== undefined &&
      addIndex(state.local, type, uuid, `${path}/${key}/${index}`) > 1 &&
      duplicateCode !== undefined
    ) {
      diagnose(state, duplicateCode, `${path}/${key}/${index}/uuid`);
    }
  });
}
export function reference(
  state: ApDeriveState,
  type: string | undefined,
  id: string | undefined,
  path: string,
  external: boolean,
  code: string,
): ApReference {
  if (type === undefined || id === undefined) {
    diagnose(state, code, path);
    return { status: 'unresolved', reason: 'identity-missing' };
  }
  const key = type === 'role' ? id : id.toLowerCase();
  const local = state.local.get(type)?.get(key) ?? [];
  if (local.length === 1) return { status: 'resolved', origin: 'local', path: local[0] };
  if (local.length > 1) {
    diagnose(state, code, path);
    return { status: 'unresolved', reason: 'identity-ambiguous' };
  }
  if (external && !state.sspAvailable)
    return {
      status: 'not-resolvable-in-context',
      reason: state.options.ssp === undefined ? 'ssp-not-supplied' : 'ssp-binding-invalid',
    };
  const remote = external ? (state.ssp.get(type)?.get(key) ?? []) : [];
  if (remote.length === 1) return { status: 'resolved', origin: 'ssp', path: remote[0] };
  diagnose(state, code, path);
  return {
    status: 'unresolved',
    reason: remote.length > 1 ? 'identity-ambiguous' : 'identity-not-found',
  };
}
export function controlReference(
  id: string | undefined,
  path: string,
  state: ApDeriveState,
): ApControlReference {
  if (id === undefined) {
    unexpected(state, path);
    return { status: 'unresolved', reason: 'control-id-missing' };
  }
  const binding = state.options.catalog;
  if (binding === undefined)
    return {
      status: 'not-resolvable-in-context',
      reason: 'catalog-not-supplied',
    };
  const control = binding.catalog.controlsById.get(id);
  if (control === undefined) {
    diagnose(state, 'CONTROL_REFERENCE_UNRESOLVED', path);
    return { status: 'unresolved', reason: 'control-not-in-catalog' };
  }
  return { status: 'resolved', catalogKey: binding.catalogKey, control };
}
/** Prüft die Quellindizes auch dann korrekt, wenn Strukturleser ungültige Einträge auslassen. */
function checkIdentityArray(
  node: JsonObject,
  key: 'role-ids' | 'party-uuids',
  type: 'role' | 'party',
  path: string,
  state: ApDeriveState,
): void {
  const values = node[key];
  if (!Array.isArray(values)) return;
  const code = type === 'role' ? 'ROLE_REFERENCE_UNRESOLVED' : 'PARTY_REFERENCE_UNRESOLVED';
  values.forEach((value: unknown, index) => {
    if (typeof value === 'string')
      reference(state, type, value, `${path}/${key}/${index}`, true, code);
  });
}
export function responsibleRoles(node: JsonObject, path: string, state: ApDeriveState) {
  return readObjectArrayField(node, 'responsible-roles', path, state).flatMap(
    ({ node: role, path: rolePath }) => {
      const roleId = stringField(role, 'role-id', rolePath, state, true);
      checkIdentityArray(role, 'party-uuids', 'party', rolePath, state);
      if (roleId === undefined) return [];
      return [
        {
          roleId,
          partyUuids: readStringArrayField(role, 'party-uuids', rolePath, state),
          remarks: stringField(role, 'remarks', rolePath, state),
          reference: reference(
            state,
            'role',
            roleId,
            `${rolePath}/role-id`,
            true,
            'ROLE_REFERENCE_UNRESOLVED',
          ),
        },
      ];
    },
  );
}
