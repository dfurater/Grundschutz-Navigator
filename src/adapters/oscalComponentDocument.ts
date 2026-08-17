// =============================================================================
// Verlustfreier Dokumenteinstieg für Component Definitions (GSPP-248)
//
// Dieselbe Aufteilung wie im Katalogpfad: `oscalComponentAdapter.ts` leitet die
// Projektion aus dem Root-Körper ab, diese Datei hält `source`, Kontext und
// `view` als Dokument zusammen und führt den Root-Dispatch davor (ADR-2,
// GSPP-285).
//
// Sie ist auch der einzige Übergang nach Stufe 3: Die Schemazelle kommt aus
// dem Dispatch, nicht aus einer Modellkonstante.
// =============================================================================

import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  dispatchOscalDocumentOrThrow,
  OscalRootDispatchError,
  ROOT_DISPATCH_DIAGNOSTIC_CODES,
  ROOT_DISPATCH_STAGE,
  ROOT_DISPATCH_VALIDATOR,
} from '@/adapters/oscalRootDispatch';
import { deriveComponentDefinition } from '@/adapters/oscalComponentAdapter';
import { COMPONENT_DEFINITION_ROOT_TYPE } from '@/domain/componentDefinitionModel';
import type {
  ComponentDefinition,
  ComponentDefinitionDeriveOptions,
} from '@/domain/componentDefinitionModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaPin, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { validateAgainstPinnedSchema } from '@/domain/oscalSchemaValidation';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

/**
 * Ein geparstes Component-Definition-Dokument nach dem verlustfreien Vertrag.
 *
 * `source` ist die Wahrheit, `view` eine Projektion darauf. `pin` ist die in
 * Stufe 2 gewählte Matrixzelle und der einzige zulässige Eingang in Stufe 3.
 */
export interface ComponentDefinitionDocument {
  readonly source: unknown;
  readonly context: OscalDocumentContext;
  readonly view: ComponentDefinition;
  /** Die aus `metadata.oscal-version` gebundene Zelle — nie aus `$schema`. */
  readonly pin: OscalSchemaPin;
  readonly oscalVersion: PinnedOscalVersion;
  readonly artifactKey: string | null;
}

/**
 * Parst ein OSCAL-Component-Definition-Dokument verlustfrei nach ADR-2.
 *
 * Der Root-Typ wird über den Dispatch bestimmt und nicht angenommen. Eine
 * bekannt schema-invalide Definition (`component-ga-lotse-grundmodul`,
 * `component-lieferkette`) wird hier **nicht** abgewiesen: Die Sperrung aus
 * ADR-7 betrifft die Auslieferung, nicht das Parsen.
 *
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen — dazu zählt eine nicht gepinnte `oscal-version`
 */
export function parseComponentDefinitionDocument(
  source: unknown,
  context: OscalDocumentContext,
  options: ComponentDefinitionDeriveOptions = {},
): ComponentDefinitionDocument {
  const dispatch = dispatchOscalDocumentOrThrow(source, context);

  // Zweite Schranke neben dem Registry-Abgleich im Dispatch: Der greift nur bei
  // einem registrierten Upstream-Pfad. Dieser Einstieg liefert ein
  // `ComponentDefinitionDocument` und darf keinen fremden Root durchreichen.
  if (dispatch.rootType !== COMPONENT_DEFINITION_ROOT_TYPE) {
    throw new OscalRootDispatchError(
      createOscalDiagnostic({
        code: ROOT_DISPATCH_DIAGNOSTIC_CODES.ROOT_TYPE_MISMATCH,
        stage: ROOT_DISPATCH_STAGE,
        validator: ROOT_DISPATCH_VALIDATOR,
        path: '/',
        artifact: {
          key: dispatch.artifactKey,
          rootType: dispatch.rootType,
          oscalVersion: dispatch.oscalVersion,
        },
        params: { expected: COMPONENT_DEFINITION_ROOT_TYPE, found: dispatch.rootType },
      }),
    );
  }

  return {
    source,
    context,
    view: deriveComponentDefinition(dispatch.body, context, options),
    pin: dispatch.pin,
    oscalVersion: dispatch.oscalVersion,
    artifactKey: dispatch.artifactKey,
  };
}

/**
 * Führt Stufe 3 für ein bereits geparstes Dokument aus.
 *
 * Der Schema-Pin kommt aus dem Dokument und damit aus
 * `getSchemaPin('component-definition', <deklarierte Version>)`. Es gibt keinen
 * Rückfall auf eine Nachbarversion und keine Modellversionskonstante: dieselbe
 * `import-component-definitions[0].remarks` ist unter 1.1.2 ein Schemabefund
 * und unter 1.2.2 gültig.
 */
export function validateComponentDefinitionSchema(
  document: ComponentDefinitionDocument,
): Promise<OscalSchemaValidationResult> {
  return validateAgainstPinnedSchema(document.source, document.pin, {
    artifactKey: document.artifactKey,
  });
}
