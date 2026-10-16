// =============================================================================
// Read-Model des SSP-Adapters (GSPP-293)
//
// Feste Erwartungswerte stehen ausschließlich gegen die synthetischen Fixtures
// aus `src/test/fixtures/systemSecurityPlans.ts`.
// =============================================================================

import { describe, expect, it } from 'vitest';
import {
  deriveSystemSecurityPlan,
  NOT_RESOLVABLE_IN_CONTEXT,
  SSP_ADAPTER_DIAGNOSTIC_CODES,
} from './oscalSspAdapter';
import type {
  SspImplementedRequirement,
  SspStatement,
  SystemSecurityPlan,
  SystemSecurityPlanDeriveOptions,
} from './oscalSspAdapter';
import type { OscalDocumentContext } from '@/domain/models';
import {
  makeFullSsp,
  SSP_FIXTURE_IDS,
  withSspBody,
} from '@/test/fixtures/systemSecurityPlans';

const context: OscalDocumentContext = { trustClass: 'class-2-local-user' };
const ids = SSP_FIXTURE_IDS;
const codes = SSP_ADAPTER_DIAGNOSTIC_CODES;

function derive(
  document: Record<string, unknown>,
  options?: SystemSecurityPlanDeriveOptions,
): SystemSecurityPlan {
  return deriveSystemSecurityPlan(document['system-security-plan'], context, options);
}

function requirement(plan: SystemSecurityPlan, index: number): SspImplementedRequirement {
  const found = plan.controlImplementation?.implementedRequirements[index];
  if (!found) throw new Error(`Anforderung ${index} fehlt`);
  return found;
}

/* ------------------------------------------------------------------ */
/*  Read-Model                                                         */
/* ------------------------------------------------------------------ */

describe('Read-Model am Vollfixture', () => {
  const plan = derive(makeFullSsp());

  it('erzeugt keine Modelldiagnose', () => {
    expect(plan.diagnostics).toEqual([]);
  });

  it('bildet alle sechs Pflichtfelder der system-characteristics und ihre optionalen Felder ab', () => {
    expect(plan.systemCharacteristics).toMatchObject({
      systemIds: [{ id: ids.ssp, identifierType: 'https://ietf.org/rfc/rfc4122' }],
      systemName: 'Beispielsystem',
      systemNameShort: 'BSP',
      description: 'Ein **synthetisches** System ohne Betriebsdaten.',
      dateAuthorized: '2026-10-01',
      securitySensitivityLevel: 'fips-199-moderate',
      systemInformation: {
        informationTypes: [{
          uuid: ids.informationType,
          title: 'Betriebsdaten',
          categorizations: [{
            system: 'https://doi.org/10.6028/NIST.SP.800-60v2r1',
            informationTypeIds: ['C.2.4.1'],
          }],
          confidentialityImpact: {
            base: 'fips-199-moderate',
            props: [{ name: 'marking', value: 'synthetisch' }],
            links: [{ href: './einstufung.md', rel: 'reference' }],
          },
          integrityImpact: {
            base: 'fips-199-moderate',
            selected: 'fips-199-high',
            adjustmentJustification: 'Synthetische Anhebung.',
          },
          availabilityImpact: { base: 'fips-199-low' },
        }],
        props: [{ name: 'marking', value: 'synthetisch' }],
        links: [{ href: './informationsarten.md', rel: 'reference' }],
      },
      securityImpactLevel: {
        confidentiality: 'fips-199-moderate',
        integrity: 'fips-199-high',
        availability: 'fips-199-low',
      },
      status: { state: 'operational', remarks: 'Synthetischer Betrieb.' },
      authorizationBoundary: {
        description: 'Synthetische Systemgrenze.',
        diagrams: [{ uuid: ids.diagram, caption: 'Abbildung 1' }],
      },
      networkArchitecture: { description: 'Synthetische Netzarchitektur.' },
      dataFlow: { description: 'Synthetischer Datenfluss.' },
      responsibleParties: [{ roleId: 'system-owner', partyUuids: [ids.party] }],
    });
  });

  it('bildet system-implementation ab und löst das Inventar gegen die Komponenten auf', () => {
    const implementation = plan.systemImplementation;
    expect(implementation?.leveragedAuthorizations).toMatchObject([
      { uuid: ids.leveragedAuthorization, partyUuid: ids.party, dateAuthorized: '2026-09-01' },
    ]);
    expect(implementation?.users).toMatchObject([{
      uuid: ids.user,
      shortName: 'admin',
      roleIds: ['system-owner'],
      authorizedPrivileges: [{ title: 'Vollzugriff', functionsPerformed: ['konfigurieren', 'protokolle-lesen'] }],
    }]);
    expect(implementation?.components.map((component) => [component.uuid, component.status?.state])).toEqual([
      [ids.thisSystem, 'operational'],
      [ids.software, 'under-development'],
    ]);
    expect(implementation?.inventoryItems[0]?.implementedComponents[0]?.component).toMatchObject({
      status: 'resolved',
      component: { uuid: ids.software },
    });
  });

  it('führt set-parameters auf allen drei Ebenen und die Anforderungen in Quellreihenfolge', () => {
    expect(plan.controlImplementation?.setParameters).toEqual([
      { paramId: 'gc.1.1_prm_1', values: ['Systemebene'], remarks: undefined },
    ]);
    expect(plan.controlImplementation?.implementedRequirements.map((entry) => entry.controlId)).toEqual([
      'GC.1.1',
      'GC.1.2',
    ]);
    expect(requirement(plan, 0).setParameters[0]?.values).toEqual(['Anforderungsebene']);
    expect(requirement(plan, 0).byComponents[0]?.setParameters[0]?.values).toEqual(['Komponentenebene']);
  });
});

describe('Umsetzungsstatus je Komponente', () => {
  const plan = derive(makeFullSsp());

  it('führt implementation-status ausschließlich an by-component', () => {
    const first = requirement(plan, 0);
    const statement = requirement(plan, 1).statements[0] as SspStatement;

    expect(first.byComponents.map((entry) => entry.implementationStatus?.state)).toEqual([
      'implemented',
      'gspp-teilweise-geprueft',
    ]);
    expect(statement.byComponents[0]?.implementationStatus?.state).toBe('partial');
    expect('implementationStatus' in first).toBe(false);
    expect('implementationStatus' in statement).toBe(false);

    // @ts-expect-error — Anforderungen tragen keinen Umsetzungsstatus.
    void first.implementationStatus;
    // @ts-expect-error — Statements tragen keinen Umsetzungsstatus.
    void statement.implementationStatus;
  });

  it('liest ein unbekanntes Token des offenen Vokabulars unverändert', () => {
    expect(requirement(plan, 0).byComponents[1]?.implementationStatus).toEqual({
      state: 'gspp-teilweise-geprueft',
      remarks: 'Unbekanntes Token des offenen Vokabulars.',
    });
  });

  it('führt export, inherited, satisfied und responsible-roles an by-component', () => {
    const byThisSystem = requirement(plan, 0).byComponents[0];
    expect(byThisSystem?.export).toMatchObject({
      description: 'Angebot an nutzende Systeme.',
      provided: [{ uuid: ids.provided, responsibleRoles: [{ roleId: 'system-owner' }] }],
      responsibilities: [{ uuid: ids.responsibility, providedUuid: ids.provided }],
    });
    expect(byThisSystem?.responsibleRoles).toEqual([
      { roleId: 'system-owner', partyUuids: [ids.party], remarks: undefined },
    ]);

    const statementBy = requirement(plan, 1).statements[0]?.byComponents[0];
    expect(statementBy?.inherited).toMatchObject([{ uuid: ids.inherited }]);
    expect(statementBy?.satisfied).toMatchObject([{ uuid: ids.satisfied }]);
  });

  it('weist provided-uuid und responsibility-uuid als nicht auflösbar aus, ohne Befund', () => {
    const statementBy = requirement(plan, 1).statements[0]?.byComponents[0];
    expect(statementBy?.inherited[0]?.provided).toEqual({
      uuid: ids.leveragedProvided,
      status: NOT_RESOLVABLE_IN_CONTEXT,
    });
    expect(statementBy?.satisfied[0]?.responsibility).toEqual({
      uuid: ids.leveragedResponsibility,
      status: NOT_RESOLVABLE_IN_CONTEXT,
    });
    expect(plan.diagnostics).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Verlustfreiheit und Form                                           */
/* ------------------------------------------------------------------ */

describe('Verlustfreiheit', () => {
  it('lässt den Quellgraphen unverändert und projiziert unbekannte Felder nicht', () => {
    const document = withSspBody(makeFullSsp(), (body) => {
      Object.assign(body['control-implementation'], { 'x-unbekanntes-feld': { wert: 'bleibt-in-source' } });
    });
    const before = structuredClone(document);
    const plan = derive(document);

    expect(document).toEqual(before);
    expect(JSON.stringify(plan)).not.toContain('bleibt-in-source');
  });

  it('führt Props mit fremdem Namespace unverändert und ohne Deutung', () => {
    const plan = derive(makeFullSsp());
    expect(plan.systemCharacteristics?.props).toContainEqual({
      name: 'vendor-classification',
      value: 'nur-intern',
      ns: 'https://example.vendor.invalid/ns/oscal',
      class: undefined,
    });
  });

  it('diagnostiziert fehlende Pflichtknoten, statt zu werfen', () => {
    const plan = derive(withSspBody(makeFullSsp(), (body) => {
      Reflect.deleteProperty(body, 'import-profile');
      Reflect.deleteProperty(body['system-characteristics'], 'status');
      Reflect.deleteProperty(body['system-implementation'].components[0], 'status');
      Reflect.deleteProperty(body, 'control-implementation');
    }));

    expect(plan.importProfile).toBeNull();
    expect(plan.systemCharacteristics?.status).toBeNull();
    expect(plan.systemImplementation?.components[0]?.status).toBeNull();
    expect(plan.controlImplementation).toBeNull();
    expect(plan.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
      '/system-security-plan/import-profile',
      '/system-security-plan/system-characteristics/status',
      '/system-security-plan/system-implementation/components/0/status',
      '/system-security-plan/control-implementation',
    ]);
  });

  it('diagnostiziert ein Einzelobjekt statt eines Arrays und normalisiert es nicht', () => {
    const document = withSspBody(makeFullSsp(), (body) => {
      Object.assign(body['system-implementation'], { users: { uuid: ids.user } });
    });
    const plan = derive(document);

    expect(plan.systemImplementation?.users).toEqual([]);
    expect(plan.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([[
      codes.STRUCTURE_UNEXPECTED,
      '/system-security-plan/system-implementation/users',
    ]]);
  });
});

describe('Unvollständige Knoten', () => {
  it('diagnostiziert jeden unvollständigen Knoten an seinem Pfad, statt zu werfen', () => {
    const plan = derive(withSspBody(makeFullSsp(), (body) => {
      Reflect.deleteProperty(body['import-profile'], 'href');
      Reflect.deleteProperty(body, 'system-characteristics');
      body.metadata.roles = [{ title: 'ohne id' } as never];
      body['system-implementation'].components[1].status = {} as never;
      Reflect.deleteProperty(body['system-implementation'].components[1], 'uuid');
      const first = body['control-implementation']['implemented-requirements'][0];
      Reflect.deleteProperty(first, 'control-id');
      Reflect.deleteProperty(first['by-components']![1], 'component-uuid');
      first['responsible-roles'] = ['keine-rolle' as never];
    }));

    expect(plan.importProfile).toBeNull();
    expect(plan.systemCharacteristics).toBeNull();
    const requirements = '/system-security-plan/control-implementation/implemented-requirements';
    const implementation = '/system-security-plan/system-implementation';
    expect(plan.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([
      [codes.STRUCTURE_UNEXPECTED, '/system-security-plan/import-profile/href'],
      [codes.STRUCTURE_UNEXPECTED, '/system-security-plan/system-characteristics'],
      [codes.ROLE_REFERENCE_UNRESOLVED, `${implementation}/components/0/responsible-roles/0/role-id`],
      [codes.STRUCTURE_UNEXPECTED, `${implementation}/components/1/status/state`],
      [codes.ROLE_REFERENCE_UNRESOLVED, `${implementation}/users/0/role-ids/0`],
      [codes.ROLE_REFERENCE_UNRESOLVED, `${implementation}/inventory-items/0/responsible-parties/0/role-id`],
      [
        codes.COMPONENT_REFERENCE_UNRESOLVED,
        `${implementation}/inventory-items/0/implemented-components/0/component-uuid`,
      ],
      [codes.CONTROL_ID_MISSING, `${requirements}/0/control-id`],
      [codes.STRUCTURE_UNEXPECTED, `${requirements}/0/responsible-roles/0`],
      [codes.ROLE_REFERENCE_UNRESOLVED, `${requirements}/0/by-components/0/responsible-roles/0/role-id`],
      [codes.ROLE_REFERENCE_UNRESOLVED, `${requirements}/0/by-components/0/export/provided/0/responsible-roles/0/role-id`],
      [codes.COMPONENT_REFERENCE_UNRESOLVED, `${requirements}/0/by-components/1/component-uuid`],
      [codes.COMPONENT_REFERENCE_UNRESOLVED, `${requirements}/1/statements/0/by-components/0/component-uuid`],
    ]);
    expect(requirement(plan, 0).byComponents[1]?.component).toMatchObject({ reason: 'component-uuid-missing' });
  });

  it('meldet einen Root-Körper, der kein Objekt ist, ohne zu werfen', () => {
    const plan = deriveSystemSecurityPlan('kein-objekt', context);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.path)[0]).toBe('/system-security-plan');
    expect(plan.systemImplementation).toBeNull();
  });
});
