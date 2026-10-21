// =============================================================================
// Root-UUID-Politik (GSPP-315)
//
// `reassign` vergibt die Dokument-UUID bei jedem fachlichen Schreiben neu
// (change-on-write), `keep` führt sie über Revisionen hinweg
// (docs/PERSISTENCE.md §5, ADR-9 Festlegung 4). Ein Checkpoint bindet deshalb
// den Content-Hash, nicht die UUID allein.
// =============================================================================

import type { OscalRootKey } from '@/domain/oscalVersionMatrix';

export type RootUuidPolicy = 'reassign' | 'keep';

export const OSCAL_ROOT_UUID_POLICY: Readonly<Record<OscalRootKey, RootUuidPolicy>> = Object.freeze({
  catalog: 'reassign',
  profile: 'reassign',
  'component-definition': 'reassign',
  'mapping-collection': 'reassign',
  'system-security-plan': 'keep',
  'assessment-plan': 'keep',
  'assessment-results': 'keep',
  'plan-of-action-and-milestones': 'keep',
});

export function rootUuidPolicy(rootType: OscalRootKey): RootUuidPolicy {
  return OSCAL_ROOT_UUID_POLICY[rootType];
}
