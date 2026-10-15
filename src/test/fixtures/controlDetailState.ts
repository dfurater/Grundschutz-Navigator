import type { Catalog, CatalogState, Control, VocabularyRegistry } from '@/domain/models';
import { catalogCollectionDefaults } from '@/test/catalogState';

/** Leerer `gspp`-Katalogzustand für die Tests der Kontrolldetailansicht. */
export function createControlDetailCatalogState(
  vocabularyRegistry: VocabularyRegistry,
  overrides: Partial<CatalogState> = {},
): CatalogState {
  return {
    ...catalogCollectionDefaults(),
    catalogDocument: null,
    catalog: {
      catalogKey: 'gspp',
      uuid: 'test-catalog',
      metadata: {
        title: 'Testkatalog',
        lastModified: '2026-07-21T00:00:00Z',
        version: 'test',
        oscalVersion: '1.1.3',
        props: [],
        links: [],
        roles: [],
        parties: [],
        responsibleParties: [],
      },
      practices: [],
      controlsById: new Map(),
      controlsByAltIdentifier: new Map(),
      controls: [],
      backMatter: [],
      totalControls: 0,
    } satisfies Catalog,
    provenance: null,
    verification: null,
    vocabularyRegistry,
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
    ...overrides,
  };
}

export interface ControlSourceOptions {
  /** Ersetzt `catalog.controlsById`; ohne Angabe bleibt die leere Map. */
  readonly controlsById?: ReadonlyMap<string, Control>;
  /** OSCAL-Links der Quellkontrolle; ohne Angabe aus `control.links` abgeleitet. */
  readonly sourceLinks?: readonly Record<string, unknown>[];
  /** Back-Matter-Ressourcen des Quelldokuments; ohne Angabe fehlt `back-matter`. */
  readonly sourceResources?: readonly Record<string, unknown>[];
}

/**
 * Katalogzustand mit einem OSCAL-Quelldokument, das genau `control` unter
 * `GC` → `GC.2` enthält.
 */
export function createControlDetailCatalogStateWithSource(
  vocabularyRegistry: VocabularyRegistry,
  control: Control,
  { controlsById, sourceLinks, sourceResources }: ControlSourceOptions = {},
): CatalogState {
  const state = createControlDetailCatalogState(vocabularyRegistry);
  if (controlsById) {
    state.catalog!.controlsById = new Map(controlsById);
  }
  state.catalogDocument = {
    source: {
      catalog: {
        uuid: 'test-catalog',
        metadata: {
          title: 'Testkatalog',
          'last-modified': '2026-07-21T00:00:00Z',
          version: 'test',
          'oscal-version': '1.1.3',
        },
        groups: [{
          id: 'GC',
          title: 'Praktik',
          groups: [{
            id: 'GC.2',
            title: 'Thema',
            controls: [{
              id: control.id,
              title: control.title,
              links: sourceLinks ?? control.links.map((link) => ({
                href: link.href,
                rel: link.rel,
              })),
            }],
          }],
        }],
        'back-matter': sourceResources ? { resources: sourceResources } : undefined,
      },
    },
    context: {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    },
    view: state.catalog!,
  };
  return state;
}
