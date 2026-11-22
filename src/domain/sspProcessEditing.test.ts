import { describe, expect, it } from 'vitest';
import { makeFullSsp, SSP_FIXTURE_IDS, withSspBody } from '@/test/fixtures/systemSecurityPlans';
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

  it('verwirft konkurrierende Kategorienänderungen und erhält fachlich unabhängige Felder', () => {
    const source = sourceWith([], true);
    const before = readProcessDraft(source, path);
    const category = before.categories[0];
    const draft = { ...before, categories: [{ ...category, level: 'hoch' }] };
    const changed = writeProcessDraft(source, path, draft);
    const withReason = writeProcessDraft(changed, path, { ...before, categories: [{ ...category, reason: 'Präzisierung' }] }, before);
    expect(readProcessDraft(withReason, path).categories[0]).toMatchObject({ level: 'hoch', reason: 'Präzisierung' });
    expect(() => writeProcessDraft(withReason, path, { ...before, categories: [{ ...category, reason: 'Veralteter Entwurf' }] }, before))
      .toThrow('SSP_PROCESS_CATEGORY_EDIT_CONFLICT');
  });

  it('wechselt zwischen wesentlicher Anwendung und begründetem Nullfall und erhält native Erweiterungen', () => {
    const initial = withSspBody(sourceWith([legacy, objective]), body => {
      const process = body['system-implementation'].components[0];
      process.status.remarks = 'Erhalten';
    });
    const before = readProcessDraft(initial, path);
    const assigned = writeProcessDraft(initial, path, { ...before,
      owners: [SSP_FIXTURE_IDS.party], applications: [SSP_FIXTURE_IDS.software], status: 'other',
    });
    expect(readSspValue(assigned, [...path, 'status'])).toEqual({ state: 'other', remarks: 'Erhalten' });
    expect(readSspValue(assigned, ['metadata', 'roles'])).toContainEqual(expect.objectContaining({ id: 'process-owner' }));

    const current = readProcessDraft(assigned, path);
    const none = writeProcessDraft(assigned, path, { ...current, owners: [], applications: [], noApplications: true,
      noApplicationsReason: 'Papierakte', title: '', status: '', objectives: { ...current.objectives,
        integrity: { ...current.objectives.integrity, level: '', reason: '' },
      },
    });
    expect(readSspValue(none, [...path, 'props'])).toEqual([legacy, { ns, name: 'process-applications-none', value: 'true', remarks: 'Papierakte' }]);
    expect(readSspValue(none, [...path, 'status'])).toEqual({ remarks: 'Erhalten' });
    expect(readSspValue(none, [...path, 'responsible-roles'])).toEqual(readSspValue(initial, [...path, 'responsible-roles']));
    const reassigned = writeProcessDraft(none, path, { ...readProcessDraft(none, path), applications: [SSP_FIXTURE_IDS.software], noApplications: false });
    expect(readSspValue(reassigned, [...path, 'props'])).toEqual([legacy, { ns, name: 'process-application-uuid', value: SSP_FIXTURE_IDS.software }]);
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
