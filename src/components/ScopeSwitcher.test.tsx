import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { ScopeSwitcher } from './ScopeSwitcher';
import type { ScopeSwitcherProps } from './ScopeSwitcher';

// Vier Einträge statt der drei ausgelieferten: Der Baustein iteriert über die
// übergebenen Einträge und kennt keine Katalogschlüssel.
const ITEMS = [
  { key: 'gspp', title: 'Anwenderkatalog Grundschutz++', href: '/katalog/gspp' },
  { key: 'lieferkette', title: 'Supply Chain Security', href: '/katalog/lieferkette' },
  { key: 'wlan', title: 'Stand der Technik WLAN', href: '/katalog/wlan' },
  { key: 'tls', title: '  Mindeststandard TLS (Entwurf)', href: '/katalog/tls' },
] as const;

function Location() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function renderSwitcher(props: Partial<ScopeSwitcherProps> = {}) {
  return render(
    <MemoryRouter initialEntries={['/start']}>
      <ScopeSwitcher
        label="Katalog"
        items={ITEMS}
        activeKey="lieferkette"
        trailing={<button type="button">Einklappen</button>}
        {...props}
      />
      <Routes>
        <Route path="*" element={<Location />} />
      </Routes>
      <button type="button">Außerhalb</button>
    </MemoryRouter>,
  );
}

const trigger = () => screen.getByRole('button', { name: 'Katalog: Supply Chain Security' });

describe('ScopeSwitcher', () => {
  it('nennt den aktiven Titel wörtlich, mit der Klasse als Präfix des Namens', () => {
    renderSwitcher();

    expect(trigger()).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('Katalog:', { exact: false })).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Einklappen' })).toBeInTheDocument();
  });

  it('listet alle Einträge als Links und markiert nur den aktiven', () => {
    renderSwitcher();
    fireEvent.click(trigger());

    expect(trigger()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu', { name: 'Katalog wechseln' })).toBeInTheDocument();
    const items = screen.getAllByRole('menuitemradio');
    expect(items.map((item) => item.getAttribute('href'))).toEqual(ITEMS.map(({ href }) => href));
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false']);
    // Wörtlich heißt auch: kein Trimmen von Randleerzeichen.
    expect(items[3].textContent).toBe('  Mindeststandard TLS (Entwurf)');
    expect(items[1].querySelector('svg')).not.toBeNull();
    expect(items[0].querySelector('svg')).toBeNull();
    // Nur Überschrift und Einträge, keine weitere Textzeile.
    expect(screen.getByRole('menu').textContent).toBe(
      `Katalog wechseln${ITEMS.map(({ title }) => title).join('')}`,
    );
  });

  it('navigiert bei Auswahl, schließt das Menü, gibt den Fokus zurück und meldet die Auswahl', () => {
    const onItemActivate = vi.fn();
    renderSwitcher({ onItemActivate });
    fireEvent.click(trigger());

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Stand der Technik WLAN' }));

    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/wlan');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
    expect(onItemActivate).toHaveBeenCalledWith('wlan');
  });

  it('öffnet per Pfeiltaste mit Fokus auf dem aktiven Eintrag und bewegt zyklisch', () => {
    renderSwitcher();
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });

    const items = screen.getAllByRole('menuitemradio');
    expect(items[1]).toHaveFocus();
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(items[1], { key: 'ArrowDown' });
    expect(items[2]).toHaveFocus();
    fireEvent.keyDown(items[2], { key: 'ArrowDown' });
    fireEvent.keyDown(items[3], { key: 'ArrowDown' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(items[3]).toHaveFocus();
    fireEvent.keyDown(items[3], { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'End' });
    expect(items[3]).toHaveFocus();

    menu.focus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(items[3]).toHaveFocus();
    menu.focus();
    fireEvent.keyDown(menu, { key: ' ' });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('öffnet auch per Pfeil nach oben und wählt mit der Leertaste', () => {
    renderSwitcher();
    fireEvent.keyDown(trigger(), { key: 'ArrowUp' });
    const items = screen.getAllByRole('menuitemradio');
    expect(items[1]).toHaveFocus();

    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    const wasNotPrevented = fireEvent.keyDown(items[0], { key: ' ' });

    expect(wasNotPrevented).toBe(false);
    expect(screen.getByTestId('location')).toHaveTextContent('/katalog/gspp');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('zeigt ohne passenden aktiven Eintrag keinen Auslöser, aber das Element rechts', () => {
    renderSwitcher({ activeKey: 'unbekannt' });

    expect(screen.queryByRole('button', { name: /^Katalog:/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Einklappen' })).toBeInTheDocument();
  });

  it('schließt per Escape mit Fokus-Rückgabe und per Tab am Auslöser', () => {
    renderSwitcher();
    fireEvent.click(trigger());

    const wasNotPrevented = fireEvent.keyDown(screen.getAllByRole('menuitemradio')[1], { key: 'Escape' });
    expect(wasNotPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();

    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getAllByRole('menuitemradio')[1], { key: 'Tab' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).toHaveFocus();
  });

  it('schließt bei Klick außerhalb, nicht bei Klick ins Menü', () => {
    renderSwitcher();
    fireEvent.click(trigger());

    fireEvent.mouseDown(screen.getByRole('menu'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole('button', { name: 'Einklappen' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('schließt, wenn der Fokus den Baustein verlässt', () => {
    renderSwitcher();
    fireEvent.click(trigger());
    const items = screen.getAllByRole('menuitemradio');

    fireEvent.blur(items[1], { relatedTarget: items[2] });
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.blur(items[1], { relatedTarget: screen.getByRole('button', { name: 'Außerhalb' }) });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('schaltet per Klick auf den Auslöser auf und zu', () => {
    renderSwitcher();
    fireEvent.click(trigger());
    expect(screen.getByRole('menu')).toHaveAttribute('id', trigger().getAttribute('aria-controls'));

    fireEvent.click(trigger());
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger()).not.toHaveAttribute('aria-controls');
  });
});
