import { describe, expect, it } from 'vitest';
import { parseOscalDocument, getOscalRootAdapter, listAdaptedOscalRootTypes } from './oscalRootAdapters';
import { makeMinimalPoam, POAM_UUID } from '@/test/fixtures/poams';
import { makeFullPoam } from '@/test/fixtures/poams';
import { AR_UUIDS, makeFullAssessmentResults } from '@/test/fixtures/assessmentResults';
import { parsePoamDocument } from './oscalPoamDocument';
import { parseAssessmentResultsDocument } from './oscalAssessmentResultsDocument';
import { parseSspDocument } from './oscalSspDocument';
import { countPoamUuids } from './oscalPoamReaders';
import { makeFullSsp } from '@/test/fixtures/systemSecurityPlans';
import { afterEach, vi } from 'vitest';
import { stubNoNetwork, expectNoNetworkCalls } from '@/test/noNetwork';

const context = { trustClass: 'class-2-local-user' } as const;
const options = { at: new Date('2026-10-22T00:00:00Z') };
const parse = (source: unknown) => parsePoamDocument(source, context, options).view;
afterEach(() => vi.unstubAllGlobals());

describe('POA&M-Root', () => {
  it('leitet den registrierten Root mit system-id und ohne erfundene Item-UUID ab', () => {
    const result = parseOscalDocument(makeMinimalPoam(), { trustClass: 'class-2-local-user' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.view).toMatchObject({ uuid: POAM_UUID, poamItems: [{ uuid: undefined }] });
    expect(getOscalRootAdapter('plan-of-action-and-milestones')).not.toBeNull();
    expect(listAdaptedOscalRootTypes()).toContain('plan-of-action-and-milestones');
  });
  it('übernimmt Befundkette, Herkunft, Fristen, Aufgaben und inaktive Evidenz ohne Mutation', () => {
    const source = makeFullPoam();
    const before = structuredClone(source);
    const stubs = stubNoNetwork();
    vi.stubGlobal('atob', vi.fn());
    const view = parse(source);
    expect(view.diagnostics).toEqual([]);
    expect(view.systemId?.id).toBe('synthetic-system');
    expect(view.importSsp?.status).toBe('not-resolvable-in-context');
    expect(view.poamItems[0]).toMatchObject({
      description: '<script>synthetic</script>',
      relatedRisks: [{ reference: { status: 'resolved', origin: 'local' } }],
      relatedFindings: [{ reference: { status: 'resolved', origin: 'local' } }],
      relatedObservations: [{ reference: { state: 'resolved' } }],
      origins: [{ actors: [{ reference: { status: 'resolved', origin: 'local' } }] }],
    });
    expect(view.risks[0]).toMatchObject({ status: 'open', deadline: '2026-12-01T00:00:00Z', remediations: [{ lifecycle: 'planned', tasks: [{ uuid: AR_UUIDS.task }] }] });
    expect(view.findings[0].relatedRisks[0].reference.status).toBe('resolved');
    expect(view.observations[0].subjects[0].reference.status).toBe('resolved');
    expect(view.observations[0].evidence).toBe(view.evidence.observations[0]);
    expect(view.observations.map((o) => o.evidence?.validity)).toEqual(['current', 'expired']);
    expect(JSON.stringify(view)).not.toContain('PHNjcmlwdD4=');
    expect(source).toEqual(before);
    expectNoNetworkCalls(stubs);
    expect(globalThis.atob).not.toHaveBeenCalled();
  });
  it('adressiert UUID-lose Items über den Quellpfad und leitet die übrigen Gültigkeitswerte ab', () => {
    const source = makeFullPoam();
    Reflect.deleteProperty(source['plan-of-action-and-milestones']['poam-items'][0], 'uuid');
    const observations = source['plan-of-action-and-milestones'].observations;
    Reflect.deleteProperty(observations[0], 'expires');
    observations[1].collected = 'gestern';
    const view = parse(source);
    expect(view.poamItems[0].key).toBe('/plan-of-action-and-milestones/poam-items/0');
    expect(view.poamItems[0].uuid).toBeUndefined();
    expect(view.observations.map((o) => o.evidence?.validity)).toEqual(['no-expiry-declared', 'not-evaluable']);
    expect(parse(source).poamItems[0].key).toBe(view.poamItems[0].key);
  });
  it('meldet typfalsche und mehrdeutige Ziele mit redigierten Diagnosen', () => {
    const source = makeFullPoam();
    const root = source['plan-of-action-and-milestones'];
    root['poam-items'][0]['related-risks'][0]['risk-uuid'] = AR_UUIDS.observation;
    root.findings.push(structuredClone(root.findings[0]));
    const view = parse(source);
    expect(view.poamItems[0].relatedRisks[0].reference.status).toBe('unresolved');
    expect(view.poamItems[0].relatedFindings[0].reference).toMatchObject({ status: 'unresolved', reason: 'identity-ambiguous' });
    expect(view.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['OSCAL_POAM_RISK_REFERENCE_UNRESOLVED', 'OSCAL_POAM_FINDING_UUID_DUPLICATE']));
    expect(JSON.stringify(view.diagnostics)).not.toMatch(/0000000001|script|Maßnahme/);
  });
  it('lässt doppelte oder typfalsche Beobachtungsziele nicht als auflösbar erscheinen', () => {
    const source = makeFullPoam();
    const root = source['plan-of-action-and-milestones'];
    root.observations.push(structuredClone(root.observations[0]));
    const duplicate = parse(source);
    expect(duplicate.poamItems[0].relatedObservations[0].reference?.state).toBe('ambiguous-in-document');
    Object.assign(root['poam-items'][0]['related-observations'][0], { 'observation-uuid': AR_UUIDS.component });
    expect(parse(source).poamItems[0].relatedObservations[0].reference?.state).toBe('type-mismatch');
  });
  it('führt fehlenden AR-Kontext getrennt von lokalen Datenfehlern', () => {
    const source = makeFullPoam();
    const root = source['plan-of-action-and-milestones'];
    Reflect.deleteProperty(root, 'observations');
    Reflect.deleteProperty(root, 'risks');
    Reflect.deleteProperty(root, 'findings');
    const without = parse(source);
    expect(without.poamItems[0].relatedObservations[0].reference?.state).toBe('not-resolvable-in-context');
    expect(without.poamItems[0].relatedRisks[0].reference.status).toBe('not-resolvable-in-context');
    expect(without.diagnostics).toEqual([]);
    const assessmentResults = parseAssessmentResultsDocument(makeFullAssessmentResults(), context);
    const withAr = parsePoamDocument(source, context, { ...options, assessmentResults }).view;
    expect(withAr.poamItems[0].relatedObservations[0].reference?.state).toBe('resolved-in-context');
    expect(withAr.poamItems[0].relatedRisks[0].reference).toMatchObject({ status: 'resolved', origin: 'assessment-results' });
    root['poam-items'][0]['related-risks'][0]['risk-uuid'] = AR_UUIDS.missing;
    expect(parsePoamDocument(source, context, { assessmentResults }).view.poamItems[0].relatedRisks[0].reference.status).toBe('unresolved');
  });
  it('bindet ein ausdrücklich zugeordnetes SSP und erkennt ungültige und fremde Bindungen', () => {
    const source = makeFullPoam();
    const ssp = parseSspDocument(makeFullSsp(), context);
    const view = parsePoamDocument(source, context, { ssp }).view;
    expect(view.importSsp?.status).toBe('bound');
    expect(parsePoamDocument(source, context, { ssp: { ...ssp, source: {} } }).view.importSsp?.status).toBe('not-resolvable-in-context');
    expect(() => parsePoamDocument(source, context, { ssp: { ...ssp, context: { trustClass: 'class-1-verified-public' } } })).toThrow(/OSCAL_POAM_TRUST_CLASS_REJECTED/);
  });
  it('meldet zyklische Aufgaben ohne zyklische Read-Model-Objekte', () => {
    const source = makeFullPoam();
    Object.assign(source['plan-of-action-and-milestones'].risks[0].remediations[0], {
      tasks: [{ uuid: AR_UUIDS.task, title: 'Zyklus', type: 'action', dependencies: [{ 'task-uuid': AR_UUIDS.task }] }],
    });
    const view = parse(source);
    expect(view.diagnostics.map((d) => d.code)).toContain('OSCAL_POAM_TASK_DEPENDENCY_CYCLE');
    expect(() => JSON.stringify(view)).not.toThrow();
  });
  it('leitet Inventory Items, Prüfwerkzeuge und Verantwortlichkeiten aus OSCAL ab', () => {
    const source = makeFullPoam();
    const root = source['plan-of-action-and-milestones'];
    Object.assign(root.metadata, { roles: [{ id: 'owner', title: 'Verantwortlich' }] });
    Object.assign(root['local-definitions'], {
      'inventory-items': [{ uuid: AR_UUIDS.missing, description: 'Inventar' }],
      'assessment-assets': {
        components: [{ uuid: AR_UUIDS.statement, type: 'software', title: 'Werkzeug', description: 'Prüfwerkzeug', status: { state: 'operational' } }],
        'assessment-platforms': [{ uuid: AR_UUIDS.result, 'uses-components': [{ 'component-uuid': AR_UUIDS.statement }] }],
      },
    });
    Object.assign(root.risks[0].remediations[0], { tasks: [{
      uuid: AR_UUIDS.task, title: 'Umsetzen', type: 'milestone',
      timing: { 'on-date': { date: '2026-12-01T00:00:00Z' } },
      'responsible-roles': [{ 'role-id': 'owner', 'party-uuids': [AR_UUIDS.party] }],
    }] });
    const view = parse(source);
    expect(view.diagnostics).toEqual([]);
    expect(view.localDefinitions.inventoryItems[0].uuid).toBe(AR_UUIDS.missing);
    expect(view.localDefinitions.assessmentAssets?.assessmentPlatforms[0].usesComponents[0].reference.status).toBe('resolved');
    expect(view.risks[0].remediations[0].tasks[0]).toMatchObject({
      type: 'milestone', timing: { onDate: { date: '2026-12-01T00:00:00Z' } },
      responsibleRoles: [{ reference: { status: 'resolved', origin: 'local' }, partyUuids: [AR_UUIDS.party] }],
    });
  });
  it('weist ungültige AR-Bindungen sichtbar und Klasse-1-Bindungen fail-closed ab', () => {
    const source = makeMinimalPoam();
    const assessmentResults = parseAssessmentResultsDocument(makeFullAssessmentResults(), context);
    const invalid = parsePoamDocument(source, context, { assessmentResults: { ...assessmentResults, source: {} } });
    expect(invalid.view.diagnostics.map((d) => d.code)).toContain('OSCAL_POAM_ASSESSMENT_RESULTS_BINDING_INVALID');
    expect(() => parsePoamDocument(source, context, { assessmentResults: { ...assessmentResults, context: { trustClass: 'class-1-unverified-public' } } })).toThrow(/OSCAL_POAM_TRUST_CLASS_REJECTED/);
  });
  it.each(['missing', 'duplicate'])('diagnostiziert %s Beobachtungsziele im ausdrücklich gebundenen AR', (testCase) => {
    const source = makeFullPoam();
    Reflect.deleteProperty(source['plan-of-action-and-milestones'], 'observations');
    const arSource = makeFullAssessmentResults();
    const arResult = arSource['assessment-results'].results[0];
    if (testCase === 'missing') arResult.observations.splice(0, 1);
    else arResult.observations.push(structuredClone(arResult.observations[0]));
    const assessmentResults = parseAssessmentResultsDocument(arSource, context);
    const view = parsePoamDocument(source, context, { assessmentResults }).view;
    expect(view.poamItems[0].relatedObservations[0].reference?.state).toBe(testCase === 'missing' ? 'missing-in-context' : 'ambiguous-in-context');
    expect(view.diagnostics.map((d) => d.code)).toContain(testCase === 'missing' ? 'OSCAL_EVIDENCE_OBSERVATION_NOT_FOUND_IN_CONTEXT' : 'OSCAL_EVIDENCE_OBSERVATION_AMBIGUOUS_IN_CONTEXT');
    expect(JSON.stringify(view.diagnostics)).not.toContain(AR_UUIDS.observation);
  });
  it('behandelt Risiko- und Response-Verweise in Findings und Risikologs wie Item-Verweise', () => {
    const source = makeFullPoam();
    const root = source['plan-of-action-and-milestones'];
    root.risks[0].remediations.splice(0);
    const assessmentResults = parseAssessmentResultsDocument(makeFullAssessmentResults(), context);
    const bound = parsePoamDocument(source, context, { assessmentResults }).view;
    expect(bound.risks[0].riskLog[0].relatedResponses[0].reference).toMatchObject({ status: 'resolved', origin: 'assessment-results' });
    expect(parse(source).risks[0].riskLog[0].relatedResponses[0].reference.status).toBe('not-resolvable-in-context');
    Reflect.deleteProperty(root, 'risks');
    const noAr = parse(source);
    expect(noAr.findings[0].relatedRisks[0].reference.status).toBe('not-resolvable-in-context');
    expect(parsePoamDocument(source, context, { assessmentResults }).view.findings[0].relatedRisks[0].reference).toMatchObject({ status: 'resolved', origin: 'assessment-results' });
  });
  it.each([false, true])('löst lokale Prüfplattform-Actors auf und weist Duplikate ab: %s', (duplicate) => {
    const source = makeFullPoam();
    const root = source['plan-of-action-and-milestones'];
    const platform = { uuid: AR_UUIDS.result };
    Object.assign(root['local-definitions'], { 'assessment-assets': { 'assessment-platforms': duplicate ? [platform, structuredClone(platform)] : [platform] } });
    Object.assign(root['poam-items'][0], { origins: [{ actors: [{ type: 'assessment-platform', 'actor-uuid': AR_UUIDS.result }] }] });
    const view = parse(source);
    expect(view.poamItems[0].origins[0].actors[0].reference.status).toBe(duplicate ? 'unresolved' : 'resolved');
    expect(view.diagnostics.map((d) => d.code)).toEqual(duplicate ? expect.arrayContaining(['OSCAL_POAM_PLATFORM_UUID_DUPLICATE', 'OSCAL_POAM_ACTOR_REFERENCE_UNRESOLVED']) : []);
  });
  it.each(['component', 'resource', 'mitigating-factor'])('weist ein lokales %s-Ziel vor einem passenden AR-Risiko zurück', (type) => {
    const source = makeFullPoam();
    const root = source['plan-of-action-and-milestones'];
    const target = type === 'component' ? AR_UUIDS.component : type === 'resource' ? AR_UUIDS.resource : AR_UUIDS.missing;
    Object.assign(root.risks[0], { 'mitigating-factors': [{ uuid: AR_UUIDS.missing, description: 'Minderung' }] });
    root['poam-items'][0]['related-risks'][0]['risk-uuid'] = target;
    const arSource = makeFullAssessmentResults();
    Object.assign(arSource['assessment-results'].results[0].risks[0], { uuid: target });
    const assessmentResults = parseAssessmentResultsDocument(arSource, context);
    for (const view of [parse(source), parsePoamDocument(source, context, { assessmentResults }).view]) {
      expect(view.poamItems[0].relatedRisks[0].reference).toMatchObject({ status: 'unresolved', reason: 'identity-type-mismatch' });
      expect(view.diagnostics.map((d) => d.code)).toContain('OSCAL_POAM_RISK_REFERENCE_UNRESOLVED');
    }
  });
  it('zählt verschachtelte lokale Identitäten ohne Nutzlastkopien oder zyklischen Abstieg', () => {
    const body: Record<string, unknown> = { uuid: AR_UUIDS.risk, props: [{ uuid: AR_UUIDS.risk.toUpperCase(), name: 'synthetic', value: 'private' }] };
    body.self = body;
    expect(countPoamUuids(body)).toEqual(new Map([[AR_UUIDS.risk, 2]]));
    expect(body.self).toBe(body);
  });
});
