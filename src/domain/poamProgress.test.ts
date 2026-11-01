import { describe, expect, it } from 'vitest';
import { parsePoamDocument, validatePoamSchema } from '@/adapters/oscalPoamDocument';
import { assessDeadline, derivePoamProgress, readRoleTitles, sortPoamProgress, type PoamProgressRow } from '@/domain/poamProgress';
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
      deadlineState: 'noch nicht fällig',
      deadlineGaps: [],
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

  it('vergleicht Fristen zeitpunktbasiert über verschiedene Offsets; genau am Termin gilt überschritten', () => {
    const state = (deadline: string) => rowsOf(withBody((body) => { risk(body).deadline = deadline; }))[0].deadlineState;
    expect(state('2026-10-22T02:00:00+02:00')).toBe('überschritten');
    expect(state('2026-10-21T23:00:00-01:00')).toBe('überschritten');
    expect(state('2026-10-21T23:59:00-01:00')).toBe('noch nicht fällig');
    expect(state('2026-10-22T01:00:00+02:00')).toBe('überschritten');
  });

  describe.each([
    ['on-date', (date: string) => ({ 'on-date': { date } })],
    ['within-date-range/end', (date: string) => ({ 'within-date-range': { start: '2026-01-01T00:00:00Z', end: date } })],
  ])('Termingrenze bei %s', (_, timing) => {
    const at = (date: string, dangling: boolean) => rowsOf(withBody((body) => {
      delete risk(body).deadline;
      risk(body).remediations[0].tasks = [{ uuid: '00000000-0000-4000-8000-000000000304', type: 'milestone', title: 'Termin', timing: timing(date) }];
      if (dangling) body['poam-items'][0]['related-risks'].push({ 'risk-uuid': '00000000-0000-4000-8000-0000000003fd' });
    }))[0].deadlineState;
    it.each([false, true])('eine Sekunde vor, am und nach dem Termin (zusätzlicher unaufgelöster Verweis: %s)', (dangling) => {
      expect(at('2026-10-22T02:00:01+02:00', dangling)).toBe(dangling ? 'Fristlage unbekannt' : 'noch nicht fällig');
      expect(at('2026-10-22T02:00:00+02:00', dangling)).toBe('überschritten');
      expect(at('2026-10-21T23:59:59Z', dangling)).toBe('überschritten');
    });
  });

  it('führt fehlende und unlesbare Fristen als „Fristlage unbekannt“ mit Grund und Quellpfad, nie als noch nicht fällig', () => {
    const riskPath = '/plan-of-action-and-milestones/risks/0';
    expect(rowsOf(makeMinimalPoam())[0]).toMatchObject({
      deadlineState: 'Fristlage unbekannt', deadline: undefined, completed: false,
      deadlineGaps: [{ reason: 'keine Frist', path: '/plan-of-action-and-milestones/poam-items/0/related-risks' }],
    });
    const frequencyOnly = withBody((body) => {
      delete risk(body).deadline;
      risk(body).remediations[0].tasks = [{
        uuid: '00000000-0000-4000-8000-000000000303', type: 'action', title: 'Turnus',
        timing: { 'at-frequency': { period: 1, unit: 'months' } },
      }];
    });
    expect(rowsOf(frequencyOnly)[0]).toMatchObject({
      deadlineState: 'Fristlage unbekannt',
      deadlineGaps: [{ reason: 'Wiederholung ohne absoluten Termin', path: `${riskPath}/remediations/0/tasks/0/timing/at-frequency` }],
    });
    expect(rowsOf(withBody((body) => { risk(body).deadline = '2026-01-01T00:00:00'; }))[0]).toMatchObject({
      deadlineState: 'Fristlage unbekannt',
      deadlineGaps: [{ reason: 'ungültiges Datum', path: `${riskPath}/deadline`, value: '2026-01-01T00:00:00' }],
    });
    const noDeadline = withBody((body) => { delete risk(body).deadline; });
    expect(rowsOf(noDeadline)[0].deadlineGaps).toEqual([{ reason: 'keine Frist', path: `${riskPath}/deadline` }]);
    const dangling = withBody((body) => { body['poam-items'][0]['related-risks'] = [{ 'risk-uuid': '00000000-0000-4000-8000-0000000003ff' }]; });
    expect(rowsOf(dangling)[0]).toMatchObject({
      deadlineState: 'Fristlage unbekannt', riskStatuses: [],
      deadlineGaps: [{
        reason: 'Risikobezug nicht auflösbar', value: '00000000-0000-4000-8000-0000000003ff',
        path: '/plan-of-action-and-milestones/poam-items/0/related-risks/0/risk-uuid',
      }],
    });
  });

  it('wertet ein umgekehrtes Intervall als ungültig, auch wenn eine andere Frist lesbar ist', () => {
    const source = withBody((body) => {
      risk(body).remediations[0].tasks = [{
        uuid: '00000000-0000-4000-8000-000000000305', type: 'action', title: 'Umgekehrt',
        timing: { 'within-date-range': { start: '2026-11-02T00:00:00Z', end: '2026-11-01T00:00:00Z' } },
      }];
    });
    expect(rowsOf(source)[0]).toMatchObject({
      deadline: '2026-12-01T00:00:00Z', deadlineState: 'Fristlage unbekannt',
      deadlineGaps: [{ reason: 'ungültiges Intervall', value: '2026-11-02T00:00:00Z – 2026-11-01T00:00:00Z' }],
    });
  });

  it('führt Frist, Risikostatus und Lifecycle mit Quellpfad', () => {
    expect(rowsOf(makeFullPoam())[0].sources).toEqual([
      { label: 'Frist (früheste)', path: '/plan-of-action-and-milestones/risks/0/deadline', value: '2026-12-01T00:00:00Z' },
      { label: 'Lifecycle', path: '/plan-of-action-and-milestones/risks/0/remediations/0/lifecycle', value: 'planned' },
      { label: 'Risikostatus', path: '/plan-of-action-and-milestones/risks/0/status', value: 'open' },
    ]);
  });

  it('erklärt Umsetzung nur über lifecycle = completed, lässt risk.status unverändert und behält die Fristlage', () => {
    const done = withBody((body) => { risk(body).remediations[0].lifecycle = 'completed'; });
    expect(rowsOf(done)[0]).toMatchObject({ completed: true, riskStatuses: ['open'] });
    expect(rowsOf(done, new Date('2027-01-01T00:00:00Z'))[0]).toMatchObject({ completed: true, deadlineState: 'überschritten' });
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
    expect(rowsOf(source)[0]).toMatchObject({ unresolvedRisks: 1, completed: false, deadlineState: 'Fristlage unbekannt', deadline: undefined });
  });

  it('wertet ein unmögliches Kalenderdatum nicht als Frist', () => {
    expect(rowsOf(withBody((body) => { risk(body).deadline = '2026-02-30T10:00:00Z'; }))[0]).toMatchObject({
      deadlineState: 'Fristlage unbekannt', deadline: undefined, deadlineGaps: [{ reason: 'ungültiges Datum', value: '2026-02-30T10:00:00Z' }],
    });
  });

  it('belegt bei nicht auflösbarem Risikoverweis keinen Abschluss; eine bekannte überschrittene Frist bleibt überschritten', () => {
    const withDangling = (deadline: string) => withBody((body) => {
      risk(body).deadline = deadline;
      risk(body).remediations[0].lifecycle = 'completed';
      body['poam-items'][0]['related-risks'].push({ 'risk-uuid': '00000000-0000-4000-8000-0000000003fe' });
    });
    expect(rowsOf(withDangling('2026-12-01T00:00:00Z'))[0]).toMatchObject({
      unresolvedRisks: 1, completed: false, deadlineState: 'Fristlage unbekannt', deadline: '2026-12-01T00:00:00Z',
    });
    expect(rowsOf(withDangling('2026-10-01T00:00:00Z'))[0]).toMatchObject({
      unresolvedRisks: 1, completed: false, deadlineState: 'überschritten', deadline: '2026-10-01T00:00:00Z',
      deadlineGaps: [{ reason: 'Risikobezug nicht auflösbar' }],
    });
  });

  it('weist ein schemagültiges erfundenes Lifecycle-Token als unbekannt aus und zählt es nicht als abgeschlossen', async () => {
    const source = withBody((body) => { risk(body).remediations[0].lifecycle = 'erledigt'; });
    expect((await validatePoamSchema(parsePoamDocument(source, context))).ok).toBe(true);
    expect(rowsOf(source)[0]).toMatchObject({ lifecycles: [{ value: 'erledigt', documented: false }], completed: false });
  });
});

describe('assessDeadline', () => {
  it('bewertet ein einzelnes Risiko mit denselben Eingaben wie die Zeile', () => {
    const view = parsePoamDocument(makeFullPoam(), context).view;
    const at = (now: string) => assessDeadline(view.risks, [], new Date(now));
    expect(at('2026-11-30T23:59:59Z')).toEqual({
      deadline: { value: '2026-12-01T00:00:00Z', path: '/plan-of-action-and-milestones/risks/0/deadline' }, state: 'noch nicht fällig', gaps: [],
    });
    expect(at('2026-12-01T00:00:00Z').state).toBe('überschritten');
    expect(assessDeadline([], [{ path: '/x/risk-uuid' }], NOW)).toEqual({
      deadline: undefined, state: 'Fristlage unbekannt', gaps: [{ path: '/x/risk-uuid', reason: 'Risikobezug nicht auflösbar' }],
    });
  });
});

describe('sortPoamProgress', () => {
  const row = (key: string, extra: Partial<PoamProgressRow>): PoamProgressRow => ({
    key, requirementIds: [], deadlineState: 'Fristlage unbekannt', deadlineGaps: [], sources: [], responsible: [], riskStatuses: [], lifecycles: [], unresolvedRisks: 0, completed: false, ...extra,
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
