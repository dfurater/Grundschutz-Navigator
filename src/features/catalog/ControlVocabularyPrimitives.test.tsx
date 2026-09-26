import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { tightStackClass } from '@/components/legendStyles';
import {
  detailListClass,
  LegendPanel,
  rowTouchTargetClass,
  SectionLegend,
  TermTrigger,
  toVocabCardId,
} from './ControlVocabularyPrimitives';

describe('ControlVocabularyPrimitives (GSPP-303 T4)', () => {
  it('TermTrigger rendert abbr-Stil ohne Icon; offen trägt aria-expanded', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <TermTrigger
        vocabKey="muss"
        active
        onToggle={onToggle}
        label="MUSS"
        ariaLabel="Vokabularbegriff MUSS"
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Vokabularbegriff MUSS',
    });

    // Abkürzungs-Stil: gepunktet unterstrichenes Label statt Icon-Affordanz.
    const label = screen.getByText('MUSS');
    expect(label.tagName).toBe('SPAN');
    expect(label).toHaveClass(
      'underline',
      'decoration-dotted',
      'underline-offset-4',
    );
    expect(container.querySelector('svg')).toBeNull();
    expect(
      container.querySelector('.catalog-vocabulary-affordance'),
    ).toBeNull();

    // Offener Zustand: Karten-Steuerung + aktive Hervorhebung.
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(trigger).toHaveAttribute('aria-controls', toVocabCardId('muss'));
    expect(trigger).toHaveClass('font-medium', 'text-primary-main');
    // Zeile 24 px bei jeder Breite; die Touch-Fläche wächst per Pseudo-Element,
    // damit am Breakpoint nichts springt.
    expect(trigger).toHaveClass('min-h-6', ...rowTouchTargetClass.split(' '));
    expect(trigger).not.toHaveClass('min-h-11');

    // Klick toggelt über den Vokabular-Schlüssel.
    fireEvent.click(trigger);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith('muss');
  });

  it("tooltip-Prop wird über Tooltip mode='hover' mit aria-describedby verdrahtet", () => {
    render(
      <TermTrigger
        vocabKey="muss"
        active={false}
        onToggle={() => {}}
        label="MUSS"
        ariaLabel="Vokabularbegriff MUSS"
        tooltip="Verbindliche Anforderung."
      />,
    );
    const trigger = screen.getByRole('button', {
      name: 'Vokabularbegriff MUSS',
    });

    // Fokus öffnet den Hover-Tooltip sofort (T3: Fokus umgeht hoverDelayMs).
    fireEvent.focus(trigger);
    const tooltipNode = screen.getByRole('tooltip', {
      name: 'Verbindliche Anforderung.',
    });

    // Echte Verdrahtung am geöffneten Tooltip: der BUTTON trägt
    // aria-describedby auf genau diesen Container.
    expect(trigger).toHaveAttribute('aria-describedby', tooltipNode.id);
    expect(tooltipNode.id).toBe(`${toVocabCardId('muss')}-tooltip`);
  });

  it('SectionLegend rendert Textlink ohne Icon; Klick toggelt Panel mit allen Entries', () => {
    const { container } = render(
      <MemoryRouter>
        <SectionLegend
          legendId="legende-kurzprofil"
          entries={[
            {
              term: 'MUSS',
              definition: 'Verbindlich.',
              href: '/vokabular/modal-verbs?wert=MUSS',
            },
            {
              term: 'SOLLTE',
              definition: 'Empfohlen.',
              href: '/vokabular/modal-verbs?wert=SOLLTE',
            },
          ]}
        />
      </MemoryRouter>,
    );

    // Textlink „Legende", kein Icon.
    const toggle = screen.getByRole('button', { name: 'Legende' });
    expect(container.querySelector('svg')).toBeNull();
    expect(toggle).toHaveAttribute('aria-controls', 'legende-kurzprofil');

    // Panel startet geschlossen …
    const panel = document.getElementById('legende-kurzprofil');
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('hidden');

    // … Klick öffnet es mit allen Entries (Term + Definition + href-Link) …
    fireEvent.click(toggle);
    expect(panel).not.toHaveAttribute('hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    const mussLink = screen.getByRole('link', { name: 'MUSS' });
    expect(mussLink).toHaveAttribute(
      'href',
      '/vokabular/modal-verbs?wert=MUSS',
    );
    expect(screen.getByText('Verbindlich.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SOLLTE' })).toHaveAttribute(
      'href',
      '/vokabular/modal-verbs?wert=SOLLTE',
    );
    expect(screen.getByText('Empfohlen.')).toBeInTheDocument();

    // … zweiter Klick schließt wieder.
    fireEvent.click(toggle);
    expect(panel).toHaveAttribute('hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('LegendPanel zeigt „Merkmal: Symbol“ über der Erklärung', () => {
    render(
      <LegendPanel
        legendId="legende-symbole"
        open
        entries={[
          { category: 'Stufe', term: '1', definition: 'Wirkt hin.', visual: <span>●○</span> },
          { category: 'Stufe', term: '2', definition: 'Wirkt in besonderem Maße hin.', visual: <span>●●</span> },
        ]}
      />,
    );

    const panel = document.getElementById('legende-symbole');
    const terms = [...(panel?.querySelectorAll('dt') ?? [])];
    // Das Symbol steht sichtbar, die Ziffer nur für Screenreader.
    expect(terms.map((term) => term.textContent)).toEqual(['Stufe: ●○1', 'Stufe: ●●2']);
    expect(screen.getByText('2')).toHaveClass('sr-only');
    for (const term of terms) {
      // Block statt fließend: Die Erklärung beginnt in einer eigenen Zeile.
      expect(term).not.toHaveClass('inline');
      expect(term.nextElementSibling?.tagName).toBe('DD');
      expect(term.nextElementSibling).not.toHaveClass('inline');
    }
    expect(screen.getByText('Wirkt hin.').textContent).toBe('Wirkt hin.');
  });

  it('Detail-Listen halten nach einer offenen Karte 12 px zum nächsten Eintrag', () => {
    // Listenzeilen stehen 6 px auseinander; die Karte in einem Eintrag außer
    // dem letzten bekommt deshalb `mb-3` (Abstandsregel in legendStyles).
    expect(detailListClass.split(' ')).toContain(tightStackClass);
    expect(tightStackClass).toBe('[&>:not(:last-child)_[data-vocab-card]]:mb-3');
  });
});
