// Findings und Risiken eines Assessment-Results-Ergebnisses.
import type { JsonObject } from '@/domain/jsonGuards';
import type { AssessmentFinding, AssessmentRisk } from '@/domain/assessmentResultsModel';
import {
  entity,
  objectField,
  readElements,
  readObjectArrayField,
  stringField,
} from '@/adapters/oscalAssessmentPlanReaders';
import { tasks } from '@/adapters/oscalAssessmentPlanTasks';
import {
  arReference,
  origin,
  origins,
  relatedObservations,
  subjectReferences,
} from '@/adapters/oscalAssessmentResultsReaders';
import type { ArDeriveState } from '@/adapters/oscalAssessmentResultsReaders';

export function deriveFinding(node: JsonObject, path: string, state: ArDeriveState): AssessmentFinding {
  const target = objectField(node, 'target', path, state, true);
  const tp = `${path}/target`;
  const status = target === null ? null : objectField(target, 'status', tp, state, true);
  const implementation = target === null ? null : objectField(target, 'implementation-status', tp, state);
  const statementUuid = stringField(node, 'implementation-statement-uuid', path, state);
  const observations = relatedObservations(node, path, state);
  const risks = readObjectArrayField(node, 'related-risks', path, state).map(({ node: risk, path: rp }) => {
    const riskUuid = stringField(risk, 'risk-uuid', rp, state, true);
    return {
      riskUuid,
      remarks: stringField(risk, 'remarks', rp, state),
      path: rp,
      reference: arReference(state, 'risk', riskUuid, `${rp}/risk-uuid`, 'RISK_REFERENCE_UNRESOLVED', ['document']),
    };
  });
  return {
    ...entity(node, path, state),
    origins: origins(node, path, state),
    target:
      target === null
        ? null
        : {
            ...readElements(target, tp, state),
            type: stringField(target, 'type', tp, state, true),
            targetId: stringField(target, 'target-id', tp, state, true),
            title: stringField(target, 'title', tp, state),
            description: stringField(target, 'description', tp, state),
            status:
              status === null
                ? null
                : {
                    state: stringField(status, 'state', `${tp}/status`, state, true),
                    reason: stringField(status, 'reason', `${tp}/status`, state),
                  },
            implementationStatus:
              implementation === null
                ? null
                : {
                    state: stringField(implementation, 'state', `${tp}/implementation-status`, state, true),
                    remarks: stringField(implementation, 'remarks', `${tp}/implementation-status`, state),
                  },
          },
    implementationStatementUuid: statementUuid,
    implementationStatement:
      statementUuid === undefined
        ? null
        : arReference(
            state,
            'statement',
            statementUuid,
            `${path}/implementation-statement-uuid`,
            'IMPLEMENTATION_STATEMENT_UNRESOLVED',
            ['ssp'],
          ),
    relatedObservations: observations,
    relatedRisks: risks,
    hasLinkedEvidence: observations.length + risks.length > 0,
  };
}
export function deriveRisk(node: JsonObject, path: string, state: ArDeriveState): AssessmentRisk {
  const log = objectField(node, 'risk-log', path, state);
  return {
    ...entity(node, path, state),
    statement: stringField(node, 'statement', path, state, true),
    status: stringField(node, 'status', path, state, true),
    origins: origins(node, path, state),
    threatIds: readObjectArrayField(node, 'threat-ids', path, state).map(({ node: threat, path: tp }) => ({
      system: stringField(threat, 'system', tp, state, true),
      id: stringField(threat, 'id', tp, state, true),
      href: stringField(threat, 'href', tp, state),
      path: tp,
    })),
    characterizations: readObjectArrayField(node, 'characterizations', path, state).map(({ node: item, path: cp }) => {
      const source = objectField(item, 'origin', cp, state, true);
      return {
        ...readElements(item, cp, state, false),
        origin: source === null ? null : origin(source, `${cp}/origin`, state),
        facets: readObjectArrayField(item, 'facets', cp, state).map(({ node: facet, path: fp }) => ({
          ...readElements(facet, fp, state),
          name: stringField(facet, 'name', fp, state, true),
          system: stringField(facet, 'system', fp, state, true),
          value: stringField(facet, 'value', fp, state, true),
        })),
      };
    }),
    mitigatingFactors: readObjectArrayField(node, 'mitigating-factors', path, state).map(({ node: factor, path: mp }) => ({
      ...entity(factor, mp, state),
      implementationUuid: stringField(factor, 'implementation-uuid', mp, state),
      subjects: subjectReferences(factor, mp, state),
    })),
    deadline: stringField(node, 'deadline', path, state),
    remediations: readObjectArrayField(node, 'remediations', path, state).map(({ node: response, path: xp }) => ({
      ...entity(response, xp, state),
      lifecycle: stringField(response, 'lifecycle', xp, state, true),
      origins: origins(response, xp, state),
      requiredAssets: readObjectArrayField(response, 'required-assets', xp, state).map(({ node: asset, path: ap }) => ({
        ...entity(asset, ap, state),
        subjects: subjectReferences(asset, ap, state),
      })),
      tasks: tasks(response, xp, state),
    })),
    riskLog:
      log === null
        ? []
        : readObjectArrayField(log, 'entries', `${path}/risk-log`, state).map(({ node: entry, path: ep }) => ({
            ...entity(entry, ep, state),
            start: stringField(entry, 'start', ep, state, true),
            end: stringField(entry, 'end', ep, state),
            statusChange: stringField(entry, 'status-change', ep, state),
            relatedResponses: readObjectArrayField(entry, 'related-responses', ep, state).map(({ node: related, path: rp }) => {
              const responseUuid = stringField(related, 'response-uuid', rp, state, true);
              return {
                responseUuid,
                path: rp,
                reference: arReference(state, 'response', responseUuid, `${rp}/response-uuid`, 'RESPONSE_REFERENCE_UNRESOLVED', ['document']),
              };
            }),
          })),
    relatedObservations: relatedObservations(node, path, state),
  };
}
