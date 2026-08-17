// =============================================================================
// Modelladapter `component-definition` — Implementation Layer (GSPP-248)
//
// Rein lesend und verlustfrei nach ADR-2: Die Wahrheit ist der unveränderte
// `source`, `view` ist die Projektion darauf. Schemawidrige Strukturen werden
// deshalb **nicht** repariert — ein `links`-Einzelobjekt statt eines Arrays
// (realer Fall `component-lieferkette`, BSI #71) bleibt im Quellgraphen
// unverändert stehen und erscheint als Diagnose, nicht als stillschweigend
// normalisiertes Array.
//
// Zwei Eigenheiten des Modells prägen den Adapter:
//
//  1. **Es gibt keine eine Quelle.** `control-implementation.source` zeigt je
//     Implementierung auf einen Katalog oder ein Profil. `component-
//     netzarchitektur` trägt zwei verschiedene `#uuid`-Quellen in **einem**
//     Dokument. Ein Adapter, der eine Definition auf genau eine Quelle
//     reduziert, liegt dort still falsch — deshalb hängt jede
//     `implemented-requirement` an der `source` ihrer Implementierung.
//  2. **`control-id` ist ohne `source` bedeutungslos.** Sie ist eine
//     Control-ID im Kontext der jeweiligen Quelle, nicht global. Ohne
//     aufgelöste Quelle wird sie nie interpretiert, sondern bleibt als
//     Diagnose sichtbar.
//
// Referenzen werden ausschließlich über `src/domain/referenceResolution.ts`
// klassifiziert (GSPP-286). Dieser Adapter verzweigt an keiner Stelle selbst
// auf die Form eines `href` und lädt nichts nach.
//
// Es gibt hier **keine** Component-Definition-Versionskonstante: Welche
// Schemazelle gilt, entscheidet allein `metadata.oscal-version` über den
// Root-Dispatch (Stufe 2). Die Versionsunterschiede der Raw-Typen stehen in
// `src/domain/oscalComponentDefinition.ts` und hängen dort am Schema.
// =============================================================================

import {
  createReferenceDocument,
  resolveOscalReference,
} from '@/domain/referenceResolution';
import {
  COMPONENT_ADAPTER_DIAGNOSTIC_CODES,
  diagnose,
  isJsonObject,
  readLinks,
  readObjectArrayField,
  readProps,
  readResponsibleRoles,
  readSetParameters,
  readString,
  registerUuid,
} from '@/adapters/oscalComponentReaders';
import type { DeriveState, JsonObject } from '@/adapters/oscalComponentReaders';
import { COMPONENT_DEFINITION_ROOT_TYPE } from '@/domain/componentDefinitionModel';
import type {
  ComponentCapability,
  ComponentControlImplementation,
  ComponentControlReference,
  ComponentControlReferenceReason,
  ComponentDefinition,
  ComponentDefinitionDeriveOptions,
  ComponentDefinitionImport,
  ComponentDefinitionMetadata,
  ComponentImplementationSource,
  ComponentImplementedRequirement,
  ComponentImplementedStatement,
  DefinedComponent,
} from '@/domain/componentDefinitionModel';
import type { OscalDocumentContext } from '@/domain/models';
import { isPinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { getArtifactByUpstreamPath } from '@/domain/sourceRegistry';

export { COMPONENT_DEFINITION_ROOT_TYPE } from '@/domain/componentDefinitionModel';
export {
  COMPONENT_ADAPTER_DIAGNOSTIC_CODES,
  COMPONENT_ADAPTER_STAGE,
  COMPONENT_ADAPTER_VALIDATOR,
} from '@/adapters/oscalComponentReaders';
export type * from '@/domain/componentDefinitionModel';

/* ------------------------------------------------------------------ */
/*  Implementierungen und Anforderungen                                */
/* ------------------------------------------------------------------ */

function readImplementationSource(
  implementation: JsonObject,
  path: string,
  state: DeriveState,
): ComponentImplementationSource | null {
  const href = readString(implementation.source);
  if (href === undefined) {
    diagnose(
      state,
      COMPONENT_ADAPTER_DIAGNOSTIC_CODES.IMPLEMENTATION_SOURCE_MISSING,
      `${path}/source`,
    );
    return null;
  }

  // Einziger Klassifikationsweg (GSPP-286): kein Netzzugriff, keine
  // Normalisierung gegen eine Basis, keine eigene href-Verzweigung hier.
  return {
    href,
    reference: resolveOscalReference(
      { href, path: `${path}/source` },
      { document: state.referenceDocument },
    ),
  };
}

function resolveControlReference(
  controlId: string | undefined,
  source: ComponentImplementationSource | null,
  path: string,
  state: DeriveState,
): ComponentControlReference {
  const unresolved = (reason: ComponentControlReferenceReason, code: string) => ({
    status: 'unresolved' as const,
    reason,
    diagnostic: diagnose(state, code, path),
  });
  const codes = COMPONENT_ADAPTER_DIAGNOSTIC_CODES;

  if (source === null) {
    return unresolved('implementation-source-missing', codes.CONTROL_REFERENCE_UNRESOLVED);
  }
  if (controlId === undefined) {
    return unresolved('control-id-missing', codes.CONTROL_ID_MISSING);
  }

  const binding = state.catalogsBySource.get(source.href);
  if (binding === undefined) {
    return unresolved('catalog-not-supplied', codes.CONTROL_REFERENCE_UNRESOLVED);
  }

  const control = binding.catalog.controlsById.get(controlId);
  if (control === undefined) {
    return unresolved('control-not-in-catalog', codes.CONTROL_REFERENCE_UNRESOLVED);
  }

  return { status: 'resolved', catalogKey: binding.catalogKey, control };
}

function deriveImplementedStatements(
  requirement: JsonObject,
  path: string,
  state: DeriveState,
): readonly ComponentImplementedStatement[] {
  return readObjectArrayField(requirement, 'statements', path, state).map(
    ({ node: statement, path: statementPath }) => ({
      statementId: readString(statement['statement-id']),
      uuid: readString(statement.uuid),
      description: readString(statement.description),
      responsibleRoles: readResponsibleRoles(statement, statementPath, state),
      props: readProps(statement, statementPath, state),
      links: readLinks(statement, statementPath, state),
      remarks: readString(statement.remarks),
    }),
  );
}

function deriveImplementedRequirements(
  implementation: JsonObject,
  source: ComponentImplementationSource | null,
  path: string,
  state: DeriveState,
): readonly ComponentImplementedRequirement[] {
  return readObjectArrayField(implementation, 'implemented-requirements', path, state).map(
    ({ node: requirement, path: requirementPath }) => {
      const uuid = readString(requirement.uuid);
      registerUuid(uuid, requirementPath, state);

      const controlId = readString(requirement['control-id']);
      return {
        uuid,
        controlId,
        description: readString(requirement.description),
        source,
        control: resolveControlReference(
          controlId,
          source,
          `${requirementPath}/control-id`,
          state,
        ),
        setParameters: readSetParameters(requirement, requirementPath, state),
        responsibleRoles: readResponsibleRoles(requirement, requirementPath, state),
        statements: deriveImplementedStatements(requirement, requirementPath, state),
        props: readProps(requirement, requirementPath, state),
        links: readLinks(requirement, requirementPath, state),
        remarks: readString(requirement.remarks),
        path: requirementPath,
      };
    },
  );
}

function deriveControlImplementations(
  owner: JsonObject,
  ownerPath: string,
  state: DeriveState,
): readonly ComponentControlImplementation[] {
  return readObjectArrayField(owner, 'control-implementations', ownerPath, state).map(
    ({ node: implementation, path }) => {
      const source = readImplementationSource(implementation, path, state);
      return {
        uuid: readString(implementation.uuid),
        source,
        description: readString(implementation.description),
        setParameters: readSetParameters(implementation, path, state),
        implementedRequirements: deriveImplementedRequirements(
          implementation,
          source,
          path,
          state,
        ),
        props: readProps(implementation, path, state),
        links: readLinks(implementation, path, state),
        path,
      };
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Ableitung                                                          */
/* ------------------------------------------------------------------ */

function deriveMetadata(body: JsonObject): ComponentDefinitionMetadata {
  const metadata = isJsonObject(body.metadata) ? body.metadata : {};
  return {
    title: readString(metadata.title),
    lastModified: readString(metadata['last-modified']),
    version: readString(metadata.version),
    oscalVersion: readString(metadata['oscal-version']),
  };
}

/**
 * Die Version für den Referenz- und Diagnosekontext.
 *
 * Nur ein Wert aus der gepinnten Menge wird übernommen; alles andere wird
 * `null`. Der Dispatch hat die Bindung vor dem Aufruf bereits geprüft — dieser
 * Filter hält die Redaction-Regel auch dann ein, wenn jemand `derive` direkt
 * aufruft.
 */
function readPinnedOscalVersion(body: JsonObject): PinnedOscalVersion | null {
  const metadata = isJsonObject(body.metadata) ? body.metadata : null;
  const declared = metadata ? readString(metadata['oscal-version']) : undefined;
  return declared !== undefined && isPinnedOscalVersion(declared) ? declared : null;
}

function deriveImports(
  body: JsonObject,
  state: DeriveState,
): readonly ComponentDefinitionImport[] {
  const basePath = `/${COMPONENT_DEFINITION_ROOT_TYPE}`;
  return readObjectArrayField(body, 'import-component-definitions', basePath, state).flatMap(
    ({ node: entry, path }) => {
      const href = readString(entry.href);
      if (href === undefined) {
        diagnose(state, COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED, path);
        return [];
      }
      return [{
        href,
        reference: resolveOscalReference(
          { href, path: `${path}/href` },
          { document: state.referenceDocument },
        ),
        // In 1.1.2 und 1.1.3 ist dieses Feld schemawidrig. Der Adapter liest es
        // trotzdem, weil er verlustfrei bleiben muss; die Versionsaussage
        // trifft Stufe 3, nicht die Projektion (ADR-7).
        remarks: readString(entry.remarks),
        path,
      }];
    },
  );
}

function deriveComponents(body: JsonObject, state: DeriveState): readonly DefinedComponent[] {
  const basePath = `/${COMPONENT_DEFINITION_ROOT_TYPE}`;
  return readObjectArrayField(body, 'components', basePath, state).map(
    ({ node: component, path }) => {
      const uuid = readString(component.uuid);
      registerUuid(uuid, path, state);

      return {
        uuid,
        type: readString(component.type),
        title: readString(component.title),
        description: readString(component.description),
        purpose: readString(component.purpose),
        responsibleRoles: readResponsibleRoles(component, path, state),
        controlImplementations: deriveControlImplementations(component, path, state),
        props: readProps(component, path, state),
        links: readLinks(component, path, state),
        remarks: readString(component.remarks),
        path,
      };
    },
  );
}

function deriveCapabilities(body: JsonObject, state: DeriveState): readonly ComponentCapability[] {
  const basePath = `/${COMPONENT_DEFINITION_ROOT_TYPE}`;
  return readObjectArrayField(body, 'capabilities', basePath, state).map(
    ({ node: capability, path }) => {
      const uuid = readString(capability.uuid);
      registerUuid(uuid, path, state);

      const incorporatesComponents = readObjectArrayField(
        capability,
        'incorporates-components',
        path,
        state,
      ).flatMap(({ node: incorporated, path: incorporatedPath }) => {
        const componentUuid = readString(incorporated['component-uuid']);
        if (componentUuid === undefined) {
          diagnose(
            state,
            COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED,
            incorporatedPath,
          );
          return [];
        }
        return [{ componentUuid, description: readString(incorporated.description) }];
      });

      return {
        uuid,
        name: readString(capability.name),
        description: readString(capability.description),
        incorporatesComponents,
        // Eine Capability kann eigene Implementierungen tragen; im Bestand tut
        // das genau `component-aws-security-hub`.
        controlImplementations: deriveControlImplementations(capability, path, state),
        props: readProps(capability, path, state),
        links: readLinks(capability, path, state),
        remarks: readString(capability.remarks),
        path,
      };
    },
  );
}

function indexBySource(
  implementations: readonly ComponentControlImplementation[],
): ReadonlyMap<string, readonly ComponentControlImplementation[]> {
  const index = new Map<string, ComponentControlImplementation[]>();
  for (const implementation of implementations) {
    if (implementation.source === null) continue;
    const existing = index.get(implementation.source.href);
    if (existing) {
      existing.push(implementation);
      continue;
    }
    index.set(implementation.source.href, [implementation]);
  }
  return index;
}

/**
 * Leitet die Projektion einer Component Definition aus ihrem Root-Körper ab.
 *
 * Wirft **nicht**: Ein schemawidriges Dokument wird diagnostiziert, nicht
 * verworfen (ADR-7). Verworfen wird nur vorher, im Root-Dispatch.
 *
 * @param body Der unveränderte Root-Körper aus dem Dispatch
 * @param context Ableitungskontext; trägt Vertrauensklasse und Upstream-Pfad
 * @param options Explizit gebundene Zielkataloge je `source`
 */
export function deriveComponentDefinition(
  body: unknown,
  context: OscalDocumentContext,
  options: ComponentDefinitionDeriveOptions = {},
): ComponentDefinition {
  const rootBody = isJsonObject(body) ? body : {};
  const oscalVersion = readPinnedOscalVersion(rootBody);
  const state: DeriveState = {
    diagnostics: [],
    // Der Registry-Schlüssel, nie der Upstream-Pfad: Diagnosen tragen nur
    // Werte aus geschlossenen Mengen.
    artifactKey: context.upstreamPath
      ? (getArtifactByUpstreamPath(context.upstreamPath)?.artifactKey ?? null)
      : null,
    oscalVersion,
    uuidPaths: new Map(),
    // Der Referenzschicht wird der Envelope gereicht, den sie erwartet. Die
    // Hülle ist neu, der Körper bleibt dasselbe Objekt — es wird nichts kopiert
    // und nichts verändert.
    referenceDocument: createReferenceDocument({
      source: { [COMPONENT_DEFINITION_ROOT_TYPE]: rootBody },
      context,
      rootType: COMPONENT_DEFINITION_ROOT_TYPE,
      oscalVersion: oscalVersion ?? 'unknown',
    }),
    catalogsBySource: options.catalogsBySource ?? new Map(),
  };

  if (!isJsonObject(body)) {
    diagnose(
      state,
      COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED,
      `/${COMPONENT_DEFINITION_ROOT_TYPE}`,
    );
  }

  const components = deriveComponents(rootBody, state);
  const capabilities = deriveCapabilities(rootBody, state);
  const controlImplementations = [
    ...components.flatMap((component) => component.controlImplementations),
    ...capabilities.flatMap((capability) => capability.controlImplementations),
  ];

  return {
    uuid: readString(rootBody.uuid),
    metadata: deriveMetadata(rootBody),
    importComponentDefinitions: deriveImports(rootBody, state),
    components,
    capabilities,
    controlImplementations,
    implementedRequirements: controlImplementations.flatMap(
      (implementation) => implementation.implementedRequirements,
    ),
    implementationsBySource: indexBySource(controlImplementations),
    // Eingefroren: Die Sammelphase ist mit der Rückgabe beendet, und ein
    // nachgereichter Befund wäre keiner.
    diagnostics: Object.freeze(state.diagnostics),
  };
}
