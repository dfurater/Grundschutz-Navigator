import { describe, expect, it } from 'vitest';
import { exportSspDocument, SSP_EXPORT_CODES, validateSspExportTree } from '@/domain/sspExport';
import { createSspSource } from '@/domain/sspAuthoring';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { makeFullSsp, makeMinimalSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';

const ready = (source: unknown) => ({ documentState: 'export-ready' as const, rootType: 'system-security-plan', source });

describe('Validierter SSP-Export', () => {
  it('exportiert reines OSCAL-JSON ohne Envelope und weist die Constraint-Stufe als not-checked aus', async () => {
    const source = makeFullSsp();
    const result = await exportSspDocument({ ...ready(source), localId: 'l', verbundId: 'v', savedAt: 'x' } as never);
    expect(result).toMatchObject({ ok: true, report: { schema: 'passed', references: 'passed', constraints: 'not-checked' } });
    if (!result.ok) return;
    expect(JSON.parse(result.json)).toEqual(source);
    expect(result.json).not.toMatch(/localId|verbundId|savedAt|documentState|binding/);
  });

  it.each(PINNED_OSCAL_VERSIONS)('%s: exportiert gegen das Schema der deklarierten Version', async (version) => {
    const result = await exportSspDocument(ready(makeMinimalSsp(version)));
    expect(result.ok && JSON.parse(result.json)['system-security-plan'].metadata['oscal-version']).toBe(version);
  });

  it('exportiert aus draft und imported nichts und weist einen anderen Root ab', async () => {
    for (const documentState of ['draft', 'imported'] as const) {
      expect(await exportSspDocument({ documentState, rootType: 'system-security-plan', source: makeFullSsp() })).toEqual({ ok: false, code: SSP_EXPORT_CODES.notReady, path: '/' });
    }
    expect(await exportSspDocument({ ...ready(makeFullSsp()), rootType: 'profile' })).toMatchObject({ ok: false, code: SSP_EXPORT_CODES.rootNotSsp });
  });

  it('weist ein neues SSP mit offener Pflichtstruktur am Schema ab', async () => {
    const { source } = createSspSource({ uuid: '77777777-0000-4000-8000-000000000001', resourceUuid: '77777777-0000-4000-8000-000000000002', title: 'Neu', baselineTitle: 'B', lastModified: '2026-10-22T00:00:00.000Z' });
    expect(await exportSspDocument(ready(source))).toMatchObject({ ok: false });
  });

  it('weist eine unauflösbare Referenz ab', async () => {
    const dangling = withSspBody(makeFullSsp(), (ssp) => { Reflect.deleteProperty(ssp.metadata, 'roles'); });
    expect(await exportSspDocument(ready(dangling))).toMatchObject({ ok: false, code: 'OSCAL_SSP_ROLE_REFERENCE_UNRESOLVED' });
  });

  it('lehnt einen Graphen ohne Builder-Herkunft mit OSCAL_OBJECT_UNPROVENANCED ab', async () => {
    expect(await validateSspExportTree(makeFullSsp())).toMatchObject({ ok: false, code: 'OSCAL_OBJECT_UNPROVENANCED' });
  });
});
