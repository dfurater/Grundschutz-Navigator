import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAssessmentResultsDocument } from './oscalAssessmentResultsDocument';
import { parseAssessmentPlanDocument } from './oscalAssessmentPlanDocument';
import { parseSspDocument } from './oscalSspDocument';
import {
  AR_UUIDS,
  firstResult,
  makeBoundAssessmentPlanSource,
  makeFullAssessmentResults,
  makeMinimalAssessmentResults,
} from '@/test/fixtures/assessmentResults';
import { makeFullSsp } from '@/test/fixtures/systemSecurityPlans';
import { expectNoNetworkCalls, stubNoNetwork } from '@/test/noNetwork';

const context = { trustClass: 'class-2-local-user' } as const;
const at = new Date('2026-10-22T00:00:00Z');
const parse = (source: unknown, options = {}) =>
  parseAssessmentResultsDocument(source, context, { at, ...options }).view;
const codes = (view: ReturnType<typeof parse>) => view.diagnostics.map((d) => d.code);
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
    expect(result.observations[0].subjects[0].reference).toMatchObject({ status: 'resolved', origin: 'local' });
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
  it('löst Subjekte nur im lokalen Bereich ihres eigenen Ergebnisses auf', () => {
    const source = makeFullAssessmentResults();
    const body = source['assessment-results'];
    const [first] = body.results;
    // Die Komponente liegt nur im zweiten Ergebnis; das erste darf sie nicht sehen.
    body.results = [
      { ...first, 'local-definitions': { ...first['local-definitions'], components: [] } },
      {
        ...makeMinimalAssessmentResults()['assessment-results'].results[0],
        uuid: AR_UUIDS.missing,
        'local-definitions': first['local-definitions'],
      },
    ] as typeof body.results;
    const assessmentPlan = parseAssessmentPlanDocument(makeBoundAssessmentPlanSource(), context);
    const ssp = parseSspDocument(makeFullSsp(), context);
    const view = parse(source, { assessmentPlan, ssp });
    const [observation] = view.results[0].observations;
    expect(observation.subjects[0].reference).toMatchObject({ status: 'unresolved', reason: 'identity-not-found' });
    expect(observation.evidence?.subjects[0].state).toBe('not-resolvable-in-context');
    expect(view.diagnostics).toContainEqual(
      expect.objectContaining({
        code: 'OSCAL_AR_SUBJECT_REFERENCE_UNRESOLVED',
        path: '/assessment-results/results/0/observations/0/subjects/0/subject-uuid',
      }),
    );
  });
  it('meldet mehrdeutige Risiko-UUIDs, statt den ersten Treffer zu wählen', () => {
    const source = makeFullAssessmentResults();
    const [result] = source['assessment-results'].results;
    result.risks.push(structuredClone(result.risks[0]));
    const view = parse(source);
    expect(view.results[0].findings[0].relatedRisks[0].reference).toEqual({
      status: 'unresolved',
      reason: 'identity-ambiguous',
    });
    expect(codes(view)).toEqual(
      expect.arrayContaining(['OSCAL_AR_RISK_UUID_DUPLICATE', 'OSCAL_AR_RISK_REFERENCE_UNRESOLVED']),
    );
  });
  it('prüft lange Abhängigkeitsketten ohne Stapelüberlauf', () => {
    const uuid = (i: number) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    const source = makeMinimalAssessmentResults();
    const length = 20_000;
    Object.assign(source['assessment-results'].results[0], {
      'local-definitions': {
        tasks: Array.from({ length }, (_, i) => ({
          uuid: uuid(i),
          type: 'action',
          title: 'Kette',
          ...(i + 1 < length ? { dependencies: [{ 'task-uuid': uuid(i + 1) }] } : {}),
        })),
      },
    });
    expect(parse(source).diagnostics).toEqual([]);
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
