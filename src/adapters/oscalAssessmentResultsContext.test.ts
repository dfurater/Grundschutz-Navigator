import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAssessmentResultsDocument } from './oscalAssessmentResultsDocument';
import { parseAssessmentPlanDocument } from './oscalAssessmentPlanDocument';
import { parseSspDocument } from './oscalSspDocument';
import {
  AR_UUIDS,
  firstResult,
  makeBoundAssessmentPlanSource,
  makeFullAssessmentResults,
} from '@/test/fixtures/assessmentResults';
import { AP_UUIDS, makeFullAssessmentPlan } from '@/test/fixtures/assessmentPlans';
import { makeFullSsp, SSP_FIXTURE_IDS } from '@/test/fixtures/systemSecurityPlans';

const context = { trustClass: 'class-2-local-user' } as const;
const at = new Date('2026-10-22T00:00:00Z');
const parse = (source: unknown, options = {}) =>
  parseAssessmentResultsDocument(source, context, { at, ...options }).view;
const codes = (view: ReturnType<typeof parse>) => view.diagnostics.map((d) => d.code);

afterEach(() => vi.unstubAllGlobals());

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
  it('löst Aufgabenabhängigkeiten gegen den gebundenen Plan auf', () => {
    const source = makeFullAssessmentResults();
    Object.assign(firstResult(source)['local-definitions'].tasks[0], { dependencies: [{ 'task-uuid': AP_UUIDS.task }] });
    const dependency = (options = {}) =>
      parse(source, options).results[0].localDefinitions.tasks[0].dependencies[0].reference;
    expect(dependency()).toEqual({ status: 'not-resolvable-in-context', reason: 'assessment-plan-not-supplied' });
    const assessmentPlan = parseAssessmentPlanDocument(makeBoundAssessmentPlanSource(), context);
    expect(dependency({ assessmentPlan })).toMatchObject({ status: 'resolved', origin: 'assessment-plan' });
    expect(parse(source, { assessmentPlan }).diagnostics).toEqual([]);
  });
  it('meldet mehrdeutige Planaufgaben und ungültige Planbindungen', () => {
    const source = makeFullAssessmentResults();
    Object.assign(firstResult(source)['local-definitions'].tasks[0], { dependencies: [{ 'task-uuid': AP_UUIDS.task }] });
    const planSource = makeBoundAssessmentPlanSource();
    planSource['assessment-plan'].tasks.push(structuredClone(planSource['assessment-plan'].tasks[0]));
    const ambiguous = parse(source, { assessmentPlan: parseAssessmentPlanDocument(planSource, context) });
    expect(ambiguous.results[0].localDefinitions.tasks[0].dependencies[0].reference).toEqual({
      status: 'unresolved',
      reason: 'identity-ambiguous',
    });
    expect(codes(ambiguous)).toContain('OSCAL_AR_TASK_REFERENCE_UNRESOLVED');
    const assessmentPlan = parseAssessmentPlanDocument(makeBoundAssessmentPlanSource(), context);
    firstResult(source).observations[0].origins[0]['related-tasks'] = [{ 'task-uuid': AP_UUIDS.task }];
    const invalid = parse(source, { assessmentPlan: { ...assessmentPlan, source: {} } });
    expect(invalid.results[0].observations[0].origins[0].relatedTasks[0].reference).toEqual({
      status: 'not-resolvable-in-context',
      reason: 'assessment-plan-binding-invalid',
    });
    expect(invalid.importAp?.status).toBe('not-resolvable-in-context');
    expect(invalid.results[0].localDefinitions.tasks[0].dependencies[0].reference).toEqual({
      status: 'not-resolvable-in-context',
      reason: 'assessment-plan-binding-invalid',
    });
    expect(codes(invalid)).toContain('OSCAL_AR_ASSESSMENT_PLAN_BINDING_INVALID');
  });
  it('löst Ressourcen-Subjekte nur gegen das eigene Back-matter auf', () => {
    const source = makeFullAssessmentResults();
    const ssp = parseSspDocument(makeFullSsp(), context);
    const sspResource = (makeFullSsp()['system-security-plan'] as { 'back-matter': { resources: { uuid: string }[] } })[
      'back-matter'
    ].resources[0].uuid;
    Object.assign(firstResult(source).observations[0], {
      subjects: [
        { 'subject-uuid': AR_UUIDS.resource, type: 'resource' },
        { 'subject-uuid': sspResource, type: 'resource' },
      ],
    });
    const [observation] = parse(source, { ssp }).results[0].observations;
    expect(observation.subjects.map((s) => s.reference.status)).toEqual(['resolved', 'unresolved']);
    expect(observation.evidence?.subjects.map((s) => s.state)).toEqual(['resolved', 'missing-in-document']);
  });
  it('meldet eine im gebundenen Plan fehlende Aufgabe und nicht erschlossene Subjekttypen', () => {
    const source = makeFullAssessmentResults();
    const result = firstResult(source);
    Object.assign(result['local-definitions'].tasks[0], { dependencies: [{ 'task-uuid': AR_UUIDS.missing }] });
    Object.assign(result.observations[0], { subjects: [{ 'subject-uuid': AR_UUIDS.component, type: 'unbekannt' }] });
    const assessmentPlan = parseAssessmentPlanDocument(makeBoundAssessmentPlanSource(), context);
    const view = parse(source, { assessmentPlan });
    expect(view.results[0].localDefinitions.tasks[0].dependencies[0].reference).toEqual({
      status: 'unresolved',
      reason: 'identity-not-found',
    });
    expect(codes(view)).toContain('OSCAL_AR_TASK_REFERENCE_UNRESOLVED');
    expect(view.results[0].observations[0].subjects[0].reference).toEqual({
      status: 'not-resolvable-in-context',
      reason: 'subject-type-not-supported',
    });
  });
  it('löst Subjekte und Rollen lokaler Aufgaben gegen den gebundenen Plan auf', () => {
    const source = makeFullAssessmentResults();
    Object.assign(firstResult(source)['local-definitions'].tasks[0], {
      subjects: [{ type: 'component', 'include-subjects': [{ type: 'component', 'subject-uuid': AP_UUIDS.component }] }],
      'responsible-roles': [{ 'role-id': 'assessor' }],
    });
    const task = (options = {}) => {
      const view = parse(source, options);
      const referenceCodes = codes(view).filter((code) => /SUBJECT|ROLE/.test(code));
      const [first] = view.results[0].localDefinitions.tasks;
      return { view, referenceCodes, subject: first.subjects[0].includeSubjects[0].reference, role: first.responsibleRoles[0].reference };
    };
    const ssp = parseSspDocument(makeFullSsp(), context);
    const assessmentPlan = parseAssessmentPlanDocument(makeFullAssessmentPlan(), context);
    const bound = task({ assessmentPlan, ssp });
    expect(bound.subject).toMatchObject({ status: 'resolved', origin: 'assessment-plan' });
    expect(bound.role).toMatchObject({ status: 'resolved', origin: 'assessment-plan' });
    expect(bound.referenceCodes).toEqual([]);
    expect(task({ assessmentPlan }).subject).toMatchObject({ status: 'resolved', origin: 'assessment-plan' });
    for (const missing of [task(), task({ ssp })]) {
      expect(missing.subject).toEqual({ status: 'not-resolvable-in-context', reason: 'assessment-plan-not-supplied' });
      expect(missing.role).toEqual({ status: 'not-resolvable-in-context', reason: 'assessment-plan-not-supplied' });
      expect(missing.referenceCodes).toEqual([]);
    }
    const planSource = makeFullAssessmentPlan();
    const planRoot = planSource['assessment-plan'] as unknown as { metadata: { roles: unknown[] } };
    planRoot.metadata.roles.push(structuredClone(planRoot.metadata.roles[0]));
    const ambiguous = task({ assessmentPlan: parseAssessmentPlanDocument(planSource, context), ssp });
    expect(ambiguous.role).toEqual({ status: 'unresolved', reason: 'identity-ambiguous' });
    expect(ambiguous.referenceCodes).toContain('OSCAL_AR_ROLE_REFERENCE_UNRESOLVED');
  });
  it('hält Systemkomponenten und Prüfwerkzeuge des gebundenen Plans getrennt', () => {
    const tool = '00000000-0000-4000-8000-0000000000aa';
    const planSource = makeFullAssessmentPlan();
    const assets = planSource['assessment-plan']['assessment-assets'] as unknown as Record<string, unknown>;
    // Eine UUID als Systemkomponente und Prüfwerkzeug, eine nur als Prüfwerkzeug.
    assets.components = [
      { uuid: AP_UUIDS.component, type: 'software', title: 'Werkzeug', description: 'Scanner', status: { state: 'operational' } },
      { uuid: tool, type: 'software', title: 'Werkzeug', description: 'Scanner', status: { state: 'operational' } },
    ];
    const assessmentPlan = parseAssessmentPlanDocument(planSource, context);
    const ssp = parseSspDocument(makeFullSsp(), context);
    const source = makeFullAssessmentResults();
    const result = firstResult(source);
    const setSubject = (uuid: string) =>
      Object.assign(result['local-definitions'].tasks[0], {
        subjects: [{ type: 'component', 'include-subjects': [{ type: 'component', 'subject-uuid': uuid }] }],
      });
    result.observations[0].origins[0].actors = [{ type: 'tool', 'actor-uuid': tool }];
    setSubject(AP_UUIDS.component);
    const shared = parse(source, { assessmentPlan, ssp });
    expect(shared.results[0].localDefinitions.tasks[0].subjects[0].includeSubjects[0].reference).toMatchObject({
      status: 'resolved',
      origin: 'assessment-plan',
      path: '/assessment-plan/local-definitions/components/0',
    });
    expect(shared.results[0].observations[0].origins[0].actors[0].reference).toMatchObject({
      status: 'resolved',
      origin: 'assessment-plan',
      path: '/assessment-plan/assessment-assets/components/1',
    });
    setSubject(tool);
    const toolOnly = parse(source, { assessmentPlan, ssp });
    expect(toolOnly.results[0].localDefinitions.tasks[0].subjects[0].includeSubjects[0].reference).toEqual({
      status: 'unresolved',
      reason: 'identity-not-found',
    });
    expect(codes(toolOnly)).toContain('OSCAL_AR_SUBJECT_REFERENCE_UNRESOLVED');
  });
  it('fällt für Subjekte lokaler Aufgaben nach dem Plan auf das SSP zurück', () => {
    const source = makeFullAssessmentResults();
    const setSubject = (uuid: string) =>
      Object.assign(firstResult(source)['local-definitions'].tasks[0], {
        subjects: [{ type: 'component', 'include-subjects': [{ type: 'component', 'subject-uuid': uuid }] }],
      });
    const subject = (options = {}) => {
      const view = parse(source, options);
      return { view, reference: view.results[0].localDefinitions.tasks[0].subjects[0].includeSubjects[0].reference };
    };
    const ssp = parseSspDocument(makeFullSsp(), context);
    const assessmentPlan = parseAssessmentPlanDocument(makeFullAssessmentPlan(), context);
    setSubject(SSP_FIXTURE_IDS.software);
    // Plan nicht gebunden oder ohne das Ziel: Treffer im SSP.
    expect(subject({ ssp }).reference).toMatchObject({ status: 'resolved', origin: 'ssp' });
    expect(subject({ assessmentPlan, ssp }).reference).toMatchObject({ status: 'resolved', origin: 'ssp' });
    // Plan gebunden ohne Ziel, kein SSP: der fehlende Kontext ist das SSP.
    expect(subject({ assessmentPlan }).reference).toEqual({ status: 'not-resolvable-in-context', reason: 'ssp-not-supplied' });
    // Weder im Plan noch im gebundenen SSP: Fehlbefund mit Diagnose.
    setSubject(AR_UUIDS.missing);
    const missing = subject({ assessmentPlan, ssp });
    expect(missing.reference).toEqual({ status: 'unresolved', reason: 'identity-not-found' });
    expect(codes(missing.view)).toContain('OSCAL_AR_SUBJECT_REFERENCE_UNRESOLVED');
  });
  it('projiziert Aufgabenbezüge und Urheber des Prüfprotokolls', () => {
    const source = makeFullAssessmentResults();
    const result = source['assessment-results'].results[0] as unknown as { 'assessment-log': { entries: Record<string, unknown>[] } };
    Object.assign(result['assessment-log'].entries[0], {
      'related-tasks': [{ 'task-uuid': AR_UUIDS.task }, { 'task-uuid': AP_UUIDS.task }, { 'task-uuid': AR_UUIDS.missing }],
      'logged-by': [{ 'party-uuid': AR_UUIDS.party, 'role-id': 'assessor' }, { 'party-uuid': AR_UUIDS.missing }],
    });
    const assessmentPlan = parseAssessmentPlanDocument(makeBoundAssessmentPlanSource(), context);
    const view = parse(source, { assessmentPlan });
    const [entry] = view.results[0].assessmentLog;
    expect(entry.relatedTasks.map((t) => t.reference)).toEqual([
      expect.objectContaining({ status: 'resolved', origin: 'local' }),
      expect.objectContaining({ status: 'resolved', origin: 'assessment-plan' }),
      { status: 'unresolved', reason: 'identity-not-found' },
    ]);
    expect(entry.loggedBy[0]).toMatchObject({ partyUuid: AR_UUIDS.party, party: { status: 'resolved', origin: 'local' } });
    expect(entry.loggedBy[0].role).toEqual({ status: 'not-resolvable-in-context', reason: 'ssp-not-supplied' });
    expect(entry.loggedBy[1]).toMatchObject({ role: null, party: { status: 'not-resolvable-in-context' } });
    expect(view.diagnostics.map((d) => [d.code, d.path])).toEqual([
      ['OSCAL_AR_TASK_REFERENCE_UNRESOLVED', '/assessment-results/results/0/assessment-log/entries/0/related-tasks/2/task-uuid'],
    ]);
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
