import { describe, expect, it } from 'vitest';
import { makeFullSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import type { RawOscalProp } from '@/domain/models';
import { PROJECT_PROPS_NAMESPACE as ns } from '@/domain/projectProps';
import { readSspValue } from '@/domain/sspAuthoring';
import { deriveSspProcessProtection } from '@/domain/sspProcessProtection';
import { readProcessDraft, writeProcessDraft } from '@/domain/sspProcessEditing';
import { prepareSspTargets } from '@/domain/sspTargetObjects';
import { exportSspDocument } from '@/domain/sspExport';

const path = ['system-implementation', 'components', 0];
const legacy = { ns, name: 'protection-need-level', value: 'normal', remarks: 'Altwert' };
const foreign = { ns: 'urn:example', name: 'source', value: 'Beleg' };
const mapping = { ns, name: 'process-category-mapping', group: 'cat-intern', value: 'normal', remarks: 'Zuordnung' };
const objective = { ns, name: 'process-protection-integrity', value: 'hoch', remarks: 'Schadensfolge' };
const use = { ns, name: 'process-protection-category', group: 'integrity', value: 'cat-intern' };
const sourceWith = (props: RawOscalProp[], withMapping = false) => withSspBody(makeFullSsp(), body => {
  body['system-implementation'].components[0].type = 'business-process';
  body['system-implementation'].components[0].props = props;
  if (withMapping) body.metadata.props = [mapping];
});

describe('Geschäftsprozess im SSP bearbeiten', () => {
  it('erhält die Quelle bei No-op und bearbeitet nur ausdrücklich geänderte Felder', async () => {
    const source = sourceWith([legacy, foreign]);
    const before = readProcessDraft(source, path);
    expect(Object.values(before.objectives).map(goal => goal.level)).toEqual(['', '', '']);
    expect(writeProcessDraft(source, path, before)).toBe(source);
    const after = writeProcessDraft(source, path, {
      ...before, id: '  A-01  ',
      objectives: { ...before.objectives, integrity: { ...before.objectives.integrity, level: 'hoch', reason: 'Schadensfolge' } },
    });
    expect(readSspValue(after, path)).toEqual({
      ...readSspValue(source, path) as object, props: [legacy, foreign, { ns, name: 'process-id', value: 'A-01' }, objective],
    });
    expect(readSspValue(after, ['system-characteristics'])).toEqual(readSspValue(source, ['system-characteristics']));
    expect(deriveSspProcessProtection(after).processes[0].riskConsideration).toBe('required');
    const exported = await exportSspDocument({ source: after, rootType: 'system-security-plan', documentState: 'export-ready' });
    expect(exported.ok && JSON.parse(exported.json)).toEqual(after);
  });

  it.each([
    [false, 'SSP_PROCESS_CATEGORY_MAPPING_REQUIRED'],
    [true, 'SSP_PROCESS_CATEGORY_CONFLICT'],
  ] as const)('blockiert Speichern und validierten Export bei fehlerhafter Kategorie (%s)', async (withMapping, code) => {
    const source = sourceWith([objective, use], withMapping);
    expect(prepareSspTargets(source)).toMatchObject({ ok: false, code });
    expect(await exportSspDocument({ source, rootType: 'system-security-plan', documentState: 'export-ready' })).toMatchObject({ ok: false, code });
  });
});
