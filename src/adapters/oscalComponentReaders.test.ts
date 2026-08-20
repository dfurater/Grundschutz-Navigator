// =============================================================================
// Knotenleser — Diagnose statt stiller Einträge (GSPP-248)
//
// Der Unterschied zwischen einem Leser und einem `?? []` ist genau das
// Verhalten bei einem **vorhandenen** Wert der falschen Form. Diese Datei
// belegt ihn Zweig für Zweig: Jede fehlgeformte Stelle erzeugt eine Diagnose
// mit strukturellem JSON Pointer, und der Quellgraph bleibt daneben
// unverändert stehen.
//
// Ohne diesen Nachweis wäre die Zusage „Fehlende oder unauflösbare Angaben
// erzeugen Diagnostics statt stiller Einträge" nur eine Behauptung über
// ungetesteten Verteidigungscode.
// =============================================================================

import { describe, expect, it } from 'vitest';
import { deriveComponentDefinition } from './oscalComponentAdapter';
import { COMPONENT_ADAPTER_DIAGNOSTIC_CODES } from './oscalComponentReaders';
import type { OscalDocumentContext } from '@/domain/models';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };

const METADATA = {
  title: 'Fehlgeformtes Fixture',
  'last-modified': '2026-08-17T00:00:00Z',
  version: '1',
  'oscal-version': '1.2.2',
};

function deriveBody(extra: Record<string, unknown>) {
  return deriveComponentDefinition(
    { uuid: '11111111-1111-4111-8111-111111111111', metadata: METADATA, ...extra },
    context,
  );
}

/** Alle strukturellen Befunde in Fundreihenfolge. */
function structuralPaths(view: { diagnostics: readonly { code: string; path: string }[] }) {
  return view.diagnostics
    .filter(
      (diagnostic) =>
        diagnostic.code === COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED,
    )
    .map((diagnostic) => diagnostic.path);
}

describe('Root-Körper', () => {
  it('diagnostiziert einen Körper, der kein Objekt ist, statt zu werfen', () => {
    const view = deriveComponentDefinition('kein Objekt', context);

    expect(structuralPaths(view)).toEqual(['/component-definition']);
    expect(view.components).toEqual([]);
    expect(view.metadata.oscalVersion).toBeUndefined();
  });

  it('verträgt einen leeren Körper', () => {
    const view = deriveComponentDefinition({}, context);

    expect(view.diagnostics).toEqual([]);
    expect(view.uuid).toBeUndefined();
  });
});

describe('Arrayfelder', () => {
  it('diagnostiziert ein Objekt an Stelle eines Arrays', () => {
    const view = deriveBody({ components: { uuid: 'kein Array' } });

    expect(structuralPaths(view)).toEqual(['/component-definition/components']);
    expect(view.components).toEqual([]);
  });

  it('diagnostiziert einen Nicht-Objekt-Eintrag innerhalb eines Arrays', () => {
    const view = deriveBody({ capabilities: ['kein Objekt'] });

    expect(structuralPaths(view)).toEqual(['/component-definition/capabilities/0']);
    expect(view.capabilities).toEqual([]);
  });

  it('behandelt ein fehlendes Feld nicht als Befund', () => {
    const view = deriveBody({});

    expect(view.diagnostics).toEqual([]);
  });
});

describe('props, links, set-parameters und responsible-roles', () => {
  const component = (extra: Record<string, unknown>) => ({
    components: [
      {
        uuid: '22222222-2222-4222-8222-222222222222',
        type: 'software',
        title: 'Komponente',
        description: 'Komponente.',
        ...extra,
      },
    ],
  });

  it('diagnostiziert eine prop ohne name oder value', () => {
    const view = deriveBody(component({ props: [{ name: 'ohne-value' }, { value: 'ohne-name' }] }));

    expect(structuralPaths(view)).toEqual([
      '/component-definition/components/0/props/0',
      '/component-definition/components/0/props/1',
    ]);
    expect(view.components[0]?.props).toEqual([]);
  });

  it('diagnostiziert einen link ohne href', () => {
    const view = deriveBody(component({ links: [{ rel: 'reference' }] }));

    expect(structuralPaths(view)).toEqual(['/component-definition/components/0/links/0']);
    expect(view.components[0]?.links).toEqual([]);
  });

  it('diagnostiziert eine responsible-role ohne role-id und Nicht-String-party-uuids', () => {
    const view = deriveBody(
      component({
        'responsible-roles': [
          { remarks: 'Ohne role-id.' },
          { 'role-id': 'betrieb', 'party-uuids': ['gültig', 42] },
        ],
      }),
    );

    expect(structuralPaths(view)).toEqual([
      '/component-definition/components/0/responsible-roles/0',
      '/component-definition/components/0/responsible-roles/1/party-uuids/1',
    ]);
    expect(view.components[0]?.responsibleRoles).toEqual([
      { roleId: 'betrieb', partyUuids: ['gültig'], remarks: undefined },
    ]);
  });

  it('diagnostiziert ein set-parameter ohne param-id und Nicht-String-values', () => {
    const view = deriveBody(
      component({
        'control-implementations': [
          {
            uuid: '44444444-4444-4444-8444-444444444444',
            source: '#quelle',
            description: 'Umsetzung.',
            'set-parameters': [{ values: ['x'] }, { 'param-id': 'frist', values: [30] }],
            'implemented-requirements': [],
          },
        ],
      }),
    );

    expect(structuralPaths(view)).toEqual([
      '/component-definition/components/0/control-implementations/0/set-parameters/0',
      '/component-definition/components/0/control-implementations/0/set-parameters/1/values/0',
    ]);
    expect(view.controlImplementations[0]?.setParameters).toEqual([
      { paramId: 'frist', values: [], remarks: undefined },
    ]);
  });
});

describe('Modellspezifische Pflichtangaben', () => {
  it('diagnostiziert einen import-Eintrag ohne href', () => {
    const view = deriveBody({
      'import-component-definitions': [{ remarks: 'Ohne href.' }],
    });

    expect(structuralPaths(view)).toEqual([
      '/component-definition/import-component-definitions/0',
    ]);
    expect(view.importComponentDefinitions).toEqual([]);
  });

  it('diagnostiziert incorporates-components ohne component-uuid', () => {
    const view = deriveBody({
      capabilities: [
        {
          uuid: '88888888-8888-4888-8888-888888888888',
          name: 'verbund',
          description: 'Verbund.',
          'incorporates-components': [{ description: 'Ohne UUID.' }],
        },
      ],
    });

    expect(structuralPaths(view)).toEqual([
      '/component-definition/capabilities/0/incorporates-components/0',
    ]);
    expect(view.capabilities[0]?.incorporatesComponents).toEqual([]);
  });

  it('registriert eine fehlende uuid nicht als Dublette', () => {
    const view = deriveBody({
      components: [
        { type: 'software', title: 'Ohne UUID', description: 'Erste.' },
        { type: 'software', title: 'Auch ohne UUID', description: 'Zweite.' },
      ],
    });

    expect(
      view.diagnostics.filter(
        (diagnostic) => diagnostic.code === COMPONENT_ADAPTER_DIAGNOSTIC_CODES.DUPLICATE_UUID,
      ),
    ).toEqual([]);
  });
});
