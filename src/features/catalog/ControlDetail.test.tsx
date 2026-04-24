import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogState, Control } from '@/domain/models';
import type { IncomingControlLink } from '@/domain/controlRelationships';
import { useCatalog } from '@/hooks/useCatalog';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { ControlDetail, getControlDetailUrl } from './ControlDetail';

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: vi.fn(),
}));

const mockedUseCatalog = vi.mocked(useCatalog);
const vocabularyRegistry = createTestVocabularyRegistry();

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.2.2',
    title: 'Kontrolle mit Verweisen',
    groupId: 'GC.2',
    practiceId: 'GC',
    tags: [],
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

function makeCatalogState(overrides: Partial<CatalogState> = {}): CatalogState {
  return {
    catalog: null,
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
    expect(screen.getByText('Modalverb definiert verbindliche Anforderungen.')).toBeInTheDocument();
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
      guidance: 'Mit dokumentierten Freigaben arbeiten.',
      statementProps: {
        ergebnis: 'Ergebnis',
        praezisierung: 'präzisiert',
        handlungsworte: 'umsetzen',
        dokumentation: 'Richtlinie A',
        zielobjektKategorien: ['Server'],
      },
      links: [{ targetId: 'GC.2.3', relation: 'related' }],
    });
    const incomingLinks: IncomingControlLink[] = [
      {
        control: makeControl({
          id: 'GC.2.1',
          title: 'Voraussetzung',
        }),
        relation: 'required',
      },
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

    render(
      <ControlDetail
        control={control}
        incomingLinks={incomingLinks}
        parentControl={parentControl}
        childControls={[childControl]}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    const classification = screen.getByRole('heading', { name: 'Klassifikation', level: 3 });
    const statement = screen.getByRole('heading', { name: 'Anforderung', level: 3 });
    const details = screen.getByRole('heading', { name: 'Anforderungsdetails', level: 3 });
    const guidance = screen.getByRole('heading', { name: 'Umsetzungshinweise', level: 3 });
    const dependencies = screen.getByRole('heading', { name: 'Abhängigkeiten', level: 3 });
    const hierarchy = screen.getByRole('heading', { name: 'Hierarchie', level: 3 });
    const metadata = screen.getByRole('heading', { name: 'Technische Metadaten', level: 3 });
    const orderedHeadings = [
      classification,
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

  it('shows outgoing link title when controlsById is provided', () => {
    const linkedControl = makeControl({ id: 'GC.2.3', title: 'Verknüpfte Basiskontrolle' });
    const controlsById = new Map([[linkedControl.id, linkedControl]]);
    const control = makeControl({
      links: [{ targetId: 'GC.2.3', relation: 'related' }],
    });

    render(
      <ControlDetail
        control={control}
        controlsById={controlsById}
        onClose={vi.fn()}
        onNavigateToControl={vi.fn()}
      />,
    );

    expect(screen.getByText('Verknüpfte Basiskontrolle')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /GC\.2\.3 Verknüpfte Basiskontrolle/ })).toBeInTheDocument();
    expect(screen.getByText('GC.2.3')).toBeInTheDocument();
  });

  it('renders and navigates incoming control references', async () => {
    const user = userEvent.setup();
    const onNavigateToControl = vi.fn();
    const control = makeControl({
      links: [{ targetId: 'GC.2.3', relation: 'related' }],
    });
    const incomingLinks: IncomingControlLink[] = [
      {
        control: makeControl({
          id: 'GC.2.1',
          title: 'Voraussetzung',
        }),
        relation: 'required',
      },
    ];

    render(
      <ControlDetail
        control={control}
        incomingLinks={incomingLinks}
        onClose={vi.fn()}
        onNavigateToControl={onNavigateToControl}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Wird referenziert von', level: 4 })).toBeInTheDocument();
    const reverseLinkButton = screen.getByRole('button', { name: /GC\.2\.1 Voraussetzung \(erforderlich\)/ });
    expect(reverseLinkButton).toBeInTheDocument();

    await user.click(reverseLinkButton);

    expect(onNavigateToControl).toHaveBeenCalledWith('GC.2.1');
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
      links: [{ targetId: reciprocalControl.id, relation: 'required' }],
    });
    const incomingLinks: IncomingControlLink[] = [
      {
        control: reciprocalControl,
        relation: 'required',
      },
      {
        control: incomingOnlyControl,
        relation: 'related',
      },
    ];

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
        name: /GC\.2\.3 Gegenseitige Kontrolle \(erforderlich\)/,
      }),
    ).toBeInTheDocument();
    expect(
      within(incomingSection).queryByRole('button', {
        name: /GC\.2\.3 Gegenseitige Kontrolle/,
      }),
    ).not.toBeInTheDocument();
    expect(
      within(incomingSection).getByRole('button', {
        name: /GC\.2\.1 Nur eingehende Kontrolle \(verwandt\)/,
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
      links: [{ targetId: reciprocalControl.id, relation: 'required' }],
    });
    const incomingLinks: IncomingControlLink[] = [
      {
        control: reciprocalControl,
        relation: 'required',
      },
      {
        control: reciprocalControl,
        relation: 'related',
      },
    ];

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
      name: /GC\.2\.3 Gegenseitige Kontrolle \(erforderlich · ↔ verwandt\)/,
    });

    expect(outgoingButton).toBeInTheDocument();
    expect(within(outgoingButton).getByText('erforderlich · ↔ verwandt')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wird referenziert von', level: 4 })).not.toBeInTheDocument();
  });

  it('omits the reverse relation marker when reciprocal links use the same relation', () => {
    const reciprocalControl = makeControl({
      id: 'GC.2.3',
      title: 'Gegenseitige Kontrolle',
    });
    const controlsById = new Map([[reciprocalControl.id, reciprocalControl]]);
    const control = makeControl({
      links: [{ targetId: reciprocalControl.id, relation: 'required' }],
    });
    const incomingLinks: IncomingControlLink[] = [
      {
        control: reciprocalControl,
        relation: 'required',
      },
    ];

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
      name: /GC\.2\.3 Gegenseitige Kontrolle \(erforderlich\)/,
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

    expect(onNavigateToControl).toHaveBeenNthCalledWith(1, 'GC.5');
    expect(onNavigateToControl).toHaveBeenNthCalledWith(2, 'GC.5.1.1');
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
      getControlDetailUrl('DET.5.4', {
        origin: 'https://dfurater.github.io',
        baseUrl: '/Grundschutz-Navigator/',
      }),
    ).toBe('https://dfurater.github.io/Grundschutz-Navigator/katalog/DET.5.4');

    expect(
      getControlDetailUrl('DET.5.4', {
        origin: 'http://localhost:5173',
        baseUrl: '/',
      }),
    ).toBe('http://localhost:5173/katalog/DET.5.4');
  });

  it('copies the direct link for the current control', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const originalClipboard = navigator.clipboard;

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(
      <MemoryRouter>
        <ControlDetail control={makeControl({ id: 'DET.5.4' })} onClose={vi.fn()} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: 'Link kopieren' }));

    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/katalog/DET.5.4');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: originalClipboard,
    });
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
});
