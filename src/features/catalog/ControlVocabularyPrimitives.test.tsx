import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import {
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
    expect(trigger).toHaveClass('min-h-11', 'min-w-11');

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
    expect(screen.getByText(': Verbindlich.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'SOLLTE' })).toHaveAttribute(
      'href',
      '/vokabular/modal-verbs?wert=SOLLTE',
    );
    expect(screen.getByText(': Empfohlen.')).toBeInTheDocument();

    // … zweiter Klick schließt wieder.
    fireEvent.click(toggle);
    expect(panel).toHaveAttribute('hidden');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
