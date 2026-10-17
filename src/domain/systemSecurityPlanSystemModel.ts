// =============================================================================
// Domänenmodell eines OSCAL System Security Plan — Systembeschreibung (GSPP-293)
//
// Die Typen für `system-characteristics` und `system-implementation`. Sie
// gehören zu `src/domain/systemSecurityPlanModel.ts`, das sie re-exportiert;
// abgeleitet werden sie in `src/adapters/oscalSspSystem.ts`.
// =============================================================================

import type { OscalResponsibleRoleView } from '@/domain/oscalRootDocument';
import type {
  SspComponentReference,
  SspElements,
  SspState,
} from '@/domain/systemSecurityPlanModel';

/* ------------------------------------------------------------------ */
/*  system-characteristics                                             */
/* ------------------------------------------------------------------ */

export interface SspSystemId {
  readonly id: string;
  readonly identifierType?: string;
}

export interface SspImpact extends SspElements {
  readonly base?: string;
  readonly selected?: string;
  readonly adjustmentJustification?: string;
}

export interface SspInformationTypeCategorization {
  readonly system?: string;
  readonly informationTypeIds: readonly string[];
}

export interface SspInformationType extends SspElements {
  readonly uuid?: string;
  readonly title?: string;
  readonly description?: string;
  readonly categorizations: readonly SspInformationTypeCategorization[];
  readonly confidentialityImpact: SspImpact | null;
  readonly integrityImpact: SspImpact | null;
  readonly availabilityImpact: SspImpact | null;
  readonly path: string;
}

export interface SspSystemInformation extends SspElements {
  readonly informationTypes: readonly SspInformationType[];
  readonly path: string;
}

export interface SspSecurityImpactLevel {
  readonly confidentiality?: string;
  readonly integrity?: string;
  readonly availability?: string;
}

export interface SspDiagram extends SspElements {
  readonly uuid?: string;
  readonly description?: string;
  readonly caption?: string;
  readonly remarks?: string;
}

/** `authorization-boundary`, `network-architecture` oder `data-flow`. */
export interface SspSystemDescription extends SspElements {
  readonly description?: string;
  readonly diagrams: readonly SspDiagram[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspSystemCharacteristics extends SspElements {
  readonly systemIds: readonly SspSystemId[];
  readonly systemName?: string;
  readonly systemNameShort?: string;
  readonly description?: string;
  readonly dateAuthorized?: string;
  readonly securitySensitivityLevel?: string;
  readonly systemInformation: SspSystemInformation | null;
  readonly securityImpactLevel: SspSecurityImpactLevel | null;
  readonly status: SspState | null;
  readonly authorizationBoundary: SspSystemDescription | null;
  readonly networkArchitecture: SspSystemDescription | null;
  readonly dataFlow: SspSystemDescription | null;
  readonly responsibleParties: readonly OscalResponsibleRoleView[];
  readonly remarks?: string;
  readonly path: string;
}

/* ------------------------------------------------------------------ */
/*  system-implementation                                              */
/* ------------------------------------------------------------------ */

export interface SspLeveragedAuthorization extends SspElements {
  readonly uuid?: string;
  readonly title?: string;
  readonly partyUuid?: string;
  readonly dateAuthorized?: string;
  readonly remarks?: string;
  readonly path: string;
}

export interface SspAuthorizedPrivilege {
  readonly title?: string;
  readonly description?: string;
  readonly functionsPerformed: readonly string[];
}

export interface SspUser extends SspElements {
  readonly uuid?: string;
  readonly title?: string;
  readonly shortName?: string;
  readonly description?: string;
  readonly roleIds: readonly string[];
  readonly authorizedPrivileges: readonly SspAuthorizedPrivilege[];
  readonly remarks?: string;
  readonly path: string;
}

/** Eine Komponente des Systems; `protocols` bleiben im Quellgraphen. */
export interface SspComponent extends SspElements {
  readonly uuid?: string;
  readonly type?: string;
  readonly title?: string;
  readonly description?: string;
  readonly purpose?: string;
  readonly status: SspState | null;
  readonly responsibleRoles: readonly OscalResponsibleRoleView[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspImplementedComponent extends SspElements {
  readonly componentUuid?: string;
  readonly component: SspComponentReference;
  readonly responsibleParties: readonly OscalResponsibleRoleView[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspInventoryItem extends SspElements {
  readonly uuid?: string;
  readonly description?: string;
  readonly responsibleParties: readonly OscalResponsibleRoleView[];
  readonly implementedComponents: readonly SspImplementedComponent[];
  readonly remarks?: string;
  readonly path: string;
}

export interface SspSystemImplementation extends SspElements {
  readonly leveragedAuthorizations: readonly SspLeveragedAuthorization[];
  readonly users: readonly SspUser[];
  readonly components: readonly SspComponent[];
  readonly inventoryItems: readonly SspInventoryItem[];
  readonly remarks?: string;
  readonly path: string;
}
