// =============================================================================
// SSP-Ableitung: `control-implementation` (GSPP-293)
//
// Teil des Modelladapters `src/adapters/oscalSspAdapter.ts`. Der
// Umsetzungsstatus wird je `by-component` gelesen; an Anforderung und
// Statement entsteht keine Zusammenfassung. Eine `control-id` wird nur gegen
// die übergebene Baseline-Bindung aufgelöst, `statement-id` gar nicht.
// =============================================================================

import {
  checkRoleAssignmentReferences,
  diagnose,
  readElements,
  readObjectArrayField,
  readObjectField,
  readResponsibleRoles,
  readSetParameters,
  readState,
  resolveComponentReference,
  SSP_ADAPTER_DIAGNOSTIC_CODES,
  SSP_BASE_PATH,
  uuidKey,
} from '@/adapters/oscalSspReaders';
import type { SspDeriveState } from '@/adapters/oscalSspReaders';
import { readString, type JsonObject } from '@/domain/jsonGuards';
import { NOT_RESOLVABLE_IN_CONTEXT } from '@/domain/systemSecurityPlanModel';
import type {
  SspByComponent,
  SspControlImplementation,
  SspControlReference,
  SspExport,
  SspExternalUuidReference,
  SspImplementedRequirement,
  SspProvided,
  SspStatement,
} from '@/domain/systemSecurityPlanModel';

/* ------------------------------------------------------------------ */
/*  control-implementation                                             */
/* ------------------------------------------------------------------ */

function readExternalUuid(node: JsonObject, key: string): SspExternalUuidReference | null {
  const uuid = readString(node[key]);
  return uuid === undefined ? null : { uuid, status: NOT_RESOLVABLE_IN_CONTEXT };
}

function deriveProvided(node: JsonObject, path: string, state: SspDeriveState): SspProvided {
  checkRoleAssignmentReferences(node, path, state);
  return {
    uuid: readString(node.uuid),
    description: readString(node.description),
    responsibleRoles: readResponsibleRoles(node, path, state),
    remarks: readString(node.remarks),
    ...readElements(node, path, state),
    path,
  };
}

function deriveExport(node: JsonObject, path: string, state: SspDeriveState): SspExport | null {
  const exported = readObjectField(node, 'export', path, state);
  if (exported === null) return null;

  const exportPath = `${path}/export`;
  return {
    description: readString(exported.description),
    provided: readObjectArrayField(exported, 'provided', exportPath, state).map(
      ({ node: provided, path: providedPath }) => deriveProvided(provided, providedPath, state),
    ),
    responsibilities: readObjectArrayField(exported, 'responsibilities', exportPath, state).map(
      ({ node: responsibility, path: responsibilityPath }) => ({
        ...deriveProvided(responsibility, responsibilityPath, state),
        providedUuid: readString(responsibility['provided-uuid']),
      }),
    ),
    remarks: readString(exported.remarks),
    ...readElements(exported, exportPath, state),
  };
}

function deriveByComponents(node: JsonObject, path: string, state: SspDeriveState): readonly SspByComponent[] {
  const seen = new Set<string>();

  return readObjectArrayField(node, 'by-components', path, state).map(({ node: byComponent, path: byPath }) => {
    const componentUuid = readString(byComponent['component-uuid']);
    if (componentUuid !== undefined) {
      const key = uuidKey(componentUuid);
      if (seen.has(key)) {
        diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.BY_COMPONENT_DUPLICATE, `${byPath}/component-uuid`);
      }
      seen.add(key);
    }
    checkRoleAssignmentReferences(byComponent, byPath, state);

    return {
      uuid: readString(byComponent.uuid),
      componentUuid,
      component: resolveComponentReference(componentUuid, `${byPath}/component-uuid`, state),
      description: readString(byComponent.description),
      implementationStatus: readState(byComponent, 'implementation-status', byPath, state),
      export: deriveExport(byComponent, byPath, state),
      inherited: readObjectArrayField(byComponent, 'inherited', byPath, state).map(
        ({ node: inherited, path: inheritedPath }) => {
          checkRoleAssignmentReferences(inherited, inheritedPath, state);
          return {
            uuid: readString(inherited.uuid),
            description: readString(inherited.description),
            provided: readExternalUuid(inherited, 'provided-uuid'),
            responsibleRoles: readResponsibleRoles(inherited, inheritedPath, state),
            ...readElements(inherited, inheritedPath, state),
            path: inheritedPath,
          };
        },
      ),
      satisfied: readObjectArrayField(byComponent, 'satisfied', byPath, state).map(
        ({ node: satisfied, path: satisfiedPath }) => {
          checkRoleAssignmentReferences(satisfied, satisfiedPath, state);
          return {
            uuid: readString(satisfied.uuid),
            description: readString(satisfied.description),
            responsibility: readExternalUuid(satisfied, 'responsibility-uuid'),
            responsibleRoles: readResponsibleRoles(satisfied, satisfiedPath, state),
            remarks: readString(satisfied.remarks),
            ...readElements(satisfied, satisfiedPath, state),
            path: satisfiedPath,
          };
        },
      ),
      setParameters: readSetParameters(byComponent, byPath, state),
      responsibleRoles: readResponsibleRoles(byComponent, byPath, state),
      remarks: readString(byComponent.remarks),
      ...readElements(byComponent, byPath, state),
      path: byPath,
    };
  });
}

function resolveControlReference(
  controlId: string | undefined,
  path: string,
  state: SspDeriveState,
): SspControlReference {
  const codes = SSP_ADAPTER_DIAGNOSTIC_CODES;

  if (controlId === undefined) {
    return {
      status: 'unresolved',
      reason: 'control-id-missing',
      diagnostic: diagnose(state, codes.CONTROL_ID_MISSING, path),
    };
  }
  // Ohne Bindung ist die Baseline nicht Teil dieses Kontexts — kein Befund.
  if (state.baseline === null) {
    return { status: NOT_RESOLVABLE_IN_CONTEXT, reason: 'catalog-not-supplied' };
  }

  const control = state.baseline.catalog.controlsById.get(controlId);
  if (control === undefined) {
    return {
      status: 'unresolved',
      reason: 'control-not-in-catalog',
      diagnostic: diagnose(state, codes.CONTROL_REFERENCE_UNRESOLVED, path),
    };
  }
  if ('catalogKey' in state.baseline) {
    return { status: 'resolved', catalogKey: state.baseline.catalogKey,
      control: state.baseline.catalog.controlsById.get(controlId)! };
  }
  return { status: 'resolved', kind: 'transient',
    control: state.baseline.catalog.controlsById.get(controlId)! };
}

function deriveStatements(node: JsonObject, path: string, state: SspDeriveState): readonly SspStatement[] {
  return readObjectArrayField(node, 'statements', path, state).map(({ node: statement, path: statementPath }) => {
    checkRoleAssignmentReferences(statement, statementPath, state);
    return {
      uuid: readString(statement.uuid),
      statementId: readString(statement['statement-id']),
      byComponents: deriveByComponents(statement, statementPath, state),
      responsibleRoles: readResponsibleRoles(statement, statementPath, state),
      remarks: readString(statement.remarks),
      ...readElements(statement, statementPath, state),
      path: statementPath,
    };
  });
}

function deriveImplementedRequirements(
  node: JsonObject,
  path: string,
  state: SspDeriveState,
): readonly SspImplementedRequirement[] {
  return readObjectArrayField(node, 'implemented-requirements', path, state).map(
    ({ node: requirement, path: requirementPath }) => {
      checkRoleAssignmentReferences(requirement, requirementPath, state);
      const controlId = readString(requirement['control-id']);
      return {
        uuid: readString(requirement.uuid),
        controlId,
        control: resolveControlReference(controlId, `${requirementPath}/control-id`, state),
        setParameters: readSetParameters(requirement, requirementPath, state),
        responsibleRoles: readResponsibleRoles(requirement, requirementPath, state),
        statements: deriveStatements(requirement, requirementPath, state),
        byComponents: deriveByComponents(requirement, requirementPath, state),
        remarks: readString(requirement.remarks),
        ...readElements(requirement, requirementPath, state),
        path: requirementPath,
      };
    },
  );
}

export function deriveControlImplementation(
  body: JsonObject,
  state: SspDeriveState,
): SspControlImplementation | null {
  const node = readObjectField(body, 'control-implementation', SSP_BASE_PATH, state, true);
  if (node === null) return null;

  const path = `${SSP_BASE_PATH}/control-implementation`;
  return {
    description: readString(node.description),
    setParameters: readSetParameters(node, path, state),
    implementedRequirements: deriveImplementedRequirements(node, path, state),
    path,
  };
}
