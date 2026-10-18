// =============================================================================
// Verlustfreier Dokumenteinstieg für System Security Plans (GSPP-293)
//
// Dieselbe Aufteilung wie bei der Component Definition: `oscalSspAdapter.ts`
// leitet die Projektion aus dem Root-Körper ab, diese Datei hält `source`,
// Kontext und `view` als Dokument zusammen und führt den Root-Dispatch davor
// (ADR-2, GSPP-285).
//
// Ein SSP gelangt ausschließlich als lokale Nutzerdatei in die Anwendung. Der
// vorgesehene Weg ist die Klasse-2-Importgrenze: `importClass2OscalDocument()`
// prüft Bytes, Root, Version und Schema; ihr Erfolgsergebnis liefert `source`
// und `context` für `parseSspDocument()`.
// =============================================================================

import { parseRootDocument } from '@/adapters/oscalRootDocumentParse';
import type { ParsedRootDocument } from '@/adapters/oscalRootDocumentParse';
import { validateParsedSchema } from '@/adapters/oscalRootDocumentSchema';
import { deriveSystemSecurityPlan } from '@/adapters/oscalSspAdapter';
import { SYSTEM_SECURITY_PLAN_ROOT_TYPE } from '@/domain/systemSecurityPlanModel';
import type {
  SystemSecurityPlan,
  SystemSecurityPlanDeriveOptions,
} from '@/domain/systemSecurityPlanModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

/**
 * Ein geparstes SSP nach dem verlustfreien Vertrag. `source` ist die Wahrheit,
 * `view` eine Projektion darauf; `pin` ist die in Stufe 2 gewählte Matrixzelle.
 */
export type SspDocument = ParsedRootDocument<SystemSecurityPlan>;

/**
 * Parst ein OSCAL-SSP verlustfrei nach ADR-2.
 *
 * Der Root-Typ wird über den Dispatch bestimmt und nicht angenommen. Ein
 * schemawidriges SSP wird hier nicht abgewiesen, sondern diagnostiziert; die
 * Schemaaussage trifft Stufe 3.
 *
 * @throws OscalRootDispatchError wenn Root-Erkennung oder Versionsbindung
 *   fehlschlagen — dazu zählt eine fehlende oder nicht gepinnte `oscal-version`
 * @throws SspTrustClassError wenn der Kontext nicht `class-2-local-user` trägt
 */
export function parseSspDocument(
  source: unknown,
  context: OscalDocumentContext,
  options: SystemSecurityPlanDeriveOptions = {},
): SspDocument {
  return parseRootDocument(source, context, {
    rootType: SYSTEM_SECURITY_PLAN_ROOT_TYPE,
    derive: (body) => deriveSystemSecurityPlan(body, context, options),
  });
}

/**
 * Führt Stufe 3 für ein bereits geparstes SSP aus. Der Schema-Pin kommt aus
 * dem Dokument und damit aus der deklarierten `oscal-version`.
 */
export const validateSspSchema: (
  document: SspDocument,
) => Promise<OscalSchemaValidationResult> = validateParsedSchema;
