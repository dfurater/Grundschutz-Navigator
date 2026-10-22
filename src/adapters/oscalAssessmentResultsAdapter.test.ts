import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAssessmentResultsDocument } from './oscalAssessmentResultsDocument';
import { parseAssessmentPlanDocument } from './oscalAssessmentPlanDocument';
import { parseSspDocument } from './oscalSspDocument';
import {
  AR_UUIDS,
  makeBoundAssessmentPlanSource,
  makeFullAssessmentResults,
  makeMinimalAssessmentResults,
} from '@/test/fixtures/assessmentResults';
import { AP_UUIDS } from '@/test/fixtures/assessmentPlans';
import { makeFullSsp, SSP_FIXTURE_IDS } from '@/test/fixtures/systemSecurityPlans';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';

const context = { trustClass: 'class-2-local-user' } as const;
const at = new Date('2026-10-22T00:00:00Z');
const parse = (source: unknown, options = {}) =>
  parseAssessmentResultsDocument(source, context, { at, ...options }).view;
const codes = (view: ReturnType<typeof parse>) => view.diagnostics.map((d) => d.code);
type Refs = Record<string, string>[];
/** Bearbeitbare Sicht auf das erste Ergebnis des Vollfalls; dessen erste Einträge tragen alle Felder. */
interface FixtureResult {
  observations: { origins: { actors: Refs; 'related-tasks'?: Refs }[] }[];
  findings: { 'related-observations': Refs; 'related-risks': Refs }[];
  'local-definitions': { tasks: Record<string, unknown>[] };
}
const firstResult = (source: ReturnType<typeof makeFullAssessmentResults>) =>
  source['assessment-results'].results[0] as unknown as FixtureResult;

afterEach(() => vi.unstubAllGlobals());

describe('Befundkette', () => {
  it('leitet Beobachtungen, Risiken und Findings ohne I/O und ohne Nutzlast ab', () => {
    const source = makeFullAssessmentResults();
    const before = structuredClone(source);
    const stubs = stubNoNetwork();
    vi.stubGlobal('atob', vi.fn());
    const view = parse(source);
    expectNoNetworkCalls(stubs);
    expect(globalThis.atob).not.toHaveBeenCalled();
    expect(source).toEqual(before);
    expect(view.diagnostics).toEqual([]);
    const [result] = view.results;
    expect(result.observations[0].description).toBe('<script>alert(1)</script>');
    expect(result.observations[0].origins[0].actors[0].reference).toMatchObject({ status: 'resolved', origin: 'local' });
    expect(result.observations[0].origins[0].relatedTasks[0].reference.status).toBe('resolved');
    expect(result.observations[0].evidence?.subjects[0].state).toBe('resolved-in-context');
    expect(result.risks[0]).toMatchObject({ status: 'open', remediations: [{ lifecycle: 'planned' }] });
    expect(result.risks[0].riskLog[0].relatedResponses[0].reference.status).toBe('resolved');
    expect(result.risks[0].relatedObservations[0].reference?.state).toBe('resolved');
    expect(result.findings[0]).toMatchObject({
      target: { type: 'objective-id', targetId: 'ac-1_obj', status: { state: 'not-satisfied' } },
      hasLinkedEvidence: true,
      relatedRisks: [{ reference: { status: 'resolved' } }],
      relatedObservations: [{ reference: { state: 'resolved' } }],
    });
    expect(result.findings[1]).toMatchObject({ hasLinkedEvidence: false, relatedObservations: [], relatedRisks: [] });
    expect(result.assessmentLog).toHaveLength(1);
    expect(view.evidence.resources[0]).toMatchObject({ uuid: AR_UUIDS.resource });
    expect(JSON.stringify(view)).not.toContain('PHNjcmlwdD4=');
  });
  it('führt die Gültigkeit ausschließlich aus dem Evidenz-Read-Model', () => {
    const view = parse(makeFullAssessmentResults());
    const [current, expired] = view.results[0].observations;
    expect(current.evidence).toBe(view.evidence.observations[0]);
    expect(current.evidence?.validity).toBe('current');
    expect(expired.evidence?.validity).toBe('expired');
    const source = makeFullAssessmentResults();
    const [first, second] = source['assessment-results'].results[0].observations;
    Reflect.deleteProperty(first, 'expires');
    second.collected = 'gestern';
    expect(parse(source).results[0].observations.map((o) => o.evidence?.validity)).toEqual([
      'no-expiry-declared',
      'not-evaluable',
    ]);
  });
});

describe('Kontextbindung', () => {
  it('weist import-ap ohne gebundenen Plan als not-resolvable-in-context aus', () => {
    const source = makeFullAssessmentResults();
    firstResult(source).observations[0].origins[0]['related-tasks'] = [{ 'task-uuid': AP_UUIDS.task }];
    const unbound = parse(source);
    expect(unbound.importAp?.status).toBe('not-resolvable-in-context');
    expect(unbound.results[0].observations[0].origins[0].relatedTasks[0].reference).toMatchObject({
      status: 'not-resolvable-in-context',
      reason: 'assessment-plan-not-supplied',
    });
    const assessmentPlan = parseAssessmentPlanDocument(makeBoundAssessmentPlanSource(), context);
    const bound = parse(source, { assessmentPlan });
    expect(bound.importAp?.status).toBe('bound');
    expect(bound.results[0].observations[0].origins[0].relatedTasks[0].reference).toMatchObject({
      status: 'resolved',
      origin: 'assessment-plan',
    });
    expect(() => parse(source, { assessmentPlan: { ...assessmentPlan, context: { trustClass: 'class-1-verified-public' } } })).toThrow(
      /OSCAL_AR_TRUST_CLASS_REJECTED/,
    );
  });
  it('löst implementation-statement-uuid nur gegen ein gebundenes SSP auf', () => {
    const source = makeFullAssessmentResults();
    const finding = source['assessment-results'].results[0].findings[0];
    expect(parse(source).results[0].findings[0].implementationStatement).toMatchObject({
      status: 'not-resolvable-in-context',
      reason: 'ssp-not-supplied',
    });
    const ssp = parseSspDocument(makeFullSsp(), context);
    const missing = parse(source, { ssp });
    expect(missing.results[0].findings[0].implementationStatement?.status).toBe('unresolved');
    expect(codes(missing)).toContain('OSCAL_AR_IMPLEMENTATION_STATEMENT_UNRESOLVED');
    finding['implementation-statement-uuid'] = SSP_FIXTURE_IDS.statement as typeof AR_UUIDS.statement;
    expect(parse(source, { ssp }).results[0].findings[0].implementationStatement).toMatchObject({
      status: 'resolved',
      origin: 'ssp',
    });
  });
});

describe('Referenzdiagnosen', () => {
  it('diagnostiziert fehlende, typfalsche und doppelte Ziele ohne Dokumentwerte', () => {
    const source = makeFullAssessmentResults();
    const result = firstResult(source);
    result.findings[0]['related-observations'][0]['observation-uuid'] = AR_UUIDS.missing;
    // Typfalsch: eine Observation-UUID an der Stelle einer Risk-UUID.
    result.findings[0]['related-risks'][0]['risk-uuid'] = AR_UUIDS.observation;
    result.observations[0].origins[0].actors[0]['actor-uuid'] = AR_UUIDS.component;
    result.observations.push(structuredClone(result.observations[1]));
    const view = parse(source);
    expect(view.results[0].findings[0].relatedObservations[0].reference?.state).toBe('missing-in-document');
    expect(view.results[0].findings[0].relatedRisks[0].reference.status).toBe('unresolved');
    // Eine Partei kann im nicht gebundenen Plan liegen; das ist keine Fehlaussage über das Dokument.
    expect(view.results[0].observations[0].origins[0].actors[0].reference.status).toBe('not-resolvable-in-context');
    for (const code of [
      'OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND',
      'OSCAL_AR_RISK_REFERENCE_UNRESOLVED',
      'OSCAL_AR_OBSERVATION_UUID_DUPLICATE',
    ])
      expect(codes(view)).toContain(code);
    expect(JSON.stringify(view.diagnostics)).not.toMatch(/0000000001|script|Prüf/);
  });
  it('meldet zyklische Aufgabenabhängigkeiten', () => {
    const source = makeFullAssessmentResults();
    Object.assign(firstResult(source)['local-definitions'].tasks[0], {
      tasks: [{ uuid: AR_UUIDS.missing, type: 'action', title: 'Teil', dependencies: [{ 'task-uuid': AR_UUIDS.task }] }],
      dependencies: [{ 'task-uuid': AR_UUIDS.missing }],
    });
    const view = parse(source);
    expect(view.diagnostics.filter((d) => d.code === 'OSCAL_AR_TASK_DEPENDENCY_CYCLE')).toHaveLength(1);
  });
  it('diagnostiziert fehlende Pflichtstrukturen, ohne die Quelle zu reparieren', () => {
    const source = makeMinimalAssessmentResults();
    Reflect.deleteProperty(source['assessment-results'], 'results');
    Reflect.deleteProperty(source['assessment-results'], 'import-ap');
    const view = parse(source);
    expect(view.importAp).toBeNull();
    expect(view.results).toEqual([]);
    expect(view.diagnostics.map((d) => d.path)).toEqual(
      expect.arrayContaining(['/assessment-results/import-ap', '/assessment-results/results']),
    );
  });
});
