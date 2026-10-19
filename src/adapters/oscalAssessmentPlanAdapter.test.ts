import { describe, expect, it } from 'vitest';
import { deriveAssessmentPlan } from './oscalAssessmentPlanAdapter';
import { parseAssessmentPlanDocument } from './oscalAssessmentPlanDocument';
import { parseSspDocument } from './oscalSspDocument';
import { makeMinimalSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import {
  AP_UUIDS,
  makeFullAssessmentPlan,
  makeMinimalAssessmentPlan,
} from '@/test/fixtures/assessmentPlans';

const context = { trustClass: 'class-2-local-user' } as const;
const parse = (source: unknown) => parseAssessmentPlanDocument(source, context).view;

describe('Assessment-Plan-Referenzgrenzen', () => {
  it('behält den Diagnosepfad jeder wiederholten Rollenzuweisung', () => {
    const source = makeFullAssessmentPlan();
    const task = source['assessment-plan'].tasks[0];
    task['responsible-roles'] = [{ 'role-id': 'marker' }, { 'role-id': 'marker' }];
    const ssp = parseSspDocument(makeMinimalSsp('1.2.2'), context);
    const view = parseAssessmentPlanDocument(source, context, { ssp }).view;
    expect(
      view.diagnostics
        .filter((d) => d.code === 'OSCAL_AP_ROLE_REFERENCE_UNRESOLVED')
        .map((d) => d.path),
    ).toEqual([
      '/assessment-plan/tasks/0/responsible-roles/0/role-id',
      '/assessment-plan/tasks/0/responsible-roles/1/role-id',
    ]);
  });
  it.each([
    ['component', AP_UUIDS.component],
    ['user', AP_UUIDS.user],
    ['inventory-item', AP_UUIDS.inventory],
    ['resource', AP_UUIDS.resource],
  ])('löst lokale %s-Subjekte auf, UUIDs ohne Beachtung der Hex-Schreibweise', (type, uuid) => {
    const source = makeFullAssessmentPlan();
    Object.assign(source['assessment-plan'], {
      'assessment-subjects': [
        {
          type,
          'include-subjects': [{ type, 'subject-uuid': uuid.toUpperCase() }],
        },
      ],
    });
    expect(parse(source).assessmentSubjects[0].includeSubjects[0].reference).toMatchObject({
      status: 'resolved',
      origin: 'local',
    });
  });
  it('löst externe Subjekte aus dem gebundenen SSP und Mehrdeutigkeiten fail-closed auf', () => {
    const source = makeFullAssessmentPlan();
    Object.assign(source['assessment-plan'], {
      'assessment-subjects': [
        {
          type: 'component',
          'include-subjects': [{ type: 'component', 'subject-uuid': 'external-id' }],
        },
      ],
    });
    const sspSource = withSspBody(makeMinimalSsp('1.2.2'), (body) => {
      Object.assign(body['system-implementation'], {
        components: [{ uuid: 'external-id' }],
      });
    });
    const ssp = parseSspDocument(sspSource, context);
    expect(
      parseAssessmentPlanDocument(source, context, { ssp }).view.assessmentSubjects[0]
        .includeSubjects[0].reference,
    ).toMatchObject({ status: 'resolved', origin: 'ssp' });
    const duplicate = withSspBody(sspSource, (body) => {
      body['system-implementation'].components.push(body['system-implementation'].components[0]);
    });
    const duplicateSsp = parseSspDocument(duplicate, context);
    expect(
      parseAssessmentPlanDocument(source, context, { ssp: duplicateSsp }).view.assessmentSubjects[0]
        .includeSubjects[0].reference,
    ).toMatchObject({ status: 'unresolved', reason: 'identity-ambiguous' });
  });
  it('behauptet für eine ungültige SSP-Bindung keinen gebundenen Kontext', () => {
    const ssp = parseSspDocument(makeMinimalSsp('1.2.2'), context);
    const view = parseAssessmentPlanDocument(makeMinimalAssessmentPlan(), context, {
      ssp: { ...ssp, source: {} },
    }).view;
    expect(view.importSsp?.ssp.status).toBe('not-resolvable-in-context');
    expect(view.diagnostics).toMatchObject([{ code: 'OSCAL_AP_SSP_BINDING_INVALID' }]);
  });
  it('entscheidet doppelte lokale UUIDs nicht zugunsten des ersten Objekts', () => {
    const source = makeFullAssessmentPlan();
    source['assessment-plan']['local-definitions'].components.push(
      source['assessment-plan']['local-definitions'].components[0],
    );
    const view = parse(source);
    expect(view.assessmentSubjects[0].includeSubjects[0].reference).toMatchObject({
      status: 'unresolved',
      reason: 'identity-ambiguous',
    });
  });
  it('verwendet Prüfwerkzeuge nicht als Systemsubjekte, auch bei gebundenem SSP', () => {
    const source = makeFullAssessmentPlan();
    const body = source['assessment-plan'];
    Object.assign(body['assessment-assets'], { components: body['local-definitions'].components });
    body['local-definitions'].components = [];
    const view = parse(source);
    expect(view.assessmentSubjects[0].includeSubjects[0].reference).toEqual({
      status: 'not-resolvable-in-context', reason: 'ssp-not-supplied',
    });
    expect(view.assessmentAssets?.assessmentPlatforms[0].usesComponents[0].reference).toEqual({
      status: 'resolved', origin: 'local', path: '/assessment-plan/assessment-assets/components/0',
    });
    const ssp = parseSspDocument(makeMinimalSsp('1.2.2'), context);
    const bound = parseAssessmentPlanDocument(source, context, { ssp }).view;
    expect(bound.assessmentSubjects[0].includeSubjects[0].reference).toEqual({
      status: 'unresolved', reason: 'identity-not-found',
    });
  });
  it('trennt identische UUIDs in Systemkomponenten und Prüfwerkzeugen', () => {
    const source = makeFullAssessmentPlan();
    const body = source['assessment-plan'];
    Object.assign(body['assessment-assets'], { components: body['local-definitions'].components });
    const view = parse(source);
    expect(view.diagnostics).toEqual([]);
    expect(view.assessmentSubjects[0].includeSubjects[0].reference).toEqual({
      status: 'resolved', origin: 'local', path: '/assessment-plan/local-definitions/components/0',
    });
    expect(view.tasks[0].subjects[0].includeSubjects[0].reference).toEqual(
      view.assessmentSubjects[0].includeSubjects[0].reference,
    );
    expect(view.tasks[0].associatedActivities[0].subjects[0].includeSubjects[0].reference).toEqual(
      view.assessmentSubjects[0].includeSubjects[0].reference,
    );
    expect(view.assessmentAssets?.assessmentPlatforms[0].usesComponents[0].reference).toEqual({
      status: 'resolved', origin: 'local', path: '/assessment-plan/assessment-assets/components/0',
    });
  });
  it('diagnostiziert doppelte Prüfwerkzeuge nur in ihrem eigenen Bereich', () => {
    const source = makeFullAssessmentPlan();
    const body = source['assessment-plan'];
    const component = body['local-definitions'].components[0];
    Object.assign(body['assessment-assets'], { components: [component, component] });
    const view = parse(source);
    expect(view.assessmentSubjects[0].includeSubjects[0].reference.status).toBe('resolved');
    expect(view.assessmentAssets?.assessmentPlatforms[0].usesComponents[0].reference).toEqual({
      status: 'unresolved', reason: 'identity-ambiguous',
    });
    expect(view.diagnostics.map(({ code, path }) => ({ code, path }))).toEqual([
      { code: 'OSCAL_AP_COMPONENT_UUID_DUPLICATE', path: '/assessment-plan/assessment-assets/components/1/uuid' },
      { code: 'OSCAL_AP_COMPONENT_REFERENCE_UNRESOLVED', path: '/assessment-plan/assessment-assets/assessment-platforms/0/uses-components/0/component-uuid' },
    ]);
  });
  it('führt offene Subjektarten als nicht auflösbar im aktuellen Kontext', () => {
    const source = makeFullAssessmentPlan();
    Object.assign(source['assessment-plan'], {
      'assessment-subjects': [
        {
          type: 'custom',
          'include-subjects': [{ type: 'custom', 'subject-uuid': AP_UUIDS.user }],
        },
      ],
    });
    const view = parse(source);
    expect(view.assessmentSubjects[0].includeSubjects[0].reference).toMatchObject({
      status: 'not-resolvable-in-context',
      reason: 'subject-type-not-supported',
    });
    expect(view.diagnostics).toEqual([]);
  });
  it('diagnostiziert falsche Strukturen ohne zu reparieren oder den Plan zu verwerfen', () => {
    const source = makeMinimalAssessmentPlan();
    Object.assign(source['assessment-plan'], {
      tasks: [
        42,
        {
          uuid: 99,
          title: [],
          type: 7,
          timing: { 'at-frequency': { period: '1', unit: 3 } },
          dependencies: [{ 'task-uuid': 1 }],
          subjects: {},
        },
      ],
      'assessment-subjects': {},
      'local-definitions': { components: 'invalid' },
      'import-ssp': { href: 5 },
    });
    const before = structuredClone(source);
    const view = parse(source);
    expect(source).toEqual(before);
    expect(view.tasks).toHaveLength(1);
    expect(view.diagnostics.length).toBeGreaterThan(5);
    expect(view.diagnostics.every((d) => d.stage === 'domain')).toBe(true);
  });
  it('liefert für einen nicht objektförmigen Körper nur Modelldiagnosen', () => {
    expect(deriveAssessmentPlan(null, context).diagnostics.length).toBeGreaterThan(0);
  });
  it('projiziert gemeinsame Felder nur an den dafür definierten OSCAL-Strukturen', () => {
    const source = makeFullAssessmentPlan();
    Object.assign(source['assessment-plan'].tasks[0], {
      status: { state: 'unknown-task-marker' },
      'short-name': 'unknown-task-marker',
      'role-ids': ['unknown-task-marker'],
    });
    Object.assign(source['assessment-plan']['local-definitions'].activities[0], {
      type: 'unknown-activity-marker',
    });
    Object.assign(source['assessment-plan']['terms-and-conditions'].parts[0], {
      id: 'unknown-part-marker',
      remarks: 'unknown-part-marker',
    });
    Object.assign(
      source['assessment-plan']['local-definitions']['objectives-and-methods'][0].parts[0],
      { uuid: 'unknown-part-marker' },
    );
    Object.assign(source['assessment-plan']['local-definitions']['inventory-items'][0], {
      title: 'unknown-inventory-marker',
    });
    const view = parse(source);
    expect(JSON.stringify(view)).not.toContain('unknown-');
    expect(view.tasks[0].type).toBe('action');
    expect(view.localDefinitions.components[0].status?.state).toBe('operational');
    expect(view.localDefinitions.users[0].roleIds).toEqual(['assessor']);
  });
  it('weist auch unbekannte Trust-Token ab', () => {
    expect(() => deriveAssessmentPlan({}, { trustClass: 'future-token' } as never)).toThrow(
      /OSCAL_AP_TRUST_CLASS_REJECTED/,
    );
  });
});
