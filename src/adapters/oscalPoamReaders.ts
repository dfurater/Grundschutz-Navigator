import type { JsonObject } from '@/domain/jsonGuards';
import type { PoamDeriveOptions, PoamItem, PoamReference } from '@/domain/poamModel';
import { diagnose, entity, readObjectArrayField, stringField } from '@/adapters/oscalAssessmentPlanReaders';
import { origins, relatedObservations, type ArDeriveState } from '@/adapters/oscalAssessmentResultsReaders';

export const POAM_BASE_PATH = '/plan-of-action-and-milestones';
export interface PoamDeriveState extends ArDeriveState {
  readonly options: PoamDeriveOptions;
  readonly resultsContext: ArDeriveState['document'];
  resultsAvailable: boolean;
}

function itemReference(state: PoamDeriveState, type: string, id: string | undefined, path: string): PoamReference {
  const fail = (reason: string): PoamReference => {
    diagnose(state, `${type.toUpperCase()}_REFERENCE_UNRESOLVED`, path);
    return { status: 'unresolved', reason };
  };
  if (id === undefined) return fail('identity-missing');
  const key = id.toLowerCase();
  const local = state.document.get(type)?.get(key) ?? [];
  if (local.length === 1) return { status: 'resolved', origin: 'local', path: local[0] };
  if (local.length > 1) return fail('identity-ambiguous');
  // Ein vorhandenes Ziel der falschen Art darf fehlenden Kontext nicht vortäuschen.
  if ([...state.document.values()].some((index) => index.has(key))) return fail('identity-type-mismatch');
  if (!state.resultsAvailable)
    return { status: 'not-resolvable-in-context', reason: state.options.assessmentResults === undefined ? 'assessment-results-not-supplied' : 'assessment-results-binding-invalid' };
  const external = state.resultsContext.get(type)?.get(key) ?? [];
  if (external.length === 1) return { status: 'resolved', origin: 'assessment-results', path: external[0] };
  return fail(external.length > 1 ? 'identity-ambiguous' : 'identity-not-found');
}
export function poamItem(node: JsonObject, path: string, state: PoamDeriveState): PoamItem {
  return {
    ...entity(node, path, state),
    key: path,
    origins: origins(node, path, state),
    relatedObservations: relatedObservations(node, path, state),
    relatedRisks: readObjectArrayField(node, 'related-risks', path, state).map(({ node: related, path: rp }) => {
      const riskUuid = stringField(related, 'risk-uuid', rp, state, true);
      return { riskUuid, path: rp, reference: itemReference(state, 'risk', riskUuid, `${rp}/risk-uuid`) };
    }),
    relatedFindings: readObjectArrayField(node, 'related-findings', path, state).map(({ node: related, path: rp }) => {
      const findingUuid = stringField(related, 'finding-uuid', rp, state, true);
      return { findingUuid, path: rp, reference: itemReference(state, 'finding', findingUuid, `${rp}/finding-uuid`) };
    }),
  };
}
