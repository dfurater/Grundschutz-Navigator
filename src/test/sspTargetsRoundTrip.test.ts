import { describe, expect, it } from 'vitest';
import { runEditRoundTrip } from '@/test/oscalRoundTrip';
import { makeFullSsp, makeMinimalSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import { prepareSspTargets, setTargetProtection, sspTargets, targetCoverage } from '@/domain/sspTargetObjects';
import { commitSspSave } from '@/domain/sspSave';
import { exportSspDocument } from '@/domain/sspExport';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';

function prepared(source: unknown) {
  const result = prepareSspTargets(source);
  if (!result.ok) throw new Error(result.code);
  return result.source;
}

describe('SSP-Zielobjekte im echten Schreib-/Exportpfad', () => {
  it('bewahrt im Edit-Harnisch native CIA-Felder, fremde Props, Links, Back-matter und UUID-lose Informationsarten', async () => {
    const path = ['system-implementation', 'components', 0];
    const source = withSspBody(makeFullSsp(), body => { delete body['system-characteristics']['system-information']!['information-types']![0].uuid; });
    const stored = prepared(setTargetProtection(source, path, 'normal', 'Geprüft'));
    const result = await runEditRoundTrip({
      fixtureText: JSON.stringify(stored),
      edit: { op: 'replace', path: ['system-security-plan', ...path, 'props', 0, 'value'], value: 'hoch' },
      stamp: { uuid: 'aaaaaaaa-0000-4000-8000-000000000099', lastModified: '2026-10-23T10:00:00Z' },
      exportDocument: (parsed, stamp) => commitSspSave(parsed, prepared(setTargetProtection(parsed, path, 'hoch', 'Geprüft')), stamp.lastModified).source,
    });
    expect(result).toMatchObject({ status: 'passed', graph: { status: 'passed', unexpected: [], missing: [] }, identities: { status: 'passed', findings: [] } });
  });
  it.each(PINNED_OSCAL_VERSIONS)('%s: exportiert alle bewerteten Träger mit complete und unveränderten Versionswerten', async version => {
    let source: unknown = makeMinimalSsp(version);
    for (const target of sspTargets(source)) source = setTargetProtection(source, target.path, 'normal', 'Synthetisch');
    source = prepared(source);
    expect(targetCoverage(source).value).toBe('complete');
    const result = await exportSspDocument({ documentState: 'export-ready', rootType: 'system-security-plan', source });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(JSON.parse(result.json)).toEqual(source);
      expect(JSON.parse(result.json)['system-security-plan'].metadata['oscal-version']).toBe(version);
    }
  });
});
