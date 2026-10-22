import { parseRootDocument, type ParsedRootDocument } from '@/adapters/oscalRootDocumentParse';
import { validateParsedSchema } from '@/adapters/oscalRootDocumentSchema';
import { derivePoam } from '@/adapters/oscalPoamAdapter';
import { POAM_ROOT_TYPE, type Poam, type PoamDeriveOptions } from '@/domain/poamModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';

export type PoamDocument = ParsedRootDocument<Poam>;
export function parsePoamDocument(
  source: unknown,
  context: OscalDocumentContext,
  options: PoamDeriveOptions = {},
): PoamDocument {
  return parseRootDocument(source, context, {
    rootType: POAM_ROOT_TYPE,
    derive: (body) => derivePoam(body, context, options),
  });
}
export const validatePoamSchema: (document: PoamDocument) => Promise<OscalSchemaValidationResult> = validateParsedSchema;
