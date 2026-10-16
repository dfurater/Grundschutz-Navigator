// =============================================================================
// Stufe 3 für geparste Root-Dokumente (GSPP-566)
//
// Getrennt von `oscalRootDocumentParse.ts`, weil der Katalogpfad jenes Modul
// importiert, aber keine Schemaprüfung ausführt: Hier hängt der
// Schema-Validator (`ajv`) dran, und nur die Dokumenteinstiege für Component
// Definition, Mapping und Profile laden ihn.
// =============================================================================

import type { ParsedRootDocument } from '@/adapters/oscalRootDocumentParse';
import { validateAgainstPinnedSchema } from '@/domain/oscalSchemaValidation';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

/**
 * Führt Stufe 3 für ein bereits geparstes Dokument aus.
 *
 * Der Schema-Pin kommt aus dem Dokument und damit aus `getSchemaPin(<Root>,
 * <deklarierte Version>)`. Es gibt keinen Rückfall auf eine Nachbarversion und
 * keine Modellversionskonstante.
 */
export function validateParsedSchema(
  document: ParsedRootDocument<unknown>,
): Promise<OscalSchemaValidationResult> {
  return validateAgainstPinnedSchema(document.source, document.pin, {
    artifactKey: document.artifactKey,
  });
}
