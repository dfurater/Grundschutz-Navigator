import { describe, expect, it } from 'vitest';
import { parseAssessmentResultsDocument } from '@/adapters/oscalAssessmentResultsDocument';
import { createAssessmentRelations } from '@/features/workspace/assessment/assessmentRelations';
import { AR_UUIDS, makeFullAssessmentResults } from '@/test/fixtures/assessmentResults';

function crossResultModel(ambiguous = false) {
  const source = makeFullAssessmentResults();
  const first = source['assessment-results'].results[0];
  const second = { ...first, uuid: AR_UUIDS.missing as typeof AR_UUIDS.result, title: 'Zweites Ergebnis', findings: [] };
  source['assessment-results'].results.push(second);
  Object.assign(first, { observations: ambiguous ? structuredClone(second.observations) : undefined, risks: ambiguous ? structuredClone(second.risks) : undefined });
  return parseAssessmentResultsDocument(JSON.parse(JSON.stringify(source)), { trustClass: 'class-2-local-user' }).view;
}

describe('Dokumentweite Results-Beziehungen', () => {
  it('indiziert vorwärts und rückwärts nur die aufgelösten Modellbeziehungen über Ergebnisgrenzen', () => {
    const model = crossResultModel();
    const relations = createAssessmentRelations(model);
    expect(relations.observations.get(AR_UUIDS.observation)).toBe(model.results[1].observations[0]);
    expect(relations.risks.get(AR_UUIDS.risk)).toBe(model.results[1].risks[0]);
    expect(relations.findingsByObservation.get(AR_UUIDS.observation)).toEqual([model.results[0].findings[0]]);
    expect(relations.risksByObservation.get(AR_UUIDS.observation)).toEqual([model.results[1].risks[0]]);
    expect(relations.findingsByRisk.get(AR_UUIDS.risk)).toEqual([model.results[0].findings[0]]);
  });
  it('weist mehrdeutige UUIDs keine Verwendung zu', () => {
    const model = crossResultModel(true);
    const relations = createAssessmentRelations(model);
    expect(relations.findingsByObservation.get(AR_UUIDS.observation)).toBeUndefined();
    expect(relations.findingsByRisk.get(AR_UUIDS.risk)).toBeUndefined();
  });
  it('zählt doppelte aufgelöste Verweise desselben Findings nur einmal', () => {
    const source = makeFullAssessmentResults();
    const finding = source['assessment-results'].results[0].findings[0];
    Object.assign(finding, { 'related-observations': [{ 'observation-uuid': AR_UUIDS.observation }, { 'observation-uuid': AR_UUIDS.observation }] });
    const model = parseAssessmentResultsDocument(source, { trustClass: 'class-2-local-user' }).view;
    expect(createAssessmentRelations(model).findingsByObservation.get(AR_UUIDS.observation)).toHaveLength(1);
  });
});
