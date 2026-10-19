// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseAssessmentPlanDocument,
  validateAssessmentPlanSchema,
} from './oscalAssessmentPlanDocument';
import {
  AP_UUIDS,
  makeFullAssessmentPlan,
  makeMinimalAssessmentPlan,
} from '@/test/fixtures/assessmentPlans';
import { PINNED_OSCAL_VERSIONS } from '@/domain/oscalVersionMatrix';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { parseSspDocument } from './oscalSspDocument';
import { makeMinimalSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import { parseCatalog } from './oscalAdapter';
import { stubNoNetwork, expectNoNetworkCalls } from '@/test/noNetwork';

const context = { trustClass: 'class-2-local-user' } as const;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const parse = (value: unknown) => parseAssessmentPlanDocument(value, context);

afterEach(() => vi.unstubAllGlobals());

describe('Assessment-Plan-Dokument und Importgrenze', () => {
  it.each(PINNED_OSCAL_VERSIONS)('erhält source, context und Pin für %s', async (version) => {
    const source = makeMinimalAssessmentPlan(version);
    const document = parse(source);
    expect(document.source).toBe(source);
    expect(document.context).toBe(context);
    expect(document.oscalVersion).toBe(version);
    expect(document.pin).toMatchObject({
      rootKey: 'assessment-plan',
      oscalVersion: version,
    });
    expect(document.view).toMatchObject({
      uuid: AP_UUIDS.plan,
      tasks: [],
      assessmentSubjects: [],
      assessmentAssets: null,
      termsAndConditions: [],
      diagnostics: [],
    });
    expect(document.view.localDefinitions).toMatchObject({
      components: [],
      users: [],
      inventoryItems: [],
      activities: [],
      objectivesAndMethods: [],
    });
    expect((await validateAssessmentPlanSchema(document)).ok).toBe(true);
    const imported = await processClass2OscalBytes(bytes(source), context);
    expect(imported.ok).toBe(true);
    if (imported.ok)
      expect(
        parseAssessmentPlanDocument(imported.document.source, imported.document.context).view.uuid,
      ).toBe(AP_UUIDS.plan);
  });
  it.each(['class-1-verified-public', 'class-1-unverified-public'] as const)(
    'weist %s fail-closed ab',
    (trustClass) => {
      expect(() =>
        parseAssessmentPlanDocument(makeMinimalAssessmentPlan(), {
          trustClass,
        }),
      ).toThrow(/OSCAL_AP_TRUST_CLASS_REJECTED/);
    },
  );
  it.each([undefined, '9.9.9'])('weist unbekannte Version %s in Stufe 2 ab', async (version) => {
    const source = makeMinimalAssessmentPlan();
    Object.assign(source['assessment-plan'].metadata, {
      'oscal-version': version,
    });
    expect(await processClass2OscalBytes(bytes(source), context)).toMatchObject({
      ok: false,
      diagnostic: { stage: 'root-dispatch' },
    });
  });
  it.each(['import-ssp', 'reviewed-controls', 'empty-selection'])(
    'weist %s in Stufe 3 ab',
    async (key) => {
      const source = makeMinimalAssessmentPlan();
      if (key === 'empty-selection')
        source['assessment-plan']['reviewed-controls']['control-selections'] = [];
      else Reflect.deleteProperty(source['assessment-plan'], key);
      expect(await processClass2OscalBytes(bytes(source), context)).toMatchObject({
        ok: false,
        diagnostic: { stage: 'json-schema' },
      });
    },
  );
  it.each(['subjects', 'controls', 'timing'])('prüft die versionierte Auswahl %s', async (key) => {
    for (const version of ['1.1.3', '1.2.2'] as const) {
      const source = makeMinimalAssessmentPlan(version);
      const body = source['assessment-plan'];
      if (key === 'subjects')
        Object.assign(body, {
          'assessment-subjects': [
            {
              type: 'component',
              'include-all': {},
              'include-subjects': [{ 'subject-uuid': AP_UUIDS.component, type: 'component' }],
            },
          ],
        });
      if (key === 'controls')
        body['reviewed-controls']['control-selections'] = [
          {},
        ] as (typeof body)['reviewed-controls']['control-selections'];
      if (key === 'timing')
        Object.assign(body, {
          tasks: [
            {
              uuid: AP_UUIDS.task,
              type: 'action',
              title: 'Task',
              timing: {
                'on-date': { date: '2026-10-19T00:00:00Z' },
                'at-frequency': { period: 1, unit: 'days' },
              },
            },
          ],
        });
      const result = await processClass2OscalBytes(bytes(source), context);
      expect(result.ok, `${version}/${key}`).toBe(version === '1.1.3');
      if (!result.ok) expect(result.diagnostic.stage).toBe('json-schema');
    }
  });
});

describe('Projektion und kontrollierte Referenzen', () => {
  it('liest alle Bereiche, rekursive Aufgaben und lokale Referenzen ohne I/O', async () => {
    const source = makeFullAssessmentPlan();
    const before = structuredClone(source);
    const stubs = stubNoNetwork();
    vi.stubGlobal(
      'atob',
      vi.fn(() => {
        throw new Error('decode');
      }),
    );
    for (const name of ['localStorage', 'sessionStorage', 'indexedDB'])
      vi.stubGlobal(
        name,
        new Proxy(
          {},
          {
            get() {
              throw new Error('storage');
            },
          },
        ),
      );
    const { view } = parse(source);
    expectNoNetworkCalls(stubs);
    expect(globalThis.atob).not.toHaveBeenCalled();
    expect(source).toEqual(before);
    expect(view.diagnostics).toEqual([]);
    expect(view.localDefinitions.components[0].description).toBe('**Rohmarkup**');
    expect(view.localDefinitions.activities[0].steps).toHaveLength(1);
    expect(view.tasks[0].tasks[0].dependencies[0].reference.status).toBe('resolved');
    expect(view.tasks[0].associatedActivities[0].reference.status).toBe('resolved');
    expect(view.tasks[0].subjects[0].includeSubjects[0].reference.status).toBe('resolved');
    expect(view.tasks[0].timing?.onDate?.date).toBe('2026-10-19T00:00:00Z');
    expect(view.termsAndConditions[0].prose).toBe('**Methode**');
    expect(view.assessmentAssets?.assessmentPlatforms).toHaveLength(1);
    expect(JSON.stringify(view)).not.toContain('foreign-marker');
    expect(JSON.stringify(view)).not.toContain('c2Vuc2l0aXZl');
    expect((await validateAssessmentPlanSchema(parse(source))).ok).toBe(true);
  });
  it.each(['ssp.json', 'https://example.invalid/ssp.json', `#${AP_UUIDS.resource}`])(
    'klassifiziert %s ohne SSP-Aussage oder Laden',
    (href) => {
      const source = makeFullAssessmentPlan();
      source['assessment-plan']['import-ssp'].href = href;
      const stubs = stubNoNetwork();
      const view = parse(source).view;
      expect(view.importSsp?.reference).toBeDefined();
      expect(view.importSsp?.ssp.status).toBe('not-resolvable-in-context');
      expectNoNetworkCalls(stubs);
    },
  );
  it('diagnostiziert lokale Duplikate und dangling Referenzen ohne Dokumentwerte', () => {
    const source = makeFullAssessmentPlan();
    const body = source['assessment-plan'];
    body['local-definitions'].components.push(body['local-definitions'].components[0]);
    body['local-definitions'].users.push(body['local-definitions'].users[0]);
    body.tasks[0].tasks[0].dependencies[0]['task-uuid'] =
      'sensitive-task-marker' as typeof AP_UUIDS.task;
    body.tasks[0]['associated-activities'][0]['activity-uuid'] =
      'sensitive-activity-marker' as typeof AP_UUIDS.activity;
    body['terms-and-conditions'].parts[0].name = 'unknown';
    Reflect.deleteProperty(body['assessment-subjects'][0], 'type');
    const { view } = parse(source);
    const codes = view.diagnostics.map((d) => d.code);
    for (const code of [
      'COMPONENT_UUID_DUPLICATE',
      'USER_UUID_DUPLICATE',
      'TASK_REFERENCE_UNRESOLVED',
      'ACTIVITY_REFERENCE_UNRESOLVED',
      'PART_NAME_UNEXPECTED',
      'SUBJECT_TYPE_MISSING',
    ])
      expect(codes).toContain(`OSCAL_AP_${code}`);
    expect(JSON.stringify(view.diagnostics)).not.toContain('sensitive-');
  });
  it('löst Rollen nur lokal oder gegen ein explizites SSP auf', () => {
    const source = makeFullAssessmentPlan();
    source['assessment-plan'].tasks[0]['responsible-roles'][0]['role-id'] = 'sensitive-role-marker';
    expect(parse(source).view.tasks[0].responsibleRoles[0].reference.status).toBe(
      'not-resolvable-in-context',
    );
    let sspSource = withSspBody(makeMinimalSsp('1.2.2'), (body) => {
      Object.assign(body.metadata, {
        roles: [{ id: 'sensitive-role-marker', title: 'Role' }],
      });
    });
    let ssp = parseSspDocument(sspSource, context);
    expect(
      parseAssessmentPlanDocument(source, context, { ssp }).view.tasks[0].responsibleRoles[0]
        .reference.status,
    ).toBe('resolved');
    sspSource = withSspBody(sspSource, (body) => {
      Object.assign(body.metadata, { roles: [] });
    });
    ssp = parseSspDocument(sspSource, context);
    const { view } = parseAssessmentPlanDocument(source, context, { ssp });
    expect(view.diagnostics.some((d) => d.code === 'OSCAL_AP_ROLE_REFERENCE_UNRESOLVED')).toBe(
      true,
    );
    expect(JSON.stringify(view.diagnostics)).not.toContain('sensitive-role-marker');
  });
  it('löst Controls ausschließlich gegen eine explizite Katalogbindung auf', () => {
    const source = makeFullAssessmentPlan();
    const target = (options = {}) =>
      parseAssessmentPlanDocument(source, context, options).view.localDefinitions
        .objectivesAndMethods[0].control;
    expect(target()).toMatchObject({
      status: 'not-resolvable-in-context',
      reason: 'catalog-not-supplied',
    });
    const catalog = parseCatalog(
      {
        uuid: AP_UUIDS.plan,
        metadata: {},
        controls: [
          {
            id: 'ac-1',
            title: 'Control',
            props: [{ name: 'alt-identifier', value: 'AC-1' }],
          },
        ],
      },
      { catalogKey: 'gspp' },
    );
    expect(target({ catalog: { catalogKey: 'gspp', catalog } })).toMatchObject({
      status: 'resolved',
    });
    catalog.controlsById.clear();
    expect(target({ catalog: { catalogKey: 'gspp', catalog } })).toMatchObject({
      status: 'unresolved',
      reason: 'control-not-in-catalog',
    });
  });
  it('erhält unbekannte Quellfelder ohne sie zu projizieren', () => {
    const source = makeMinimalAssessmentPlan();
    Object.assign(source['assessment-plan'], {
      'vendor-field': { marker: 'unknown-field-marker' },
    });
    const document = parse(source);
    expect(document.source).toBe(source);
    expect(JSON.stringify(document.view)).not.toContain('unknown-field-marker');
  });
});
