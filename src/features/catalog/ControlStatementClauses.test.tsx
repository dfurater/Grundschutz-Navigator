import { act, fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { SegmentStatementInput } from '@/domain/statementSegments';
import { segmentStatement } from '@/domain/statementSegments';
import { ControlStatement, PLACEHOLDER_TOGGLETIP, type ControlStatementSegmentsProps } from './ControlStatement';
import { ControlStatementDetails } from './ControlStatementDetails';

function plainSegmentsProps(input: SegmentStatementInput): ControlStatementSegmentsProps {
  return {
    input,
    practiceResolution: null,
    handlungswortResolution: null,
    isVocabularyActive: () => false,
    onToggleVocabulary: () => {},
    renderVocabularyCard: () => null,
  };
}

const GROUPED_INPUT: SegmentStatementInput = {
  statementRaw: 'Die Institution muss Meldungen anhand von {{ insert: param, k }} innerhalb einer Frist prüfen.',
  params: { k: { value: 'Kriterien', hasValue: false } },
  modalverb: 'muss',
  praezisierung: 'anhand von Kriterien innerhalb einer Frist',
};

describe('ControlStatement Satzteile und Restdetails (GSPP-303 Review)', () => {
  it('Platzhalter als ganze Präzisierung nennt den Satzteil in seiner Erklärung', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss Meldungen {{ insert: param, frist }} prüfen.',
      params: { frist: { value: 'innerhalb einer Frist', hasValue: false } },
      modalverb: 'muss',
      handlungsworte: 'prüfen',
      praezisierung: 'innerhalb einer Frist',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={plainSegmentsProps(input)} />
      </MemoryRouter>,
    );
    const scope = within(container);

    fireEvent.click(scope.getByText('innerhalb einer Frist'));
    expect(
      scope.getByRole('tooltip', { name: `Präzisierung${PLACEHOLDER_TOGGLETIP}` }),
    ).toBeInTheDocument();
  });

  it.each([
    ['ergebnis', 'ergebnisResolution', 'Ergebnis'],
    ['praezisierung', 'praezisierungResolution', 'Präzisierung'],
  ] as const)('Parameterwert als ganzer Satzteil %s wird mit Vokabeleintrag zum Begriffs-Trigger', (role, resolutionProp, tip) => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss {{ insert: param, ziel }} festlegen.',
      params: { ziel: { value: 'Sicherheitsziele', hasValue: true } },
      modalverb: 'muss',
      [role]: 'Sicherheitsziele',
    };
    const onToggleVocabulary = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={{
          ...plainSegmentsProps(input),
          [resolutionProp]: { namespace: {} as never, entry: { value: 'Sicherheitsziele', columns: {} } },
          isVocabularyActive: (key) => key === `satz:${role}`,
          onToggleVocabulary,
          renderVocabularyCard: (resolution) => <span>{`Karte:${resolution.entry.value}`}</span>,
        }} />
      </MemoryRouter>,
    );
    const scope = within(container);

    const trigger = scope.getByRole('button', { name: 'Vokabularbegriff Sicherheitsziele' });
    expect(trigger).toHaveAttribute('aria-controls', `vocab-card-satz-${role}`);
    // Beschriftung des richtigen Satzteils, kein zusätzliches Satzteil-Fokusziel.
    fireEvent.mouseEnter(trigger);
    fireEvent.focus(trigger);
    expect(scope.getByRole('tooltip', { name: tip })).toBeInTheDocument();
    expect(container.querySelectorAll('section p [tabindex="0"]')).toHaveLength(0);
    expect(container.querySelector(`#vocab-card-satz-${role}`)?.textContent).toBe('Karte:Sicherheitsziele');
    fireEvent.click(trigger);
    expect(onToggleVocabulary).toHaveBeenCalledWith(`satz:${role}`);
  });

  it('Platzhalter ohne Wert bleibt auch mit Vokabeleintrag des Satzteils Platzhalter', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss {{ insert: param, ziel }} festlegen.',
      params: { ziel: { value: 'Sicherheitsziele', hasValue: false } },
      modalverb: 'muss',
      ergebnis: 'Sicherheitsziele',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={{
          ...plainSegmentsProps(input),
          ergebnisResolution: { namespace: {} as never, entry: { value: 'Sicherheitsziele', columns: {} } },
        }} />
      </MemoryRouter>,
    );
    const scope = within(container);

    expect(scope.queryByRole('button', { name: 'Vokabularbegriff Sicherheitsziele' })).toBeNull();
    fireEvent.click(scope.getByText('Sicherheitsziele'));
    expect(scope.getByRole('tooltip', { name: `Ergebnis${PLACEHOLDER_TOGGLETIP}` })).toBeInTheDocument();
  });

  it('Handlungswort nur im Parameterwert bleibt über seine Restzeile erklärbar', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss die Regeln {{ insert: param, p }}.',
      params: { p: { value: 'verschärfen', hasValue: true } },
      modalverb: 'muss',
      handlungsworte: 'verschärfen',
    };
    const resolution = { namespace: {} as never, entry: { value: 'verschärfen', columns: {} } };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={{ ...plainSegmentsProps(input), handlungswortResolution: resolution }}>
          <ControlStatementDetails
            details={[{ key: 'handlungsworte', label: 'Handlungswort', value: 'verschärfen', resolution }]}
            missing={segmentStatement(input).missing}
            isVocabularyActive={() => false}
            onToggleVocabulary={() => {}}
            renderVocabularyCard={() => null}
          />
        </ControlStatement>
      </MemoryRouter>,
    );
    const scope = within(container);

    expect(scope.getByText('Handlungswort')).toBeInTheDocument();
    const trigger = scope.getByRole('button', { name: 'Vokabularbegriff verschärfen' });
    expect(container.querySelector(`#${trigger.getAttribute('aria-controls') ?? ''}`)).not.toBeNull();
  });

  it('ControlStatementDetails: geschlossene Karte bleibt als aria-controls-Ziel im DOM', () => {
    const { container } = render(
      <MemoryRouter>
        <ControlStatementDetails
          details={[{ key: 'dokumentation', label: 'Dokumentationsvorgabe', value: 'Protokoll', resolution: { namespace: {} as never, entry: { value: 'Protokoll', columns: {} } } }]}
          missing={[]}
          isVocabularyActive={() => false}
          onToggleVocabulary={() => {}}
          renderVocabularyCard={() => null}
        />
      </MemoryRouter>,
    );

    const trigger = within(container).getByRole('button', { name: 'Vokabularbegriff Protokoll' });
    const card = container.querySelector(`#${trigger.getAttribute('aria-controls') ?? ''}`);
    expect(card).not.toBeNull();
    expect(card).toHaveAttribute('hidden');
  });

  it('zeigt Anforderungsdetails auch ohne Satzprosa', () => {
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="">
          <p>Dokumentation vorhanden</p>
        </ControlStatement>
      </MemoryRouter>,
    );

    expect(within(container).getByRole('heading', { name: 'Anforderung' })).toBeInTheDocument();
    expect(within(container).getByText('Dokumentation vorhanden')).toBeInTheDocument();
  });

  it('Satzteile sind per Tab erreichbar und zeigen ihre Beschriftung beim Fokus', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss Meldungen fristgerecht prüfen.',
      params: {},
      modalverb: 'muss',
      praezisierung: 'fristgerecht',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={plainSegmentsProps(input)} />
      </MemoryRouter>,
    );
    const scope = within(container);
    const clause = scope.getByText('fristgerecht', { selector: '[aria-describedby]' });

    expect(clause).toHaveAttribute('tabindex', '0');
    // Die Beschreibung existiert schon vor dem Fokus (für Screenreader).
    expect(document.getElementById(clause.getAttribute('aria-describedby') ?? '')).toHaveTextContent('Präzisierung');
    expect(scope.queryByRole('tooltip')).toBeNull();

    fireEvent.focus(clause);
    expect(scope.getByRole('tooltip', { name: 'Präzisierung' })).toBeInTheDocument();
  });

  it('Antippen öffnet die Satzteil-Beschriftung nicht', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss Meldungen fristgerecht prüfen.',
      params: {},
      modalverb: 'muss',
      praezisierung: 'fristgerecht',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={plainSegmentsProps(input)} />
      </MemoryRouter>,
    );
    const scope = within(container);
    const clause = scope.getByText('fristgerecht', { selector: '[aria-describedby]' });

    fireEvent.pointerDown(clause, { pointerType: 'touch' });
    fireEvent.focus(clause);
    expect(scope.queryByRole('tooltip')).toBeNull();
  });

  it('fasst einen Satzteil mit Platzhalter zu einem Fokusziel zusammen', () => {
    const input: SegmentStatementInput = {
      statementRaw: 'Die Institution muss Meldungen anhand von {{ insert: param, k }} innerhalb einer Frist prüfen.',
      params: { k: { value: 'Kriterien', hasValue: false } },
      modalverb: 'muss',
      praezisierung: 'anhand von Kriterien innerhalb einer Frist',
    };
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={plainSegmentsProps(input)} />
      </MemoryRouter>,
    );
    const scope = within(container);
    const clauses = container.querySelectorAll('section p [tabindex="0"]');
    expect(clauses).toHaveLength(1);
    const placeholder = scope.getByText('Kriterien').closest('button');
    expect(clauses[0]).toContainElement(placeholder);

    // Fokus auf den Platzhalter öffnet nur dessen eigene Erklärung.
    fireEvent.focus(placeholder as HTMLElement);
    expect(scope.queryByRole('tooltip')).toBeNull();
    fireEvent.click(placeholder as HTMLElement);
    expect(scope.getAllByRole('tooltip')).toHaveLength(1);
    expect(scope.getByRole('tooltip', { name: `Präzisierung${PLACEHOLDER_TOGGLETIP}` })).toBeInTheDocument();
  });

  it('Maus in der Platzhalter-Erklärung öffnet nicht zusätzlich den Satzteil', () => {
    vi.useFakeTimers();
    try {
      const { container } = render(
        <MemoryRouter>
          <ControlStatement statement="Fallback" segments={plainSegmentsProps(GROUPED_INPUT)} />
        </MemoryRouter>,
      );
      const scope = within(container);
      fireEvent.click(scope.getByText('Kriterien'));
      const placeholderTip = scope.getByRole('tooltip');

      fireEvent.mouseOver(placeholderTip);
      act(() => vi.advanceTimersByTime(600));
      expect(scope.getAllByRole('tooltip')).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('Tastaturfokus nach Antippen eines Platzhalters zeigt die Satzteil-Beschriftung', () => {
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={plainSegmentsProps(GROUPED_INPUT)} />
      </MemoryRouter>,
    );
    const scope = within(container);
    const placeholder = scope.getByText('Kriterien').closest('button') as HTMLElement;
    fireEvent.pointerDown(placeholder, { pointerType: 'touch' });
    fireEvent.focus(placeholder);
    fireEvent.blur(placeholder);

    const clause = container.querySelector('section p [tabindex="0"]') as HTMLElement;
    fireEvent.focus(clause);
    expect(scope.getByRole('tooltip', { name: 'Präzisierung' })).toBeInTheDocument();
  });

  it('Antippen des Satzteils nach fokussiertem Platzhalter öffnet keine Beschriftung', () => {
    const { container } = render(
      <MemoryRouter>
        <ControlStatement statement="Fallback" segments={plainSegmentsProps(GROUPED_INPUT)} />
      </MemoryRouter>,
    );
    const scope = within(container);
    const placeholder = scope.getByText('Kriterien').closest('button') as HTMLElement;
    const clause = container.querySelector('section p [tabindex="0"]') as HTMLElement;
    fireEvent.focus(placeholder);

    fireEvent.pointerDown(clause, { pointerType: 'touch' });
    fireEvent.blur(placeholder);
    fireEvent.focus(clause);
    expect(scope.queryByRole('tooltip', { name: 'Präzisierung' })).toBeNull();
  });
});

