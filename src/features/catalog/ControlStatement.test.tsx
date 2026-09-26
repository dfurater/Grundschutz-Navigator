import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { SegmentStatementInput, SegmentStatementResult } from '@/domain/statementSegments';
import { segmentStatement } from '@/domain/statementSegments';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { ControlStatement, PLACEHOLDER_TOGGLETIP, type ControlStatementSegmentsProps } from './ControlStatement';
import { ControlStatementDetails, type RestDetail } from './ControlStatementDetails';
import { toVocabCardId } from './ControlVocabularyPrimitives';

function fakeResolution(value: string): VocabularyResolution {
  return {
    namespace: {} as VocabularyResolution['namespace'],
    entry: { value, columns: {} },
  };
}

function plainSegmentsProps(input: SegmentStatementInput): ControlStatementSegmentsProps {
  return {
    input,
    practiceResolution: null,
    modalverbResolution: null,
    handlungswortResolution: null,
    isVocabularyActive: () => false,
    onToggleVocabulary: () => {},
    renderVocabularyCard: () => null,
  };
}

function detailsProps(details: RestDetail[], missing: SegmentStatementResult['missing']) {
  return {
    details,
    missing,
    isVocabularyActive: () => false,
    onToggleVocabulary: () => {},
    renderVocabularyCard: () => null,
  };
}

describe('ControlStatement (GSPP-303 T5)', () => {
  it('Satz mit Begriffen und Hover-Beschriftung; Platzhalter mit Wert als normaler Text', () => {
    const input: SegmentStatementInput = {
      statementRaw:
        'GC: Die Institution muss verankern. Ergebnis beachten, siehe Praezisierung zur {{ insert: param, frist }}.',
      params: { frist: { value: 'Frist', hasValue: true } },
      practiceTitle: 'GC',
      modalverb: 'muss',
      handlungsworte: 'verankern',
      ergebnis: 'Ergebnis',
      praezisierung: 'Praezisierung',
    };
    const onToggleVocabulary = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ControlStatement
          statement="Fallback"
          segments={{
            input,
            practiceResolution: fakeResolution('GC'),
            modalverbResolution: fakeResolution('muss'),
            handlungswortResolution: fakeResolution('verankern'),
            isVocabularyActive: (key) => key === 'satz:practice',
            onToggleVocabulary,
            renderVocabularyCard: (resolution) => (
              <span>{`Karte:${resolution.entry.value}`}</span>
            ),
          }}
        />
      </MemoryRouter>,
    );
    const scope = within(container);

    const triggers: Array<[string, string]> = [
      ['GC', 'satz:practice'],
      ['muss', 'satz:modalverb'],
      ['verankern', 'satz:handlungswort'],
    ];
    for (const [text, key] of triggers) {
      const trigger = scope.getByRole('button', {
        name: `Vokabularbegriff ${text}`,
      });
      expect(trigger).toHaveAttribute('aria-controls', toVocabCardId(key));
    }

    // Platzhalter MIT Wert: Fließtext im Satz — Assert über textContent + Button-Menge (Fragmente ohne Elementknoten).
    const sentence = container.querySelector('section p');
    expect(sentence?.textContent).toBe(
      'GC: Die Institution muss verankern. Ergebnis beachten, siehe Praezisierung zur Frist.',
    );
    const sentenceButtons = scope.getAllByRole('button');
    expect(sentenceButtons).toHaveLength(3);
    expect(scope.queryByRole('button', { name: 'Vokabularbegriff Ergebnis' })).toBeNull();
    expect(
      sentenceButtons.some((button) => button.textContent === 'Frist'),
    ).toBe(false);
    expect(scope.queryByRole('tooltip')).toBeNull();
    expect(container.querySelector('[role="button"]')).toBeNull();

    // Genau EIN Karten-Slot am Sektionsende (aktiver Satz-Key).
    const slots = container.querySelectorAll(
      '[id^="vocab-card-satz-"]',
    );
    expect(slots).toHaveLength(1);
    expect(slots[0].id).toBe(toVocabCardId('satz:practice'));
    expect(slots[0].textContent).toBe('Karte:GC');

    // Klick toggelt über den Satz-Key.
    fireEvent.click(
      scope.getByRole('button', { name: 'Vokabularbegriff GC' }),
    );
    expect(onToggleVocabulary).toHaveBeenCalledTimes(1);
    expect(onToggleVocabulary).toHaveBeenCalledWith('satz:practice');
  });

  it('missing-Teil erscheint als Restzeile', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss dokumentieren.',
      params: {},
      modalverb: 'muss',
      ergebnis: 'Bericht',
    };
    const { missing } = segmentStatement(input);
    expect(missing).toContain('ergebnis');

    const { container } = render(
      <MemoryRouter>
        <ControlStatementDetails
          {...detailsProps(
            [
              {
                key: 'ergebnis',
                label: 'Ergebnis',
                value: 'Bericht',
                resolution: null,
              },
            ],
            missing,
          )}
        />
      </MemoryRouter>,
    );

    expect(within(container).getByText('Ergebnis')).toBeInTheDocument();
    expect(within(container).getByText('Bericht')).toBeInTheDocument();
  });

  it('zeigt Restzeilen innerhalb des Blocks Anforderung', () => {
    const { container } = render(
      <ControlStatement statement="Die Institution muss dokumentieren.">
        <p>Dokumentation der Umsetzung</p>
      </ControlStatement>,
    );

    const section = container.querySelector('section');
    expect(section).toHaveTextContent('Anforderung');
    expect(section).toHaveTextContent('Dokumentation der Umsetzung');
  });

  it("Param ohne Wert: hinterlegter Platzhalter mit FIXED-Text, per Klick öffenbar", () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss {{ insert: param, frist }} einhalten.',
      params: { frist: { value: 'Frist', hasValue: false } },
      modalverb: 'muss',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement
          statement="Fallback"
          segments={plainSegmentsProps(input)}
        />
      </MemoryRouter>,
    );
    const scope = within(container);

    // T2-Lehre: hasValue:false rendert weiterhin den Werttext.
    const frist = scope.getByText('Frist');
    expect(frist).toHaveClass('bg-amber-100');
    expect(PLACEHOLDER_TOGGLETIP).toBe('Platzhalter – Der Wert wird bei der Anwendung festgelegt.');
    expect(frist.closest('[role="button"]')).not.toBeNull();
    expect(scope.queryByRole('tooltip')).toBeNull();

    fireEvent.click(frist);
    expect(
      scope.getByRole('tooltip', { name: PLACEHOLDER_TOGGLETIP }),
    ).toBeInTheDocument();
  });

  it('Satz-fontSize: 16', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss dokumentieren.',
      params: {},
      modalverb: 'muss',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement
          statement="Fallback"
          segments={plainSegmentsProps(input)}
        />
      </MemoryRouter>,
    );

    const sentence = Array.from(container.querySelectorAll('p')).find(
      (paragraph) => paragraph.style.fontSize === '16px',
    );
    expect(sentence).toBeDefined();
    expect(sentence?.textContent).toContain('Die Institution muss');
  });

  it('ControlStatementDetails: nur missing-Zeilen + Dokumentation, Label-über-Inhalt, kein Affordance-Icon', () => {
    const missing: SegmentStatementResult['missing'] = ['ergebnis'];
    const { container } = render(
      <MemoryRouter>
        <ControlStatementDetails
          {...detailsProps(
            [
              {
                key: 'ergebnis',
                label: 'Ergebnis',
                value: 'Bericht',
                resolution: null,
              },
              {
                key: 'praezisierung',
                label: 'Präzisierung',
                value: 'Details zum Bericht',
                resolution: null,
              },
              {
                key: 'handlungsworte',
                label: 'Handlungswort',
                value: 'erstellen',
                resolution: null,
              },
              {
                key: 'dokumentation',
                label: 'Dokumentation',
                value: 'Im Handbuch.',
                resolution: null,
              },
            ],
            missing,
          )}
        />
      </MemoryRouter>,
    );
    const scope = within(container);

    expect(scope.getByText('Bericht')).toBeInTheDocument();
    expect(scope.getByText('Im Handbuch.')).toBeInTheDocument();
    expect(scope.queryByText('Details zum Bericht')).toBeNull();
    expect(scope.queryByText('erstellen')).toBeNull();

    const label = scope.getByText('Ergebnis');
    expect(label.tagName).toBe('P');
    expect(label).toHaveClass('catalog-meta-text');

    expect(
      container.querySelector('.catalog-vocabulary-affordance'),
    ).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('Ergebnis-/Präzisierung-Segment trägt Hover-Tooltip mit echter aria-describedby-Verdrahtung', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Ergebnis beachten, siehe Praezisierung.',
      params: {},
      ergebnis: 'Ergebnis',
      praezisierung: 'Praezisierung',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement
          statement="Fallback"
          segments={{
            ...plainSegmentsProps(input),
          }}
        />
      </MemoryRouter>,
    );
    const scope = within(container);

    for (const [text, tip] of [
      ['Ergebnis', 'Ergebnis'],
      ['Praezisierung', 'Präzisierung'],
    ] as const) {
      const trigger = scope.getByText(text);
      expect(trigger.closest('button')).toBeNull();

      fireEvent.mouseEnter(trigger);
      fireEvent.focus(trigger);
      const tooltipNode = scope.getByRole('tooltip', { name: tip });
      expect(trigger).toHaveAttribute('aria-describedby', tooltipNode.id);
    }
  });
});
