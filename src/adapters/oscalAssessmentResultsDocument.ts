// Klasse-2-Dokumenteinstieg: source bleibt unverändert, view ist ausschließlich eine Projektion.
import { parseRootDocument, type ParsedRootDocument } from '@/adapters/oscalRootDocumentParse';
import { validateParsedSchema } from '@/adapters/oscalRootDocumentSchema';
import { deriveAssessmentResults } from '@/adapters/oscalAssessmentResultsAdapter';
import type {
  AssessmentResults,
  AssessmentResultsDeriveOptions,
} from '@/domain/assessmentResultsModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';
export type AssessmentResultsDocument = ParsedRootDocument<AssessmentResults>;
export function parseAssessmentResultsDocument(
  source: unknown,
  context: OscalDocumentContext,
  options: AssessmentResultsDeriveOptions = {},
): AssessmentResultsDocument {
  return parseRootDocument(source, context, {
    rootType: 'assessment-results',
    derive: (body) => deriveAssessmentResults(body, context, options),
  });
}
export const validateAssessmentResultsSchema: (
  document: AssessmentResultsDocument,
) => Promise<OscalSchemaValidationResult> = validateParsedSchema;
