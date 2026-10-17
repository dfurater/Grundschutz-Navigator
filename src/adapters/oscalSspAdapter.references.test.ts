// =============================================================================
// Referenzen im SSP-Adapter (GSPP-293): Baseline, control-id und
// dokumentinterne UUID- und Rollenbezüge
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
  SystemSecurityPlan,
  SystemSecurityPlanDeriveOptions,
} from './oscalSspAdapter';
import { parseCatalogDocument } from './oscalDocument';
import type { OscalDocumentContext } from '@/domain/models';
import type { RawOscalSystemSecurityPlan } from '@/domain/oscalSystemSecurityPlan';
import { makeLosslessCatalogSource } from '@/test/fixtures/losslessCatalog';
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
/*  Baseline und Control-Bezug                                         */
/* ------------------------------------------------------------------ */

describe('Baseline-Referenz', () => {
  function withBaseline(href: string): SystemSecurityPlan {
    return derive(withSspBody(makeFullSsp(), (body) => {
      body['import-profile'].href = href;
    }));
  }

  it('klassifiziert ein Fragment mit vorhandener Ressource als Back-matter-Ressource', () => {
    const plan = derive(makeFullSsp());
    expect(plan.importProfile?.reference).toMatchObject({
      kind: 'resource',
      resource: { uuid: ids.baselineResource, title: 'Baseline-Profil' },
    });
    expect(plan.importProfile?.baseline).toEqual({ status: NOT_RESOLVABLE_IN_CONTEXT });
  });

  it('klassifiziert eine relative URI als unaufgelöst und liefert das Dokument trotzdem', () => {
    const plan = withBaseline('./baseline-profile.json');
    expect(plan.importProfile?.reference).toMatchObject({ kind: 'unresolved', reason: 'relative' });
    expect(plan.importProfile?.baseline).toEqual({ status: NOT_RESOLVABLE_IN_CONTEXT });
    expect(plan.controlImplementation?.implementedRequirements).toHaveLength(2);
    expect(plan.diagnostics).toEqual([]);
  });

  it('klassifiziert eine absolute URI als extern', () => {
    const plan = withBaseline('https://example.invalid/baseline-profile.json');
    expect(plan.importProfile?.reference).toMatchObject({ kind: 'external' });
    expect(plan.importProfile?.baseline).toEqual({ status: NOT_RESOLVABLE_IN_CONTEXT });
  });

  it('führt eingebettete Ressourcen nur mit Metadaten, die base64-Nutzlast nie', () => {
    const plan = withBaseline(`#${ids.embeddedResource}`);
    expect(plan.importProfile?.reference).toMatchObject({
      kind: 'resource',
      resource: { embeddedContent: { filename: 'grenze.png', mediaType: 'image/png' } },
    });
    expect(JSON.stringify(plan)).not.toContain('iVBORw0KGgo=');
  });
});

describe('control-id gegen die Baseline-Bindung', () => {
  const catalog = parseCatalogDocument(makeLosslessCatalogSource(), {
    catalogKey: 'gspp',
    trustClass: 'class-1-verified-public',
  }).view;

  it('bleibt ohne Bindung nicht auflösbar im aktuellen Kontext und erzeugt keinen Befund', () => {
    const plan = derive(makeFullSsp());
    expect(requirement(plan, 0).control).toEqual({
      status: NOT_RESOLVABLE_IN_CONTEXT,
      reason: 'catalog-not-supplied',
    });
    expect(plan.diagnostics).toEqual([]);
  });

  it('löst mit Bindung auf und meldet eine im Katalog unbekannte control-id', () => {
    const document = withSspBody(makeFullSsp(), (body) => {
      body['control-implementation']['implemented-requirements'][1]['control-id'] = 'GC.99.99';
    });
    const plan = derive(document, { baseline: { catalogKey: 'gspp', catalog } });

    expect(plan.importProfile?.baseline).toEqual({ status: 'bound', catalogKey: 'gspp' });
    expect(requirement(plan, 0).control).toMatchObject({
      status: 'resolved',
      catalogKey: 'gspp',
      control: { id: 'GC.1.1' },
    });
    expect(requirement(plan, 1).control).toMatchObject({
      status: 'unresolved',
      reason: 'control-not-in-catalog',
    });
    expect(plan.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([[
      codes.CONTROL_REFERENCE_UNRESOLVED,
      '/system-security-plan/control-implementation/implemented-requirements/1/control-id',
    ]]);
  });

  it('führt statement-id als gelesenen Wert ohne Auflösungsversuch', () => {
    const plan = derive(makeFullSsp(), { baseline: { catalogKey: 'gspp', catalog } });
    const statement = requirement(plan, 1).statements[0];
    expect(statement?.statementId).toBe('gc.1.2_smt');
    expect(Object.keys(statement ?? {})).not.toContain('statement');
  });
});

/* ------------------------------------------------------------------ */
/*  Dokumentinterne Referenzen                                         */
/* ------------------------------------------------------------------ */

describe('Dokumentinterne Referenzen', () => {
  const requirementsPath = '/system-security-plan/control-implementation/implemented-requirements';

  it.each([
    {
      name: 'eine by-component.component-uuid ohne Komponente',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        body['control-implementation']['implemented-requirements'][0]['by-components']![1]['component-uuid'] =
          '66666666-0000-4000-8000-0000000000ff';
      },
      code: codes.COMPONENT_REFERENCE_UNRESOLVED,
      path: `${requirementsPath}/0/by-components/1/component-uuid`,
    },
    {
      name: 'eine implemented-components[].component-uuid ohne Komponente',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        body['system-implementation']['inventory-items']![0]['implemented-components']![0]['component-uuid'] =
          '66666666-0000-4000-8000-0000000000ff';
      },
      code: codes.COMPONENT_REFERENCE_UNRESOLVED,
      path: '/system-security-plan/system-implementation/inventory-items/0/implemented-components/0/component-uuid',
    },
    {
      name: 'zwei by-components mit derselben component-uuid in einer Anforderung',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        body['control-implementation']['implemented-requirements'][0]['by-components']![1]['component-uuid'] =
          ids.thisSystem;
      },
      code: codes.BY_COMPONENT_DUPLICATE,
      path: `${requirementsPath}/0/by-components/1/component-uuid`,
    },
    {
      name: 'zwei by-components mit derselben component-uuid in einem Statement',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        const statement = body['control-implementation']['implemented-requirements'][1].statements![0];
        statement['by-components']!.push({
          ...structuredClone(statement['by-components']![0]),
          uuid: '66666666-0000-4000-8000-0000000000fe',
        });
      },
      code: codes.BY_COMPONENT_DUPLICATE,
      path: `${requirementsPath}/1/statements/0/by-components/1/component-uuid`,
    },
    {
      name: 'eine role-id ohne Rolle in metadata.roles',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        body['control-implementation']['implemented-requirements'][0]['responsible-roles'] = [
          { 'role-id': 'unbekannte-rolle' },
        ];
      },
      code: codes.ROLE_REFERENCE_UNRESOLVED,
      path: `${requirementsPath}/0/responsible-roles/0/role-id`,
    },
    {
      name: 'eine Party-UUID ohne Partei in metadata.parties',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        body['control-implementation']['implemented-requirements'][0]['by-components']![0]['responsible-roles'] = [
          { 'role-id': 'system-owner', 'party-uuids': ['66666666-0000-4000-8000-0000000000fd'] },
        ];
      },
      code: codes.PARTY_REFERENCE_UNRESOLVED,
      path: `${requirementsPath}/0/by-components/0/responsible-roles/0/party-uuids/0`,
    },
    {
      name: 'eine role-id an einer Komponente ohne Rolle in metadata.roles',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        body['system-implementation'].components[0]['responsible-roles'] = [{ 'role-id': 'unbekannte-rolle' }];
      },
      code: codes.ROLE_REFERENCE_UNRESOLVED,
      path: '/system-security-plan/system-implementation/components/0/responsible-roles/0/role-id',
    },
    {
      name: 'eine Party-UUID in system-characteristics.responsible-parties ohne Partei',
      mutate: (body: RawOscalSystemSecurityPlan) => {
        body['system-characteristics']['responsible-parties'] = [
          { 'role-id': 'system-owner', 'party-uuids': ['66666666-0000-4000-8000-0000000000fd'] },
        ];
      },
      code: codes.PARTY_REFERENCE_UNRESOLVED,
      path: '/system-security-plan/system-characteristics/responsible-parties/0/party-uuids/0',
    },
  ])('diagnostiziert $name und liefert das Dokument', ({ mutate, code, path }) => {
    const plan = derive(withSspBody(makeFullSsp(), mutate));

    expect(plan.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([[code, path]]);
    expect(plan.diagnostics[0]).toMatchObject({ stage: 'domain', artifact: { rootType: 'system-security-plan' } });
    expect(plan.controlImplementation?.implementedRequirements).toHaveLength(2);
  });

  it('diagnostiziert eine doppelte Komponenten-UUID und entscheidet Referenzen darauf nicht', () => {
    const plan = derive(withSspBody(makeFullSsp(), (body) => {
      body['system-implementation'].components[1].uuid = ids.thisSystem;
    }));

    expect(plan.diagnostics[0]).toMatchObject({
      code: codes.COMPONENT_UUID_DUPLICATE,
      path: '/system-security-plan/system-implementation/components/1/uuid',
    });
    expect(requirement(plan, 0).byComponents[0]?.component).toMatchObject({
      status: 'unresolved',
      reason: 'component-ambiguous',
    });
  });

  it('vergleicht UUIDs ohne Unterschied der Schreibweise und behält den gelesenen Wert', () => {
    const componentUuid = '66666666-0000-4000-8000-0000000000ab';
    const partyUuid = '66666666-0000-4000-8000-0000000000ac';
    const plan = derive(withSspBody(makeFullSsp(), (body) => {
      body.metadata.parties = [
        ...(body.metadata.parties ?? []),
        { uuid: partyUuid, type: 'organization', name: 'Zweite Organisation' },
      ];
      const components = body['system-implementation'].components;
      components.push({ ...structuredClone(components[1]), uuid: componentUuid });
      const byComponent = body['control-implementation']['implemented-requirements'][0]['by-components']![1];
      byComponent['component-uuid'] = componentUuid.toUpperCase();
      byComponent['responsible-roles'] = [{ 'role-id': 'system-owner', 'party-uuids': [partyUuid.toUpperCase()] }];
    }));

    expect(plan.diagnostics).toEqual([]);
    expect(requirement(plan, 0).byComponents[1]).toMatchObject({
      componentUuid: componentUuid.toUpperCase(),
      component: { status: 'resolved', component: { uuid: componentUuid } },
    });

    const duplicate = derive(withSspBody(makeFullSsp(), (body) => {
      const components = body['system-implementation'].components;
      components.push(
        { ...structuredClone(components[1]), uuid: componentUuid },
        { ...structuredClone(components[1]), uuid: componentUuid.toUpperCase() },
      );
    }));
    expect(duplicate.diagnostics.map((diagnostic) => [diagnostic.code, diagnostic.path])).toEqual([
      [codes.COMPONENT_UUID_DUPLICATE, '/system-security-plan/system-implementation/components/3/uuid'],
    ]);
  });

  it('setzt keinen Referenzwert in eine Diagnose', () => {
    const marker = 'GEHEIMER-MARKER-7f3a';
    const plan = derive(withSspBody(makeFullSsp(), (body) => {
      const first = body['control-implementation']['implemented-requirements'][0];
      first['by-components']![1]['component-uuid'] = `${marker}-komponente`;
      first['responsible-roles'] = [{ 'role-id': `${marker}-rolle`, 'party-uuids': [`${marker}-partei`] }];
    }));

    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(expect.arrayContaining([
      codes.COMPONENT_REFERENCE_UNRESOLVED,
      codes.ROLE_REFERENCE_UNRESOLVED,
      codes.PARTY_REFERENCE_UNRESOLVED,
    ]));
    expect(JSON.stringify(plan.diagnostics)).not.toContain(marker);
  });
});
