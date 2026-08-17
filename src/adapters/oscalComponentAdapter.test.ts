// =============================================================================
// Modelladapter `component-definition` — Testvertrag (GSPP-248)
//
// Der verbindliche Korpus ist fixture-basiert: Die sechs realen BSI-Artefakte
// liegen nicht im Repository, weil weder `preview`- noch
// `blocked-by-upstream`-Einträge ausgeliefert werden. Feste Inhaltszahlen
// stehen deshalb ausschließlich hier und in den Fixtures — nie in einer
// Assertion gegen den Realkorpus (`oscalComponentDocument.node.test.ts`).
// =============================================================================

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COMPONENT_ADAPTER_DIAGNOSTIC_CODES,
  COMPONENT_ADAPTER_VALIDATOR,
  COMPONENT_DEFINITION_ROOT_TYPE,
  deriveComponentDefinition,
} from './oscalComponentAdapter';
import { parseComponentDefinitionDocument } from './oscalComponentDocument';
import type { ComponentDefinitionDocument } from './oscalComponentDocument';
import type {
  ComponentControlImplementation,
  ComponentSourceCatalogBinding,
} from '@/domain/componentDefinitionModel';
import {
  componentDefinitionRootAdapter,
  getOscalRootAdapter,
  listAdaptedOscalRootTypes,
  parseOscalDocument,
} from './oscalRootAdapters';
import { OscalRootDispatchError } from './oscalRootDispatch';
import { parseCatalogDocument } from './oscalDocument';
import type { OscalDocumentContext } from '@/domain/models';
import {
  AWS_EXTERNAL_SOURCE,
  COMPONENT_ARTIFACT_SPECS,
  COMPONENT_SOURCE_UUIDS,
  makeAllComponentDefinitionSources,
  makeComponentDefinitionSource,
  makeComponentDefinitionWithDuplicateUuids,
  makeComponentDefinitionWithSchemaDirective,
  makeComponentDefinitionWithUnpinnedVersion,
  makeComponentDefinitionWithoutComponents,
  makeRichComponentDefinitionSource,
  makeStructureProbeComponentDefinition,
} from '@/test/fixtures/componentDefinitions';
import { makeLosslessCatalogSource } from '@/test/fixtures/losslessCatalog';
import {
  arrayOrderSignature,
  containerIdentities,
  contentMultiset,
  deepFreeze,
  missingFromMultiset,
  sharedContainerPaths,
} from '@/test/oscalStructure';

const context: OscalDocumentContext = { trustClass: 'class-1-verified-public' };

function specFor(artifactKey: string) {
  const specification = COMPONENT_ARTIFACT_SPECS.find(
    (entry) => entry.artifactKey === artifactKey,
  );
  if (!specification) throw new Error(`Unbekanntes Fixture: ${artifactKey}`);
  return specification;
}

function parseArtifact(artifactKey: string): ComponentDefinitionDocument {
  const specification = specFor(artifactKey);
  return parseComponentDefinitionDocument(makeComponentDefinitionSource(specification), {
    ...context,
    upstreamPath: specification.upstreamPath,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ------------------------------------------------------------------ */
/*  Registrierung                                                      */
/* ------------------------------------------------------------------ */

describe('Adapter-Registrierung', () => {
  it('führt component-definition als adaptierten Root-Typ', () => {
    expect(listAdaptedOscalRootTypes()).toContain(COMPONENT_DEFINITION_ROOT_TYPE);
    expect(getOscalRootAdapter(COMPONENT_DEFINITION_ROOT_TYPE)).toBe(
      componentDefinitionRootAdapter,
    );
    expect(componentDefinitionRootAdapter.moduleEntryPoint).toBe(
      'src/adapters/oscalComponentAdapter.ts',
    );
  });

  it('lässt den Katalogpfad unberührt', () => {
    // Der Katalogadapter darf durch die neue Registrierung nicht anders
    // arbeiten — der Erweiterungsvertrag verspricht genau das.
    const document = parseCatalogDocument(makeLosslessCatalogSource(), {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });

    expect(document.view.totalControls).toBe(4);
  });

  it('leitet über den root-generischen Einstieg ab, statt OSCAL_ROOT_TYPE_UNSUPPORTED zu liefern', () => {
    const specification = specFor('component-keycloak');
    const result = parseOscalDocument(makeComponentDefinitionSource(specification), {
      ...context,
      upstreamPath: specification.upstreamPath,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.dispatch.rootType).toBe(COMPONENT_DEFINITION_ROOT_TYPE);
  });
});

/* ------------------------------------------------------------------ */
/*  Bestandszahlen                                                     */
/* ------------------------------------------------------------------ */

describe('Fixture-Korpus — gemessene Strukturzahlen', () => {
  const expectedCounts: Readonly<Record<string, readonly [number, number, number, number]>> = {
    // [Components, Capabilities, Control-Implementations, implemented requirements]
    'component-aws-security-hub': [2, 1, 3, 17],
    'component-ga-lotse-grundmodul': [3, 1, 0, 0],
    'component-keycloak': [3, 0, 3, 43],
    'component-lieferkette': [11, 3, 11, 145],
    'component-netzarchitektur': [9, 4, 11, 85],
    'component-passwortrichtlinie': [7, 1, 7, 17],
  };

  it.each(Object.entries(expectedCounts))(
    '%s trägt die gemessenen Zahlen',
    (artifactKey, [components, capabilities, implementations, requirements]) => {
      const { view } = parseArtifact(artifactKey);

      expect(view.components).toHaveLength(components);
      expect(view.capabilities).toHaveLength(capabilities);
      expect(view.controlImplementations).toHaveLength(implementations);
      expect(view.implementedRequirements).toHaveLength(requirements);
    },
  );

  it('summiert über alle sechs Definitionen auf 35 / 10 / 35 / 307', () => {
    const views = makeAllComponentDefinitionSources().map(({ specification, source }) =>
      parseComponentDefinitionDocument(source, {
        ...context,
        upstreamPath: specification.upstreamPath,
      }).view,
    );

    const sum = (pick: (view: (typeof views)[number]) => number) =>
      views.reduce((total, view) => total + pick(view), 0);

    expect(sum((view) => view.components.length)).toBe(35);
    expect(sum((view) => view.capabilities.length)).toBe(10);
    expect(sum((view) => view.controlImplementations.length)).toBe(35);
    expect(sum((view) => view.implementedRequirements.length)).toBe(307);
  });

  it('deckt alle im Bestand vorkommenden component.type-Werte ab', () => {
    const types = new Set(
      makeAllComponentDefinitionSources().flatMap(({ specification, source }) =>
        parseComponentDefinitionDocument(source, {
          ...context,
          upstreamPath: specification.upstreamPath,
        }).view.components.map((component) => component.type),
      ),
    );

    expect([...types].sort()).toEqual([
      'plan',
      'policy',
      'process-procedure',
      'service',
      'software',
    ]);
  });

  it('deklariert drei verschiedene OSCAL-Versionen und bindet jede an ihre eigene Zelle', () => {
    const bindings = makeAllComponentDefinitionSources().map(({ specification, source }) => {
      const document = parseComponentDefinitionDocument(source, {
        ...context,
        upstreamPath: specification.upstreamPath,
      });
      return {
        artifactKey: specification.artifactKey,
        declared: specification.oscalVersion,
        bound: document.oscalVersion,
        pinned: document.pin.oscalVersion,
      };
    });

    for (const binding of bindings) {
      expect(binding.bound, binding.artifactKey).toBe(binding.declared);
      expect(binding.pinned, binding.artifactKey).toBe(binding.declared);
    }
    expect(new Set(bindings.map((binding) => binding.bound))).toEqual(
      new Set(['1.1.2', '1.1.3', '1.2.2']),
    );
  });
});

/* ------------------------------------------------------------------ */
/*  Zulässige Leerstellen                                              */
/* ------------------------------------------------------------------ */

describe('Optionalität von components, capabilities und Implementierungen', () => {
  it('akzeptiert eine Definition ohne implemented requirements (GA-Lotse)', () => {
    const { view } = parseArtifact('component-ga-lotse-grundmodul');

    expect(view.components).toHaveLength(3);
    expect(view.implementedRequirements).toEqual([]);
    expect(view.implementationsBySource.size).toBe(0);
    expect(view.diagnostics).toEqual([]);
  });

  it('akzeptiert eine Definition ohne capabilities (Keycloak)', () => {
    const { view } = parseArtifact('component-keycloak');

    expect(view.capabilities).toEqual([]);
    expect(view.implementedRequirements).toHaveLength(43);
  });

  it('akzeptiert eine Definition ohne components', () => {
    const { view } = parseComponentDefinitionDocument(
      makeComponentDefinitionWithoutComponents(),
      context,
    );

    expect(view.components).toEqual([]);
    expect(view.capabilities).toEqual([]);
    expect(view.diagnostics).toEqual([]);
    expect(view.metadata.oscalVersion).toBe('1.2.2');
  });
});

/* ------------------------------------------------------------------ */
/*  Quellen und Referenzen                                             */
/* ------------------------------------------------------------------ */

describe('control-implementation.source als Referenzkontext', () => {
  it('verarbeitet eine Capability mit eigener control-implementation (AWS)', () => {
    const { view } = parseArtifact('component-aws-security-hub');

    const capabilityImplementations = view.capabilities.flatMap(
      (capability) => capability.controlImplementations,
    );
    expect(capabilityImplementations).toHaveLength(1);
    // Die Anforderungen der Capability-Implementierung dürfen nicht verloren
    // gehen, nur weil sie nicht unter `components` hängen.
    expect(capabilityImplementations[0]?.implementedRequirements).toHaveLength(5);
    expect(view.implementedRequirements).toHaveLength(17);
  });

  it('führt zwei verschiedene source-Werte eines Dokuments getrennt (Netzarchitektur)', () => {
    const { view } = parseArtifact('component-netzarchitektur');

    expect([...view.implementationsBySource.keys()].sort()).toEqual(
      [
        COMPONENT_SOURCE_UUIDS.netzarchitekturPrimary,
        COMPONENT_SOURCE_UUIDS.netzarchitekturSecondary,
      ].sort(),
    );
    const perSource = [...view.implementationsBySource.values()].map(
      (implementations: readonly ComponentControlImplementation[]) => implementations.length,
    );
    expect(perSource.reduce((total, count) => total + count, 0)).toBe(11);
    for (const count of perSource) expect(count).toBeGreaterThan(0);
  });

  it('hängt jede implemented requirement an die source ihrer Implementierung', () => {
    const { view } = parseArtifact('component-netzarchitektur');

    for (const requirement of view.implementedRequirements) {
      expect(requirement.source).not.toBeNull();
      expect(requirement.source?.href).toMatch(/^#/);
    }
  });

  it('klassifiziert die externe AWS-source als external, ohne sie aufzulösen', () => {
    const { view } = parseArtifact('component-aws-security-hub');

    for (const implementation of view.controlImplementations) {
      expect(implementation.source?.href).toBe(AWS_EXTERNAL_SOURCE);
      expect(implementation.source?.reference.kind).toBe('external');
    }
  });

  it('löst eine #uuid-source gegen back-matter desselben Dokuments auf', () => {
    const { view } = parseArtifact('component-passwortrichtlinie');

    const [implementation] = view.controlImplementations;
    expect(implementation?.source?.reference.kind).toBe('resource');
    expect(
      implementation?.source?.reference.kind === 'resource'
      && implementation.source.reference.resource.uuid,
    ).toBe(COMPONENT_SOURCE_UUIDS.passwortrichtlinie.slice(1));
  });

  it('diagnostiziert eine control-implementation ohne source', () => {
    const { view } = deriveDocument({
      components: [
        {
          uuid: '22222222-2222-4222-8222-222222222222',
          type: 'software',
          title: 'Ohne Quelle',
          description: 'Ohne Quelle.',
          'control-implementations': [
            {
              uuid: '44444444-4444-4444-8444-444444444444',
              description: 'Ohne Quelle.',
              'implemented-requirements': [
                {
                  uuid: '66666666-6666-4666-8666-666666666666',
                  'control-id': 'GC.1.1',
                  description: 'Erfüllt.',
                },
              ],
            },
          ],
        },
      ],
    });

    const codes = view.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain(COMPONENT_ADAPTER_DIAGNOSTIC_CODES.IMPLEMENTATION_SOURCE_MISSING);
    expect(view.controlImplementations[0]?.source).toBeNull();
    expect(view.implementedRequirements[0]?.control).toMatchObject({
      status: 'unresolved',
      reason: 'implementation-source-missing',
    });
  });
});

/** Baut ein Dokument aus einem Definitionskörper und leitet es ab. */
function deriveDocument(body: Record<string, unknown>) {
  const source = {
    'component-definition': {
      uuid: '11111111-1111-4111-8111-111111111111',
      metadata: {
        title: 'Ad-hoc-Fixture',
        'last-modified': '2026-08-17T00:00:00Z',
        version: '1',
        'oscal-version': '1.2.2',
      },
      ...body,
    },
  };
  return parseComponentDefinitionDocument(source, context);
}

/* ------------------------------------------------------------------ */
/*  control-id nur im Kontext ihrer source                             */
/* ------------------------------------------------------------------ */

describe('control-id-Auflösung', () => {
  it('hält die 17 AWS-control-ids als Diagnostics, ohne die Definition zu verwerfen', () => {
    const { view } = parseArtifact('component-aws-security-hub');

    const unresolved = view.implementedRequirements.filter(
      (requirement) => requirement.control.status === 'unresolved',
    );
    expect(unresolved).toHaveLength(17);
    for (const requirement of unresolved) {
      expect(requirement.control).toMatchObject({ reason: 'catalog-not-supplied' });
      // Die control-id bleibt lesbar — sie wird nur nicht interpretiert.
      expect(requirement.controlId).toBeDefined();
    }
    expect(
      view.diagnostics.filter(
        (diagnostic) =>
          diagnostic.code === COMPONENT_ADAPTER_DIAGNOSTIC_CODES.CONTROL_REFERENCE_UNRESOLVED,
      ),
    ).toHaveLength(17);
    expect(view.components).toHaveLength(2);
  });

  it('diagnostiziert eine fehlende control-id eigenständig', () => {
    const { view } = deriveDocument({
      components: [
        {
          uuid: '22222222-2222-4222-8222-222222222222',
          type: 'software',
          title: 'Komponente',
          description: 'Komponente.',
          'control-implementations': [
            {
              uuid: '44444444-4444-4444-8444-444444444444',
              source: '#55555555-5555-4555-8555-555555555555',
              description: 'Umsetzung.',
              'implemented-requirements': [
                { uuid: '66666666-6666-4666-8666-666666666666', description: 'Ohne control-id.' },
              ],
            },
          ],
        },
      ],
    });

    expect(view.implementedRequirements[0]?.control).toMatchObject({
      status: 'unresolved',
      reason: 'control-id-missing',
    });
    expect(view.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      COMPONENT_ADAPTER_DIAGNOSTIC_CODES.CONTROL_ID_MISSING,
    );
  });

  it('löst eine control-id nur gegen den explizit gebundenen Zielkatalog auf', () => {
    const catalog = parseCatalogDocument(makeLosslessCatalogSource(), {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    }).view;
    const source = '#55555555-5555-4555-8555-555555555555';
    const binding: ComponentSourceCatalogBinding = { catalogKey: 'gspp', catalog };
    const body = {
      uuid: '11111111-1111-4111-8111-111111111111',
      metadata: {
        title: 'Bindung',
        'last-modified': '2026-08-17T00:00:00Z',
        version: '1',
        'oscal-version': '1.2.2',
      },
      components: [
        {
          uuid: '22222222-2222-4222-8222-222222222222',
          type: 'software',
          title: 'Komponente',
          description: 'Komponente.',
          'control-implementations': [
            {
              uuid: '44444444-4444-4444-8444-444444444444',
              source,
              description: 'Umsetzung.',
              'implemented-requirements': [
                {
                  uuid: '66666666-6666-4666-8666-666666666666',
                  'control-id': 'GC.1.1.1',
                  description: 'Bekannt.',
                },
                {
                  uuid: '77777777-7777-4777-8777-777777777777',
                  'control-id': 'GC.99.99',
                  description: 'Unbekannt.',
                },
              ],
            },
          ],
        },
      ],
    };

    const withoutBinding = deriveComponentDefinition(body, context);
    expect(withoutBinding.implementedRequirements[0]?.control).toMatchObject({
      status: 'unresolved',
      reason: 'catalog-not-supplied',
    });

    const withBinding = deriveComponentDefinition(body, context, {
      catalogsBySource: new Map([[source, binding]]),
    });
    expect(withBinding.implementedRequirements[0]?.control).toMatchObject({
      status: 'resolved',
      catalogKey: 'gspp',
    });
    expect(withBinding.implementedRequirements[1]?.control).toMatchObject({
      status: 'unresolved',
      reason: 'control-not-in-catalog',
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Identitäten                                                        */
/* ------------------------------------------------------------------ */

describe('UUID-Eindeutigkeit', () => {
  it('diagnostiziert eine dokumentweit doppelte UUID am späteren Knoten', () => {
    const { view } = parseComponentDefinitionDocument(
      makeComponentDefinitionWithDuplicateUuids(),
      context,
    );

    const duplicates = view.diagnostics.filter(
      (diagnostic) => diagnostic.code === COMPONENT_ADAPTER_DIAGNOSTIC_CODES.DUPLICATE_UUID,
    );
    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.path).toBe('/component-definition/components/1/uuid');
    expect(duplicates[0]?.validator).toEqual(COMPONENT_ADAPTER_VALIDATOR);
  });

  it('prüft Components, Capabilities und implemented requirements im selben Namensraum', () => {
    const shared = '99999999-9999-4999-8999-999999999999';
    const { view } = deriveDocument({
      components: [
        {
          uuid: shared,
          type: 'software',
          title: 'Komponente',
          description: 'Komponente.',
          'control-implementations': [
            {
              uuid: '44444444-4444-4444-8444-444444444444',
              source: '#quelle',
              description: 'Umsetzung.',
              'implemented-requirements': [
                { uuid: shared, 'control-id': 'GC.1.1', description: 'Doppelt.' },
              ],
            },
          ],
        },
      ],
      capabilities: [{ uuid: shared, name: 'verbund', description: 'Verbund.' }],
    });

    const duplicates = view.diagnostics.filter(
      (diagnostic) => diagnostic.code === COMPONENT_ADAPTER_DIAGNOSTIC_CODES.DUPLICATE_UUID,
    );
    expect(duplicates.map((diagnostic) => diagnostic.path)).toEqual([
      '/component-definition/components/0/control-implementations/0/implemented-requirements/0/uuid',
      '/component-definition/capabilities/0/uuid',
    ]);
  });

  it('lässt die 307 implemented requirements des Korpus kollisionsfrei', () => {
    for (const { specification, source } of makeAllComponentDefinitionSources()) {
      const { view } = parseComponentDefinitionDocument(source, {
        ...context,
        upstreamPath: specification.upstreamPath,
      });

      expect(
        view.diagnostics.filter(
          (diagnostic) => diagnostic.code === COMPONENT_ADAPTER_DIAGNOSTIC_CODES.DUPLICATE_UUID,
        ),
        specification.artifactKey,
      ).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  Kardinalität bleibt unverändert                                    */
/* ------------------------------------------------------------------ */

describe('links als Einzelobjekt (component-lieferkette, BSI #71)', () => {
  it('gibt das Einzelobjekt unverändert zurück und normalisiert es nicht', () => {
    const specification = specFor('component-lieferkette');
    const source = makeComponentDefinitionSource(specification);
    const document = parseComponentDefinitionDocument(source, {
      ...context,
      upstreamPath: specification.upstreamPath,
    });

    const raw = source['component-definition'] as Record<string, unknown>;
    const components = raw.components as Record<string, unknown>[];
    const implementation = (components[1]!['control-implementations'] as Record<string, unknown>[])[0]!;
    const requirements = implementation['implemented-requirements'] as Record<string, unknown>[];

    for (const index of [0, 1, 2]) {
      const links = requirements[index]!.links;
      expect(Array.isArray(links), `requirement ${index}`).toBe(false);
      expect(links).toMatchObject({ href: expect.any(String) });
    }
    expect(JSON.stringify(document.source)).toBe(JSON.stringify(source));
  });

  it('weist die Kardinalitätsverletzung als Diagnose mit exaktem Pointer aus', () => {
    const { view } = parseArtifact('component-lieferkette');

    const structural = view.diagnostics.filter(
      (diagnostic) => diagnostic.code === COMPONENT_ADAPTER_DIAGNOSTIC_CODES.STRUCTURE_UNEXPECTED,
    );
    expect(structural.map((diagnostic) => diagnostic.path)).toEqual([
      '/component-definition/components/1/control-implementations/0/implemented-requirements/0/links',
      '/component-definition/components/1/control-implementations/0/implemented-requirements/1/links',
      '/component-definition/components/1/control-implementations/0/implemented-requirements/2/links',
    ]);
    // Kein Datenverlust in der Zählung: Die Anforderungen selbst bleiben da.
    expect(view.implementedRequirements).toHaveLength(145);
  });
});

/* ------------------------------------------------------------------ */
/*  Verlustfreiheit (ADR-2)                                            */
/* ------------------------------------------------------------------ */

describe('No-op-Verlustfreiheit', () => {
  const probes = [
    ['reichhaltiges Dokument', makeRichComponentDefinitionSource],
    ['Strukturprobe mit leeren Containern', makeStructureProbeComponentDefinition],
    ...COMPONENT_ARTIFACT_SPECS.map(
      (specification) =>
        [
          specification.artifactKey,
          () => makeComponentDefinitionSource(specification),
        ] as const,
    ),
  ] as const;

  it.each(probes)('%s bleibt referenzidentisch und zeichengleich', (_name, makeSource) => {
    const source = makeSource();
    const serialized = JSON.stringify(source);

    const document = parseComponentDefinitionDocument(source, context);

    expect(document.source).toBe(source);
    expect(JSON.stringify(document.source)).toBe(serialized);
  });

  it.each(probes)('%s verliert nach der Inhalts-Multiset-Regel kein Element', (_name, makeSource) => {
    const source = makeSource();
    const expected = contentMultiset(source);

    const document = parseComponentDefinitionDocument(source, context);

    expect(missingFromMultiset(expected, contentMultiset(document.source))).toEqual([]);
    expect(missingFromMultiset(contentMultiset(document.source), expected)).toEqual([]);
    expect(arrayOrderSignature(document.source)).toEqual(arrayOrderSignature(source));
  });

  it('mutiert einen eingefrorenen Quellgraphen nicht', () => {
    const source = deepFreeze(makeRichComponentDefinitionSource());

    expect(() => parseComponentDefinitionDocument(source, context)).not.toThrow();
  });

  it('teilt keinen Container zwischen view und Quellgraph', () => {
    const source = makeRichComponentDefinitionSource();

    const document = parseComponentDefinitionDocument(source, context);

    expect(sharedContainerPaths(document.view, containerIdentities(source))).toEqual([]);
  });

  it('lässt Dokument-UUID, last-modified und $schema unverändert', () => {
    const source = makeRichComponentDefinitionSource();
    const before = JSON.parse(JSON.stringify(source));

    const document = parseComponentDefinitionDocument(source, context);
    const after = document.source as typeof before;

    expect(after.$schema).toBe(before.$schema);
    expect(after['component-definition'].uuid).toBe(before['component-definition'].uuid);
    expect(after['component-definition'].metadata['last-modified']).toBe(
      before['component-definition'].metadata['last-modified'],
    );
  });

  it('erhält Felder, die die Projektion nicht kennt', () => {
    const source = makeRichComponentDefinitionSource();

    const document = parseComponentDefinitionDocument(source, context);
    const body = (document.source as Record<string, Record<string, Record<string, unknown>>>)[
      'component-definition'
    ]!;

    // `metadata.document-ids` hat keine Entsprechung in der Projektion.
    expect(body.metadata!['document-ids']).toBeDefined();
    expect(document.view.metadata).not.toHaveProperty('documentIds');
  });
});

/* ------------------------------------------------------------------ */
/*  Projektion inhaltlich                                              */
/* ------------------------------------------------------------------ */

describe('Projektion', () => {
  it('überführt Parameter, Statements, Rollen und Bemerkungen', () => {
    const { view } = parseComponentDefinitionDocument(
      makeRichComponentDefinitionSource(),
      context,
    );

    const [implementation] = view.controlImplementations;
    expect(implementation?.setParameters).toEqual([
      { paramId: 'schluessellaenge', values: ['256'], remarks: 'Vorgabe.' },
    ]);

    const [requirement] = view.implementedRequirements;
    expect(requirement?.setParameters).toEqual([
      { paramId: 'frist', values: ['30', '90'], remarks: undefined },
    ]);
    expect(requirement?.responsibleRoles).toEqual([
      { roleId: 'betrieb', partyUuids: [], remarks: undefined },
    ]);
    expect(requirement?.statements).toHaveLength(1);
    expect(requirement?.statements[0]).toMatchObject({
      statementId: 'GC.1.1_smt',
      remarks: 'Bemerkung zur Teilaussage.',
    });
    expect(requirement?.remarks).toBe('Bemerkung zur Anforderung.');
  });

  it('führt incorporates-components der Capability', () => {
    const { view } = parseComponentDefinitionDocument(
      makeRichComponentDefinitionSource(),
      context,
    );

    expect(view.capabilities[0]?.incorporatesComponents).toEqual([
      {
        componentUuid: '22222222-2222-4222-8222-222222222222',
        description: 'Bindet den Dienst ein.',
      },
    ]);
  });

  it('klassifiziert eine relative import-Referenz, ohne sie aufzulösen', () => {
    const { view } = parseComponentDefinitionDocument(
      makeRichComponentDefinitionSource(),
      context,
    );

    const [entry] = view.importComponentDefinitions;
    expect(entry?.href).toBe('../Basis/basis-component_definition.json');
    expect(entry?.reference).toMatchObject({ kind: 'unresolved', reason: 'relative' });
    expect(entry?.remarks).toBe('Relative Referenz.');
  });
});

/* ------------------------------------------------------------------ */
/*  Fail-closed                                                        */
/* ------------------------------------------------------------------ */

describe('Fail-closed-Abweisungen', () => {
  it('weist einen fremden Root ab', () => {
    expect(() => parseComponentDefinitionDocument(makeLosslessCatalogSource(), context)).toThrow(
      OscalRootDispatchError,
    );
  });

  it('weist einen Root-Type-Mismatch gegen die Registry-Erwartung ab', () => {
    const specification = specFor('component-keycloak');
    let thrown: unknown;
    try {
      parseComponentDefinitionDocument(makeLosslessCatalogSource(), {
        ...context,
        upstreamPath: specification.upstreamPath,
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(OscalRootDispatchError);
    expect((thrown as OscalRootDispatchError).diagnostic.code).toBe('OSCAL_ROOT_TYPE_MISMATCH');
    expect((thrown as OscalRootDispatchError).diagnostic.artifact.key).toBe(
      specification.artifactKey,
    );
  });

  it('weist zwei Root-Keys ab', () => {
    const source = {
      ...makeComponentDefinitionWithoutComponents(),
      ...(makeLosslessCatalogSource() as Record<string, unknown>),
    };

    expect(() => parseComponentDefinitionDocument(source, context)).toThrow(
      'OSCAL_ROOT_KEY_AMBIGUOUS',
    );
  });

  it('weist eine nicht gepinnte oscal-version ab, statt eine Nachbarversion zu wählen', () => {
    let thrown: unknown;
    try {
      parseComponentDefinitionDocument(makeComponentDefinitionWithUnpinnedVersion(), context);
    } catch (error) {
      thrown = error;
    }

    const { diagnostic } = thrown as OscalRootDispatchError;
    expect(diagnostic.code).toBe('OSCAL_ROOT_VERSION_UNSUPPORTED');
    // Die Diagnose nennt keine gewählte Zelle — es wurde keine gewählt.
    expect(diagnostic.artifact.oscalVersion).toBeNull();
  });

  it('wählt die Zelle nach metadata.oscal-version und nie nach $schema', () => {
    const matching = parseComponentDefinitionDocument(
      makeComponentDefinitionWithSchemaDirective(
        '1.2.2',
        'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-component-definition-schema.json',
      ),
      context,
    );
    expect(matching.oscalVersion).toBe('1.2.2');

    let thrown: unknown;
    try {
      parseComponentDefinitionDocument(
        // `$schema` zeigt auf 1.1.3, `metadata.oscal-version` auf 1.2.2.
        makeComponentDefinitionWithSchemaDirective(
          '1.2.2',
          'http://csrc.nist.gov/ns/oscal/1.1.3/oscal-component-definition-schema.json',
        ),
        context,
      );
    } catch (error) {
      thrown = error;
    }

    const { diagnostic } = thrown as OscalRootDispatchError;
    expect(diagnostic.code).toBe('OSCAL_SCHEMA_DIRECTIVE_CONFLICT');
    expect(diagnostic.path).toBe('/$schema');
    // Ausgewählt wurde die Zelle aus metadata.oscal-version — die Direktive
    // hat den Konflikt ausgelöst, aber nichts ausgewählt.
    expect(diagnostic.artifact.oscalVersion).toBe('1.2.2');
    expect(diagnostic.params.expected).toBe(
      'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-component-definition-schema.json',
    );
  });

  it('erhält $schema im No-op-Round-trip unverändert', () => {
    const source = makeComponentDefinitionWithSchemaDirective(
      '1.2.2',
      'http://csrc.nist.gov/ns/oscal/1.2.2/oscal-component-definition-schema.json',
    );

    const document = parseComponentDefinitionDocument(source, context);

    expect(JSON.stringify(document.source)).toBe(JSON.stringify(source));
    expect((document.source as Record<string, unknown>).$schema).toBeDefined();
  });
});

/* ------------------------------------------------------------------ */
/*  Netzwerkorakel                                                     */
/* ------------------------------------------------------------------ */

describe('Kein Netzzugriff auf irgendeinem Parse- oder Auflösungspfad', () => {
  it('parst den gesamten Korpus, während fetch, XMLHttpRequest und sendBeacon werfen', () => {
    const fetch = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    const XMLHttpRequest = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    const sendBeacon = vi.fn(() => {
      throw new Error('network access is forbidden');
    });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', XMLHttpRequest);
    vi.stubGlobal('navigator', { sendBeacon });

    const documents = [
      ...makeAllComponentDefinitionSources().map(({ specification, source }) =>
        parseComponentDefinitionDocument(source, {
          ...context,
          upstreamPath: specification.upstreamPath,
        }),
      ),
      parseComponentDefinitionDocument(makeRichComponentDefinitionSource(), context),
    ];

    expect(documents).toHaveLength(7);
    expect(fetch).not.toHaveBeenCalled();
    expect(XMLHttpRequest).not.toHaveBeenCalled();
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it('nennt in keiner Adapterdiagnose einen href-Wert', () => {
    const { view } = parseArtifact('component-aws-security-hub');

    const serialized = JSON.stringify(view.diagnostics);
    expect(serialized).not.toContain(AWS_EXTERNAL_SOURCE);
    expect(serialized).not.toContain('github.com');
  });
});
