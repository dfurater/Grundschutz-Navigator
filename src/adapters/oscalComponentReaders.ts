// =============================================================================
// Knotenleser und Diagnosesammler des Component-Adapters (GSPP-248)
//
// Die Leser haben genau eine Aufgabe, die sie von einem naiven `?? []`
// unterscheidet: Ein **vorhandener** Wert der falschen Form wird
// diagnostiziert, statt still zu verschwinden. Genau daran hängt der reale
// Befund aus `component-lieferkette` — ein `links`-Einzelobjekt statt eines
// Arrays. Ein Leser, der daraus wortlos `[]` macht, erfüllt zwar die
// Verlustfreiheit am Quellgraphen, verliert den Befund aber aus der
// Projektion und damit aus der Sicht des Nutzers.
//
// Normalisiert wird nichts: Aus dem Einzelobjekt wird kein Array. Der
// Quellgraph bleibt, wie er ist (ADR-2).
// =============================================================================

import { createElementReaders, createStructureReaders } from '@/adapters/oscalReaders';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDiagnostic, OscalDiagnosticValidator } from '@/domain/oscalDiagnostics';
import type { ReferenceDocument } from '@/domain/referenceResolution';
import { COMPONENT_DEFINITION_ROOT_TYPE } from '@/domain/componentDefinitionModel';
import type { ComponentSourceCatalogBinding } from '@/domain/componentDefinitionModel';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';

/** Stufe der modellinternen Befunde dieses Adapters. */
export const COMPONENT_ADAPTER_STAGE = 'domain' as const;

/**
 * Vertragsversion des Adapters; sie geht in jede Diagnosesignatur ein und wird
 * erhöht, wenn sich Codes, Pfade oder Parameter einer bestehenden Diagnose
 * ändern.
 */
export const COMPONENT_ADAPTER_VALIDATOR: OscalDiagnosticValidator = Object.freeze({
  name: 'gspp-component-adapter',
  version: '1',
});

export const COMPONENT_ADAPTER_DIAGNOSTIC_CODES = Object.freeze({
  /** Component-, Capability- oder implemented-requirement-`uuid` doppelt. */
  DUPLICATE_UUID: 'OSCAL_COMPONENT_DUPLICATE_UUID',
  /** `control-implementation` ohne `source` — der Referenzkontext fehlt. */
  IMPLEMENTATION_SOURCE_MISSING: 'OSCAL_COMPONENT_IMPLEMENTATION_SOURCE_MISSING',
  /** `implemented-requirement` ohne `control-id`. */
  CONTROL_ID_MISSING: 'OSCAL_COMPONENT_CONTROL_ID_MISSING',
  /** `control-id` vorhanden, aber im Kontext ihrer `source` nicht auflösbar. */
  CONTROL_REFERENCE_UNRESOLVED: 'OSCAL_COMPONENT_CONTROL_REFERENCE_UNRESOLVED',
  /** Knoten hat nicht die vom Modell erwartete Form (z. B. Objekt statt Array). */
  STRUCTURE_UNEXPECTED: 'OSCAL_COMPONENT_STRUCTURE_UNEXPECTED',
});


export type { JsonObject } from '@/domain/jsonGuards';

export interface DeriveState {
  readonly diagnostics: OscalDiagnostic[];
  readonly artifactKey: string | null;
  readonly oscalVersion: PinnedOscalVersion | null;
  readonly uuidPaths: Map<string, string>;
  readonly referenceDocument: ReferenceDocument;
  readonly catalogsBySource: ReadonlyMap<string, ComponentSourceCatalogBinding>;
}

export function diagnose(state: DeriveState, code: string, path: string): OscalDiagnostic {
  const diagnostic = createOscalDiagnostic({
    code,
    stage: COMPONENT_ADAPTER_STAGE,
    validator: COMPONENT_ADAPTER_VALIDATOR,
    path,
    artifact: {
      key: state.artifactKey,
      rootType: COMPONENT_DEFINITION_ROOT_TYPE,
      oscalVersion: state.oscalVersion,
    },
  });
  state.diagnostics.push(diagnostic);
  return diagnostic;
}

function diagnoseUnexpected(state: DeriveState, path: string): void {
  diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, path);
}

const structureReaders = createStructureReaders<DeriveState>(diagnoseUnexpected);

export const { readArrayField, readObjectArrayField, readStringArrayField } = structureReaders;

export const { readProps, readLinks, readSetParameters, readResponsibleRoles } =
  createElementReaders(structureReaders, diagnoseUnexpected);

/**
 * Registriert eine `uuid` dokumentweit. Ein zweites Vorkommen erzeugt eine
 * Diagnose am **späteren** Knoten; das erste bleibt die Fundstelle.
 */
export function registerUuid(uuid: string | undefined, path: string, state: DeriveState): void {
  if (uuid === undefined) return;
  if (state.uuidPaths.has(uuid)) {
    diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.DUPLICATE_UUID, `${path}/uuid`);
    return;
  }
  state.uuidPaths.set(uuid, path);
}

