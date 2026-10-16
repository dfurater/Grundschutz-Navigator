// =============================================================================
// Knotenleser und Diagnosesammler des SSP-Adapters (GSPP-293)
//
// Die Struktur- und Elementleser kommen aus `src/adapters/oscalReaders.ts` und
// werden hier an die SSP-Diagnose gebunden. Dazu kommen die Prüfungen der
// dokumentinternen Referenzen, die weder das JSON-Schema noch Stufe 3
// abdeckt: `component-uuid`, `role-id` und Party-UUIDs.
//
// Diagnosepfade sind strukturelle JSON Pointer aus Schlüsseln und Indizes. Ein
// Referenzwert aus dem Dokument erscheint nie in einer Diagnose.
// =============================================================================

import { createElementReaders, createStructureReaders } from '@/adapters/oscalReaders';
import { isJsonObject, readString, type JsonObject } from '@/domain/jsonGuards';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDiagnostic, OscalDiagnosticValidator } from '@/domain/oscalDiagnostics';
import type { ReferenceDocument } from '@/domain/referenceResolution';
import { SYSTEM_SECURITY_PLAN_ROOT_TYPE } from '@/domain/systemSecurityPlanModel';
import type {
  SspBaselineBinding,
  SspComponent,
  SspComponentReference,
  SspState,
} from '@/domain/systemSecurityPlanModel';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

/** JSON-Pointer des SSP-Körpers; Präfix jedes Diagnosepfads dieses Adapters. */
export const SSP_BASE_PATH = `/${SYSTEM_SECURITY_PLAN_ROOT_TYPE}`;

/** Stufe der modellinternen Befunde dieses Adapters. */
export const SSP_ADAPTER_STAGE = 'domain' as const;

/**
 * Vertragsversion des Adapters; sie geht in jede Diagnosesignatur ein und wird
 * erhöht, wenn sich Codes, Pfade oder Parameter einer bestehenden Diagnose
 * ändern.
 */
export const SSP_ADAPTER_VALIDATOR: OscalDiagnosticValidator = Object.freeze({
  name: 'gspp-ssp-adapter',
  version: '1',
});

export const SSP_ADAPTER_DIAGNOSTIC_CODES = Object.freeze({
  /** Der Ableitungskontext trägt keine Vertrauensklasse `class-2-local-user`. */
  TRUST_CLASS_REJECTED: 'OSCAL_SSP_TRUST_CLASS_REJECTED',
  /** Knoten hat nicht die vom Modell erwartete Form oder fehlt als Pflichtknoten. */
  STRUCTURE_UNEXPECTED: 'OSCAL_SSP_STRUCTURE_UNEXPECTED',
  /** Zwei Komponenten tragen dieselbe `uuid` (Metaschema-Index). */
  COMPONENT_UUID_DUPLICATE: 'OSCAL_SSP_COMPONENT_UUID_DUPLICATE',
  /** Eine `component-uuid` trifft keine oder mehr als eine Komponente. */
  COMPONENT_REFERENCE_UNRESOLVED: 'OSCAL_SSP_COMPONENT_REFERENCE_UNRESOLVED',
  /** Dieselbe `component-uuid` zweimal in den `by-components` eines Knotens. */
  BY_COMPONENT_DUPLICATE: 'OSCAL_SSP_BY_COMPONENT_DUPLICATE',
  /** `role-id` ohne passende Rolle in `metadata.roles`. */
  ROLE_REFERENCE_UNRESOLVED: 'OSCAL_SSP_ROLE_REFERENCE_UNRESOLVED',
  /** Party-UUID ohne passende Partei in `metadata.parties`. */
  PARTY_REFERENCE_UNRESOLVED: 'OSCAL_SSP_PARTY_REFERENCE_UNRESOLVED',
  /** `implemented-requirement` ohne `control-id`. */
  CONTROL_ID_MISSING: 'OSCAL_SSP_CONTROL_ID_MISSING',
  /** Die Baseline ist gebunden, kennt die `control-id` aber nicht. */
  CONTROL_REFERENCE_UNRESOLVED: 'OSCAL_SSP_CONTROL_REFERENCE_UNRESOLVED',
});

export interface SspDeriveState {
  readonly diagnostics: OscalDiagnostic[];
  readonly artifactKey: string | null;
  readonly oscalVersion: PinnedOscalVersion | null;
  readonly referenceDocument: ReferenceDocument;
  readonly baseline: SspBaselineBinding | null;
  /** Komponenten je `uuidKey(uuid)`; mehr als ein Eintrag ist eine Indexverletzung. */
  readonly componentsByUuid: Map<string, SspComponent[]>;
  readonly roleIds: ReadonlySet<string>;
  /** `uuidKey()` der Partei-UUIDs aus `metadata.parties`. */
  readonly partyUuids: ReadonlySet<string>;
}

export function diagnose(state: SspDeriveState, code: string, path: string): OscalDiagnostic {
  const diagnostic = createOscalDiagnostic({
    code,
    stage: SSP_ADAPTER_STAGE,
    validator: SSP_ADAPTER_VALIDATOR,
    path,
    artifact: {
      key: state.artifactKey,
      rootType: SYSTEM_SECURITY_PLAN_ROOT_TYPE,
      oscalVersion: state.oscalVersion,
    },
  });
  state.diagnostics.push(diagnostic);
  return diagnostic;
}

function diagnoseUnexpected(state: SspDeriveState, path: string): void {
  diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, path);
}

const structureReaders = createStructureReaders<SspDeriveState>(diagnoseUnexpected);

export const { readArrayField, readObjectArrayField, readStringArrayField } = structureReaders;

export const {
  readProps,
  readLinks,
  readSetParameters,
  readResponsibleRoles,
  readResponsibleParties,
} = createElementReaders(structureReaders, diagnoseUnexpected);

/** Liest `props` und `links` eines Knotens — die beiden Felder fast jeder SSP-Struktur. */
export function readElements(node: JsonObject, path: string, state: SspDeriveState) {
  return { props: readProps(node, path, state), links: readLinks(node, path, state) };
}

/**
 * Liest einen Objektknoten. Ein abwesender optionaler Knoten ergibt `null`
 * ohne Befund; ein abwesender Pflichtknoten und ein vorhandener Knoten
 * fremder Form ergeben `null` mit Befund.
 */
export function readObjectField(
  node: JsonObject,
  key: string,
  path: string,
  state: SspDeriveState,
  required = false,
): JsonObject | null {
  const value = node[key];
  if (isJsonObject(value)) return value;
  if ((value !== undefined && value !== null) || required) {
    diagnoseUnexpected(state, `${path}/${key}`);
  }
  return null;
}

/** Liest einen `status`- oder `implementation-status`-Knoten; `state` bleibt ein offenes Token. */
export function readState(
  node: JsonObject,
  key: string,
  path: string,
  state: SspDeriveState,
  required = false,
): SspState | null {
  const value = readObjectField(node, key, path, state, required);
  if (value === null) return null;

  const token = readString(value.state);
  if (token === undefined) {
    diagnoseUnexpected(state, `${path}/${key}/state`);
    return null;
  }
  return { state: token, remarks: readString(value.remarks) };
}

/* ------------------------------------------------------------------ */
/*  Dokumentinterne Referenzen                                         */
/* ------------------------------------------------------------------ */

/**
 * Vergleichsschlüssel einer UUID. RFC 4122 liest Hexziffern ohne Unterschied
 * der Schreibweise, und das Schema lässt beide zu; Modell und `source` behalten
 * den gelesenen Wert.
 */
export function uuidKey(uuid: string): string {
  return uuid.toLowerCase();
}

/**
 * Löst eine `component-uuid` gegen `system-implementation.components` auf.
 * Mehrere Treffer werden nicht zugunsten des ersten entschieden — der Index
 * ist dann verletzt, und die Referenz bleibt unaufgelöst.
 */
export function resolveComponentReference(
  componentUuid: string | undefined,
  path: string,
  state: SspDeriveState,
): SspComponentReference {
  const unresolved = (reason: 'component-not-found' | 'component-ambiguous' | 'component-uuid-missing') => ({
    status: 'unresolved' as const,
    reason,
    diagnostic: diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.COMPONENT_REFERENCE_UNRESOLVED, path),
  });

  if (componentUuid === undefined) return unresolved('component-uuid-missing');

  const candidates = state.componentsByUuid.get(uuidKey(componentUuid)) ?? [];
  if (candidates.length === 0) return unresolved('component-not-found');
  if (candidates.length > 1) return unresolved('component-ambiguous');
  return { status: 'resolved', component: candidates[0] };
}

function checkRoleId(roleId: unknown, path: string, state: SspDeriveState): void {
  if (typeof roleId === 'string' && !state.roleIds.has(roleId)) {
    diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.ROLE_REFERENCE_UNRESOLVED, path);
  }
}

/**
 * Prüft `role-id` und `party-uuids` aller Rollenzuweisungen eines Knotens
 * (`responsible-roles` oder `responsible-parties`) gegen `metadata.roles` und
 * `metadata.parties`. Gelesen wird der Quellknoten, damit jeder Befund seinen
 * Index behält.
 */
export function checkRoleAssignmentReferences(
  node: JsonObject,
  path: string,
  state: SspDeriveState,
  key: 'responsible-roles' | 'responsible-parties' = 'responsible-roles',
): void {
  const assignments = node[key];
  if (!Array.isArray(assignments)) return;

  assignments.forEach((assignment: unknown, assignmentIndex) => {
    if (!isJsonObject(assignment)) return;
    const assignmentPath = `${path}/${key}/${assignmentIndex}`;

    checkRoleId(assignment['role-id'], `${assignmentPath}/role-id`, state);

    const partyUuids = assignment['party-uuids'];
    if (!Array.isArray(partyUuids)) return;
    partyUuids.forEach((partyUuid: unknown, partyIndex) => {
      if (typeof partyUuid === 'string' && !state.partyUuids.has(uuidKey(partyUuid))) {
        diagnose(
          state,
          SSP_ADAPTER_DIAGNOSTIC_CODES.PARTY_REFERENCE_UNRESOLVED,
          `${assignmentPath}/party-uuids/${partyIndex}`,
        );
      }
    });
  });
}

/** Prüft die `role-ids` eines Benutzers gegen `metadata.roles`. */
export function checkRoleIdReferences(node: JsonObject, path: string, state: SspDeriveState): void {
  const roleIds = node['role-ids'];
  if (!Array.isArray(roleIds)) return;
  roleIds.forEach((roleId: unknown, index) => checkRoleId(roleId, `${path}/role-ids/${index}`, state));
}

/**
 * Die `id` aller Rollen und die Vergleichsschlüssel der `uuid` aller Parteien
 * aus `metadata`.
 */
export function readMetadataIdentities(rootBody: JsonObject): {
  readonly roleIds: ReadonlySet<string>;
  readonly partyUuids: ReadonlySet<string>;
} {
  const metadata = isJsonObject(rootBody.metadata) ? rootBody.metadata : {};
  const collect = (key: string, field: string, toKey: (value: string) => string): ReadonlySet<string> => {
    const entries = metadata[key];
    if (!Array.isArray(entries)) return new Set();
    return new Set(
      entries.flatMap((entry: unknown) => {
        const value = isJsonObject(entry) ? readString(entry[field]) : undefined;
        return value === undefined ? [] : [toKey(value)];
      }),
    );
  };
  return {
    roleIds: collect('roles', 'id', (roleId) => roleId),
    partyUuids: collect('parties', 'uuid', uuidKey),
  };
}
