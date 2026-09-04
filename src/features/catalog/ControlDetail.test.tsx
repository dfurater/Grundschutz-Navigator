import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Catalog, CatalogState, Control, ControlLink } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import { useCatalog } from '@/hooks/useCatalog';
import {
  createTestVocabularyRegistry,
  VOCABULARY_IDENTIFIERS,
} from '@/test/fixtures/vocabulary';
import { ControlDetail, getControlDetailUrl } from './ControlDetail';
import { catalogCollectionDefaults } from '@/test/catalogState';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const vocabularyRegistry = createTestVocabularyRegistry();
const originalClipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function setClipboard(writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();

  if (originalClipboardDescriptor) {
    Object.defineProperty(navigator, 'clipboard', originalClipboardDescriptor);
  } else {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.2.2',
    altIdentifier: 'alt-gc-2-2',
    title: 'Kontrolle mit Verweisen',
    groupId: 'GC.2',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Diese Kontrolle steht mit anderen in Beziehung.',
    statementRaw: 'Diese Kontrolle steht mit anderen in Beziehung.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

function makeControlLink(
  targetId: string,
  rel: 'required' | 'related' = 'related',
): ControlLink {
  return {
    targetId,
    href: `#${targetId}`,
    rel,
    relStatus: 'custom',
  };
}

function makeIncomingLink(
  control: Control,
  rel: 'required' | 'related',
): IncomingControlLink {
  return { control, link: makeControlLink(control.id, rel) };
}

function makeCatalogState(overrides: Partial<CatalogState> = {}): CatalogState {
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

function makeCatalogStateWithControlSource(
  control: Control,
  controlsById?: ReadonlyMap<string, Control>,
  sourceLinks?: readonly Record<string, unknown>[],
  sourceResources?: readonly Record<string, unknown>[],
): CatalogState {
  const state = makeCatalogState();
  const sourceControlsById = controlsById ?? new Map(
    control.links.map((link) => [
      link.targetId,
      makeControl({ id: link.targetId, title: link.targetId }),
    ]),
  );
  state.catalog!.controlsById = new Map(sourceControlsById);
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

/**
 * Rendert die Detailansicht mit einer Praktik, die per UUID an das Vokabular
 * gejoint ist. Beide Breadcrumb-Tests unterscheiden sich nur im Praktik-Titel.
 */
function renderWithJoinedPractice(practiceTitle: string) {
  const user = userEvent.setup();
  const state = makeCatalogState();
  state.catalog!.practices = [{
    id: 'GC',
    title: practiceTitle,
    label: 'GC',
    altIdentifier: VOCABULARY_IDENTIFIERS.practiceGC,
    topics: [{
      id: 'GC.2',
      title: 'Organisation',
      label: '2',
      altIdentifier: VOCABULARY_IDENTIFIERS.topicOrganisation,
      practiceId: 'GC',
      controlCount: 1,
      controlIds: ['GC.2.2'],
    }],
    controlCount: 1,
  }];
  mockedUseCatalog.mockReturnValue(state);

  render(
    <MemoryRouter>
      <ControlDetail control={makeControl()} onClose={vi.fn()} />
    </MemoryRouter>,
  );

  return user;
}

describe('ControlDetail', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseCatalog.mockReturnValue(makeCatalogState());
  });

  it('opens inline vocabulary cards for badges, tags, metadata values, and target categories', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: {
        name: 'modal_verb',
        value: 'MUSS',
        ns: 'https://example.com/namespaces/modal_verbs.csv',
      },
      tags: ['Governance'],
      tagsProp: {
        name: 'tags',
        value: 'Governance',
        ns: 'https://example.com/namespaces/tags.csv',
      },
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: {
          name: 'result',
          value: 'Verfahren und Regelungen',
          ns: 'https://example.com/namespaces/result.csv',
        },
        dokumentation: 'Richtlinie A',
        dokumentationProp: {
          name: 'documentation',
          value: 'Richtlinie A',
          ns: 'https://example.com/namespaces/documentation_guidelines.csv',
        },
        zielobjektKategorien: ['Server'],
        zielobjektKategorienProp: {
          name: 'target_object_categories',
          value: 'Server',
          ns: 'https://example.com/namespaces/target_object_categories.csv',
        },
      },
    });
    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'MUSS' }));
    const vocabularyDefinition = screen.getByText('Modalverb definiert verbindliche Anforderungen.');
    expect(vocabularyDefinition).toBeInTheDocument();
    expect(vocabularyDefinition).not.toHaveClass('max-w-prose');
    expect(screen.getByRole('link', { name: 'Zu den Vokabularen →' })).toHaveAttribute(
      'href',
      '/vokabular/modal-verbs?wert=MUSS',
    );

    await user.click(screen.getByRole('button', { name: 'Tag: Governance' }));
    expect(screen.getByText('Governance-Definition.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Verfahren und Regelungen' }));
    expect(screen.getByText('Offizielles Ergebnis für Richtlinien und Prozesse.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Richtlinie A' }));
    expect(screen.getByText('Dokumentation muss nachvollziehbar gepflegt werden.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Zielobjekt: Server' }));
    expect(screen.getByText('Server sind Zielobjekte mit zentralen IT-Diensten.')).toBeInTheDocument();
  });

  it('shows the practice identifier in the breadcrumb card and keeps curated fields hidden', async () => {
    const user = renderWithJoinedPractice('Governance und Compliance');

    const practice = screen.getByRole('button', {
      name: 'Praktik: Governance und Compliance',
    });
    expect(practice).toHaveAttribute('aria-expanded', 'false');

    await user.click(practice);

    const practiceCard = document.getElementById('vocab-card-practice')!;
    expect(screen.getByText('Offizielle Praktik-Definition.')).toBeInTheDocument();
    expect(screen.getByText('Methodik')).toBeInTheDocument();
    expect(screen.getByText('Corporate Governance')).toBeInTheDocument();
    // GSPP-380: Die Kennung gehört zum Eintrag und wird gezeigt; kuratiert
    // ausgeblendet bleibt nur die Nummerierung.
    expect(within(practiceCard).getByText('UUID').tagName).toBe('DT');
    expect(within(practiceCard).getByText(VOCABULARY_IDENTIFIERS.practiceGC))
      .toBeInTheDocument();
    expect(screen.queryByText('Nummerierung')).not.toBeInTheDocument();
    // GSPP-301: Der offizielle Begriff steht bereits im Breadcrumb.
    expect(within(practiceCard).queryByText('Begriff')).not.toBeInTheDocument();
    expect(within(practiceCard).getByText('Schwerpunkt').tagName).toBe('DT');
    expect(within(practiceCard).getByRole('link', { name: 'Zu den Vokabularen →' }))
      .toHaveAttribute('href', '/vokabular/documentation-namespaces-practices?wert=GC');

    const topic = screen.getByRole('button', { name: 'Thema: Organisation' });
    await user.click(topic);

    expect(screen.getByText('Offizielle Themen-Definition.')).toBeInTheDocument();
    expect(practice).toHaveAttribute('aria-expanded', 'false');
    expect(topic).toHaveAttribute('aria-expanded', 'true');
    const topicCard = document.getElementById('vocab-card-topic')!;
    expect(within(topicCard).getByText(VOCABULARY_IDENTIFIERS.topicOrganisation))
      .toBeInTheDocument();
  });

  it('keeps the practice term visible when it differs from the breadcrumb name', async () => {
    const user = renderWithJoinedPractice('Governance & Compliance (Katalogtitel)');

    await user.click(screen.getByRole('button', {
      name: 'Praktik: Governance & Compliance (Katalogtitel)',
    }));

    const practiceCard = document.getElementById('vocab-card-practice')!;
    expect(within(practiceCard).getByText('Begriff').tagName).toBe('DT');
    expect(within(practiceCard).getByText('Governance und Compliance')).toBeInTheDocument();
    expect(within(practiceCard).getByText(VOCABULARY_IDENTIFIERS.practiceGC))
      .toBeInTheDocument();
    expect(within(practiceCard).queryByText('Nummerierung')).not.toBeInTheDocument();
  });

  it('hides the redundant term but shows the identifier inside an expanded threat card', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      threats: ['G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    }));

    const threatCard = document.getElementById('vocab-card-threat-G-0-18-0')!;
    expect(within(threatCard).getByText('Fehlplanung oder fehlende Anpassung von Prozessen.'))
      .toBeInTheDocument();
    expect(within(threatCard).queryByText('Begriff')).not.toBeInTheDocument();
    expect(within(threatCard).getByText('uuid').tagName).toBe('DT');
    expect(within(threatCard).getByText(VOCABULARY_IDENTIFIERS.threatG018))
      .toBeInTheDocument();
    expect(within(threatCard).getByRole('link', { name: 'Zu den Vokabularen →' }))
      .toHaveAttribute('href', '/vokabular/basethreats?wert=G%200.18');
  });

  it('falls back to the plain ID when a resolved threat has no term', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      threats: ['G 0.20'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.20',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const trigger = screen.getByRole('button', { name: 'Elementare Gefährdung: G 0.20' });
    expect(trigger).toHaveTextContent('G 0.20');
    await user.click(trigger);

    const threatCard = document.getElementById('vocab-card-threat-G-0-20-0')!;
    expect(within(threatCard).getByText('Gefährdung ohne hinterlegten Begriff.'))
      .toBeInTheDocument();
    expect(within(threatCard).getByText(VOCABULARY_IDENTIFIERS.threatG020))
      .toBeInTheDocument();
  });

  it('shows a diagnostic for a catalog topic without an official CSV definition', () => {
    const state = makeCatalogState();
    state.catalog!.practices = [{
      id: 'GC',
      title: 'Governance und Compliance',
      label: 'GC',
      altIdentifier: VOCABULARY_IDENTIFIERS.practiceGC,
      topics: [{
        id: 'GC.2',
        title: 'Organisation',
        label: '2',
        altIdentifier: 'unbekannte-topic-uuid',
        practiceId: 'GC',
        controlCount: 1,
        controlIds: ['GC.2.2'],
      }],
      controlCount: 1,
    }];
    mockedUseCatalog.mockReturnValue(state);

    render(
      <MemoryRouter>
        <ControlDetail control={makeControl()} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Organisation')).toBeInTheDocument();
    expect(screen.getByText('keine offizielle Definition')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thema: Organisation' }))
      .not.toBeInTheDocument();
  });

  it('does not retain control-local UI state across catalog changes', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: {
        name: 'modal_verb',
        value: 'MUSS',
        ns: 'https://example.com/namespaces/modal_verbs.csv',
      },
    });
    const view = render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'MUSS' }));
    expect(screen.getByRole('button', { name: 'MUSS' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    const wlanCatalog = {
      ...makeCatalogState().catalog!,
      catalogKey: 'wlan' as const,
    };
    mockedUseCatalog.mockReturnValue(makeCatalogState({ catalog: wlanCatalog }));
    view.rerender(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'MUSS' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('does not revive vocabulary state after a catalog scope roundtrip', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: {
        name: 'modal_verb',
        value: 'MUSS',
        ns: 'https://example.com/namespaces/modal_verbs.csv',
      },
    });
    const initialCatalogState = makeCatalogState();
    const view = render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'MUSS' }));
    const wlanCatalog = {
      ...initialCatalogState.catalog!,
      catalogKey: 'wlan' as const,
    };
    mockedUseCatalog.mockReturnValue(makeCatalogState({ catalog: wlanCatalog }));
    view.rerender(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );
    mockedUseCatalog.mockReturnValue(initialCatalogState);
    view.rerender(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'MUSS' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('renders resolved security targets and threats with independent accessible toggles', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      confidentiality: '2',
      confidentialityProp: {
        name: 'confidentiality',
        value: '2',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets_levels.csv',
      },
      integrity: '1',
      integrityProp: {
        name: 'integrity',
        value: '1',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets_levels.csv',
      },
      availability: '1',
      availabilityProp: {
        name: 'availability',
        value: '1',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets_levels.csv',
      },
      authenticity: '0',
      authenticityProp: {
        name: 'authenticity',
        value: '0',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets_levels.csv',
      },
      threats: ['G 0.18', 'G 0.19'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18, G 0.19',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Schutzziele und Gefährdungen', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Vertraulichkeit')).toBeInTheDocument();
    expect(screen.getByText('Integrität')).toBeInTheDocument();
    expect(screen.getByText('Verfügbarkeit')).toBeInTheDocument();
    expect(screen.getByText('Authentizität')).toBeInTheDocument();
    expect(screen.getAllByRole('rowheader')).toHaveLength(4);
    expect(screen.getAllByText('Relevanz')).toHaveLength(1);
    expect(screen.queryByText(/^Relevanz: [0-2]$/)).not.toBeInTheDocument();

    const confidentiality = screen.getByRole('button', { name: 'Schutzziel: Vertraulichkeit' });
    const confidentialityLevel = screen.getByRole('button', {
      name: 'Relevanz Vertraulichkeit: 2',
    });
    const threat = screen.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    });
    expect(confidentiality).toHaveAttribute('aria-expanded', 'false');
    expect(confidentialityLevel).toHaveAttribute('aria-expanded', 'false');
    expect(threat).toHaveAttribute('aria-expanded', 'false');

    await user.click(confidentiality);
    expect(screen.getByText('Schutz vor unbefugter Offenlegung.')).toBeInTheDocument();
    expect(confidentiality).toHaveAttribute('aria-expanded', 'true');

    await user.click(confidentialityLevel);
    expect(screen.getByText(
      'Die Anforderung wirkt in besonderem Maße auf dieses Schutzziel hin. Dieser Wert zeigt an, dass das Schutzziel im Zentrum dieser Anforderung steht.',
    )).toBeInTheDocument();
    expect(confidentiality).toHaveAttribute('aria-expanded', 'false');
    expect(confidentialityLevel).toHaveAttribute('aria-expanded', 'true');

    await user.click(threat);
    expect(screen.getByText('Fehlplanung oder fehlende Anpassung von Prozessen.')).toBeInTheDocument();
    expect(confidentiality).toHaveAttribute('aria-expanded', 'false');
    expect(threat).toHaveAttribute('aria-expanded', 'true');
  });

  it('shows partial data and leaves unresolved threat references visible', () => {
    const control = makeControl({
      integrity: '1',
      integrityProp: {
        name: 'integrity',
        value: '1',
        ns: 'https://example.com/namespaces/security_targets.csv',
      },
      threats: ['G 0.99'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.99',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Integrität')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'Integrität' }).closest('tr'))
      .toHaveTextContent('1');
    expect(screen.getByText('G 0.99')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Elementare Gefährdung: G 0.99' })).not.toBeInTheDocument();
    expect(screen.queryByText('Vertraulichkeit')).not.toBeInTheDocument();
  });

  it('keeps an out-of-range security target relevance visible with a diagnostic', () => {
    const control = makeControl({
      confidentialityProp: {
        name: 'confidentiality',
        value: '3',
        ns: 'https://example.com/namespaces/security_targets.csv',
      },
      threats: ['G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Fehlplanung oder fehlende Anpassung (G 0.18)'))
      .toBeInTheDocument();
    expect(screen.getByText('Vertraulichkeit')).toBeInTheDocument();
    const confidentialityRow = screen
      .getByRole('rowheader', { name: 'Vertraulichkeit' })
      .closest('tr');
    expect(confidentialityRow).toHaveTextContent('3');
    expect(confidentialityRow?.querySelectorAll('span[aria-hidden="true"]'))
      .toHaveLength(0);
    expect(screen.getByText('Keine offizielle Definition für diese Relevanzstufe verfügbar.'))
      .toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: 'Relevanz Vertraulichkeit: 3',
    })).not.toBeInTheDocument();
  });

  it('does not carry an expanded threat card to another control', async () => {
    const user = userEvent.setup();
    const firstControl = makeControl({
      id: 'GC.2.2',
      threats: ['G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });
    const nextControl = makeControl({
      id: 'GC.2.3',
      threats: ['G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });
    const { rerender } = render(
      <MemoryRouter>
        <ControlDetail control={firstControl} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    }));
    expect(screen.getByText('Fehlplanung oder fehlende Anpassung von Prozessen.')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ControlDetail control={nextControl} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Fehlplanung oder fehlende Anpassung von Prozessen.')).not.toBeInTheDocument();
  });

  it('does not carry an expanded security target card to another control', async () => {
    const user = userEvent.setup();
    const firstControl = makeControl({
      id: 'ASST.1.1',
      confidentiality: '2',
      confidentialityProp: {
        name: 'confidentiality',
        value: '2',
        ns: 'https://example.com/namespaces/security_targets.csv',
      },
    });
    const nextControl = makeControl({
      id: 'ASST.1.1.1',
      confidentiality: '1',
      confidentialityProp: {
        name: 'confidentiality',
        value: '1',
        ns: 'https://example.com/namespaces/security_targets.csv',
      },
    });
    const { rerender } = render(
      <MemoryRouter>
        <ControlDetail control={firstControl} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', {
      name: 'Schutzziel: Vertraulichkeit',
    }));
    expect(screen.getByText('Schutz vor unbefugter Offenlegung.')).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ControlDetail control={nextControl} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', {
      name: 'Schutzziel: Vertraulichkeit',
    })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Schutz vor unbefugter Offenlegung.')).not.toBeInTheDocument();
  });

  it('hides the security targets and threats section when the control has no such data', () => {
    render(
      <MemoryRouter>
        <ControlDetail control={makeControl()} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('heading', { name: 'Schutzziele und Gefährdungen', level: 3 })).not.toBeInTheDocument();
  });

  it('shows a visible info affordance only on vocabulary-enabled triggers', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: {
        name: 'modal_verb',
        value: 'MUSS',
        ns: 'https://example.com/namespaces/modal_verbs.csv',
      },
      securityLevel: 'normal-SdT',
      securityLevelProp: {
        name: 'security_level',
        value: 'normal-SdT',
        ns: 'https://example.com/namespaces/security_level.csv',
      },
      effortLevel: '3',
      effortLevelProp: {
        name: 'effort_level',
        value: '3',
        ns: 'https://example.com/namespaces/effort_level.csv',
      },
      tags: ['Governance', 'Nicht aufgelöst'],
      tagsProp: {
        name: 'tags',
        value: 'Governance, Nicht aufgelöst',
        ns: 'https://example.com/namespaces/tags.csv',
      },
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: {
          name: 'result',
          value: 'Verfahren und Regelungen',
          ns: 'https://example.com/namespaces/result.csv',
        },
        zielobjektKategorien: ['Server'],
        zielobjektKategorienProp: {
          name: 'target_object_categories',
          value: 'Server',
          ns: 'https://example.com/namespaces/target_object_categories.csv',
        },
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const mustButton = screen.getByRole('button', { name: 'MUSS' });
    const securityLevelButton = screen.getByRole('button', { name: 'normal-SdT' });
    const effortButton = screen.getByRole('button', { name: /Aufwand/ });
    const tagButton = screen.getByRole('button', { name: 'Tag: Governance' });
    const resultButton = screen.getByRole('button', { name: 'Verfahren und Regelungen' });
    const targetButton = screen.getByRole('button', { name: 'Zielobjekt: Server' });

    expect(mustButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('text-slate-400');
    expect(securityLevelButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('text-slate-400');
    expect(effortButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('text-slate-400');
    [mustButton, securityLevelButton, effortButton, tagButton, targetButton].forEach((button) => {
      const badgeIcon = button.querySelector('.catalog-vocabulary-affordance');
      expect(badgeIcon).toHaveClass('self-center');
      expect(badgeIcon).not.toHaveClass('mt-0.5');
      expect(badgeIcon?.parentElement).toHaveClass('justify-center', 'leading-none');
    });
    expect(resultButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('mt-0.5');
    expect(securityLevelButton.firstElementChild).toHaveClass(
      'bg-transparent',
      'border-[var(--color-border-strong)]',
    );
    expect(effortButton.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(5);
    expect(tagButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('text-slate-400');
    expect(resultButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('text-slate-400');
    expect(targetButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('text-slate-400');
    expect(mustButton).not.toHaveClass('hover:ring-2');
    expect(resultButton).not.toHaveClass('hover:text-primary-main');

    const rawTagBadge = screen.getByText('Nicht aufgelöst').closest('span');
    expect(rawTagBadge?.querySelector('.catalog-vocabulary-affordance')).toBeNull();

    await user.click(mustButton);
    expect(mustButton.querySelector('.catalog-vocabulary-affordance')).toHaveClass('text-primary-main');
  });

  it('groups classification, details, dependencies, hierarchy, and metadata in the expected order', () => {
    const control = makeControl({
      title: 'Kontrolle mit vollständigen Metadaten',
      altIdentifier: 'test-uuid-1234',
      modalverb: 'MUSS',
      securityLevel: 'normal-SdT',
      effortLevel: '3',
      tags: ['Governance'],
      confidentiality: '2',
      confidentialityProp: {
        name: 'confidentiality',
        value: '2',
        ns: 'https://example.com/namespaces/security_targets.csv',
      },
      guidance: 'Mit dokumentierten Freigaben arbeiten.',
      statementProps: {
        ergebnis: 'Ergebnis',
        praezisierung: 'präzisiert',
        handlungsworte: 'umsetzen',
        dokumentation: 'Richtlinie A',
        zielobjektKategorien: ['Server'],
      },
      links: [makeControlLink('GC.2.3')],
    });
    const incomingLinks: IncomingControlLink[] = [
      makeIncomingLink(makeControl({
          id: 'GC.2.1',
          title: 'Voraussetzung',
        }), 'required'),
    ];
    const parentControl = makeControl({
      id: 'GC.2',
      title: 'Überbau',
    });
    const childControl = makeControl({
      id: 'GC.2.2.1',
      title: 'Erweiterung',
      parentId: control.id,
    });
    const linkedControl = makeControl({ id: 'GC.2.3', title: 'Verknüpfte Kontrolle' });
    const controlsById = new Map([[linkedControl.id, linkedControl]]);
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, controlsById));

    render(
      <ControlDetail
        control={control}
        controlsById={controlsById}
        incomingLinks={incomingLinks}
        parentControl={parentControl}
        childControls={[childControl]}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    const classification = screen.getByRole('heading', { name: 'Klassifikation', level: 3 });
    const securityTargets = screen.getByRole('heading', { name: 'Schutzziele und Gefährdungen', level: 3 });
    const statement = screen.getByRole('heading', { name: 'Anforderung', level: 3 });
    const details = screen.getByRole('heading', { name: 'Anforderungsdetails', level: 3 });
    const guidance = screen.getByRole('heading', { name: 'Umsetzungshinweise', level: 3 });
    const dependencies = screen.getByRole('heading', { name: 'Abhängigkeiten', level: 3 });
    const hierarchy = screen.getByRole('heading', { name: 'Hierarchie', level: 3 });
    const metadata = screen.getByRole('heading', { name: 'Technische Metadaten', level: 3 });
    const orderedHeadings = [
      classification,
      securityTargets,
      statement,
      details,
      guidance,
      dependencies,
      hierarchy,
      metadata,
    ];

    for (let index = 0; index < orderedHeadings.length - 1; index += 1) {
      expect(
        orderedHeadings[index].compareDocumentPosition(orderedHeadings[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    expect(within(classification.parentElement as HTMLElement).getByText('Governance')).toBeInTheDocument();
    expect(within(classification.parentElement as HTMLElement).getByText('Server')).toBeInTheDocument();
    expect(within(details.parentElement as HTMLElement).getByText('Richtlinie A')).toBeInTheDocument();
    expect(
      within(dependencies.parentElement as HTMLElement).getByRole('heading', {
        name: 'Verknüpfte Kontrollen',
        level: 4,
      }),
    ).toBeInTheDocument();
    expect(
      within(dependencies.parentElement as HTMLElement).getByRole('heading', {
        name: 'Wird referenziert von',
        level: 4,
      }),
    ).toBeInTheDocument();
  });

  it('separates classification criteria and taxonomy while preserving badge order', () => {
    const control = makeControl({
      modalverb: 'MUSS',
      securityLevel: 'normal-SdT',
      effortLevel: '3',
      tags: ['Governance'],
      statementProps: {
        zielobjektKategorien: ['Server'],
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const classification = screen.getByRole('heading', { name: 'Klassifikation', level: 3 })
      .parentElement as HTMLElement;
    const criteriaGroup = within(classification).getByRole('group', { name: 'Kriterien' });
    const taxonomyGroup = within(classification).getByRole('group', { name: 'Taxonomie' });
    const taxonomyHeading = within(taxonomyGroup).getByRole('heading', {
      name: 'Tags und Zielobjektkategorien',
      level: 4,
    });
    const modalverbBadge = within(criteriaGroup).getByText('MUSS');
    const securityLevelBadge = within(criteriaGroup).getByText('normal-SdT');
    const effortBadge = within(criteriaGroup).getByText('Aufwand');
    const tagBadge = within(taxonomyGroup).getByText('Governance');
    const targetBadge = within(taxonomyGroup).getByText('Server');

    expect(criteriaGroup).toBeInTheDocument();
    expect(taxonomyGroup).toBeInTheDocument();
    expect(taxonomyHeading).toHaveClass('text-sm', 'font-semibold', 'text-slate-800', 'mb-2');
    expect(
      criteriaGroup.compareDocumentPosition(taxonomyGroup) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      modalverbBadge.compareDocumentPosition(securityLevelBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      securityLevelBadge.compareDocumentPosition(effortBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      taxonomyHeading.compareDocumentPosition(tagBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      effortBadge.compareDocumentPosition(tagBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      tagBadge.compareDocumentPosition(targetBadge) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the vocabulary reveal card inside a dd element to maintain valid dl structure', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: {
          name: 'result',
          value: 'Verfahren und Regelungen',
          ns: 'https://example.com/namespaces/result.csv',
        },
        zielobjektKategorien: [],
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Verfahren und Regelungen' }));
    const revealCard = screen.getByText('Offizielles Ergebnis für Richtlinien und Prozesse.');
    expect(revealCard.closest('dd')).not.toBeNull();
  });

  it('renders statement detail labels and values as a description list (dt/dd)', () => {
    const control = makeControl({
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        handlungsworte: 'verankern',
        dokumentation: 'Richtlinie A',
        zielobjektKategorien: [],
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const ergebnisDt = screen.getByText('Ergebnis');
    expect(ergebnisDt.tagName).toBe('DT');
    expect(ergebnisDt.nextElementSibling?.tagName).toBe('DD');
    expect(ergebnisDt.nextElementSibling).toHaveTextContent('Verfahren und Regelungen');

    const handlungswortDt = screen.getByText('Handlungswort');
    expect(handlungswortDt.tagName).toBe('DT');
    expect(handlungswortDt.nextElementSibling?.tagName).toBe('DD');
    expect(handlungswortDt.nextElementSibling).toHaveTextContent('verankern');

    const dokumentationDt = screen.getByText('Dokumentation');
    expect(dokumentationDt.tagName).toBe('DT');
    expect(dokumentationDt.nextElementSibling?.tagName).toBe('DD');
    expect(dokumentationDt.nextElementSibling).toHaveTextContent('Richtlinie A');

    expect(screen.queryByText('Handlungsworte')).not.toBeInTheDocument();
  });

  it('lets detail text blocks use the full available panel width', () => {
    const statementText = 'Breiter Anforderungstext fuer das Detailpanel.';
    const guidanceText = 'Breiter Umsetzungshinweis fuer das Detailpanel.';
    const praezisierungText = 'Breite Praezisierung ohne Vokabularauflösung.';
    const control = makeControl({
      statement: statementText,
      statementRaw: statementText,
      guidance: guidanceText,
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: {
          name: 'result',
          value: 'Verfahren und Regelungen',
          ns: 'https://example.com/namespaces/result.csv',
        },
        praezisierung: praezisierungText,
        zielobjektKategorien: [],
      },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const statementSection = screen.getByRole('heading', {
      name: 'Anforderung',
      level: 3,
    }).parentElement as HTMLElement;
    const statement = within(statementSection).getByText(statementText);
    expect(statement).toHaveClass('w-full', 'break-words', '[hyphens:auto]');
    expect(statement).not.toHaveClass('max-w-prose');

    const guidanceSection = screen.getByRole('heading', {
      name: 'Umsetzungshinweise',
      level: 3,
    }).parentElement as HTMLElement;
    const guidance = within(guidanceSection).getByText(guidanceText);
    expect(guidance).toHaveClass('w-full', 'break-words', 'line-clamp-5', '[hyphens:auto]');
    expect(guidance).not.toHaveClass('max-w-prose');

    const detailsSection = screen.getByRole('heading', {
      name: 'Anforderungsdetails',
      level: 3,
    }).parentElement as HTMLElement;
    const resolvedValueButton = within(detailsSection).getByRole('button', {
      name: 'Verfahren und Regelungen',
    });
    expect(resolvedValueButton).toHaveClass('w-full');
    expect(resolvedValueButton).not.toHaveClass('inline-flex');
    expect(resolvedValueButton.querySelector('span')).toHaveClass(
      'min-w-0',
      'flex-1',
      'break-words',
      '[hyphens:auto]',
    );
    expect(resolvedValueButton.querySelector('span')).not.toHaveClass('max-w-prose');

    const rawValue = within(detailsSection).getByText(praezisierungText);
    expect(rawValue).toHaveClass('w-full', 'break-words', '[hyphens:auto]');
    expect(rawValue).not.toHaveClass('max-w-prose');
  });

  it('renders unmatched raw values without inline vocabulary controls', () => {
    const control = makeControl({
      tags: ['Unbekannt'],
      tagsProp: {
        name: 'tags',
        value: 'Unbekannt',
        ns: 'https://example.com/namespaces/tags.csv',
      },
    });
    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('Unbekannt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tag: Unbekannt' })).not.toBeInTheDocument();
    expect(screen.queryByText('Governance-Definition.')).not.toBeInTheDocument();
  });

  it('removes external namespace links as the primary vocabulary interaction', () => {
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: {
        name: 'modal_verb',
        value: 'MUSS',
        ns: 'https://example.com/namespaces/modal_verbs.csv',
      },
    });
    render(<ControlDetail control={control} onClose={vi.fn()} />);

    expect(screen.queryByRole('link', { name: /Namespace für/i })).not.toBeInTheDocument();
  });

  it('resolves outgoing links through controlsById before navigation', async () => {
    const user = userEvent.setup();
    const onNavigateToControl = vi.fn();
    const linkedControl = makeControl({ id: 'GC.2.3', title: 'Verknüpfte Basiskontrolle' });
    const controlsById = new Map([[linkedControl.id, linkedControl]]);
    const control = makeControl({
      links: [makeControlLink('GC.2.3')],
    });
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, controlsById));

    render(
      <ControlDetail
        control={control}
        controlsById={controlsById}
        onClose={vi.fn()}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    expect(screen.getByText('Verknüpfte Basiskontrolle')).toBeInTheDocument();
    const linkedControlButton = screen.getByRole('button', {
      name: /GC\.2\.3 Verknüpfte Basiskontrolle/,
    });
    expect(linkedControlButton).toBeInTheDocument();
    expect(screen.getByText('GC.2.3')).toBeInTheDocument();

    await user.click(linkedControlButton);

    expect(onNavigateToControl).toHaveBeenCalledWith(linkedControl);
  });

  it('moves unresolved outgoing OSCAL links to sources instead of rendering a dead dependency', () => {
    const onNavigateToControl = vi.fn();
    const control = makeControl({
      links: [makeControlLink('MISSING.1')],
    });
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, new Map()));

    render(
      <ControlDetail
        control={control}
        controlsById={new Map()}
        onClose={vi.fn()}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Quellen und Verweise', level: 3 }))
      .toBeInTheDocument();
    expect(screen.getByText('#MISSING.1')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /MISSING\.1/ })).not.toBeInTheDocument();
    expect(onNavigateToControl).not.toHaveBeenCalled();
  });

  it('renders a source-only back-matter resource below dependencies', () => {
    const control = makeControl({ links: [] });
    const state = makeCatalogStateWithControlSource(
      control,
      new Map(),
      [{ href: '#resource-uuid', 'resource-fragment': 'abschnitt-2.4' }],
      [{
        uuid: 'resource-uuid',
        title: 'Quellendokument',
        description: 'Bewertungsgrundlage',
        rlinks: [{ href: 'https://example.com/quellen.pdf' }],
      }],
    );
    mockedUseCatalog.mockReturnValue(state);

    render(<ControlDetail control={control} controlsById={new Map()} onClose={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Quellen und Verweise', level: 3 }))
      .toBeInTheDocument();
    expect(screen.getByText('Quellendokument')).toBeInTheDocument();
    expect(screen.getByText('Fragment: abschnitt-2.4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /quellen.pdf/i }))
      .toHaveAttribute('href', 'https://example.com/quellen.pdf');
    expect(screen.queryByRole('heading', { name: 'Abhängigkeiten', level: 3 }))
      .not.toBeInTheDocument();
  });

  it('renders and navigates incoming control references', async () => {
    const user = userEvent.setup();
    const onNavigateToControl = vi.fn();
    const control = makeControl({
      links: [makeControlLink('GC.2.3')],
    });
    const incomingLinks: IncomingControlLink[] = [
      makeIncomingLink(makeControl({
          id: 'GC.2.1',
          title: 'Voraussetzung',
        }), 'required'),
    ];
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, new Map()));

    render(
      <ControlDetail
        control={control}
        incomingLinks={incomingLinks}
        onClose={vi.fn()}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Wird referenziert von', level: 4 })).toBeInTheDocument();
    const reverseLinkButton = screen.getByRole('button', {
      name: /GC\.2\.1 Voraussetzung \(erforderlich · benutzerdefinierte OSCAL-Relation\)/,
    });
    expect(reverseLinkButton).toBeInTheDocument();

    await user.click(reverseLinkButton);

    expect(onNavigateToControl).toHaveBeenCalledWith(incomingLinks[0].control);
  });

  it('hides reciprocal incoming rows when the same control is already listed as outgoing', () => {
    const reciprocalControl = makeControl({
      id: 'GC.2.3',
      title: 'Gegenseitige Kontrolle',
    });
    const incomingOnlyControl = makeControl({
      id: 'GC.2.1',
      title: 'Nur eingehende Kontrolle',
    });
    const controlsById = new Map([[reciprocalControl.id, reciprocalControl]]);
    const control = makeControl({
      links: [makeControlLink(reciprocalControl.id, 'required')],
    });
    const incomingLinks: IncomingControlLink[] = [
      makeIncomingLink(reciprocalControl, 'required'),
      makeIncomingLink(incomingOnlyControl, 'related'),
    ];
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, controlsById));

    render(
      <ControlDetail
        control={control}
        controlsById={controlsById}
        incomingLinks={incomingLinks}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    const dependenciesSection = screen.getByRole('heading', { name: 'Abhängigkeiten', level: 3 })
      .parentElement as HTMLElement;
    const incomingSection = within(dependenciesSection).getByRole('heading', {
      name: 'Wird referenziert von',
      level: 4,
    }).parentElement as HTMLElement;

    expect(
      screen.getByRole('button', {
        name: /GC\.2\.3 Gegenseitige Kontrolle \(erforderlich · benutzerdefinierte OSCAL-Relation\)/,
      }),
    ).toBeInTheDocument();
    expect(
      within(incomingSection).queryByRole('button', {
        name: /GC\.2\.3 Gegenseitige Kontrolle/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(incomingSection).getByRole('button', {
        name: /GC\.2\.1 Nur eingehende Kontrolle \(verwandt · benutzerdefinierte OSCAL-Relation\)/,
      }),
    ).toBeInTheDocument();
  });

  it('shows differing reverse relations inline for reciprocal links', () => {
    const reciprocalControl = makeControl({
      id: 'GC.2.3',
      title: 'Gegenseitige Kontrolle',
    });
    const controlsById = new Map([[reciprocalControl.id, reciprocalControl]]);
    const control = makeControl({
      links: [makeControlLink(reciprocalControl.id, 'required')],
    });
    const incomingLinks: IncomingControlLink[] = [
      makeIncomingLink(reciprocalControl, 'required'),
      makeIncomingLink(reciprocalControl, 'related'),
      makeIncomingLink(reciprocalControl, 'related'),
    ];
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, controlsById));

    render(
      <ControlDetail
        control={control}
        controlsById={controlsById}
        incomingLinks={incomingLinks}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    const outgoingButton = screen.getByRole('button', {
      name: /GC\.2\.3 Gegenseitige Kontrolle \(erforderlich · benutzerdefinierte OSCAL-Relation · ↔ verwandt · benutzerdefinierte OSCAL-Relation\)/,
    });

    expect(outgoingButton).toBeInTheDocument();
    expect(screen.getByText(
      'Erforderlich · benutzerdefinierte OSCAL-Relation · ↔ verwandt · benutzerdefinierte OSCAL-Relation',
    )).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wird referenziert von', level: 4 })).not.toBeInTheDocument();
  });

  it('omits the reverse relation marker when reciprocal links use the same relation', () => {
    const reciprocalControl = makeControl({
      id: 'GC.2.3',
      title: 'Gegenseitige Kontrolle',
    });
    const controlsById = new Map([[reciprocalControl.id, reciprocalControl]]);
    const control = makeControl({
      links: [makeControlLink(reciprocalControl.id, 'required')],
    });
    const incomingLinks: IncomingControlLink[] = [
      makeIncomingLink(reciprocalControl, 'required'),
    ];
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, controlsById));

    render(
      <ControlDetail
        control={control}
        controlsById={controlsById}
        incomingLinks={incomingLinks}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    const outgoingButton = screen.getByRole('button', {
      name: /GC\.2\.3 Gegenseitige Kontrolle \(erforderlich · benutzerdefinierte OSCAL-Relation\)/,
    });

    expect(outgoingButton).toBeInTheDocument();
    expect(within(outgoingButton).queryByText(/↔/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wird referenziert von', level: 4 })).not.toBeInTheDocument();
  });

  it('renders parent and child hierarchy links', async () => {
    const user = userEvent.setup();
    const onNavigateToControl = vi.fn();
    const control = makeControl({
      id: 'GC.5.1',
      title: 'Basiskontrolle',
      parentId: 'GC.5',
    });
    const parentControl = makeControl({
      id: 'GC.5',
      title: 'Übergeordnete Kontrolle',
    });
    const childControl = makeControl({
      id: 'GC.5.1.1',
      title: 'Erweiterung',
      parentId: 'GC.5.1',
    });

    render(
      <ControlDetail
        control={control}
        parentControl={parentControl}
        childControls={[childControl]}
        onClose={vi.fn()}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Übergeordnete Kontrolle', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GC\.5 Übergeordnete Kontrolle/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GC\.5\.1\.1 Erweiterung/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /GC\.5 Übergeordnete Kontrolle/ }));
    await user.click(screen.getByRole('button', { name: /GC\.5\.1\.1 Erweiterung/ }));

    expect(onNavigateToControl).toHaveBeenNthCalledWith(1, parentControl);
    expect(onNavigateToControl).toHaveBeenNthCalledWith(2, childControl);
  });

  it('hides Übergeordnet in Technische Metadaten when parentControl is provided', () => {
    const control = makeControl({ id: 'GC.5.1', parentId: 'GC.5', altIdentifier: 'some-uuid' });
    const parentControl = makeControl({ id: 'GC.5', title: 'Elternkontrolle' });

    render(
      <ControlDetail
        control={control}
        parentControl={parentControl}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    // UUID bleibt sichtbar, Übergeordnet-Eintrag wird unterdrückt
    expect(screen.getByText('some-uuid')).toBeInTheDocument();
    expect(screen.queryByRole('term', { name: 'Übergeordnet' })).not.toBeInTheDocument();
  });

  it('shows Übergeordnet in Technische Metadaten as fallback when parentControl is absent', () => {
    const control = makeControl({ id: 'GC.5.1', parentId: 'GC.5' });

    render(
      <ControlDetail
        control={control}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    expect(screen.getByText('GC.5')).toBeInTheDocument();
  });

  it('builds absolute control detail links with the configured app base path', () => {
    expect(
      getControlDetailUrl('gspp', { id: 'DET.5.4', altIdentifier: 'stable-det-5-4' }, {
        origin: 'https://dfurater.github.io',
        baseUrl: '/Grundschutz-Navigator/',
      }),
    ).toBe(
      'https://dfurater.github.io/Grundschutz-Navigator/katalog/gspp/kontrolle/stable-det-5-4',
    );

    expect(
      getControlDetailUrl('gspp', { id: 'DET.5.4', altIdentifier: 'stable-det-5-4' }, {
        origin: 'http://localhost:5173',
        baseUrl: '/',
      }),
    ).toBe('http://localhost:5173/katalog/gspp/kontrolle/stable-det-5-4');
  });

  it('copies the direct link for the current control', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);

    render(
      <MemoryRouter>
        <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));

    expect(writeText).toHaveBeenCalledWith(
      'http://localhost:3000/katalog/gspp/kontrolle/stable-det-5-4',
    );
  });

  it('shows a generic error and the full selectable direct link when copying fails', async () => {
    const user = userEvent.setup();
    setClipboard(vi.fn().mockRejectedValue(new Error('Browser detail')));

    render(
      <MemoryRouter>
        <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kopieren nicht möglich. Bitte den vollständigen Wert manuell markieren und kopieren.',
    );
    expect(screen.queryByText('Browser detail')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Direktlink zum manuellen Kopieren')).toHaveTextContent(
      'http://localhost:3000/katalog/gspp/kontrolle/stable-det-5-4',
    );
    expect(screen.getByLabelText('Direktlink zum manuellen Kopieren')).toHaveClass('select-all');
  });

  it('keeps the direct-link fallback mounted when a retry fails again', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockRejectedValue(new Error('Browser detail'));
    setClipboard(writeText);

    render(
      <MemoryRouter>
        <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));
    const fallback = screen.getByLabelText('Direktlink zum manuellen Kopieren');

    // Ein Retry darf den Fallback nicht neu mounten — sonst verliert eine
    // markierte URL ihre Auswahl und der manuelle Kopierweg bricht (PR #155).
    await user.click(screen.getByRole('button', { name: 'Erneut kopieren' }));

    expect(writeText).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText('Direktlink zum manuellen Kopieren')).toBe(fallback);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('keeps the fallback visible while a newer retry is still pending after an older one settles', async () => {
    const user = userEvent.setup();
    let resolveOld!: () => void;
    const oldAttempt = new Promise<void>((resolve) => {
      resolveOld = resolve;
    });
    const writeText = vi.fn()
      .mockImplementationOnce(() => Promise.reject(new Error('Browser detail')))
      .mockImplementationOnce(() => oldAttempt.then(() => undefined))
      .mockRejectedValue(new Error('Browser detail'));
    setClipboard(writeText);

    render(
      <MemoryRouter>
        <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));
    const fallback = screen.getByLabelText('Direktlink zum manuellen Kopieren');

    // Älterer Retry (bleibt zunächst offen) …
    await user.click(screen.getByRole('button', { name: 'Erneut kopieren' }));
    // … gefolgt von einem neueren, der zuerst fertig wird.
    await user.click(screen.getByRole('button', { name: 'Erneut kopieren' }));

    await act(async () => {
      resolveOld();
    });

    // Der ältere Versuch darf den Fallback nicht unter dem noch laufenden
    // neueren Versuch entfernen — sonst verliert die Auswahl ihre URL.
    expect(writeText).toHaveBeenCalledTimes(3);
    expect(screen.getByLabelText('Direktlink zum manuellen Kopieren')).toBe(fallback);
  });

  it('keeps long tags wrap-capable inside outline badges', () => {
    const longTag = 'Advanced Persistent Threats (APT) mit sehr langen Zusatzbezeichnungen';
    const control = makeControl({
      tags: [longTag],
    });

    render(
      <ControlDetail
        control={control}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByText(longTag)).toHaveClass(
      'max-w-full',
      'whitespace-normal',
      'break-words',
      'text-left',
      'leading-snug',
      '[overflow-wrap:anywhere]',
    );
  });

  it('sets aria-expanded and aria-controls on vocabulary trigger buttons', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: {
        name: 'modal_verb',
        value: 'MUSS',
        ns: 'https://example.com/namespaces/modal_verbs.csv',
      },
      tags: ['Governance'],
      tagsProp: {
        name: 'tags',
        value: 'Governance',
        ns: 'https://example.com/namespaces/tags.csv',
      },
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: {
          name: 'result',
          value: 'Verfahren und Regelungen',
          ns: 'https://example.com/namespaces/result.csv',
        },
        zielobjektKategorien: [],
      },
    });
    render(
      <MemoryRouter>
        <ControlDetail control={control} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    const mustButton = screen.getByRole('button', { name: 'MUSS' });
    const tagButton = screen.getByRole('button', { name: 'Tag: Governance' });
    const resultButton = screen.getByRole('button', { name: 'Verfahren und Regelungen' });

    // collapsed: aria-expanded=false, aria-controls points to existing hidden element
    expect(mustButton).toHaveAttribute('aria-expanded', 'false');
    expect(mustButton).toHaveAttribute('aria-controls');
    expect(document.getElementById(mustButton.getAttribute('aria-controls')!)).toBeInTheDocument();

    expect(tagButton).toHaveAttribute('aria-expanded', 'false');
    expect(tagButton).toHaveAttribute('aria-controls');
    expect(document.getElementById(tagButton.getAttribute('aria-controls')!)).toBeInTheDocument();

    expect(resultButton).toHaveAttribute('aria-expanded', 'false');
    expect(resultButton).toHaveAttribute('aria-controls');
    expect(document.getElementById(resultButton.getAttribute('aria-controls')!)).toBeInTheDocument();

    // expand: aria-expanded=true, target visible
    await user.click(mustButton);
    expect(mustButton).toHaveAttribute('aria-expanded', 'true');
    const mustTarget = document.getElementById(mustButton.getAttribute('aria-controls')!);
    expect(mustTarget).not.toHaveAttribute('hidden');

    await user.click(tagButton);
    expect(tagButton).toHaveAttribute('aria-expanded', 'true');
    const tagTarget = document.getElementById(tagButton.getAttribute('aria-controls')!);
    expect(tagTarget).not.toHaveAttribute('hidden');
  });

  it('sets aria-expanded and aria-controls on the guidance toggle', async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(240);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(120);

    render(
      <ControlDetail
        control={makeControl({ guidance: 'Langtext '.repeat(80) })}
        onClose={vi.fn()}
      />,
    );

    const toggle = screen.getByRole('button', { name: 'Mehr anzeigen' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'guidance-text');
    expect(document.getElementById('guidance-text')).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Weniger anzeigen' })).toHaveAttribute('aria-expanded', 'true');

    vi.restoreAllMocks();
  });

  it('shows the guidance toggle only when the clamped text actually overflows', async () => {
    const user = userEvent.setup();
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(240);
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(120);

    render(
      <ControlDetail
        control={makeControl({
          guidance: 'Langtext '.repeat(80),
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Mehr anzeigen' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Mehr anzeigen' }));

    expect(screen.getByRole('button', { name: 'Weniger anzeigen' })).toBeInTheDocument();

    scrollHeightSpy.mockRestore();
    clientHeightSpy.mockRestore();
  });

  it('hides the guidance toggle when the text exactly fits inside five lines', () => {
    const scrollHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockReturnValue(120);
    const clientHeightSpy = vi
      .spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(120);

    render(
      <ControlDetail
        control={makeControl({
          guidance: 'Grenzfall '.repeat(80),
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Mehr anzeigen' })).not.toBeInTheDocument();

    scrollHeightSpy.mockRestore();
    clientHeightSpy.mockRestore();
  });

  it('remeasures guidance on window resize when ResizeObserver is unavailable', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    let scrollHeight = 120;
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get')
      .mockImplementation(() => scrollHeight);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get')
      .mockReturnValue(120);

    render(
      <ControlDetail
        control={makeControl({
          guidance: 'Dynamischer Grenzfall '.repeat(80),
        })}
        onClose={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Mehr anzeigen' }))
      .not.toBeInTheDocument();

    scrollHeight = 240;
    fireEvent.resize(window);

    expect(screen.getByRole('button', { name: 'Mehr anzeigen' }))
      .toBeInTheDocument();
  });
});
