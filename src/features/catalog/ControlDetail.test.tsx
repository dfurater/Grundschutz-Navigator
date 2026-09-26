import { act, fireEvent, render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
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

function render(ui: ReactElement) {
  return rtlRender(ui, { wrapper: MemoryRouter });
}

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
      <ControlDetail control={makeControl()} onClose={vi.fn()} />,
  );

  return user;
}

describe('ControlDetail', () => {
  beforeEach(() => {
    mockedUseCatalog.mockReset();
    mockedUseCatalog.mockReturnValue(makeCatalogState());
  });

  it('uses the criteria legend and keeps term cards for tags, details, and target categories', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: { name: 'modal_verb', value: 'MUSS', ns: 'https://example.com/namespaces/modal_verbs.csv' },
      tags: ['Governance'],
      tagsProp: { name: 'tags', value: 'Governance', ns: 'https://example.com/namespaces/tags.csv' },
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: { name: 'result', value: 'Verfahren und Regelungen', ns: 'https://example.com/namespaces/result.csv' },
        dokumentation: 'Richtlinie A',
        dokumentationProp: { name: 'documentation', value: 'Richtlinie A', ns: 'https://example.com/namespaces/documentation_guidelines.csv' },
        zielobjektKategorien: ['Server'],
        zielobjektKategorienProp: { name: 'target_object_categories', value: 'Server', ns: 'https://example.com/namespaces/target_object_categories.csv' },
      },
    });
    render(<ControlDetail control={control} onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'MUSS' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Legende' }));
    expect(screen.getByRole('link', { name: 'MUSS' })).toHaveAttribute('href', '/vokabular/modal-verbs?wert=MUSS');
    await user.click(screen.getByRole('button', { name: 'Tag: Governance' }));
    expect(screen.getByText('Governance-Definition.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vokabularbegriff Verfahren und Regelungen' }));
    expect(screen.getByText('Offizielles Ergebnis für Richtlinien und Prozesse.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Vokabularbegriff Richtlinie A' }));
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
      <ControlDetail control={control} onClose={vi.fn()} />,
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
      <ControlDetail control={control} onClose={vi.fn()} />,
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
      <ControlDetail control={makeControl()} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Organisation')).toBeInTheDocument();
    expect(screen.getByText('keine offizielle Definition')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thema: Organisation' }))
      .not.toBeInTheDocument();
  });

  it('does not retain term-card state across catalog changes', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      tags: ['Governance'],
      tagsProp: { name: 'tags', value: 'Governance', ns: 'https://example.com/namespaces/tags.csv' },
    });
    const view = render(<ControlDetail control={control} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Tag: Governance' }));
    expect(screen.getByRole('button', { name: 'Tag: Governance' })).toHaveAttribute('aria-pressed', 'true');

    const wlanCatalog = { ...makeCatalogState().catalog!, catalogKey: 'wlan' as const };
    mockedUseCatalog.mockReturnValue(makeCatalogState({ catalog: wlanCatalog }));
    view.rerender(<ControlDetail control={control} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tag: Governance' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not revive term-card state after a catalog scope roundtrip', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      tags: ['Governance'],
      tagsProp: { name: 'tags', value: 'Governance', ns: 'https://example.com/namespaces/tags.csv' },
    });
    const initialCatalogState = makeCatalogState();
    const view = render(<ControlDetail control={control} onClose={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Tag: Governance' }));
    const wlanCatalog = { ...initialCatalogState.catalog!, catalogKey: 'wlan' as const };
    mockedUseCatalog.mockReturnValue(makeCatalogState({ catalog: wlanCatalog }));
    view.rerender(<ControlDetail control={control} onClose={vi.fn()} />);
    mockedUseCatalog.mockReturnValue(initialCatalogState);
    view.rerender(<ControlDetail control={control} onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Tag: Governance' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders resolved security targets and threats with independent accessible toggles', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      confidentiality: '2',
      confidentialityProp: {
        name: 'confidentiality',
        value: '2',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv',
      },
      integrity: '1',
      integrityProp: {
        name: 'integrity',
        value: '1',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv',
      },
      availability: '1',
      availabilityProp: {
        name: 'availability',
        value: '1',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv',
      },
      authenticity: '0',
      authenticityProp: {
        name: 'authenticity',
        value: '0',
        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv',
      },
      threats: ['G 0.18', 'G 0.19'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.18, G 0.19',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });

    render(
      <ControlDetail control={control} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('heading', { name: 'Merkmale', level: 3 })).toBeInTheDocument();
    expect(screen.getByText('Vertraulichkeit')).toBeInTheDocument();
    expect(screen.getByText('Integrität')).toBeInTheDocument();
    expect(screen.getByText('Verfügbarkeit')).toBeInTheDocument();
    expect(screen.getByText('Authentizität')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Schutzziele', level: 4 })).toBeInTheDocument();

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
      <ControlDetail control={control} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Integrität')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Schutzziel: Integrität' }).parentElement)
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
      <ControlDetail control={control} onClose={vi.fn()} />,
    );

    expect(screen.getByText('Fehlplanung oder fehlende Anpassung'))
      .toBeInTheDocument();
    expect(screen.getByText('Vertraulichkeit')).toBeInTheDocument();
    const confidentialityCell = screen.getByRole('button', { name: 'Schutzziel: Vertraulichkeit' }).parentElement;
    expect(confidentialityCell).toHaveTextContent('3');
    expect(confidentialityCell?.querySelectorAll('span[aria-hidden="true"]'))
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
      <ControlDetail control={firstControl} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    }));
    expect(screen.getByText('Fehlplanung oder fehlende Anpassung von Prozessen.')).toBeInTheDocument();

    rerender(
      <ControlDetail control={nextControl} onClose={vi.fn()} />,
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
      <ControlDetail control={firstControl} onClose={vi.fn()} />,
    );

    await user.click(screen.getByRole('button', {
      name: 'Schutzziel: Vertraulichkeit',
    }));
    expect(screen.getByText('Schutz vor unbefugter Offenlegung.')).toBeInTheDocument();

    rerender(
      <ControlDetail control={nextControl} onClose={vi.fn()} />,
    );

    expect(screen.getByRole('button', {
      name: 'Schutzziel: Vertraulichkeit',
    })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Schutz vor unbefugter Offenlegung.')).not.toBeInTheDocument();
  });

  it('hides the security targets and threats section when the control has no such data', () => {
    render(
      <ControlDetail control={makeControl()} onClose={vi.fn()} />,
    );

    expect(screen.queryByRole('heading', { name: 'Schutzziele und Gefährdungen', level: 3 })).not.toBeInTheDocument();
  });

  it('uses dotted term triggers and no info affordance in the detail view', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      modalverbProp: { name: 'modal_verb', value: 'MUSS', ns: 'https://example.com/namespaces/modal_verbs.csv' },
      tags: ['Governance', 'Nicht aufgelöst'],
      tagsProp: { name: 'tags', value: 'Governance, Nicht aufgelöst', ns: 'https://example.com/namespaces/tags.csv' },
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: { name: 'result', value: 'Verfahren und Regelungen', ns: 'https://example.com/namespaces/result.csv' },
        zielobjektKategorien: ['Server'],
        zielobjektKategorienProp: { name: 'target_object_categories', value: 'Server', ns: 'https://example.com/namespaces/target_object_categories.csv' },
      },
    });
    const { container } = render(<ControlDetail control={control} onClose={vi.fn()} />);

    expect(container.querySelector('.catalog-vocabulary-affordance')).toBeNull();
    expect(screen.queryByText('ⓘ')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'MUSS' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Kriterien' })).toHaveTextContent('MUSS');
    const tag = screen.getByRole('button', { name: 'Tag: Governance' });
    const result = screen.getByRole('button', { name: 'Vokabularbegriff Verfahren und Regelungen' });
    const target = screen.getByRole('button', { name: 'Zielobjekt: Server' });
    for (const trigger of [tag, result, target]) {
      expect(trigger.querySelector('.decoration-dotted')).not.toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Tag: Nicht aufgelöst' })).not.toBeInTheDocument();
    await user.click(tag);
    expect(tag).toHaveAttribute('aria-expanded', 'true');
  });

  it('groups content in the agreed detail-view order', () => {
    const control = makeControl({
      altIdentifier: 'test-uuid-1234', modalverb: 'MUSS', tags: ['Governance'],
      confidentiality: '2', guidance: 'Mit dokumentierten Freigaben arbeiten.',
      statementProps: { dokumentation: 'Richtlinie A', zielobjektKategorien: ['Server'] },
      links: [makeControlLink('GC.2.3')],
    });
    const parentControl = makeControl({ id: 'GC.2', title: 'Überbau' });
    const childControl = makeControl({ id: 'GC.2.2.1', title: 'Erweiterung', parentId: control.id });
    const linkedControl = makeControl({ id: 'GC.2.3', title: 'Verknüpfte Kontrolle' });
    const controlsById = new Map([[linkedControl.id, linkedControl]]);
    mockedUseCatalog.mockReturnValue(makeCatalogStateWithControlSource(control, controlsById));
    render(<ControlDetail control={control} controlsById={controlsById}
      parentControl={parentControl} childControls={[childControl]} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Teil von GC\.2 Überbau/ })).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Anforderung', 'Umsetzungshinweise', 'Merkmale', 'Zusammenhänge',
    ]);
    expect(screen.getByRole('group', { name: 'Kriterien' })).toHaveTextContent('MUSS');
    expect(screen.getByRole('heading', { name: 'Tags', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Zielobjekte', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Erweiterungen', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Verknüpft', level: 4 })).toBeInTheDocument();
    expect(screen.getByText('test-uuid-1234')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Technische Metadaten' })).not.toBeInTheDocument();
  });

  it('keeps criteria before the Merkmale zone and renders tags and targets as plain terms', () => {
    const control = makeControl({
      modalverb: 'MUSS', securityLevel: 'normal-SdT', effortLevel: '3',
      tags: ['Governance'], statementProps: { zielobjektKategorien: ['Server'] },
    });
    const { container } = render(<ControlDetail control={control} onClose={vi.fn()} />);
    const criteria = screen.getByRole('group', { name: 'Kriterien' });
    const merkmale = screen.getByRole('heading', { name: 'Merkmale', level: 3 });
    expect(criteria.compareDocumentPosition(merkmale) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const badgeTexts = ['MUSS', 'normal-SdT', 'Aufwand'];
    const badges = badgeTexts.map((label) => within(criteria).getByText(label));
    expect(badges[0].compareDocumentPosition(badges[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(badges[1].compareDocumentPosition(badges[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Governance')).toBeInTheDocument();
    expect(screen.getByText('Server')).toBeInTheDocument();
    expect(container.querySelector('.catalog-vocabulary-affordance')).toBeNull();
  });

  it('renders a rest-detail vocabulary card below its label and value', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: { name: 'result', value: 'Verfahren und Regelungen', ns: 'https://example.com/namespaces/result.csv' },
        zielobjektKategorien: [],
      },
    });
    render(<ControlDetail control={control} onClose={vi.fn()} />);
    const label = screen.getByText('Ergebnis');
    const result = screen.getByRole('button', { name: 'Vokabularbegriff Verfahren und Regelungen' });
    expect(label.compareDocumentPosition(result) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(result);
    expect(screen.getByText('Offizielles Ergebnis für Richtlinien und Prozesse.')).toBeInTheDocument();
  });

  it('shows labels above unembedded statement details without a separate heading', () => {
    const control = makeControl({
      statementProps: {
        ergebnis: 'Verfahren und Regelungen', handlungsworte: 'verankern',
        dokumentation: 'Richtlinie A', zielobjektKategorien: [],
      },
    });
    render(<ControlDetail control={control} onClose={vi.fn()} />);

    for (const [label, value] of [
      ['Ergebnis', 'Verfahren und Regelungen'],
      ['Handlungswort', 'verankern'],
      ['Dokumentation', 'Richtlinie A'],
    ]) {
      const labelElement = screen.getByText(label);
      const valueElement = screen.getByText(value);
      expect(labelElement.tagName).toBe('P');
      expect(labelElement.compareDocumentPosition(valueElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    expect(screen.queryByRole('heading', { name: 'Anforderungsdetails' })).not.toBeInTheDocument();
  });

  it('lets statement, guidance, and rest-detail text use the available width', () => {
    const statementText = 'Breiter Anforderungstext fuer das Detailpanel.';
    const guidanceText = 'Breiter Umsetzungshinweis fuer das Detailpanel.';
    const praezisierungText = 'Breite Praezisierung ohne Vokabularauflösung.';
    const control = makeControl({
      statement: statementText, statementRaw: statementText, guidance: guidanceText,
      statementProps: { praezisierung: praezisierungText, zielobjektKategorien: [] },
    });
    render(<ControlDetail control={control} onClose={vi.fn()} />);
    expect(screen.getByText(statementText)).toHaveClass('w-full', 'break-words', '[hyphens:auto]');
    expect(screen.getByText(guidanceText)).toHaveClass('w-full', 'break-words', 'line-clamp-5', '[hyphens:auto]');
    expect(screen.getByText(praezisierungText)).toHaveClass('w-full', 'break-words', '[hyphens:auto]');
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
      <ControlDetail control={control} onClose={vi.fn()} />,
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

    expect(screen.getByRole('heading', { name: 'Quellen', level: 4 }))
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

    expect(screen.getByRole('heading', { name: 'Quellen', level: 4 }))
      .toBeInTheDocument();
    expect(screen.getByText('Quellendokument')).toBeInTheDocument();
    expect(screen.getByText('Fragment: abschnitt-2.4')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /quellen.pdf/i }))
      .toHaveAttribute('href', 'https://example.com/quellen.pdf');
    expect(screen.queryByRole('heading', { name: 'Verknüpft', level: 4 }))
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

    expect(screen.getByRole('heading', { name: 'Verknüpft', level: 4 })).toBeInTheDocument();
    const reverseLinkButton = screen.getByRole('button', {
      name: /GC\.2\.1 Voraussetzung \(Erfordert\)/,
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

    const dependenciesSection = screen.getByRole('heading', { name: 'Verknüpft', level: 4 })
      .parentElement as HTMLElement;

    expect(
      screen.getByRole('button', {
        name: /GC\.2\.3 Gegenseitige Kontrolle \(Erfordert\)/,
      }),
    ).toBeInTheDocument();
    expect(
      within(dependenciesSection).getAllByRole('button', {
        name: /GC\.2\.3 Gegenseitige Kontrolle/,
      }),
    ).toHaveLength(1);
    expect(
      within(dependenciesSection).getByRole('button', {
        name: /GC\.2\.1 Nur eingehende Kontrolle \(Verwandt\)/,
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

    expect(screen.getByRole('button', {
      name: /GC\.2\.3 Gegenseitige Kontrolle \(Erfordert\)/,
    })).toBeInTheDocument();
    expect(screen.getByText('GC.2.3 verweist hierauf als „Erfordert"')).toBeInTheDocument();
    expect(screen.getByText('GC.2.3 verweist hierauf als „Verwandt"')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wird referenziert von' })).not.toBeInTheDocument();
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

    expect(screen.getByRole('button', {
      name: /GC\.2\.3 Gegenseitige Kontrolle \(Erfordert\)/,
    })).toBeInTheDocument();
    expect(screen.getAllByText('GC.2.3 verweist hierauf als „Erfordert"')).toHaveLength(1);
    expect(screen.queryByRole('heading', { name: 'Wird referenziert von' })).not.toBeInTheDocument();
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

    expect(screen.getByRole('heading', { name: 'Erweiterungen', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Teil von GC\.5 Übergeordnete Kontrolle/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GC\.5\.1\.1 Erweiterung/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Teil von GC\.5 Übergeordnete Kontrolle/ }));
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

    expect(screen.getByText('Übergeordnet: GC.5')).toBeInTheDocument();
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
      <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />,
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
      <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />,
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
      <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />,
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
      <ControlDetail
          control={makeControl({ id: 'DET.5.4', altIdentifier: 'stable-det-5-4' })}
          onClose={vi.fn()}
        />,
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

  it('keeps long tags readable as unframed text', () => {
    const longTag = 'Advanced Persistent Threats (APT) mit sehr langen Zusatzbezeichnungen';
    render(<ControlDetail control={makeControl({ tags: [longTag] })} onClose={vi.fn()} />);
    const tag = screen.getByText(longTag);
    expect(tag).toBeInTheDocument();
    expect(tag.parentElement).toHaveClass('text-sm', 'leading-relaxed');
    expect(tag).not.toHaveClass('border', 'rounded');
  });

  it('sets aria-expanded and aria-controls on term triggers', async () => {
    const user = userEvent.setup();
    const control = makeControl({
      modalverb: 'MUSS',
      tags: ['Governance'],
      tagsProp: { name: 'tags', value: 'Governance', ns: 'https://example.com/namespaces/tags.csv' },
      statementProps: {
        ergebnis: 'Verfahren und Regelungen',
        ergebnisProp: { name: 'result', value: 'Verfahren und Regelungen', ns: 'https://example.com/namespaces/result.csv' },
        zielobjektKategorien: [],
      },
    });
    render(<ControlDetail control={control} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'MUSS' })).not.toBeInTheDocument();
    const tag = screen.getByRole('button', { name: 'Tag: Governance' });
    const result = screen.getByRole('button', { name: 'Vokabularbegriff Verfahren und Regelungen' });
    for (const trigger of [tag, result]) {
      expect(trigger).toHaveAttribute('aria-expanded', 'false');
      expect(trigger).toHaveAttribute('aria-controls');
    }
    await user.click(tag);
    expect(tag).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(tag.getAttribute('aria-controls')!)).not.toHaveAttribute('hidden');
    await user.click(result);
    expect(tag).toHaveAttribute('aria-expanded', 'false');
    expect(result).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById(result.getAttribute('aria-controls')!)).toBeInTheDocument();
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
    fireEvent.resize(globalThis.window);

    expect(screen.getByRole('button', { name: 'Mehr anzeigen' }))
      .toBeInTheDocument();
  });
});
