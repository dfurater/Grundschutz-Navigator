// Klasse-2-Dokumenteinstieg: source bleibt unverändert, view ist ausschließlich eine Projektion.
import { parseRootDocument, type ParsedRootDocument } from '@/adapters/oscalRootDocumentParse';
import { validateParsedSchema } from '@/adapters/oscalRootDocumentSchema';
import { deriveAssessmentPlan } from '@/adapters/oscalAssessmentPlanAdapter';
import type { AssessmentPlan, AssessmentPlanDeriveOptions } from '@/domain/assessmentPlanModel';
import type { OscalDocumentContext } from '@/domain/models';
import type { OscalSchemaValidationResult } from '@/domain/oscalSchemaValidation';
export type AssessmentPlanDocument = ParsedRootDocument<AssessmentPlan>;
export function parseAssessmentPlanDocument(
  source: unknown,
  context: OscalDocumentContext,
  options: AssessmentPlanDeriveOptions = {},
): AssessmentPlanDocument {
  return parseRootDocument(source, context, {
    rootType: 'assessment-plan',
    derive: (body) => deriveAssessmentPlan(body, context, options),
  });
}
export const validateAssessmentPlanSchema: (
  document: AssessmentPlanDocument,
) => Promise<OscalSchemaValidationResult> = validateParsedSchema;
