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

import { parseRootDocument } from '@/adapters/oscalRootDocumentParse';
import type { ParsedRootDocument } from '@/adapters/oscalRootDocumentParse';
import { validateParsedSchema } from '@/adapters/oscalRootDocumentSchema';
import { deriveComponentDefinition } from '@/adapters/oscalComponentAdapter';
import { COMPONENT_DEFINITION_ROOT_TYPE } from '@/domain/componentDefinitionModel';
import type {
  ComponentDefinition,
  ComponentDefinitionDeriveOptions,
} from '@/domain/componentDefinitionModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

/**
 * Ein geparstes Component-Definition-Dokument nach dem verlustfreien Vertrag.
 *
 * `source` ist die Wahrheit, `view` eine Projektion darauf. `pin` ist die in
 * Stufe 2 gewählte Matrixzelle und der einzige zulässige Eingang in Stufe 3.
 */
export type ComponentDefinitionDocument = ParsedRootDocument<ComponentDefinition>;

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
  return parseRootDocument(source, context, {
    rootType: COMPONENT_DEFINITION_ROOT_TYPE,
    derive: (body) => deriveComponentDefinition(body, context, options),
  });
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
export const validateComponentDefinitionSchema: (
  document: ComponentDefinitionDocument,
) => Promise<OscalSchemaValidationResult> = validateParsedSchema;
