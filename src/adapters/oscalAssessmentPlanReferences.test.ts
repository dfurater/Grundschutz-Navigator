import { describe, expect, it } from 'vitest';
import { parseAssessmentPlanDocument } from './oscalAssessmentPlanDocument';
import { parseSspDocument } from './oscalSspDocument';
import { makeMinimalSsp, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import {
  AP_UUIDS,
  makeFullAssessmentPlan,
  makeMinimalAssessmentPlan,
} from '@/test/fixtures/assessmentPlans';

const context = { trustClass: 'class-2-local-user' } as const;

describe('Assessment-Plan-Befunde aus dem Cross-Check', () => {
  it.each(['disclosures', 'assumptions'])(
    'lässt unter %s offene item-Teile zu und erhält ihre UUID',
    (name) => {
      const source = makeMinimalAssessmentPlan();
      Object.assign(source['assessment-plan'], {
        'terms-and-conditions': {
          parts: [
            {
              name,
              parts: [
                {
                  name: 'item',
                  uuid: AP_UUIDS.step,
                  parts: [{ name: 'custom-detail', uuid: AP_UUIDS.child }],
                },
              ],
            },
          ],
        },
      });
      const view = parseAssessmentPlanDocument(source, context).view;
      expect(view.diagnostics).toEqual([]);
      expect(view.termsAndConditions[0].parts[0].uuid).toBe(AP_UUIDS.step);
      expect(view.termsAndConditions[0].parts[0].parts[0].uuid).toBe(AP_UUIDS.child);
    },
  );
  it.each(['class-1-verified-public', 'class-1-unverified-public'] as const)(
    'weist eine SSP-Bindung der Klasse %s ab',
    (trustClass) => {
      const ssp = parseSspDocument(makeMinimalSsp('1.2.2'), context);
      expect(() =>
        parseAssessmentPlanDocument(makeMinimalAssessmentPlan(), context, {
          ssp: { ...ssp, context: { trustClass } },
        }),
      ).toThrow(/OSCAL_AP_TRUST_CLASS_REJECTED/);
    },
  );
  it('diagnostiziert Parteien und Benutzerrollen am ursprünglichen Arrayindex ohne Werte', () => {
    const source = makeFullAssessmentPlan();
    Object.assign(source['assessment-plan'].tasks[0]['responsible-roles'][0], {
      'party-uuids': ['private-party-0', 99, 'private-party-2'],
    });
    source['assessment-plan']['local-definitions'].users[0]['role-ids'] = [
      'assessor',
      'private-role-1',
    ];
    const ssp = parseSspDocument(makeMinimalSsp('1.2.2'), context);
    const view = parseAssessmentPlanDocument(source, context, { ssp }).view;
    expect(
      view.diagnostics
        .filter((d) => d.code === 'OSCAL_AP_PARTY_REFERENCE_UNRESOLVED')
        .map((d) => d.path),
    ).toEqual([
      '/assessment-plan/tasks/0/responsible-roles/0/party-uuids/0',
      '/assessment-plan/tasks/0/responsible-roles/0/party-uuids/2',
    ]);
    expect(
      view.diagnostics
        .filter((d) => d.code === 'OSCAL_AP_ROLE_REFERENCE_UNRESOLVED')
        .map((d) => d.path),
    ).toEqual(['/assessment-plan/local-definitions/users/0/role-ids/1']);
    expect(JSON.stringify(view.diagnostics)).not.toContain('private-');
  });
  it('akzeptiert lokale und explizit gebundene Parteien und Benutzerrollen', () => {
    const source = makeFullAssessmentPlan();
    Object.assign(source['assessment-plan'].metadata, { parties: [{ uuid: AP_UUIDS.user }] });
    Object.assign(source['assessment-plan'].tasks[0]['responsible-roles'][0], {
      'party-uuids': [AP_UUIDS.user, AP_UUIDS.component],
    });
    source['assessment-plan']['local-definitions'].users[0]['role-ids'] = ['assessor', 'ssp-role'];
    const sspSource = withSspBody(makeMinimalSsp('1.2.2'), (body) => {
      Object.assign(body.metadata, {
        parties: [{ uuid: AP_UUIDS.component }],
        roles: [{ id: 'ssp-role', title: 'Rolle' }],
      });
    });
    const ssp = parseSspDocument(sspSource, context);
    expect(parseAssessmentPlanDocument(source, context, { ssp }).view.diagnostics).toEqual([]);
    // Ohne SSP sind die nicht lokal definierten Referenzen nicht auswertbar, kein Fehler.
    expect(parseAssessmentPlanDocument(source, context).view.diagnostics).toEqual([]);
  });
});
