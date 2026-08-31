import { describe, expect, it, vi } from 'vitest';

import { parseOscalDocument } from '@/adapters/oscalRootAdapters';
import {
  makeMappingWithExplicitGap,
  makeMappingWithUnknownItemType,
  makeMappingWithUnknownResourceType,
} from '@/test/fixtures/mappings';
import { buildReferenceGraph } from '@/domain/referenceGraph';
import { REFERENCE_GRAPH_CODES } from '@/domain/referenceGraphModel';
import type { ReferenceGraphDocument, ReferenceGraphInput } from '@/domain/referenceGraphModel';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { ArtifactLifecycle, CatalogKey } from '@/domain/sourceRegistry';

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

type JsonObject = Record<string, unknown>;

function metadata(oscalVersion: string, links?: readonly JsonObject[]): JsonObject {
  return {
    title: 'Fixture',
    'last-modified': '2026-08-18T00:00:00Z',
    version: '1.0',
    'oscal-version': oscalVersion,
    ...(links ? { links } : {}),
  };
}

/** Nimmt den vollständigen Root-Envelope, wie ihn die Fixture-Bibliothek liefert. */
function documentFromSource(input: {
  readonly artifactKey: string;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly source: unknown;
  readonly lifecycle?: ArtifactLifecycle;
  readonly catalogKey?: CatalogKey;
}): ReferenceGraphDocument {
  const { source } = input;
  const parsed = parseOscalDocument(source, {
    trustClass: 'class-1-verified-public',
    ...(input.catalogKey ? { catalogKey: input.catalogKey } : {}),
  });
  if (!parsed.ok) {
    throw new Error(`Fixture ist nicht parsebar: ${parsed.diagnostic.code}`);
  }
  return {
    artifactKey: input.artifactKey,
    lifecycle: input.lifecycle ?? 'supported',
    rootType: input.rootType,
    oscalVersion: input.oscalVersion,
    source,
    view: parsed.view,
    ...(input.catalogKey ? { catalogKey: input.catalogKey } : {}),
  };
}

/** Bequemer Einstieg für Fixtures, die nur den Root-Körper beschreiben. */
function graphDocument(input: {
  readonly artifactKey: string;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly body: JsonObject;
  readonly lifecycle?: ArtifactLifecycle;
  readonly catalogKey?: CatalogKey;
}): ReferenceGraphDocument {
  const { body, ...rest } = input;
  return documentFromSource({ ...rest, source: { [input.rootType]: body } });
}

interface ControlFixture {
  readonly id: string;
  readonly altIdentifier?: string;
  readonly links?: readonly JsonObject[];
  readonly statementIds?: readonly string[];
}

function catalogDocument(input: {
  readonly artifactKey: string;
  readonly catalogKey: CatalogKey;
  readonly controls: readonly ControlFixture[];
  readonly oscalVersion?: string;
  readonly lifecycle?: ArtifactLifecycle;
  readonly resources?: readonly JsonObject[];
  readonly metadataLinks?: readonly JsonObject[];
  readonly uuid?: string;
}): ReferenceGraphDocument {
  const oscalVersion = input.oscalVersion ?? '1.1.3';
  return graphDocument({
    artifactKey: input.artifactKey,
    rootType: 'catalog',
    oscalVersion,
    lifecycle: input.lifecycle,
    catalogKey: input.catalogKey,
    body: {
      uuid: input.uuid ?? `11111111-1111-4111-8111-${input.artifactKey.padEnd(12, '0').slice(0, 12)}`,
      metadata: metadata(oscalVersion, input.metadataLinks),
      groups: [
        {
          id: 'GRP',
          title: 'Gruppe',
          props: [{ name: 'alt-identifier', value: `${input.artifactKey}-grp` }],
          controls: input.controls.map((control, index) => ({
            id: control.id,
            title: `Control ${control.id}`,
            props: [
              {
                name: 'alt-identifier',
                value: control.altIdentifier ?? `${input.artifactKey}-ctl-${index}`,
              },
            ],
            ...(control.links ? { links: control.links } : {}),
            ...(control.statementIds
              ? {
                parts: control.statementIds.map((statementId) => ({
                  id: statementId,
                  name: 'statement',
                  prose: 'Text',
                })),
              }
              : {}),
          })),
        },
      ],
      ...(input.resources ? { 'back-matter': { resources: input.resources } } : {}),
    },
  });
}

function mappingItem(idRef: string, type: 'control' | 'statement' = 'control'): JsonObject {
  return { type, 'id-ref': idRef };
}

function mappingDocument(input: {
  readonly artifactKey: string;
  readonly sourceResource: JsonObject;
  readonly targetResource: JsonObject;
  readonly maps: readonly JsonObject[];
  readonly lifecycle?: ArtifactLifecycle;
}): ReferenceGraphDocument {
  return graphDocument({
    artifactKey: input.artifactKey,
    rootType: 'mapping-collection',
    oscalVersion: '1.2.2',
    lifecycle: input.lifecycle,
    body: {
      uuid: '22222222-2222-4222-8222-222222222222',
      metadata: metadata('1.2.2'),
      provenance: { method: 'human' },
      mappings: [
        {
          uuid: '33333333-3333-4333-8333-333333333333',
          'source-resource': input.sourceResource,
          'target-resource': input.targetResource,
          maps: input.maps,
        },
      ],
    },
  });
}

/* ------------------------------------------------------------------ */
/*  Identität                                                          */
/* ------------------------------------------------------------------ */

describe('Knotenidentität', () => {
  it('bildet dieselbe Control-ID in zwei Katalogen als zwei Knoten ab', () => {
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({ artifactKey: 'catalog-a', catalogKey: 'gspp', controls: [{ id: 'C.1' }] }),
        catalogDocument({ artifactKey: 'catalog-b', catalogKey: 'wlan', controls: [{ id: 'C.1' }] }),
      ],
    });

    const controlNodes = graph.nodes.filter((node) => node.kind === 'control');
    expect(controlNodes).toHaveLength(2);
    expect(new Set(controlNodes.map((node) => node.documentKey))).toEqual(
      new Set(['catalog-a', 'catalog-b']),
    );
    expect(controlNodes.every((node) => node.localId === 'C.1')).toBe(true);
  });

  it('löst eine gebundene id-ref nur im gebundenen Katalog auf, nicht im anderen', () => {
    const input: ReferenceGraphInput = {
      documents: [
        catalogDocument({ artifactKey: 'catalog-a', catalogKey: 'gspp', controls: [{ id: 'C.1' }] }),
        catalogDocument({ artifactKey: 'catalog-b', catalogKey: 'wlan', controls: [{ id: 'C.2' }] }),
        mappingDocument({
          artifactKey: 'mapping-a',
          sourceResource: { type: 'catalog', href: 'a.json' },
          targetResource: { type: 'catalog', href: 'b.json' },
          maps: [
            {
              relationship: 'equivalent-to',
              sources: [mappingItem('C.1')],
              // Existiert nur in catalog-a, nicht im gebundenen catalog-b.
              targets: [mappingItem('C.1')],
            },
          ],
        }),
      ],
      bindings: [
        { href: 'a.json', artifactKey: 'catalog-a' },
        { href: 'b.json', artifactKey: 'catalog-b' },
      ],
    };

    const graph = buildReferenceGraph(input);
    const itemEdges = graph.edges.filter((edge) => edge.kind === 'mapping-item');
    expect(itemEdges.map((edge) => edge.state)).toEqual(['resolved', 'unresolvable']);
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      REFERENCE_GRAPH_CODES.targetNotFound,
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Vier Zustände                                                      */
/* ------------------------------------------------------------------ */

describe('Semantikorakel — vier Zustände nebeneinander', () => {
  const documents = [
    catalogDocument({
      artifactKey: 'catalog-a',
      catalogKey: 'gspp',
      controls: [{ id: 'C.1' }, { id: 'C.2' }, { id: 'C.3' }],
    }),
    mappingDocument({
      artifactKey: 'mapping-bound',
      sourceResource: { type: 'catalog', href: 'a.json' },
      targetResource: { type: 'catalog', href: 'a.json' },
      maps: [
        {
          relationship: 'equivalent-to',
          sources: [mappingItem('C.1')],
          targets: [mappingItem('C.2')],
        },
        {
          relationship: 'no-relationship',
          sources: [mappingItem('C.1')],
          targets: [mappingItem('C.3')],
        },
      ],
    }),
    mappingDocument({
      artifactKey: 'mapping-relative',
      sourceResource: { type: 'catalog', href: 'nicht-gebunden.json' },
      targetResource: { type: 'catalog', href: 'nicht-gebunden.json' },
      maps: [
        {
          relationship: 'equivalent-to',
          sources: [mappingItem('C.1')],
          targets: [mappingItem('C.99')],
        },
      ],
    }),
  ];

  const graph = buildReferenceGraph({
    documents,
    bindings: [{ href: 'a.json', artifactKey: 'catalog-a' }],
  });

  it('führt aufgelöste, nicht bewertbare und fachliche Lückenaussage getrennt', () => {
    const itemEdges = graph.edges.filter((edge) => edge.kind === 'mapping-item');
    expect(itemEdges.filter((edge) => edge.state === 'resolved')).toHaveLength(2);
    expect(itemEdges.filter((edge) => edge.state === 'not-evaluable')).toHaveLength(2);
    expect(graph.gapAssertions).toHaveLength(1);
  });

  it('erzeugt für no-relationship keinen Referenzfehler-Diagnostic', () => {
    expect(graph.diagnostics).toHaveLength(0);
    expect(graph.edges.some((edge) => edge.state === 'unresolvable')).toBe(false);
  });

  it('macht „kein Eintrag" als Abwesenheit sichtbar, nicht als Befund', () => {
    // Zu `C.2` als Quelle sagt das Fixture nichts. Es gibt dazu weder eine
    // Kante noch eine Lückenaussage — „unbekannt" ist kein Zustand des Graphen.
    const sourceIds = graph.edges
      .filter((edge) => edge.kind === 'mapping-item' && edge.state === 'resolved')
      .map((edge) => (edge.state === 'resolved' ? edge.to.localId : null));
    expect(sourceIds).toEqual(['C.1', 'C.2']);
  });
});

/* ------------------------------------------------------------------ */
/*  Keine heuristische Auflösung                                       */
/* ------------------------------------------------------------------ */

describe('Nicht bewertbare Ziele', () => {
  const isoCatalogUuid = '2ccce1d6-de9f-481f-b56f-6134b3cb4fb0';

  function itgsLikeGraph(withTargetCatalog: boolean) {
    const documents = [
      ...(withTargetCatalog
        ? [
          catalogDocument({
            artifactKey: 'catalog-mindeststandard-tls',
            catalogKey: 'mindeststandard-tls',
            controls: [{ id: 'A.5.1' }],
            uuid: isoCatalogUuid,
          }),
        ]
        : []),
      mappingDocument({
        artifactKey: 'mapping-iso',
        lifecycle: 'blocked-by-upstream',
        sourceResource: { type: 'catalog', href: 'ISO27001-AnnexA-catalog.json' },
        targetResource: {
          type: 'catalog',
          href: 'ISO27001-AnnexA-catalog.json',
          // Das reale ITGS-Muster: ein Fremd-Namespace-`prop`, das wie ein
          // bequemer Auflösungsweg aussieht und keiner ist.
          props: [
            {
              name: 'catalog_uuid',
              ns: 'https://github.com/gsmap/pre-mapping-tool-baustein-to-oscal/ns/oscal-export',
              value: isoCatalogUuid,
            },
          ],
        },
        maps: [
          {
            relationship: 'equivalent-to',
            sources: [mappingItem('A.5.1')],
            targets: [mappingItem('A.5.1')],
          },
        ],
      }),
    ];
    return buildReferenceGraph({ documents });
  }

  it('bewertet eine relative Ressourcenreferenz nicht und meldet keinen Referenzfehler', () => {
    const graph = itgsLikeGraph(false);
    const resourceEdges = graph.edges.filter((edge) => edge.kind === 'mapping-resource');
    expect(resourceEdges.every((edge) => edge.state === 'not-evaluable')).toBe(true);
    expect(
      resourceEdges.every((edge) => edge.state === 'not-evaluable' && edge.reason === 'relative'),
    ).toBe(true);
    expect(graph.edges.filter((edge) => edge.kind === 'mapping-item')).toHaveLength(2);
    expect(
      graph.edges
        .filter((edge) => edge.kind === 'mapping-item')
        .every((edge) => edge.state === 'not-evaluable'),
    ).toBe(true);
    expect(graph.diagnostics).toHaveLength(0);
  });

  it('zieht das catalog_uuid-prop im Fremd-Namespace nicht zur Auflösung heran', () => {
    const withCatalog = itgsLikeGraph(true);
    const withoutCatalog = itgsLikeGraph(false);

    const states = (graph: ReturnType<typeof buildReferenceGraph>) =>
      graph.edges
        .filter((edge) => edge.from.documentKey === 'mapping-iso')
        .map((edge) => edge.state);

    // Die Klassifikation ist invariant dagegen, ob das benannte Zielartefakt
    // geladen, gesperrt oder ganz aus dem Tree entfernt ist.
    expect(states(withCatalog)).toEqual(states(withoutCatalog));
    expect(withCatalog.diagnostics).toHaveLength(0);
  });

  it('lässt ein nicht übergebenes gesperrtes Artefakt weder Knoten noch Abbruch erzeugen', () => {
    const graph = itgsLikeGraph(false);
    expect(graph.artifacts.map((artifact) => artifact.artifactKey)).toEqual(['mapping-iso']);
    expect(graph.nodes.some((node) => node.documentKey === 'catalog-mindeststandard-tls')).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Component Definitions                                              */
/* ------------------------------------------------------------------ */

describe('Component Definitions', () => {
  const externalSource =
    'https://github.com/BSI-Bund/Grundschutz-PlusPlus/blob/main/control_layer/Grundschutz%2B%2B/sources/catalogs/Kernel/BSI-Stand-der-Technik-Kernel-G0-catalog.json';

  function implementation(uuid: string, controlIds: readonly string[]): JsonObject {
    return {
      uuid,
      source: externalSource,
      description: 'Implementierung',
      'implemented-requirements': controlIds.map((controlId, index) => ({
        uuid: `${uuid.slice(0, 30)}${index.toString().padStart(6, '0')}`.slice(0, 36),
        'control-id': controlId,
        description: 'Anforderung',
      })),
    };
  }

  const componentDocument = graphDocument({
    artifactKey: 'component-aws-security-hub',
    rootType: 'component-definition',
    oscalVersion: '1.1.3',
    lifecycle: 'preview',
    body: {
      uuid: '44444444-4444-4444-8444-444444444444',
      metadata: metadata('1.1.3'),
      components: [
        {
          uuid: '55555555-5555-4555-8555-555555555551',
          type: 'service',
          title: 'AWS Security Hub',
          description: 'Komponente',
          'control-implementations': [
            implementation('66666666-6666-4666-8666-666666666661', [
              'GC.1.1', 'GC.1.2', 'GC.1.3', 'GC.1.4', 'GC.1.5', 'GC.1.6', 'GC.1.7',
              'GC.1.8', 'GC.1.9', 'GC.1.10', 'GC.1.11', 'GC.1.12', 'GC.1.13',
            ]),
          ],
        },
        {
          uuid: '55555555-5555-4555-8555-555555555552',
          type: 'service',
          title: 'AWS Config',
          description: 'Komponente',
          'control-implementations': [
            implementation('66666666-6666-4666-8666-666666666662', ['GC.2.1', 'GC.2.2']),
          ],
        },
      ],
      capabilities: [
        {
          uuid: '77777777-7777-4777-8777-777777777771',
          name: 'Sicherheitsueberwachung',
          description: 'Capability mit eigener control-implementation',
          'control-implementations': [
            implementation('66666666-6666-4666-8666-666666666663', ['GC.3.1', 'GC.3.2']),
          ],
        },
      ],
    },
  });

  const graph = buildReferenceGraph({ documents: [componentDocument] });

  it('meldet je control-implementation.source genau einen Befund „extern, nicht versionsstabil"', () => {
    // Der reale AWS-Bestand am Snapshot 8213e3a0: drei
    // `control-implementation.source`-Vorkommen mit **einem** Wert, 17
    // `implemented-requirements`. Der Befund hängt am Pointer der Quelle —
    // drei Fundstellen, nicht 17 nicht gefundene IDs.
    const sourceEdges = graph.edges.filter((edge) => edge.kind === 'component-source');
    expect(sourceEdges).toHaveLength(3);
    expect(sourceEdges.every((edge) => edge.state === 'not-evaluable')).toBe(true);

    const externalDiagnostics = graph.diagnostics.filter(
      (diagnostic) => diagnostic.code === REFERENCE_GRAPH_CODES.externalContextUnpinned,
    );
    expect(externalDiagnostics).toHaveLength(sourceEdges.length);
    expect(new Set(externalDiagnostics.map((diagnostic) => diagnostic.path)).size).toBe(3);
    expect(
      graph.diagnostics.some(
        (diagnostic) => diagnostic.code === REFERENCE_GRAPH_CODES.targetNotFound,
      ),
    ).toBe(false);
  });

  it('zählt implemented requirements aus components und capabilities', () => {
    const controlEdges = graph.edges.filter((edge) => edge.kind === 'component-control');
    expect(controlEdges).toHaveLength(17);
    expect(controlEdges.every((edge) => edge.state === 'not-evaluable')).toBe(true);

    const capabilityEdges = controlEdges.filter((edge) => edge.from.kind === 'capability');
    expect(capabilityEdges).toHaveLength(2);
  });

  it('löst control-ids im gebundenen Katalogkontext auf', () => {
    const bound = graphDocument({
      artifactKey: 'component-bound',
      rootType: 'component-definition',
      oscalVersion: '1.1.3',
      body: {
        uuid: '88888888-8888-4888-8888-888888888888',
        metadata: metadata('1.1.3'),
        components: [
          {
            uuid: '99999999-9999-4999-8999-999999999991',
            type: 'service',
            title: 'Komponente',
            description: 'Komponente',
            'control-implementations': [
              {
                uuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
                source: 'kernel.json',
                description: 'Implementierung',
                'implemented-requirements': [
                  {
                    uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
                    'control-id': 'C.1',
                    description: 'vorhanden',
                  },
                  {
                    uuid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
                    'control-id': 'C.99',
                    description: 'fehlt',
                  },
                ],
              },
            ],
          },
        ],
      },
    });

    const boundGraph = buildReferenceGraph({
      documents: [
        catalogDocument({ artifactKey: 'catalog-a', catalogKey: 'gspp', controls: [{ id: 'C.1' }] }),
        bound,
      ],
      bindings: [{ href: 'kernel.json', artifactKey: 'catalog-a' }],
    });

    const controlEdges = boundGraph.edges.filter((edge) => edge.kind === 'component-control');
    expect(controlEdges.map((edge) => edge.state)).toEqual(['resolved', 'unresolvable']);
    expect(boundGraph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      REFERENCE_GRAPH_CODES.targetNotFound,
    ]);
  });
});

/* ------------------------------------------------------------------ */
/*  Dokumentinterne Referenzen                                         */
/* ------------------------------------------------------------------ */

describe('Dokumentinterne Katalogreferenzen', () => {
  it('löst #<control-id> im eigenen Katalog auf und meldet eine unbekannte ID', () => {
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({
          artifactKey: 'catalog-a',
          catalogKey: 'gspp',
          controls: [
            { id: 'C.1', links: [{ href: '#C.2', rel: 'related' }, { href: '#C.99', rel: 'related' }] },
            { id: 'C.2' },
          ],
        }),
      ],
    });

    const edges = graph.edges.filter((edge) => edge.kind === 'document-internal');
    expect(edges.map((edge) => edge.state)).toEqual(['resolved', 'unresolvable']);
    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      REFERENCE_GRAPH_CODES.targetNotFound,
    ]);
  });

  it('behandelt eine back-matter-Ressource mit nur uuid als aufgelöst', () => {
    const resourceUuid = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({
          artifactKey: 'catalog-a',
          catalogKey: 'gspp',
          controls: [{ id: 'C.1', links: [{ href: `#${resourceUuid}`, rel: 'reference' }] }],
          resources: [{ uuid: resourceUuid }],
        }),
      ],
    });

    expect(graph.diagnostics).toHaveLength(0);
    const edge = graph.edges.find((candidate) => candidate.kind === 'document-internal');
    expect(edge?.state).toBe('resolved');
    expect(graph.nodes.some((node) => node.kind === 'resource' && node.localId === resourceUuid))
      .toBe(true);
  });

  it('meldet eine doppelt vergebene Control-ID und macht ihr Ziel mehrdeutig', () => {
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({
          artifactKey: 'catalog-a',
          catalogKey: 'gspp',
          controls: [
            { id: 'C.1', altIdentifier: 'alt-1' },
            { id: 'C.1', altIdentifier: 'alt-2' },
            { id: 'C.2', altIdentifier: 'alt-3', links: [{ href: '#C.1', rel: 'related' }] },
          ],
        }),
      ],
    });

    const codes = graph.diagnostics.map((diagnostic) => diagnostic.code);
    expect(codes).toContain(REFERENCE_GRAPH_CODES.duplicateNodeId);
    expect(graph.nodes.filter((node) => node.kind === 'control')).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Profile                                                            */
/* ------------------------------------------------------------------ */

describe('Profile', () => {
  function profileDocument(input: {
    readonly artifactKey: string;
    readonly imports: readonly JsonObject[];
    readonly oscalVersion?: string;
  }): ReferenceGraphDocument {
    const oscalVersion = input.oscalVersion ?? '1.1.3';
    return graphDocument({
      artifactKey: input.artifactKey,
      rootType: 'profile',
      oscalVersion,
      body: {
        uuid: `dddddddd-dddd-4ddd-8ddd-${input.artifactKey.padEnd(12, '0').slice(0, 12)}`,
        metadata: metadata(oscalVersion),
        imports: input.imports,
      },
    });
  }

  it('prüft with-ids im importierten Katalogkontext', () => {
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({ artifactKey: 'catalog-a', catalogKey: 'gspp', controls: [{ id: 'C.1' }] }),
        profileDocument({
          artifactKey: 'profile-a',
          imports: [
            {
              href: 'a.json',
              'include-controls': [{ 'with-ids': ['C.1', 'C.99'] }],
            },
          ],
        }),
      ],
      bindings: [{ href: 'a.json', artifactKey: 'catalog-a' }],
    });

    const selectionEdges = graph.edges.filter((edge) => edge.kind === 'profile-selection');
    expect(selectionEdges.map((edge) => edge.state)).toEqual(['resolved', 'unresolvable']);
    expect(graph.edges.filter((edge) => edge.kind === 'profile-import')[0]?.state).toBe('resolved');
  });

  it('meldet einen Root-Typ-Konflikt beim Import', () => {
    const graph = buildReferenceGraph({
      documents: [
        mappingDocument({
          artifactKey: 'mapping-a',
          sourceResource: { type: 'catalog', href: 'x.json' },
          targetResource: { type: 'catalog', href: 'y.json' },
          maps: [],
        }),
        profileDocument({
          artifactKey: 'profile-a',
          imports: [{ href: 'mapping.json', 'include-all': {} }],
        }),
      ],
      bindings: [{ href: 'mapping.json', artifactKey: 'mapping-a' }],
    });

    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      REFERENCE_GRAPH_CODES.rootTypeMismatch,
    );
  });

  it('hält einen Import auf eine dokumentinterne Ressource für keinen Zyklus', () => {
    // Der Regelfall in den BSI-Profilen: `imports[].href` zeigt als `#uuid` auf
    // eine eigene back-matter-Ressource. Ziel und Quelle liegen im selben
    // Artefakt — das ist keine geschlossene Importkette.
    const resourceUuid = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
    const graph = buildReferenceGraph({
      documents: [
        graphDocument({
          artifactKey: 'profile-a',
          rootType: 'profile',
          oscalVersion: '1.1.3',
          body: {
            uuid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
            metadata: metadata('1.1.3'),
            imports: [{ href: `#${resourceUuid}`, 'include-all': {} }],
            'back-matter': { resources: [{ uuid: resourceUuid }] },
          },
        }),
      ],
    });

    expect(graph.diagnostics).toHaveLength(0);
    expect(graph.edges.filter((edge) => edge.kind === 'profile-import')[0]?.state).toBe('resolved');
  });

  it('erkennt einen Zyklus in der Profilkette und terminiert', () => {
    const graph = buildReferenceGraph({
      documents: [
        profileDocument({
          artifactKey: 'profile-a',
          imports: [{ href: 'b.json', 'include-all': {} }],
        }),
        profileDocument({
          artifactKey: 'profile-b',
          imports: [{ href: 'a.json', 'include-all': {} }],
        }),
      ],
      bindings: [
        { href: 'a.json', artifactKey: 'profile-a' },
        { href: 'b.json', artifactKey: 'profile-b' },
      ],
    });

    expect(
      graph.diagnostics.filter(
        (diagnostic) => diagnostic.code === REFERENCE_GRAPH_CODES.importCycle,
      ),
    ).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Vokabulare                                                         */
/* ------------------------------------------------------------------ */

describe('Vokabulare der Mapping-Kanten', () => {
  function mappingFromFixture(source: unknown): ReferenceGraphDocument {
    return documentFromSource({
      artifactKey: 'mapping-a',
      rootType: 'mapping-collection',
      oscalVersion: '1.2.2',
      source,
    });
  }

  it('meldet einen mapping-item.type außerhalb von control/statement', () => {
    const graph = buildReferenceGraph({
      documents: [mappingFromFixture(makeMappingWithUnknownItemType())],
    });

    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      REFERENCE_GRAPH_CODES.itemTypeUnsupported,
    ]);
  });

  it('meldet einen mapping-resource-reference.type außerhalb von catalog/profile', () => {
    const graph = buildReferenceGraph({
      documents: [mappingFromFixture(makeMappingWithUnknownResourceType())],
    });

    expect(graph.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      REFERENCE_GRAPH_CODES.resourceTypeUnsupported,
    ]);
  });

  it('führt die explizite Lücke des Bestandsfixtures als Aussage, nicht als Kante', () => {
    const graph = buildReferenceGraph({
      documents: [mappingFromFixture(makeMappingWithExplicitGap())],
    });

    // Das Fixture führt beide Einträge nebeneinander: eine erklärte Lücke und
    // eine echte Beziehung. Nur die Beziehung erzeugt Kanten.
    expect(graph.gapAssertions).toHaveLength(1);
    expect(graph.edges.filter((edge) => edge.kind === 'mapping-item')).toHaveLength(2);
    expect(graph.diagnostics).toHaveLength(0);
  });

  it('löst eine statement-id-ref im gebundenen Katalogkontext auf', () => {
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({
          artifactKey: 'catalog-a',
          catalogKey: 'gspp',
          controls: [{ id: 'C.1', statementIds: ['C.1_smt'] }],
        }),
        mappingDocument({
          artifactKey: 'mapping-a',
          sourceResource: { type: 'catalog', href: 'a.json' },
          targetResource: { type: 'catalog', href: 'a.json' },
          maps: [
            {
              relationship: 'equivalent-to',
              sources: [mappingItem('C.1_smt', 'statement')],
              targets: [mappingItem('C.1')],
            },
          ],
        }),
      ],
      bindings: [{ href: 'a.json', artifactKey: 'catalog-a' }],
    });

    expect(graph.diagnostics).toHaveLength(0);
    expect(
      graph.edges.filter((edge) => edge.kind === 'mapping-item').map((edge) => edge.state),
    ).toEqual(['resolved', 'resolved']);
  });
});

/* ------------------------------------------------------------------ */
/*  Versionsspreizung, Redaction, Isolation                            */
/* ------------------------------------------------------------------ */

describe('Vertragsinvarianten', () => {
  it('verarbeitet Artefakte verschiedener deklarierter oscal-version ohne gemeinsame Annahme', () => {
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({
          artifactKey: 'catalog-a',
          catalogKey: 'gspp',
          controls: [{ id: 'C.1' }],
          oscalVersion: '1.1.3',
        }),
        mappingDocument({
          artifactKey: 'mapping-a',
          sourceResource: { type: 'catalog', href: 'a.json' },
          targetResource: { type: 'catalog', href: 'a.json' },
          maps: [],
        }),
      ],
    });

    expect(new Set(graph.nodes.map((node) => node.oscalVersion))).toEqual(
      new Set(['1.1.3', '1.2.2']),
    );
    expect(graph.artifacts.map((artifact) => artifact.oscalVersion).sort()).toEqual([
      '1.1.3',
      '1.2.2',
    ]);
  });

  it('erzeugt alle Diagnosen über das gemeinsame Modell mit stage reference', () => {
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({
          artifactKey: 'catalog-a',
          catalogKey: 'gspp',
          controls: [{ id: 'C.1', links: [{ href: '#C.99', rel: 'related' }] }],
        }),
      ],
    });

    expect(graph.diagnostics).not.toHaveLength(0);
    for (const diagnostic of graph.diagnostics) {
      expect(diagnostic.stage).toBe('reference');
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.validator).toEqual({ name: 'reference-graph', version: '1' });
      expect(diagnostic.signature).toBe(
        `reference-graph@1|${diagnostic.code}|${diagnostic.path}`,
      );
    }
  });

  it('trägt weder href-Werte noch IDs noch Dokumentinhalt in eine Diagnose', () => {
    const secretHref = 'https://example.invalid/geheimer-pfad/streng-vertraulich.json';
    const graph = buildReferenceGraph({
      documents: [
        catalogDocument({
          artifactKey: 'catalog-a',
          catalogKey: 'gspp',
          controls: [
            { id: 'GEHEIME.CONTROL.ID', links: [{ href: '#NICHT.VORHANDEN', rel: 'related' }] },
          ],
        }),
        graphDocument({
          artifactKey: 'component-a',
          rootType: 'component-definition',
          oscalVersion: '1.1.3',
          body: {
            uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
            metadata: metadata('1.1.3'),
            components: [
              {
                uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
                type: 'service',
                title: 'Komponente',
                description: 'Komponente',
                'control-implementations': [
                  {
                    uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3',
                    source: secretHref,
                    description: 'Implementierung',
                    'implemented-requirements': [
                      {
                        uuid: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee4',
                        'control-id': 'GEHEIME.CONTROL.ID',
                        description: 'Anforderung',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }),
      ],
    });

    expect(graph.diagnostics.length).toBeGreaterThan(1);
    const serialized = JSON.stringify(graph.diagnostics);
    for (const forbidden of [
      secretHref,
      'example.invalid',
      'GEHEIME.CONTROL.ID',
      'NICHT.VORHANDEN',
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('löst während der Auswertung keinen Netzwerkzugriff aus', () => {
    const failing = vi.fn(() => {
      throw new Error('Netzwerkzugriff während der Referenzauswertung');
    });
    const scope = globalThis as unknown as Record<string, unknown>;
    const original = {
      fetch: scope.fetch,
      XMLHttpRequest: scope.XMLHttpRequest,
      navigator: scope.navigator,
    };
    scope.fetch = failing;
    scope.XMLHttpRequest = failing;
    Object.defineProperty(scope, 'navigator', {
      configurable: true,
      value: { sendBeacon: failing },
    });

    try {
      const graph = buildReferenceGraph({
        documents: [
          catalogDocument({
            artifactKey: 'catalog-a',
            catalogKey: 'gspp',
            controls: [
              { id: 'C.1', links: [{ href: 'https://example.invalid/extern.json', rel: 'reference' }] },
            ],
          }),
        ],
      });
      expect(graph.edges).not.toHaveLength(0);
    } finally {
      scope.fetch = original.fetch;
      scope.XMLHttpRequest = original.XMLHttpRequest;
      Object.defineProperty(scope, 'navigator', {
        configurable: true,
        value: original.navigator,
      });
    }

    expect(failing).not.toHaveBeenCalled();
  });
});
