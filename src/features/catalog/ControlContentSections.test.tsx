import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { Control } from '@/domain/models';
import { resolveControlVocabularies } from '@/domain/vocabulary';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import { ControlGuidance } from './ControlGuidance';
import { ControlSecurityContext } from './ControlSecurityContext';
import { ControlStatement } from './ControlStatement';
import { ControlStatementDetails, type RestDetail } from './ControlStatementDetails';

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
    ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv',
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

const SECURITY_TARGETS_NS =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_targets.csv';

const allTargetsControl = makeControl({
  confidentiality: '2',
  confidentialityProp: { name: 'confidentiality', value: '2', ns: SECURITY_TARGETS_NS },
  integrity: '1',
  integrityProp: { name: 'integrity', value: '1', ns: SECURITY_TARGETS_NS },
  availability: '1',
  availabilityProp: { name: 'availability', value: '1', ns: SECURITY_TARGETS_NS },
  authenticity: '0',
  authenticityProp: { name: 'authenticity', value: '0', ns: SECURITY_TARGETS_NS },
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
  it('renders resolved and unresolved security targets in a two-column grid', () => {
    const { container } = render(
      <MemoryRouter><ControlSecurityContext
        control={allTargetsControl}
        resolvedVocabularies={allTargetsResolutions}
        isVocabularyActive={() => false}
        onToggleVocabulary={vi.fn()}
        renderVocabularyCard={renderVocabularyCard}
      /></MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Schutzziele', level: 4 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Elementare Gefährdungen', level: 4 })).toBeInTheDocument();
    expect(container.querySelector('.grid.grid-cols-2')).not.toBeNull();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    for (const label of ['Vertraulichkeit', 'Integrität', 'Verfügbarkeit', 'Authentizität']) {
      expect(screen.getByRole('button', { name: `Schutzziel: ${label}` })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Relevanz Vertraulichkeit: 2' })).toHaveTextContent('2');
    expect(screen.getByRole('button', { name: 'Legende' })).toBeInTheDocument();
    expect(container.querySelector('.catalog-vocabulary-affordance')).toBeNull();
  });

  it('keeps vocabulary cards independently accessible and hides unresolved threats', async () => {
    const user = userEvent.setup();
    const onToggleVocabulary = vi.fn();
    render(
      <MemoryRouter><ControlSecurityContext
        control={resolvedControl}
        resolvedVocabularies={resolutions}
        isVocabularyActive={(key) => key === 'security-target:confidentiality'}
        onToggleVocabulary={onToggleVocabulary}
        renderVocabularyCard={renderVocabularyCard}
      /></MemoryRouter>,
    );

    const target = screen.getByRole('button', { name: 'Schutzziel: Vertraulichkeit' });
    expect(target).toHaveAttribute('aria-expanded', 'true');
    expect(target).toHaveAttribute('aria-controls', 'vocab-card-security-target-confidentiality');
    expect(screen.getByText('Karte: Vertraulichkeit (Confidentiality)')).toBeInTheDocument();
    const threat = screen.getByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    });
    expect(threat).toHaveTextContent('Fehlplanung oder fehlende Anpassung');
    expect(threat).not.toHaveTextContent('G 0.18');
    expect(threat).toHaveAttribute('aria-controls', 'vocab-card-threat-G-0-18-0');
    expect(document.getElementById('vocab-card-threat-G-0-18-0')).toHaveAttribute('hidden');
    expect(screen.getByText('Unbekannte Gefährdung').tagName).toBe('P');
    await user.click(threat);
    expect(onToggleVocabulary).toHaveBeenCalledWith('threat:G 0.18:0');
  });

  it('sorts threat names and keeps duplicate vocabulary keys stable', async () => {
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
    render(
      <MemoryRouter><ControlSecurityContext
        control={control}
        resolvedVocabularies={resolveControlVocabularies(createTestVocabularyRegistry(), control)}
        isVocabularyActive={() => false}
        onToggleVocabulary={onToggleVocabulary}
        renderVocabularyCard={renderVocabularyCard}
      /></MemoryRouter>,
    );

    const list = screen.getByRole('heading', { name: 'Elementare Gefährdungen', level: 4 }).parentElement!;
    expect(Array.from(list.querySelectorAll('button, p')).map((item) => item.textContent)).toEqual([
      'Fehlplanung oder fehlende Anpassung',
      'Fehlplanung oder fehlende Anpassung',
      'G 0.20',
      'Offenlegung schützenswerter Informationen',
      'Unbekannte Gefährdung',
    ]);
    const duplicates = screen.getAllByRole('button', {
      name: 'Elementare Gefährdung: Fehlplanung oder fehlende Anpassung (G 0.18)',
    });
    expect(duplicates.map((button) => button.getAttribute('aria-controls'))).toEqual([
      'vocab-card-threat-G-0-18-2', 'vocab-card-threat-G-0-18-4',
    ]);
    await user.click(duplicates[1]);
    expect(onToggleVocabulary).toHaveBeenCalledWith('threat:G 0.18:4');
  });
});

describe('ControlStatement and ControlStatementDetails', () => {
  it('shows only unembedded values with their labels above the content', async () => {
    const user = userEvent.setup();
    const onToggleVocabulary = vi.fn();
    const details: RestDetail[] = [
      { key: 'ergebnis', label: 'Ergebnis', value: 'Verfahren und Regelungen', resolution: resolutions.statement.ergebnis },
      { key: 'praezisierung', label: 'Präzisierung', value: 'Unbekannte Präzisierung', resolution: null },
      { key: 'handlungsworte', label: 'Handlungswort', value: 'verankern', resolution: resolutions.statement.handlungsworte },
      { key: 'dokumentation', label: 'Dokumentation', value: 'Richtlinie A', resolution: resolutions.statement.dokumentation },
    ];
    render(
      <MemoryRouter>
        <ControlStatement statement={resolvedControl.statement} />
        <ControlStatementDetails
          details={details}
          missing={['ergebnis', 'praezisierung']}
          isVocabularyActive={(key) => key === 'ergebnis'}
          onToggleVocabulary={onToggleVocabulary}
          renderVocabularyCard={renderVocabularyCard}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Anforderung']);
    expect(screen.getByText('Mehrzeilige Anforderung')).toHaveClass('whitespace-pre-line');
    expect(screen.queryByText('Handlungswort')).not.toBeInTheDocument();
    for (const label of ['Ergebnis', 'Präzisierung', 'Dokumentation']) {
      expect(screen.getByText(label).tagName).toBe('P');
    }
    const result = screen.getByRole('button', { name: 'Vokabularbegriff Verfahren und Regelungen' });
    expect(result).toHaveAttribute('aria-controls', 'vocab-card-ergebnis');
    expect(screen.getByText('Karte: Verfahren und Regelungen')).toBeInTheDocument();
    expect(screen.getByText('Unbekannte Präzisierung')).toHaveClass('w-full', 'break-words');
    await user.click(result);
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
