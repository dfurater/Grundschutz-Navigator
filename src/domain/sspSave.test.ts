import { describe, expect, it } from 'vitest';
import { commitSspSave, sameSspContent, sspReadinessBlocker, sspSaveBlocker } from '@/domain/sspSave';
import { setSspValue } from '@/domain/sspAuthoring';
import { makeFullSsp, SSP_FIXTURE_IDS, withSspBody } from '@/test/fixtures/systemSecurityPlans';

const STAMP = '2026-10-22T12:00:00.000Z';

function body(source: unknown) {
  return (source as { 'system-security-plan': { uuid: string; metadata: Record<string, string> } })['system-security-plan'];
}

describe('Explizites Speichern', () => {
  it('lässt die Root-UUID bei einer Inhaltsänderung unverändert und setzt last-modified', () => {
    const stored = makeFullSsp();
    const { source, changed } = commitSspSave(stored, setSspValue(stored, ['metadata', 'title'], 'Neu'), STAMP);
    expect(changed).toBe(true);
    expect(body(source).uuid).toBe(SSP_FIXTURE_IDS.ssp);
    expect(body(source).metadata['last-modified']).toBe(STAMP);
  });

  it('lässt UUID und last-modified ohne Inhaltsänderung unverändert, auch bei anderer Schlüsselreihenfolge', () => {
    const stored = makeFullSsp();
    const reordered = { 'system-security-plan': Object.fromEntries(Object.entries(body(stored)).reverse()) };
    const { source, changed } = commitSspSave(stored, reordered, STAMP);
    expect(changed).toBe(false);
    expect(source).toEqual(stored);
    expect(sameSspContent(stored, reordered)).toBe(true);
  });
});

describe('Referenzprüfung', () => {
  it('meldet eine component-uuid ohne Komponente als Speicherblocker', () => {
    const dangling = withSspBody(makeFullSsp(), (ssp) => { ssp['system-implementation'].components.pop(); });
    expect(sspSaveBlocker(dangling)).toMatchObject({ code: 'OSCAL_SSP_COMPONENT_REFERENCE_UNRESOLVED' });
    expect(sspSaveBlocker(makeFullSsp())).toBeUndefined();
  });

  it('meldet unauflösbare role-id und Party-UUID nur als Blocker für export-ready', () => {
    const roleless = withSspBody(makeFullSsp(), (ssp) => { Reflect.deleteProperty(ssp.metadata, 'roles'); });
    const partyless = withSspBody(makeFullSsp(), (ssp) => { Reflect.deleteProperty(ssp.metadata, 'parties'); });
    expect(sspSaveBlocker(roleless)).toBeUndefined();
    expect(sspReadinessBlocker(roleless)).toMatchObject({ code: 'OSCAL_SSP_ROLE_REFERENCE_UNRESOLVED' });
    expect(sspReadinessBlocker(partyless)).toMatchObject({ code: 'OSCAL_SSP_PARTY_REFERENCE_UNRESOLVED' });
    expect(sspReadinessBlocker(makeFullSsp())).toBeUndefined();
  });

  it('sperrt export-ready bei einer mehrfach vergebenen Rollen-id oder Party-uuid', () => {
    const roles = withSspBody(makeFullSsp(), (ssp) => { ssp.metadata.roles = [...(ssp.metadata.roles ?? []), { id: 'system-owner', title: 'Zweite' }]; });
    const parties = withSspBody(makeFullSsp(), (ssp) => {
      ssp.metadata.parties = [...(ssp.metadata.parties ?? []), { uuid: SSP_FIXTURE_IDS.party.toUpperCase(), type: 'person', name: 'Zweite' }];
    });
    expect(sspReadinessBlocker(roles)).toMatchObject({ code: 'OSCAL_SSP_ROLE_ID_DUPLICATE' });
    expect(sspReadinessBlocker(parties)).toMatchObject({ code: 'OSCAL_SSP_PARTY_UUID_DUPLICATE' });
  });
});
