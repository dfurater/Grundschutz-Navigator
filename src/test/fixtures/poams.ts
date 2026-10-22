import type { PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { AR_UUIDS, makeFullAssessmentResults } from '@/test/fixtures/assessmentResults';

export const POAM_UUID = '00000000-0000-4000-8000-000000000201';
export const POAM_ITEM_UUID = '00000000-0000-4000-8000-000000000202';
export function makeMinimalPoam(version: PinnedOscalVersion = '1.2.2') {
  return {
    'plan-of-action-and-milestones': {
      uuid: POAM_UUID,
      metadata: { title: 'Maßnahmenplan', version: '1', 'last-modified': '2026-10-22T00:00:00Z', 'oscal-version': version },
      'system-id': { id: 'synthetic-system' },
      'poam-items': [{ title: 'Maßnahme', description: 'Synthetische Beschreibung' }],
    },
  };
}
export function makeFullPoam() {
  const ar = makeFullAssessmentResults()['assessment-results'];
  const result = ar.results[0];
  const risks = structuredClone(result.risks);
  Object.assign(risks[0], { deadline: '2026-12-01T00:00:00Z' });
  Object.assign(risks[0].remediations[0], { tasks: result['local-definitions'].tasks });
  return {
    'plan-of-action-and-milestones': {
      ...makeMinimalPoam()['plan-of-action-and-milestones'],
      metadata: ar.metadata,
      'import-ssp': { href: 'https://ssp.invalid/ssp.json' },
      'local-definitions': { components: result['local-definitions'].components },
      observations: result.observations,
      findings: result.findings,
      risks,
      'back-matter': ar['back-matter'],
      'poam-items': [{
        uuid: POAM_ITEM_UUID,
        title: 'Maßnahme',
        description: '<script>synthetic</script>',
        origins: [{ actors: [{ type: 'party', 'actor-uuid': AR_UUIDS.party }] }],
        'related-observations': [{ 'observation-uuid': AR_UUIDS.observation }],
        'related-risks': [{ 'risk-uuid': String(AR_UUIDS.risk) }],
        'related-findings': [{ 'finding-uuid': AR_UUIDS.finding }],
      }],
    },
  };
}
