// =============================================================================
// SSP-Ableitung: `system-characteristics` und `system-implementation` (GSPP-293)
//
// Teil des Modelladapters `src/adapters/oscalSspAdapter.ts`. Die Komponenten
// werden vor dem Inventar gelesen und in `componentsByUuid` registriert:
// Inventar und `control-implementation` lösen ihre `component-uuid` dagegen
// auf. Eine doppelte Komponenten-UUID wird am späteren Knoten diagnostiziert.
// =============================================================================

import {
  checkPartyUuidReference,
  checkRoleAssignmentReferences,
  checkRoleIdReferences,
  diagnose,
  readElements,
  readObjectArrayField,
  readObjectField,
  readResponsibleParties,
  readResponsibleRoles,
  readState,
  readStringArrayField,
  resolveComponentReference,
  SSP_ADAPTER_DIAGNOSTIC_CODES,
  SSP_BASE_PATH,
  uuidKey,
} from '@/adapters/oscalSspReaders';
import type { SspDeriveState } from '@/adapters/oscalSspReaders';
import { readString, type JsonObject } from '@/domain/jsonGuards';
import type {
  SspComponent,
  SspImpact,
  SspImplementedComponent,
  SspInformationType,
  SspInventoryItem,
  SspSystemCharacteristics,
  SspSystemDescription,
  SspSystemImplementation,
  SspSystemInformation,
  SspUser,
} from '@/domain/systemSecurityPlanModel';

/* ------------------------------------------------------------------ */
/*  system-characteristics                                             */
/* ------------------------------------------------------------------ */

function readImpact(node: JsonObject, key: string, path: string, state: SspDeriveState): SspImpact | null {
  const impact = readObjectField(node, key, path, state);
  if (impact === null) return null;
  return {
    base: readString(impact.base),
    selected: readString(impact.selected),
    adjustmentJustification: readString(impact['adjustment-justification']),
    ...readElements(impact, `${path}/${key}`, state),
  };
}

function deriveInformationTypes(
  systemInformation: JsonObject,
  path: string,
  state: SspDeriveState,
): readonly SspInformationType[] {
  return readObjectArrayField(systemInformation, 'information-types', path, state).map(
    ({ node, path: typePath }) => ({
      uuid: readString(node.uuid),
      title: readString(node.title),
      description: readString(node.description),
      categorizations: readObjectArrayField(node, 'categorizations', typePath, state).map(
        ({ node: categorization, path: categorizationPath }) => ({
          system: readString(categorization.system),
          informationTypeIds: readStringArrayField(
            categorization,
            'information-type-ids',
            categorizationPath,
            state,
          ),
        }),
      ),
      confidentialityImpact: readImpact(node, 'confidentiality-impact', typePath, state),
      integrityImpact: readImpact(node, 'integrity-impact', typePath, state),
      availabilityImpact: readImpact(node, 'availability-impact', typePath, state),
      ...readElements(node, typePath, state),
      path: typePath,
    }),
  );
}

function deriveSystemInformation(node: JsonObject, path: string, state: SspDeriveState): SspSystemInformation | null {
  const systemInformation = readObjectField(node, 'system-information', path, state, true);
  if (systemInformation === null) return null;

  const informationPath = `${path}/system-information`;
  return {
    informationTypes: deriveInformationTypes(systemInformation, informationPath, state),
    ...readElements(systemInformation, informationPath, state),
    path: informationPath,
  };
}

function deriveSystemDescription(
  node: JsonObject,
  key: string,
  path: string,
  state: SspDeriveState,
  required = false,
): SspSystemDescription | null {
  const description = readObjectField(node, key, path, state, required);
  if (description === null) return null;

  const descriptionPath = `${path}/${key}`;
  return {
    description: readString(description.description),
    diagrams: readObjectArrayField(description, 'diagrams', descriptionPath, state).map(
      ({ node: diagram, path: diagramPath }) => ({
        uuid: readString(diagram.uuid),
        description: readString(diagram.description),
        caption: readString(diagram.caption),
        remarks: readString(diagram.remarks),
        ...readElements(diagram, diagramPath, state),
      }),
    ),
    remarks: readString(description.remarks),
    ...readElements(description, descriptionPath, state),
    path: descriptionPath,
  };
}

export function deriveSystemCharacteristics(
  body: JsonObject,
  state: SspDeriveState,
): SspSystemCharacteristics | null {
  const node = readObjectField(body, 'system-characteristics', SSP_BASE_PATH, state, true);
  if (node === null) return null;

  const path = `${SSP_BASE_PATH}/system-characteristics`;
  checkRoleAssignmentReferences(node, path, state, 'responsible-parties');
  const impactLevel = readObjectField(node, 'security-impact-level', path, state);

  return {
    systemIds: readObjectArrayField(node, 'system-ids', path, state).flatMap(
      ({ node: systemId, path: systemIdPath }) => {
        const id = readString(systemId.id);
        if (id === undefined) {
          diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, systemIdPath);
          return [];
        }
        return [{ id, identifierType: readString(systemId['identifier-type']) }];
      },
    ),
    systemName: readString(node['system-name']),
    systemNameShort: readString(node['system-name-short']),
    description: readString(node.description),
    dateAuthorized: readString(node['date-authorized']),
    securitySensitivityLevel: readString(node['security-sensitivity-level']),
    systemInformation: deriveSystemInformation(node, path, state),
    securityImpactLevel: impactLevel === null
      ? null
      : {
        confidentiality: readString(impactLevel['security-objective-confidentiality']),
        integrity: readString(impactLevel['security-objective-integrity']),
        availability: readString(impactLevel['security-objective-availability']),
      },
    status: readState(node, 'status', path, state, true),
    authorizationBoundary: deriveSystemDescription(node, 'authorization-boundary', path, state, true),
    networkArchitecture: deriveSystemDescription(node, 'network-architecture', path, state),
    dataFlow: deriveSystemDescription(node, 'data-flow', path, state),
    responsibleParties: readResponsibleParties(node, path, state),
    remarks: readString(node.remarks),
    ...readElements(node, path, state),
    path,
  };
}

/* ------------------------------------------------------------------ */
/*  system-implementation                                              */
/* ------------------------------------------------------------------ */

function deriveComponents(node: JsonObject, path: string, state: SspDeriveState): readonly SspComponent[] {
  return readObjectArrayField(node, 'components', path, state).map(({ node: component, path: componentPath }) => {
    checkRoleAssignmentReferences(component, componentPath, state);
    const uuid = readString(component.uuid);
    const derived: SspComponent = {
      uuid,
      type: readString(component.type),
      title: readString(component.title),
      description: readString(component.description),
      purpose: readString(component.purpose),
      status: readState(component, 'status', componentPath, state, true),
      responsibleRoles: readResponsibleRoles(component, componentPath, state),
      remarks: readString(component.remarks),
      ...readElements(component, componentPath, state),
      path: componentPath,
    };

    if (uuid !== undefined) {
      const existing = state.componentsByUuid.get(uuidKey(uuid));
      if (existing) {
        // Der Befund steht am späteren Knoten; die erste Fundstelle bleibt.
        diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.COMPONENT_UUID_DUPLICATE, `${componentPath}/uuid`);
        existing.push(derived);
      } else {
        state.componentsByUuid.set(uuidKey(uuid), [derived]);
      }
    }
    return derived;
  });
}

function deriveInventoryItems(node: JsonObject, path: string, state: SspDeriveState): readonly SspInventoryItem[] {
  return readObjectArrayField(node, 'inventory-items', path, state).map(({ node: item, path: itemPath }) => {
    checkRoleAssignmentReferences(item, itemPath, state, 'responsible-parties');
    return {
      uuid: readString(item.uuid),
      description: readString(item.description),
      responsibleParties: readResponsibleParties(item, itemPath, state),
      implementedComponents: deriveImplementedComponents(item, itemPath, state),
      remarks: readString(item.remarks),
      ...readElements(item, itemPath, state),
      path: itemPath,
    };
  });
}

function deriveImplementedComponents(
  item: JsonObject,
  itemPath: string,
  state: SspDeriveState,
): readonly SspImplementedComponent[] {
  return readObjectArrayField(item, 'implemented-components', itemPath, state).map(
    ({ node: implemented, path: implementedPath }) => {
      checkRoleAssignmentReferences(implemented, implementedPath, state, 'responsible-parties');
      const componentUuid = readString(implemented['component-uuid']);
      return {
        componentUuid,
        component: resolveComponentReference(componentUuid, `${implementedPath}/component-uuid`, state),
        responsibleParties: readResponsibleParties(implemented, implementedPath, state),
        remarks: readString(implemented.remarks),
        ...readElements(implemented, implementedPath, state),
        path: implementedPath,
      };
    },
  );
}

function deriveUsers(node: JsonObject, path: string, state: SspDeriveState): readonly SspUser[] {
  return readObjectArrayField(node, 'users', path, state).map(({ node: user, path: userPath }) => {
    checkRoleIdReferences(user, userPath, state);
    return {
      uuid: readString(user.uuid),
      title: readString(user.title),
      shortName: readString(user['short-name']),
      description: readString(user.description),
      roleIds: readStringArrayField(user, 'role-ids', userPath, state),
      authorizedPrivileges: readObjectArrayField(user, 'authorized-privileges', userPath, state).map(
        ({ node: privilege, path: privilegePath }) => ({
          title: readString(privilege.title),
          description: readString(privilege.description),
          functionsPerformed: readStringArrayField(privilege, 'functions-performed', privilegePath, state),
        }),
      ),
      remarks: readString(user.remarks),
      ...readElements(user, userPath, state),
      path: userPath,
    };
  });
}

export function deriveSystemImplementation(
  body: JsonObject,
  state: SspDeriveState,
): SspSystemImplementation | null {
  const node = readObjectField(body, 'system-implementation', SSP_BASE_PATH, state, true);
  if (node === null) return null;

  const path = `${SSP_BASE_PATH}/system-implementation`;
  // Komponenten vor dem Inventar: dessen `component-uuid` wird gegen sie aufgelöst.
  const components = deriveComponents(node, path, state);

  return {
    leveragedAuthorizations: readObjectArrayField(node, 'leveraged-authorizations', path, state).map(
      ({ node: authorization, path: authorizationPath }) => {
        checkPartyUuidReference(authorization['party-uuid'], `${authorizationPath}/party-uuid`, state);
        return {
          uuid: readString(authorization.uuid),
          title: readString(authorization.title),
          partyUuid: readString(authorization['party-uuid']),
          dateAuthorized: readString(authorization['date-authorized']),
          remarks: readString(authorization.remarks),
          ...readElements(authorization, authorizationPath, state),
          path: authorizationPath,
        };
      },
    ),
    users: deriveUsers(node, path, state),
    components,
    inventoryItems: deriveInventoryItems(node, path, state),
    remarks: readString(node.remarks),
    ...readElements(node, path, state),
    path,
  };
}
