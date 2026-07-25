import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
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
    ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_targets_levels.csv',
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
    expect(screen.getByRole('button', {
      name: 'Relevanz Vertraulichkeit: 2',
    })).toHaveAttribute(
      'aria-controls',
      'vocab-card-security-target-level-confidentiality',
    );

    const threat = screen.getByRole('button', {
      name: 'Elementare Gefährdung: G 0.18',
    });
    expect(threat).toHaveAttribute('aria-controls', 'vocab-card-threat-G-0-18-0');
    expect(document.getElementById('vocab-card-threat-G-0-18-0'))
      .toHaveAttribute('hidden');
    expect(screen.getByText('Unbekannte Gefährdung').tagName).toBe('P');

    await user.click(threat);
    expect(onToggleVocabulary).toHaveBeenCalledWith('threat:G 0.18:0');
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
