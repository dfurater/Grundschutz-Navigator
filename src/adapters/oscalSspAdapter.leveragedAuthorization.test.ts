// =============================================================================
// Partei-Referenz der leveraged-authorizations im SSP-Adapter (GSPP-586)
//
// Feste Erwartungswerte stehen ausschließlich gegen die synthetischen Fixtures
// aus `src/test/fixtures/systemSecurityPlans.ts`.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { deriveSystemSecurityPlan, SSP_ADAPTER_DIAGNOSTIC_CODES } from './oscalSspAdapter';
import type { SystemSecurityPlan } from './oscalSspAdapter';
import type { OscalDocumentContext } from '@/domain/models';
import { makeFullSsp, SSP_FIXTURE_IDS, withSspBody } from '@/test/fixtures/systemSecurityPlans';

const context: OscalDocumentContext = { trustClass: 'class-2-local-user' };
const authorizationPath = '/system-security-plan/system-implementation/leveraged-authorizations/0';

function deriveWithPartyUuid(partyUuid: string): SystemSecurityPlan {
  const document = withSspBody(makeFullSsp(), (body) => {
    body['system-implementation']['leveraged-authorizations']![0]['party-uuid'] = partyUuid;
  });
  return deriveSystemSecurityPlan(document['system-security-plan'], context);
}

describe('party-uuid an leveraged-authorizations', () => {
  it('diagnostiziert eine party-uuid ohne Partei in metadata.parties und liefert das Dokument', () => {
    const plan = deriveWithPartyUuid('66666666-0000-4000-8000-0000000000fd');

    expect(plan.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([
      [SSP_ADAPTER_DIAGNOSTIC_CODES.PARTY_REFERENCE_UNRESOLVED, `${authorizationPath}/party-uuid`],
    ]);
    expect(plan.systemImplementation?.leveragedAuthorizations).toHaveLength(1);
  });

  it('löst die party-uuid unabhängig von der Schreibweise auf und behält den gelesenen Wert', () => {
    const plan = deriveWithPartyUuid(SSP_FIXTURE_IDS.party.toUpperCase());

    expect(plan.diagnostics).toEqual([]);
    expect(plan.systemImplementation?.leveragedAuthorizations[0]?.partyUuid).toBe(SSP_FIXTURE_IDS.party.toUpperCase());
  });
});
