// =============================================================================
// Raw-Typen des OSCAL-Root-Modells `system-security-plan` (GSPP-293)
//
// Die Typen sind über `PinnedOscalVersion` parametrisiert wie die der Component
// Definition: Ein Feld, dessen Pflichtstatus je Version wechselt, hängt an
// einem benannten Feldprädikat. Für den SSP ist das genau eines —
// `system-implementation.users` ist in 1.1.2 und 1.1.3 Pflicht, ab 1.2.1
// optional. `protocol` und `port-range` stammen aus dem Implementation-Common-
// Modell und kommen mit ihren eigenen Prädikaten aus
// `src/domain/oscalComponentDefinition.ts`.
//
// Gegen ein stilles Abdriften schützt
// `oscalSystemSecurityPlan.versionDrift.test.ts`: Der Test liest alle vier
// gepinnten `oscal_ssp_schema.json` und weist die vollständige Menge der
// Definitionsunterschiede nach.
//
// Verlustfreiheit (ADR-2) liegt nicht an diesen Typen: Die Wahrheit ist der
// unveränderte `source`. Die Typen beschreiben, was die Projektion lesen darf.
// =============================================================================

import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { RawOscalMetadata, RawOscalProp } from '@/domain/models';
import type {
  RawOscalComponentBackMatter,
  RawOscalComponentLink,
  RawOscalProtocol,
  RawOscalResponsibleRole,
  RawOscalSetParameter,
} from '@/domain/oscalComponentDefinition';

/** Versionen, in denen `system-implementation.users` Pflichtfeld ist (`minItems: 1`). */
export type OscalVersionsWithRequiredSystemUsers = '1.1.2' | '1.1.3';

/** Ein `responsible-party`: Rolle plus mindestens eine Partei. */
export interface RawOscalResponsibleParty {
  'role-id': string;
  'party-uuids': string[];
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

/* ------------------------------------------------------------------ */
/*  system-characteristics                                             */
/* ------------------------------------------------------------------ */

export interface RawOscalSystemId {
  id: string;
  'identifier-type'?: string;
}

export interface RawOscalImpact {
  base: string;
  selected?: string;
  'adjustment-justification'?: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
}

export interface RawOscalInformationType {
  uuid?: string;
  title: string;
  description: string;
  categorizations?: Array<{ system: string; 'information-type-ids'?: string[] }>;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'confidentiality-impact'?: RawOscalImpact;
  'integrity-impact'?: RawOscalImpact;
  'availability-impact'?: RawOscalImpact;
}

export interface RawOscalDiagram {
  uuid: string;
  description?: string;
  caption?: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

/** Gemeinsame Form von `authorization-boundary`, `network-architecture` und `data-flow`. */
export interface RawOscalSystemDescription {
  description: string;
  diagrams?: RawOscalDiagram[];
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

export interface RawOscalSystemCharacteristics {
  'system-ids': RawOscalSystemId[];
  'system-name': string;
  'system-name-short'?: string;
  description: string;
  'date-authorized'?: string;
  'security-sensitivity-level'?: string;
  'system-information': {
    'information-types': RawOscalInformationType[];
    props?: RawOscalProp[];
    links?: RawOscalComponentLink[];
  };
  'security-impact-level'?: {
    'security-objective-confidentiality': string;
    'security-objective-integrity': string;
    'security-objective-availability': string;
  };
  status: { state: string; remarks?: string };
  'authorization-boundary': RawOscalSystemDescription;
  'network-architecture'?: RawOscalSystemDescription;
  'data-flow'?: RawOscalSystemDescription;
  'responsible-parties'?: RawOscalResponsibleParty[];
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

/* ------------------------------------------------------------------ */
/*  system-implementation                                              */
/* ------------------------------------------------------------------ */

export interface RawOscalLeveragedAuthorization {
  uuid: string;
  title: string;
  'party-uuid': string;
  'date-authorized': string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

export interface RawOscalSystemUser {
  uuid: string;
  title?: string;
  'short-name'?: string;
  description?: string;
  'role-ids'?: string[];
  'authorized-privileges'?: Array<{
    title: string;
    description?: string;
    'functions-performed': string[];
  }>;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

export interface RawOscalSystemComponent<V extends PinnedOscalVersion = PinnedOscalVersion> {
  uuid: string;
  type: string;
  title: string;
  description: string;
  purpose?: string;
  status: { state: string; remarks?: string };
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'responsible-roles'?: RawOscalResponsibleRole[];
  protocols?: RawOscalProtocol<V>[];
  remarks?: string;
}

export interface RawOscalInventoryItem {
  uuid: string;
  description: string;
  'responsible-parties'?: RawOscalResponsibleParty[];
  'implemented-components'?: Array<{
    'component-uuid': string;
    props?: RawOscalProp[];
    links?: RawOscalComponentLink[];
    'responsible-parties'?: RawOscalResponsibleParty[];
    remarks?: string;
  }>;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

interface RawOscalSystemImplementationBase<V extends PinnedOscalVersion> {
  'leveraged-authorizations'?: RawOscalLeveragedAuthorization[];
  components: RawOscalSystemComponent<V>[];
  'inventory-items'?: RawOscalInventoryItem[];
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  remarks?: string;
}

export type RawOscalSystemImplementation<V extends PinnedOscalVersion = PinnedOscalVersion> =
  RawOscalSystemImplementationBase<V>
  & (V extends OscalVersionsWithRequiredSystemUsers
    ? { users: RawOscalSystemUser[] }
    : { users?: RawOscalSystemUser[] });

/* ------------------------------------------------------------------ */
/*  control-implementation                                             */
/* ------------------------------------------------------------------ */

interface RawOscalResponsibilityBase {
  uuid: string;
  description: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'responsible-roles'?: RawOscalResponsibleRole[];
  remarks?: string;
}

export interface RawOscalByComponentExport {
  description?: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  provided?: RawOscalResponsibilityBase[];
  responsibilities?: Array<RawOscalResponsibilityBase & { 'provided-uuid'?: string }>;
  remarks?: string;
}

/**
 * Eine Komponente je Anforderung. `implementation-status`, `export`,
 * `inherited` und `satisfied` sitzen ausschließlich hier — nicht an der
 * Anforderung und nicht am Statement.
 */
export interface RawOscalByComponent {
  'component-uuid': string;
  uuid: string;
  description: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'set-parameters'?: RawOscalSetParameter[];
  /** `state` ist ein offenes Token; das Enum des Schemas ist keine geschlossene Menge. */
  'implementation-status'?: { state: string; remarks?: string };
  export?: RawOscalByComponentExport;
  inherited?: Array<Omit<RawOscalResponsibilityBase, 'remarks'> & { 'provided-uuid'?: string }>;
  satisfied?: Array<RawOscalResponsibilityBase & { 'responsibility-uuid'?: string }>;
  'responsible-roles'?: RawOscalResponsibleRole[];
  remarks?: string;
}

export interface RawOscalSspStatement {
  'statement-id': string;
  uuid: string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'responsible-roles'?: RawOscalResponsibleRole[];
  'by-components'?: RawOscalByComponent[];
  remarks?: string;
}

export interface RawOscalSspImplementedRequirement {
  uuid: string;
  'control-id': string;
  props?: RawOscalProp[];
  links?: RawOscalComponentLink[];
  'set-parameters'?: RawOscalSetParameter[];
  'responsible-roles'?: RawOscalResponsibleRole[];
  statements?: RawOscalSspStatement[];
  'by-components'?: RawOscalByComponent[];
  remarks?: string;
}

export interface RawOscalSspControlImplementation {
  description: string;
  'set-parameters'?: RawOscalSetParameter[];
  'implemented-requirements': RawOscalSspImplementedRequirement[];
}

/* ------------------------------------------------------------------ */
/*  Root                                                               */
/* ------------------------------------------------------------------ */

/**
 * Der SSP-Körper. Pflicht sind in allen vier gepinnten Versionen dieselben
 * sechs Felder; `import-profile` trägt genau einen `href`.
 */
export interface RawOscalSystemSecurityPlan<V extends PinnedOscalVersion = PinnedOscalVersion> {
  uuid: string;
  metadata: RawOscalMetadata;
  'import-profile': { href: string; remarks?: string };
  'system-characteristics': RawOscalSystemCharacteristics;
  'system-implementation': RawOscalSystemImplementation<V>;
  'control-implementation': RawOscalSspControlImplementation;
  'back-matter'?: RawOscalComponentBackMatter;
}
