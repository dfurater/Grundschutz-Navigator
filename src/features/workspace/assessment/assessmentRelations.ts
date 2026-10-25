import type { AssessmentFinding, AssessmentObservation, AssessmentResults, AssessmentRisk } from '@/domain/assessmentResultsModel';

function appendUses<T>(index: Map<string, T[]>, entity: T, uuids: readonly string[]) {
  for (const uuid of new Set(uuids)) {
    const uses = index.get(uuid) ?? [];
    uses.push(entity);
    index.set(uuid, uses);
  }
}

/** Ein Index pro geladenem Dokument; nur aufgelöste Referenzen tragen Rückverweise. */
export function createAssessmentRelations(model: AssessmentResults) {
  const observations = new Map<string, AssessmentObservation>();
  const risks = new Map<string, AssessmentRisk>();
  const findingsByObservation = new Map<string, AssessmentFinding[]>();
  const risksByObservation = new Map<string, AssessmentRisk[]>();
  const findingsByRisk = new Map<string, AssessmentFinding[]>();
  const findings = model.results.flatMap(result => result.findings);
  const allRisks = model.results.flatMap(result => result.risks);
  for (const observation of model.results.flatMap(result => result.observations)) if (observation.uuid) observations.set(observation.uuid.toLowerCase(), observation);
  for (const risk of allRisks) if (risk.uuid) risks.set(risk.uuid.toLowerCase(), risk);
  for (const finding of findings) {
    appendUses(findingsByObservation, finding, finding.relatedObservations.flatMap(reference => reference.reference?.state === 'resolved' && reference.observationUuid ? [reference.observationUuid.toLowerCase()] : []));
    appendUses(findingsByRisk, finding, finding.relatedRisks.flatMap(reference => reference.reference.status === 'resolved' && reference.riskUuid ? [reference.riskUuid.toLowerCase()] : []));
  }
  for (const risk of allRisks) {
    appendUses(risksByObservation, risk, risk.relatedObservations.flatMap(reference => reference.reference?.state === 'resolved' && reference.observationUuid ? [reference.observationUuid.toLowerCase()] : []));
  }
  return { observations, risks, findingsByObservation, risksByObservation, findingsByRisk };
}
export type AssessmentRelations = ReturnType<typeof createAssessmentRelations>;
