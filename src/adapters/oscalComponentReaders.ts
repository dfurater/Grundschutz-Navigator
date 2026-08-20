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

import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalDiagnostic, OscalDiagnosticValidator } from '@/domain/oscalDiagnostics';
import type { ReferenceDocument } from '@/domain/referenceResolution';
import { COMPONENT_DEFINITION_ROOT_TYPE } from '@/domain/componentDefinitionModel';
import type {
  ComponentLink,
  ComponentProp,
  ComponentResponsibleRole,
  ComponentSetParameter,
  ComponentSourceCatalogBinding,
} from '@/domain/componentDefinitionModel';
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


export type JsonObject = Record<string, unknown>;

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

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

/**
 * Liest ein Arrayfeld. Ein **vorhandener** Nicht-Array-Wert wird diagnostiziert
 * statt still zu `[]` zu werden — sonst verschwände die Kardinalitätsverletzung
 * aus `component-lieferkette` spurlos aus der Projektion.
 */
export function readArrayField(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly unknown[] {
  const value = node[key];
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value;

  diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, `${path}/${key}`);
  return [];
}

/** Wie `readArrayField`, liefert aber nur die Objekteinträge und diagnostiziert den Rest. */
export function readObjectArrayField(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly { readonly node: JsonObject; readonly path: string }[] {
  return readArrayField(node, key, path, state).flatMap((entry, index) => {
    const entryPath = `${path}/${key}/${index}`;
    if (!isJsonObject(entry)) {
      diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, entryPath);
      return [];
    }
    return [{ node: entry, path: entryPath }];
  });
}

export function readStringArrayField(
  node: JsonObject,
  key: string,
  path: string,
  state: DeriveState,
): readonly string[] {
  return readArrayField(node, key, path, state).flatMap((entry, index) => {
    if (typeof entry !== 'string') {
      diagnose(
        state,
        COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED,
        `${path}/${key}/${index}`,
      );
      return [];
    }
    return [entry];
  });
}

export function readProps(node: JsonObject, path: string, state: DeriveState): readonly ComponentProp[] {
  return readObjectArrayField(node, 'props', path, state).flatMap(({ node: prop, path: propPath }) => {
    const name = readString(prop.name);
    const value = readString(prop.value);
    if (name === undefined || value === undefined) {
      diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, propPath);
      return [];
    }
    return [{ name, value, ns: readString(prop.ns), class: readString(prop.class) }];
  });
}

export function readLinks(node: JsonObject, path: string, state: DeriveState): readonly ComponentLink[] {
  return readObjectArrayField(node, 'links', path, state).flatMap(({ node: link, path: linkPath }) => {
    const href = readString(link.href);
    if (href === undefined) {
      diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, linkPath);
      return [];
    }
    return [{
      href,
      rel: readString(link.rel),
      mediaType: readString(link['media-type']),
      resourceFragment: readString(link['resource-fragment']),
      text: readString(link.text),
    }];
  });
}

export function readSetParameters(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly ComponentSetParameter[] {
  return readObjectArrayField(node, 'set-parameters', path, state).flatMap(
    ({ node: parameter, path: parameterPath }) => {
      const paramId = readString(parameter['param-id']);
      if (paramId === undefined) {
        diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, parameterPath);
        return [];
      }
      return [{
        paramId,
        values: readStringArrayField(parameter, 'values', parameterPath, state),
        remarks: readString(parameter.remarks),
      }];
    },
  );
}

export function readResponsibleRoles(
  node: JsonObject,
  path: string,
  state: DeriveState,
): readonly ComponentResponsibleRole[] {
  return readObjectArrayField(node, 'responsible-roles', path, state).flatMap(
    ({ node: role, path: rolePath }) => {
      const roleId = readString(role['role-id']);
      if (roleId === undefined) {
        diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, rolePath);
        return [];
      }
      return [{
        roleId,
        partyUuids: readStringArrayField(role, 'party-uuids', rolePath, state),
        remarks: readString(role.remarks),
      }];
    },
  );
}

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

