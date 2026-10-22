// =============================================================================
// Modelladapter `system-security-plan` — Implementation Layer (GSPP-293)
//
// Rein lesend und verlustfrei nach ADR-2: Die Wahrheit ist der unveränderte
// `source`, `view` ist die Projektion darauf. Schemawidrige Strukturen werden
// nicht repariert, sondern diagnostiziert; verworfen wird ein Dokument nur vor
// der Ableitung — im Root-Dispatch oder an der Vertrauensklasse.
//
// Drei Eigenheiten des Modells prägen den Adapter:
//
//  1. **Der Status hängt an der Komponente.** `implementation-status` wird je
//     `by-component` gelesen; an Anforderung und Statement entsteht keine
//     Zusammenfassung.
//  2. **`control-id` braucht die Baseline.** `import-profile.href` wird über
//     die Referenzschicht klassifiziert, aber nicht geladen. Aufgelöst wird
//     eine `control-id` nur gegen eine vom Aufrufer übergebene Bindung; ohne
//     sie ist sie „nicht auflösbar im aktuellen Kontext".
//  3. **Komponenten zuerst.** `by-component.component-uuid` und
//     `implemented-components[].component-uuid` zeigen in
//     `system-implementation.components`. Diese Liste wird deshalb vor
//     Inventar und `control-implementation` gelesen.
//
// Referenzen werden ausschließlich über `src/domain/referenceResolution.ts`
// klassifiziert (GSPP-286). Dieser Adapter verzweigt an keiner Stelle selbst
// auf die Form eines `href` und lädt nichts nach. Es gibt keine
// SSP-Versionskonstante: Welche Schemazelle gilt, entscheidet allein
// `metadata.oscal-version` über den Root-Dispatch.
// =============================================================================

import { resolveOscalReference } from '@/domain/referenceResolution';
import {
  checkRoleAssignmentReferences,
  diagnose,
  readMetadataIdentities,
  readObjectField,
  SSP_ADAPTER_DIAGNOSTIC_CODES,
  SSP_ADAPTER_STAGE,
  SSP_ADAPTER_VALIDATOR,
  SSP_BASE_PATH,
} from '@/adapters/oscalSspReaders';
import { deriveControlImplementation } from '@/adapters/oscalSspControl';
import { deriveSystemCharacteristics, deriveSystemImplementation } from '@/adapters/oscalSspSystem';
import type { SspDeriveState } from '@/adapters/oscalSspReaders';
import { readRootMetadata } from '@/domain/oscalRootDispatch';
import { openRootDerive } from '@/adapters/oscalRootDocumentParse';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  NOT_RESOLVABLE_IN_CONTEXT,
  SYSTEM_SECURITY_PLAN_ROOT_TYPE,
} from '@/domain/systemSecurityPlanModel';
import type {
  SspBaselineState,
  SspImportProfile,
  SystemSecurityPlan,
  SystemSecurityPlanDeriveOptions,
} from '@/domain/systemSecurityPlanModel';
import type { OscalDocumentContext } from '@/domain/models';

export {
  NOT_RESOLVABLE_IN_CONTEXT,
  SYSTEM_SECURITY_PLAN_ROOT_TYPE,
} from '@/domain/systemSecurityPlanModel';
export {
  SSP_ADAPTER_DIAGNOSTIC_CODES,
  SSP_ADAPTER_STAGE,
  SSP_ADAPTER_VALIDATOR,
} from '@/adapters/oscalSspReaders';
export type * from '@/domain/systemSecurityPlanModel';

/**
 * Abweisung eines SSP außerhalb der Vertrauensklasse `class-2-local-user`.
 * Die Meldung nennt nur den stabilen Code.
 */
export class SspTrustClassError extends Error {
  readonly diagnostic: OscalDiagnostic;

  constructor(diagnostic: OscalDiagnostic) {
    super(`SSP-Ableitung abgewiesen: ${diagnostic.code}`);
    this.name = 'SspTrustClassError';
    this.diagnostic = diagnostic;
  }
}

/**
 * Positivdefinition: Ein SSP ist ausschließlich ein lokales Nutzerdokument.
 * Das Quellregister führt kein SSP-Artefakt; ein Klasse-1-Kontext für ein SSP
 * ist deshalb immer falsch und wird abgewiesen, statt eine Provenienz zu
 * behaupten, die es nicht gibt.
 */
function assertClass2Context(context: OscalDocumentContext): void {
  if (context.trustClass === 'class-2-local-user') return;
  throw new SspTrustClassError(
    createOscalDiagnostic({
      code: SSP_ADAPTER_DIAGNOSTIC_CODES.TRUST_CLASS_REJECTED,
      stage: SSP_ADAPTER_STAGE,
      validator: SSP_ADAPTER_VALIDATOR,
      path: '/',
      artifact: { rootType: SYSTEM_SECURITY_PLAN_ROOT_TYPE },
    }),
  );
}

/* ------------------------------------------------------------------ */
/*  import-profile                                                     */
/* ------------------------------------------------------------------ */

function deriveImportProfile(body: JsonObject, state: SspDeriveState): SspImportProfile | null {
  const node = readObjectField(body, 'import-profile', SSP_BASE_PATH, state, true);
  if (node === null) return null;

  const path = `${SSP_BASE_PATH}/import-profile`;
  const href = readString(node.href);
  if (href === undefined) {
    diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, `${path}/href`);
    return null;
  }

  let baseline: SspBaselineState = { status: NOT_RESOLVABLE_IN_CONTEXT };
  if (state.baseline !== null) {
    baseline = 'catalogKey' in state.baseline
      ? { status: 'bound', catalogKey: state.baseline.catalogKey }
      : { status: 'bound', kind: 'transient' };
  }

  return {
    href,
    // Einziger Klassifikationsweg (GSPP-286): kein Netzzugriff, keine
    // Normalisierung gegen eine Basis, keine eigene href-Verzweigung hier.
    reference: resolveOscalReference({ href, path: `${path}/href` }, { document: state.referenceDocument }),
    baseline,
    remarks: readString(node.remarks),
    path,
  };
}

/**
 * `metadata.responsible-parties` und die `responsible-parties` jeder
 * `metadata.actions`-Zeile verweisen auf `metadata.roles` und
 * `metadata.parties` desselben Dokuments.
 */
function checkMetadataReferences(rootBody: JsonObject, state: SspDeriveState): void {
  const metadata = rootBody.metadata;
  if (!isJsonObject(metadata)) return;
  const path = `${SSP_BASE_PATH}/metadata`;
  checkRoleAssignmentReferences(metadata, path, state, 'responsible-parties');
  readArray(metadata.actions).forEach((action, index) => {
    if (isJsonObject(action)) checkRoleAssignmentReferences(action, `${path}/actions/${index}`, state, 'responsible-parties');
  });
}

/* ------------------------------------------------------------------ */
/*  Ableitung                                                          */
/* ------------------------------------------------------------------ */

/**
 * Leitet die Projektion eines SSP aus seinem Root-Körper ab.
 *
 * Ein schemawidriges Dokument wird diagnostiziert, nicht verworfen (ADR-7).
 *
 * @param body Der unveränderte Root-Körper aus dem Dispatch
 * @param context Ableitungskontext; muss `class-2-local-user` tragen
 * @param options Explizit gebundener Baseline-Katalog
 * @throws SspTrustClassError wenn der Kontext eine andere Vertrauensklasse trägt
 */
export function deriveSystemSecurityPlan(
  body: unknown,
  context: OscalDocumentContext,
  options: SystemSecurityPlanDeriveOptions = {},
): SystemSecurityPlan {
  assertClass2Context(context);

  const { rootBody, bodyIsObject, artifactKey, oscalVersion, referenceDocument } =
    openRootDerive(body, context, SYSTEM_SECURITY_PLAN_ROOT_TYPE);
  const state: SspDeriveState = {
    diagnostics: [],
    artifactKey,
    oscalVersion,
    referenceDocument,
    baseline: options.baseline ?? null,
    componentsByUuid: new Map(),
    ...readMetadataIdentities(rootBody),
  };

  if (!bodyIsObject) {
    diagnose(state, SSP_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, SSP_BASE_PATH);
  }

  checkMetadataReferences(rootBody, state);
  const importProfile = deriveImportProfile(rootBody, state);
  const systemCharacteristics = deriveSystemCharacteristics(rootBody, state);
  // Vor `control-implementation`: deren `by-components` lösen gegen die Komponenten auf.
  const systemImplementation = deriveSystemImplementation(rootBody, state);
  const controlImplementation = deriveControlImplementation(rootBody, state);

  return {
    uuid: readString(rootBody.uuid),
    metadata: readRootMetadata(rootBody),
    importProfile,
    systemCharacteristics,
    systemImplementation,
    controlImplementation,
    // Eingefroren: Die Sammelphase ist mit der Rückgabe beendet.
    diagnostics: Object.freeze(state.diagnostics),
  };
}
