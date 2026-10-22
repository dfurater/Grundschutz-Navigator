import { describe, expect, it } from 'vitest';
import { parsePoamDocument, validatePoamSchema } from '@/adapters/oscalPoamDocument';
import { derivePoamProgress, readRoleTitles, sortPoamProgress, type PoamProgressRow } from '@/domain/poamProgress';
import { makeFullPoam, makeMinimalPoam } from '@/test/fixtures/poams';

const context = { trustClass: 'class-2-local-user' } as const;
const NOW = new Date('2026-10-22T00:00:00Z');
type Source = ReturnType<typeof makeFullPoam>;
type Body = Source['plan-of-action-and-milestones'] & Record<string, unknown>;

function rowsOf(source: unknown, now = NOW) {
  return derivePoamProgress(parsePoamDocument(source, context).view, now, readRoleTitles(source));
}
function withBody(change: (body: Body) => void): Source {
  const source = makeFullPoam();
  change(source['plan-of-action-and-milestones'] as Body);
  return source;
}
const risk = (body: Body) => body.risks[0] as Record<string, unknown> & { remediations: Record<string, unknown>[] };

describe('derivePoamProgress', () => {
  it('liest Frist, Anforderungsbezug, Stand und Risikostatus aus den verknüpften Objekten', () => {
    expect(rowsOf(makeFullPoam())).toEqual([expect.objectContaining({
      title: 'Maßnahme',
      requirementIds: ['ac-1_obj'],
      deadline: '2026-12-01T00:00:00Z',
      deadlineState: 'eingehalten',
      riskStatuses: ['open'],
      lifecycles: [{ value: 'planned', documented: true }],
      completed: false,
    })]);
  });

  it('nimmt die früheste Frist auch aus verschachteltem Task-Timing und löst Rollentitel dokumentintern auf', () => {
    const source = withBody((body) => {
      (body.metadata as Record<string, unknown>).roles = [{ id: 'isb', title: 'ISB' }];
      risk(body).remediations[0].tasks = [{
        uuid: '00000000-0000-4000-8000-000000000301', type: 'milestone', title: 'Meilenstein',
        timing: { 'on-date': { date: '2026-11-01T10:00:00+02:00' } },
        'responsible-roles': [{ 'role-id': 'isb' }],
        tasks: [{
          uuid: '00000000-0000-4000-8000-000000000302', type: 'action', title: 'Teilaufgabe',
          timing: { 'within-date-range': { start: '2026-09-01T00:00:00-05:00', end: '2026-10-01T00:00:00-05:00' } },
          'responsible-roles': [{ 'role-id': 'unbekannt' }],
        }],
      }];
    });
    expect(rowsOf(source)[0]).toMatchObject({
      deadline: '2026-10-01T00:00:00-05:00', deadlineState: 'überschritten', responsible: ['ISB', 'unbekannt'],
    });
  });

  it('vergleicht Fristen zeitpunktbasiert über verschiedene Offsets', () => {
    const state = (deadline: string) => rowsOf(withBody((body) => { risk(body).deadline = deadline; }))[0].deadlineState;
    expect(state('2026-10-22T02:00:00+02:00')).toBe('eingehalten');
    expect(state('2026-10-21T23:59:00-01:00')).toBe('eingehalten');
    expect(state('2026-10-22T01:00:00+02:00')).toBe('überschritten');
  });

  it('führt ein Item ohne lesbare Frist als „ohne Frist“, nie als eingehalten', () => {
    expect(rowsOf(makeMinimalPoam())[0]).toMatchObject({ deadlineState: 'ohne Frist', deadline: undefined, completed: false });
    const frequencyOnly = withBody((body) => {
      delete risk(body).deadline;
      risk(body).remediations[0].tasks = [{
        uuid: '00000000-0000-4000-8000-000000000303', type: 'action', title: 'Turnus',
        timing: { 'at-frequency': { period: 1, unit: 'months' } },
      }];
    });
    expect(rowsOf(frequencyOnly)[0].deadlineState).toBe('ohne Frist');
    expect(rowsOf(withBody((body) => { risk(body).deadline = '2026-01-01T00:00:00'; }))[0].deadlineState).toBe('ohne Frist');
    const dangling = withBody((body) => { body['poam-items'][0]['related-risks'] = [{ 'risk-uuid': '00000000-0000-4000-8000-0000000003ff' }]; });
    expect(rowsOf(dangling)[0]).toMatchObject({ deadlineState: 'ohne Frist', riskStatuses: [] });
  });

  it('schließt nur über lifecycle = completed ab und lässt risk.status unverändert', () => {
    const done = withBody((body) => { risk(body).remediations[0].lifecycle = 'completed'; });
    expect(rowsOf(done)[0]).toMatchObject({ completed: true, riskStatuses: ['open'] });
    const closedRisk = withBody((body) => { risk(body).status = 'closed'; });
    expect(rowsOf(closedRisk)[0]).toMatchObject({ completed: false, riskStatuses: ['closed'] });
  });

  it('lässt ein aufgelöstes Risiko ohne Responses offen', () => {
    const withoutResponses = withBody((body) => { delete (risk(body) as Record<string, unknown>).remediations; });
    expect(rowsOf(withoutResponses)[0]).toMatchObject({ unresolvedRisks: 0, lifecycles: [], completed: false, riskStatuses: ['open'] });
  });

  it('überspringt Risiken ohne oder mit doppelter UUID beim Auflösen', () => {
    const source = withBody((body) => {
      const original = risk(body);
      const withoutUuid = { ...structuredClone(original), deadline: '2026-01-01T00:00:00Z' };
      delete (withoutUuid as Record<string, unknown>).uuid;
      body.risks.push(withoutUuid as never, { ...structuredClone(original), deadline: '2026-02-01T00:00:00Z' } as never);
    });
    // Die Doppelung macht den Verweis mehrdeutig; das Risiko ohne UUID ist nie ein Ziel.
    expect(rowsOf(source)[0]).toMatchObject({ unresolvedRisks: 1, completed: false, deadlineState: 'ohne Frist', deadline: undefined });
  });

  it('wertet ein unmögliches Kalenderdatum nicht als Frist', () => {
    expect(rowsOf(withBody((body) => { risk(body).deadline = '2026-02-30T10:00:00Z'; }))[0]).toMatchObject({ deadlineState: 'ohne Frist', deadline: undefined });
  });

  it('belegt bei nicht auflösbarem Risikoverweis weder Abschluss noch eingehaltene Frist', () => {
    const withDangling = (deadline: string) => withBody((body) => {
      risk(body).deadline = deadline;
      risk(body).remediations[0].lifecycle = 'completed';
      body['poam-items'][0]['related-risks'].push({ 'risk-uuid': '00000000-0000-4000-8000-0000000003fe' });
    });
    expect(rowsOf(withDangling('2026-12-01T00:00:00Z'))[0]).toMatchObject({
      unresolvedRisks: 1, completed: false, deadlineState: 'ohne Frist', deadline: '2026-12-01T00:00:00Z',
    });
    expect(rowsOf(withDangling('2026-10-01T00:00:00Z'))[0]).toMatchObject({
      unresolvedRisks: 1, completed: false, deadlineState: 'überschritten', deadline: '2026-10-01T00:00:00Z',
    });
  });

  it('weist ein schemagültiges erfundenes Lifecycle-Token als unbekannt aus und zählt es nicht als abgeschlossen', async () => {
    const source = withBody((body) => { risk(body).remediations[0].lifecycle = 'erledigt'; });
    expect((await validatePoamSchema(parsePoamDocument(source, context))).ok).toBe(true);
    expect(rowsOf(source)[0]).toMatchObject({ lifecycles: [{ value: 'erledigt', documented: false }], completed: false });
  });
});

describe('sortPoamProgress', () => {
  const row = (key: string, extra: Partial<PoamProgressRow>): PoamProgressRow => ({
    key, requirementIds: [], deadlineState: 'ohne Frist', responsible: [], riskStatuses: [], lifecycles: [], unresolvedRisks: 0, completed: false, ...extra,
  });
  const rows = [
    row('a', { title: 'A' }),
    row('b', { title: 'B', deadline: '2026-12-01T00:00:00+01:00', responsible: ['Team Netz'], lifecycles: [{ value: 'planned', documented: true }] }),
    row('c', { title: 'C', deadline: '2026-11-30T23:30:00Z', responsible: ['Betrieb'], lifecycles: [{ value: 'recommendation', documented: true }] }),
  ];
  it('ordnet nach Frist, Verantwortlichen und Stand mit fehlenden Werten zuletzt', () => {
    expect(sortPoamProgress(rows, 'frist').map((entry) => entry.key)).toEqual(['b', 'c', 'a']);
    expect(sortPoamProgress(rows, 'verantwortlich').map((entry) => entry.key)).toEqual(['c', 'b', 'a']);
    expect(sortPoamProgress(rows, 'stand').map((entry) => entry.key)).toEqual(['b', 'c', 'a']);
  });
});
