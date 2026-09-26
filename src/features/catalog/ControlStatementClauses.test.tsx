import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { SegmentStatementInput } from '@/domain/statementSegments';
import { ControlStatement, PLACEHOLDER_TOGGLETIP, type ControlStatementSegmentsProps } from './ControlStatement';

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
});
