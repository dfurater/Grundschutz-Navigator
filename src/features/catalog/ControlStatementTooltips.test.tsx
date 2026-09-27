import { fireEvent, render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router';
import type { SegmentStatementInput } from '@/domain/statementSegments';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { ControlStatement, type ControlStatementSegmentsProps } from './ControlStatement';

/*
 * Eigene Tooltip-ID je Auslöser (Greptile-Befund im Release-PR #307).
 *
 * Mit Vokabeleintrag wird jedes Stück eines Satzteils ein eigener
 * Begriffs-Trigger mit eigenem Tooltip; alle Stücke steuern dieselbe
 * Vokabelkarte. Entstünde die Tooltip-ID allein aus dem Vokabelschlüssel,
 * verwiese `aria-describedby` des zweiten Stücks auf den Tooltip des ersten.
 * Geprüft wird deshalb für jeden Auslöser im Satz, dass seine Beschreibung
 * der Tooltip in seinem eigenen Bereich ist und keine ID doppelt vorkommt.
 */

function fakeResolution(value: string): VocabularyResolution {
  return {
    namespace: {} as VocabularyResolution['namespace'],
    entry: { value, columns: {} },
  };
}

function renderStatement(input: SegmentStatementInput, resolutions: Partial<ControlStatementSegmentsProps> = {}) {
  return render(
    <MemoryRouter>
      <ControlStatement
        statement="Fallback"
        segments={{
          input,
          practiceResolution: null,
          modalverbResolution: null,
          handlungswortResolution: null,
          isVocabularyActive: () => false,
          onToggleVocabulary: () => {},
          renderVocabularyCard: () => null,
          ...resolutions,
        }}
      />
    </MemoryRouter>,
  ).container;
}

function expectOwnTooltips(container: HTMLElement, describedCount: number) {
  const ids = [...container.querySelectorAll('[role="tooltip"]')].map((tooltip) => tooltip.id);
  expect(new Set(ids).size).toBe(ids.length);

  const targets = [...container.querySelectorAll<HTMLElement>('[aria-describedby]')];
  expect(targets).toHaveLength(describedCount);
  for (const target of targets) {
    const tooltip = document.getElementById(target.getAttribute('aria-describedby') ?? '');
    expect(tooltip?.getAttribute('role')).toBe('tooltip');
    expect(tooltip?.parentElement).toBe(target.closest('[data-tooltip-root]'));
  }
}

describe('Tooltips im Anforderungssatz', () => {
  it('beschreibt jedes Stück eines erklärten Satzteils mit seinem eigenen Tooltip', () => {
    const container = renderStatement({
      statementRaw: 'Die Institution muss eine {{ insert: param, a }}{{ insert: param, b }} erstellen.',
      params: {
        a: { value: 'Risiko-', hasValue: true },
        b: { value: 'Analyse', hasValue: true },
      },
      modalverb: 'muss',
      ergebnis: 'Risiko-Analyse',
    }, { ergebnisResolution: fakeResolution('Risiko-Analyse') });

    const triggers = container.querySelectorAll('button[aria-describedby]');
    expect([...triggers].map((trigger) => trigger.getAttribute('aria-label')))
      .toEqual(['Vokabularbegriff Risiko-', 'Vokabularbegriff Analyse']);
    // Beide Stücke steuern weiter dieselbe Vokabelkarte.
    expect(new Set([...triggers].map((trigger) => trigger.getAttribute('aria-controls'))).size).toBe(1);
    expectOwnTooltips(container, 2);
  });

  it('vergibt eindeutige IDs auch neben Platzhaltern und Satzteilen ohne Vokabeleintrag', () => {
    const container = renderStatement({
      statementRaw: 'Die Institution muss {{ insert: param, frist }} eine Risiko-{{ insert: param, b }} '
        + 'erstellen und {{ insert: param, ort }} fristgerecht prüfen.',
      params: {
        frist: { value: 'Frist', hasValue: false },
        b: { value: 'Analyse', hasValue: true },
        ort: { value: 'Ort', hasValue: false },
      },
      modalverb: 'muss',
      ergebnis: 'Risiko-Analyse',
      praezisierung: 'fristgerecht',
    }, { ergebnisResolution: fakeResolution('Risiko-Analyse') });

    // Zwei Platzhalter, zwei Stücke des erklärten Ergebnisses, eine Präzisierung.
    expectOwnTooltips(container, 5);
  });

  it('öffnet die Satzteil-Beschriftung per Tastatur, nachdem ein fokussierter Platzhalter erneut angetippt wurde', () => {
    // Greptile-Befund im Release-PR #309: Das Antippen erreicht per Bubbling auch
    // den Satzteil-Tooltip. Ohne Fokuswechsel verbraucht kein Fokusereignis die
    // Touch-Markierung, und sie sperrte den folgenden Tastaturfokus des Satzteils.
    const container = renderStatement({
      statementRaw: 'Die Institution muss Meldungen anhand von {{ insert: param, k }} innerhalb einer Frist prüfen.',
      params: { k: { value: 'Kriterien', hasValue: false } },
      modalverb: 'muss',
      praezisierung: 'anhand von Kriterien innerhalb einer Frist',
    });
    const scope = within(container);
    const placeholder = scope.getByText('Kriterien').closest('button') as HTMLElement;
    const clause = container.querySelector('section p [tabindex="0"]') as HTMLElement;
    fireEvent.focus(placeholder);
    fireEvent.pointerDown(placeholder, { pointerType: 'touch' });

    // Umschalt+Tab vom Platzhalter zurück auf den Satzteil.
    fireEvent.blur(placeholder);
    fireEvent.focus(clause);
    expect(scope.getByRole('tooltip', { name: 'Präzisierung' })).toBeInTheDocument();
  });
});
