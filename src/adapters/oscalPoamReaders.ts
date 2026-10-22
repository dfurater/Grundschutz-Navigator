import { isJsonObject, readString, type JsonObject } from '@/domain/jsonGuards';
import type { PoamDeriveOptions, PoamItem } from '@/domain/poamModel';
import { entity, readObjectArrayField, stringField } from '@/adapters/oscalAssessmentPlanReaders';
import { arReference, origins, relatedObservations, type ArDeriveState } from '@/adapters/oscalAssessmentResultsReaders';

export const POAM_BASE_PATH = '/plan-of-action-and-milestones';
export interface PoamDeriveState extends ArDeriveState {
  readonly options: PoamDeriveOptions;
  readonly resultsContext: ArDeriveState['document'];
  resultsAvailable: boolean;
}

/** Nur Identitätshäufigkeiten, keine Nutzlasten oder dynamischen Pfade in Diagnosen. */
export function countPoamUuids(root: JsonObject): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  const pending: unknown[] = [root];
  const seen = new WeakSet<object>();
  while (pending.length > 0) {
    const node = pending.pop();
    if (!Array.isArray(node) && !isJsonObject(node)) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    if (isJsonObject(node)) {
      const uuid = readString(node.uuid)?.toLowerCase();
      if (uuid !== undefined) counts.set(uuid, (counts.get(uuid) ?? 0) + 1);
    }
    for (const child of Object.values(node)) pending.push(child);
  }
  return counts;
}

export function poamItem(node: JsonObject, path: string, state: PoamDeriveState): PoamItem {
  return {
    ...entity(node, path, state),
    key: path,
    origins: origins(node, path, state),
    relatedObservations: relatedObservations(node, path, state),
    relatedRisks: readObjectArrayField(node, 'related-risks', path, state).map(({ node: related, path: rp }) => {
      const riskUuid = stringField(related, 'risk-uuid', rp, state, true);
      return { riskUuid, path: rp, reference: arReference(state, 'risk', riskUuid, `${rp}/risk-uuid`, 'RISK_REFERENCE_UNRESOLVED', ['document']) };
    }),
    relatedFindings: readObjectArrayField(node, 'related-findings', path, state).map(({ node: related, path: rp }) => {
      const findingUuid = stringField(related, 'finding-uuid', rp, state, true);
      return { findingUuid, path: rp, reference: arReference(state, 'finding', findingUuid, `${rp}/finding-uuid`, 'FINDING_REFERENCE_UNRESOLVED', ['document']) };
    }),
  };
}
