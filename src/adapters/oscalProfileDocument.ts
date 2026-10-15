// =============================================================================
// Verlustfreier Dokumenteinstieg für Profile (GSPP-240)
//
// Dieselbe Aufteilung wie im Katalog- und im Component-Pfad:
// `oscalProfileAdapter.ts` leitet die Projektion aus dem Root-Körper ab, diese
// Datei hält `source`, Kontext und `view` als Dokument zusammen und führt den
// Root-Dispatch davor (ADR-2, GSPP-285).
//
// Sie ist auch der einzige Übergang nach Stufe 3: Die Schemazelle kommt aus dem
// Dispatch, nicht aus einer Modellkonstante. Das ist beim Profile nicht
// theoretisch — `import` und `merge` haben zwischen 1.1.3 und 1.2.1 ihre
// Struktur geändert, und derselbe Knoten ist unter der einen Version gültig und
// unter der anderen ein Befund.
// =============================================================================

import { parseRootDocument, validateParsedSchema } from '@/adapters/oscalRootDocumentParse';
import type { ParsedRootDocument } from '@/adapters/oscalRootDocumentParse';
import { deriveProfile } from '@/adapters/oscalProfileAdapter';
import { PROFILE_ROOT_TYPE } from '@/domain/profileModel';
import type { Profile } from '@/domain/profileModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

/**
 * Ein geparstes Profile-Dokument nach dem verlustfreien Vertrag.
 *
 * `source` ist die Wahrheit, `view` eine Projektion darauf. `pin` ist die in
 * Stufe 2 gewählte Matrixzelle und der einzige zulässige Eingang in Stufe 3.
 */
export type ProfileDocument = ParsedRootDocument<Profile>;

/**
 * Parst ein OSCAL-Profile-Dokument verlustfrei nach ADR-2.
 *
 * Der Root-Typ wird über den Dispatch bestimmt und nicht angenommen. Ein
 * schemawidriges Profil wird hier **nicht** abgewiesen: Die Projektion bleibt
 * verlustfrei, und die Schemaaussage trifft Stufe 3 (ADR-7).
 *
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen — dazu zählt eine nicht gepinnte `oscal-version`
 */
export function parseProfileDocument(
  source: unknown,
  context: OscalDocumentContext,
): ProfileDocument {
  return parseRootDocument(source, context, {
    rootType: PROFILE_ROOT_TYPE,
    derive: (body) => deriveProfile(body, context),
  });
}

/**
 * Führt Stufe 3 für ein bereits geparstes Dokument aus.
 *
 * Der Schema-Pin kommt aus dem Dokument und damit aus
 * `getSchemaPin('profile', <deklarierte Version>)`. Es gibt keinen Rückfall auf
 * eine Nachbarversion und keine Modellversionskonstante: derselbe `import` mit
 * `include-all` **und** `include-controls` ist unter 1.1.3 gültig und ab 1.2.1
 * ein Schemabefund.
 */
export const validateProfileSchema: (
  document: ProfileDocument,
) => Promise<OscalSchemaValidationResult> = validateParsedSchema;
