import { createRef } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { ControlGuidance } from './ControlGuidance';
import { ControlSecurityContext } from './ControlSecurityContext';
import { ControlStatement } from './ControlStatement';
import { ControlStatementDetails } from './ControlStatementDetails';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.2.2',
    title: 'Kontrolle mit Inhaltssektionen',
    groupId: 'GC.2',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Mehrzeilige\nAnforderung',
    statementRaw: 'Mehrzeilige\nAnforderung',
    guidance: 'Ausführlicher Umsetzungshinweis',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

const resolvedControl = makeControl({
  confidentiality: '2',
  confidentialityProp: {
    name: 'confidentiality',
    value: '2',
    ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets_levels.csv',
  },
  threats: ['G 0.18', 'Unbekannte Gefährdung'],
  threatsProp: {
    name: 'threats',
    value: 'G 0.18, Unbekannte Gefährdung',
    ns: 'https://example.com/namespaces/basethreats.csv',
  },
  statementProps: {
    ergebnis: 'Verfahren und Regelungen',
    ergebnisProp: {
      name: 'result',
      value: 'Verfahren und Regelungen',
      ns: 'https://example.com/namespaces/result.csv',
    },
    praezisierung: 'Unbekannte Präzisierung',
    handlungsworte: 'verankern',
    handlungsworteProp: {
      name: 'action_words',
      value: 'verankern',
      ns: 'https://example.com/namespaces/action_words.csv',
    },
    dokumentation: 'Richtlinie A',
    dokumentationProp: {
      name: 'documentation',
      value: 'Richtlinie A',
      ns: 'https://example.com/namespaces/documentation_guidelines.csv',
    },
    zielobjektKategorien: [],
  },
});

const resolutions = resolveControlVocabularies(
  createTestVocabularyRegistry(),
  resolvedControl,
);

const SECURITY_TARGET_LEVELS_NS =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets_levels.csv';

const allTargetsControl = makeControl({
  confidentiality: '2',
  confidentialityProp: { name: 'confidentiality', value: '2', ns: SECURITY_TARGET_LEVELS_NS },
  integrity: '1',
  integrityProp: { name: 'integrity', value: '1', ns: SECURITY_TARGET_LEVELS_NS },
  availability: '1',
  availabilityProp: { name: 'availability', value: '1', ns: SECURITY_TARGET_LEVELS_NS },
  authenticity: '0',
  authenticityProp: { name: 'authenticity', value: '0', ns: SECURITY_TARGET_LEVELS_NS },
  threats: ['G 0.18'],
  threatsProp: {
    name: 'threats',
    value: 'G 0.18',
    ns: 'https://example.com/namespaces/basethreats.csv',
  },
});

const allTargetsResolutions = resolveControlVocabularies(
  createTestVocabularyRegistry(),
  allTargetsControl,
);

function renderVocabularyCard(
  resolution: NonNullable<typeof resolutions.modalverb>,
) {
  return <p>{`Karte: ${resolution.entry.value}`}</p>;
}

describe('ControlSecurityContext', () => {
  it('renders resolved and unresolved values with preserved labels and hidden targets', async () => {
    const user = userEvent.setup();
    const onToggleVocabulary = vi.fn();

    render(
      <ControlSecurityContext
        control={resolvedControl}
        resolvedVocabularies={resolutions}
        isVocabularyActive={(key) => key === 'security-target:confidentiality'}
        onToggleVocabulary={onToggleVocabulary}
        renderVocabularyCard={renderVocabularyCard}
      />,
    );

    expect(screen.getByRole('heading', {
      name: 'Schutzziele und Gefährdungen',
      level: 3,
    })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Schutzziele', level: 4 }))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', {
      name: 'Elementare Gefährdungen',
      level: 4,
    })).toBeInTheDocument();

    const securityTarget = screen.getByRole('button', {
      name: 'Schutzziel: Vertraulichkeit',
    });
    expect(securityTarget).toHaveAttribute('aria-expanded', 'true');
    expect(securityTarget).toHaveAttribute(
      'aria-controls',
      'vocab-card-security-target-confidentiality',
    );
    expect(screen.getByText('Karte: Vertraulichkeit (Confidentiality)'))
      .toBeInTheDocument();
    const targetCardRow = document.getElementById(
      'vocab-card-security-target-confidentiality',
    )!;
    expect(targetCardRow.tagName).toBe('TR');
    expect(targetCardRow.querySelector('td')).toHaveAttribute('colspan', '2');
    expect(targetCardRow.previousElementSibling).toBe(
      screen.getByRole('rowheader', { name: 'Vertraulichkeit' }).closest('tr'),
    );
    expect(screen.getByRole('button', {
      name: 'Relevanz Vertraulichkeit: 2',
    })).toHaveAttribute(
      'aria-controls',
      'vocab-card-security-target-level-confidentiality',
    );

    const threat = screen.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    });
    expect(threat).toHaveAttribute('aria-controls', 'vocab-card-threat-G-0-18-0');
    expect(document.getElementById('vocab-card-threat-G-0-18-0'))
      .toHaveAttribute('hidden');
    expect(screen.getByText('Unbekannte Gefährdung').tagName).toBe('P');

    await user.click(threat);
    expect(onToggleVocabulary).toHaveBeenCalledWith('threat:G 0.18:0');
  });

  it('renders the security targets as an accessible table with a single visible Relevanz header', () => {
    render(
      <ControlSecurityContext
        control={allTargetsControl}
        resolvedVocabularies={allTargetsResolutions}
        isVocabularyActive={() => false}
        onToggleVocabulary={vi.fn()}
        renderVocabularyCard={renderVocabularyCard}
      />,
    );

    const table = screen.getByRole('table', { name: 'Schutzziele und ihre Relevanz' });
    const columnHeaders = within(table).getAllByRole('columnheader');
    expect(columnHeaders.map((header) => header.textContent)).toEqual([
      'Schutzziel',
      'Relevanz',
    ]);
    expect(within(columnHeaders[0]).getByText('Schutzziel')).toHaveClass('sr-only');
    expect(columnHeaders[1]).not.toHaveClass('sr-only');
    expect(screen.getAllByText('Relevanz')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Schutzziele', level: 4 }))
      .toHaveLength(1);

    const rowHeaders = within(table).getAllByRole('rowheader');
    expect(rowHeaders.map((header) => header.textContent)).toEqual([
      'Vertraulichkeit',
      'Integrität',
      'Verfügbarkeit',
      'Authentizität',
    ]);
    rowHeaders.forEach((header) => expect(header).toHaveAttribute('scope', 'row'));
    columnHeaders.forEach((header) => expect(header).toHaveAttribute('scope', 'col'));
  });

  it('renders the relevance as a screenreader-hidden dot scale with the numeric value', () => {
    render(
      <ControlSecurityContext
        control={allTargetsControl}
        resolvedVocabularies={allTargetsResolutions}
        isVocabularyActive={() => false}
        onToggleVocabulary={vi.fn()}
        renderVocabularyCard={renderVocabularyCard}
      />,
    );

    const relevance = screen.getByRole('button', { name: 'Relevanz Vertraulichkeit: 2' });
    expect(relevance).toHaveAttribute('title', 'Relevanz Vertraulichkeit: 2');
    const dots = relevance.querySelectorAll('span[aria-hidden="true"]');
    expect(dots).toHaveLength(2);
    dots.forEach((dot) => expect(dot).toHaveAttribute('aria-hidden', 'true'));
    expect(relevance.textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Relevanz Authentizität: 0' }))
      .toHaveAttribute('title', 'Relevanz Authentizität: 0');
  });

  it('puts the affordance icon before the trigger text without changing accessible names', () => {
    render(
      <ControlSecurityContext
        control={allTargetsControl}
        resolvedVocabularies={allTargetsResolutions}
        isVocabularyActive={() => false}
        onToggleVocabulary={vi.fn()}
        renderVocabularyCard={renderVocabularyCard}
      />,
    );

    const triggers = [
      screen.getByRole('button', { name: 'Schutzziel: Vertraulichkeit' }),
      screen.getByRole('button', { name: 'Relevanz Vertraulichkeit: 2' }),
      screen.getByRole('button', {
        name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
      }),
    ];

    triggers.forEach((trigger) => {
      const icon = trigger.querySelector('.catalog-vocabulary-affordance');
      expect(icon).not.toBeNull();
      expect(icon).not.toHaveClass('mt-0.5');
      expect(trigger.firstElementChild).toBe(icon?.parentElement);
    });

    expect(
      screen.getByRole('button', { name: 'Schutzziel: Vertraulichkeit' }).textContent,
    ).toBe('Vertraulichkeit');
  });

  it('shows threats as name and ID, sorted alphabetically with stable vocabulary keys', async () => {
    const user = userEvent.setup();
    const onToggleVocabulary = vi.fn();
    const control = makeControl({
      threats: ['G 0.19', 'Unbekannte Gefährdung', 'G 0.18', 'G 0.20', 'G 0.18'],
      threatsProp: {
        name: 'threats',
        value: 'G 0.19, Unbekannte Gefährdung, G 0.18, G 0.20, G 0.18',
        ns: 'https://example.com/namespaces/basethreats.csv',
      },
    });
    const threatResolutions = resolveControlVocabularies(
      createTestVocabularyRegistry(),
      control,
    );

    render(
      <ControlSecurityContext
        control={control}
        resolvedVocabularies={threatResolutions}
        isVocabularyActive={() => false}
        onToggleVocabulary={onToggleVocabulary}
        renderVocabularyCard={renderVocabularyCard}
      />,
    );

    const threatList = screen.getByRole('heading', {
      name: 'Elementare Gefährdungen',
      level: 4,
    }).parentElement!;
    const entries = Array.from(
      threatList.querySelectorAll('button, p'),
    ).map((element) => element.textContent);
    expect(entries).toEqual([
      'Fehlplanung oder fehlende Anpassung (G 0.18)',
      'Fehlplanung oder fehlende Anpassung (G 0.18)',
      'G 0.20',
      'Offenlegung schützenswerter Informationen (G 0.19)',
      'Unbekannte Gefährdung',
    ]);

    expect(screen.getByText('Unbekannte Gefährdung').tagName).toBe('P');
    expect(screen.getByRole('button', { name: 'Elementare Gefährdung: G 0.20' }))
      .toBeInTheDocument();

    const duplicates = screen.getAllByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    });
    expect(duplicates.map((button) => button.getAttribute('aria-controls'))).toEqual([
      'vocab-card-threat-G-0-18-2',
      'vocab-card-threat-G-0-18-4',
    ]);

    await user.click(duplicates[1]);
    expect(onToggleVocabulary).toHaveBeenCalledWith('threat:G 0.18:4');
  });
});

describe('ControlStatement and ControlStatementDetails', () => {
  it('preserves section order, typography, dl semantics, and vocabulary wiring', async () => {
    const user = userEvent.setup();
    const onToggleVocabulary = vi.fn();

    render(
      <>
        <ControlStatement statement={resolvedControl.statement} />
        <ControlStatementDetails
          statementProps={resolvedControl.statementProps}
          resolutions={resolutions.statement}
          isVocabularyActive={(key) => key === 'ergebnis'}
          onToggleVocabulary={onToggleVocabulary}
          renderVocabularyCard={renderVocabularyCard}
        />
      </>,
    );

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      'Anforderung',
      'Anforderungsdetails',
    ]);
    expect(screen.getByText('Mehrzeilige Anforderung')).toHaveClass(
      'w-full',
      'whitespace-pre-line',
      '[hyphens:auto]',
    );

    const ergebnisLabel = screen.getByText('Ergebnis');
    expect(ergebnisLabel.tagName).toBe('DT');
    expect(ergebnisLabel.nextElementSibling?.tagName).toBe('DD');
    const ergebnisButton = screen.getByRole('button', {
      name: 'Verfahren und Regelungen',
    });
    expect(ergebnisButton).toHaveAttribute('aria-controls', 'vocab-card-ergebnis');
    expect(document.getElementById('vocab-card-ergebnis')).not.toHaveAttribute('hidden');
    expect(screen.getByText('Karte: Verfahren und Regelungen')).toBeInTheDocument();

    expect(screen.getByText('Unbekannte Präzisierung').tagName).toBe('P');
    expect(screen.getByText('Handlungswort').tagName).toBe('DT');
    expect(screen.getByText('Dokumentation').tagName).toBe('DT');

    await user.click(ergebnisButton);
    expect(onToggleVocabulary).toHaveBeenCalledWith('ergebnis');
  });
});

describe('ControlGuidance', () => {
  it('is controlled and preserves clamp, target ID, and toggle labels', async () => {
    const user = userEvent.setup();
    const onToggleExpanded = vi.fn();
    const guidanceRef = createRef<HTMLParagraphElement>();
    const view = render(
      <ControlGuidance
        guidance="Ausführlicher Umsetzungshinweis"
        guidanceRef={guidanceRef}
        expanded={false}
        hasOverflow
        onToggleExpanded={onToggleExpanded}
      />,
    );

    const guidance = screen.getByText('Ausführlicher Umsetzungshinweis');
    expect(guidance).toHaveAttribute('id', 'guidance-text');
    expect(guidance).toHaveClass('line-clamp-5', 'whitespace-pre-line');
    const expand = screen.getByRole('button', { name: 'Mehr anzeigen' });
    expect(expand).toHaveAttribute('aria-controls', 'guidance-text');
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    await user.click(expand);
    expect(onToggleExpanded).toHaveBeenCalledOnce();

    view.rerender(
      <ControlGuidance
        guidance="Ausführlicher Umsetzungshinweis"
        guidanceRef={guidanceRef}
        expanded
        hasOverflow
        onToggleExpanded={onToggleExpanded}
      />,
    );
    expect(guidance).not.toHaveClass('line-clamp-5');
    expect(screen.getByRole('button', { name: 'Weniger anzeigen' }))
      .toHaveAttribute('aria-expanded', 'true');
  });
});
