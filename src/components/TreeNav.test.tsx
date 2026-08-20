import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeNav } from './TreeNav';

describe('TreeNav', () => {
  it('uses focus-visible rings and token-based classes for tree rows', () => {
    const { container } = render(
      <TreeNav
        items={[
          {
            id: 'APP.1',
            label: 'Anwendungen',
            prefix: 'APP',
            badge: '12',
            children: [
              { id: 'APP.1.1', label: 'Unterpunkt', badge: '3' },
            ],
          },
        ]}
        selectedId="APP.1"
        onSelect={vi.fn()}
      />,
    );

    const row = screen.getByRole('button', { name: /Anwendungen/ });

    expect(row.className).toContain('focus-visible:ring-2');

    const classNames = [row, container.firstChild]
      .map((element) => (element instanceof HTMLElement ? element.className : ''))
      .join(' ');

    expect(classNames).not.toMatch(/\b(?:bg|text|border|ring)-slate-/);
    expect(classNames).not.toContain('focus:ring-');
  });

  it('allows collapsing a branch even when a descendant is selected', () => {
    render(
      <TreeNav
        items={[
          {
            id: 'APP.1',
            label: 'Anwendungen',
            children: [
              { id: 'APP.1.1', label: 'Unterpunkt' },
            ],
          },
        ]}
        selectedId="APP.1.1"
        onSelect={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Unterpunkt/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Anwendungen/ }));

    expect(
      screen.queryByRole('button', { name: /Unterpunkt/ }),
    ).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/*  Gruppe ohne id (GSPP-242)                                          */
/* ------------------------------------------------------------------ */

describe('TreeNav — Eintrag ohne id', () => {
  const items = [
    {
      // `group.id` ist in OSCAL 1.1.3 optional; ein solcher Eintrag ist nicht
      // adressierbar, bleibt aber vollständig sichtbar.
      label: 'Bereich ohne Kennung',
      badge: '2',
      children: [{ id: 'MIT.1', label: 'Thema mit Kennung', badge: '2' }],
    },
    { id: 'MIT', label: 'Bereich mit Kennung', badge: '5' },
  ];

  it('stellt Titel, Badge und Kinder trotz fehlender id dar', () => {
    render(<TreeNav items={items} onSelect={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Bereich ohne Kennung/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Bereich mit Kennung/ })).toBeInTheDocument();
  });

  it('löst beim Anklicken keine Navigation aus', () => {
    const onSelect = vi.fn();
    render(<TreeNav items={items} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('button', { name: /Bereich ohne Kennung/ }));
    expect(onSelect).not.toHaveBeenCalled();

    // Der adressierbare Nachbar navigiert unverändert.
    fireEvent.click(screen.getByRole('button', { name: /Bereich mit Kennung/ }));
    expect(onSelect).toHaveBeenCalledWith('MIT');
  });

  it('bleibt per Tastatur aufklappbar, ohne ein Navigationsziel zu erzeugen', () => {
    const onSelect = vi.fn();
    render(<TreeNav items={items} onSelect={onSelect} />);
    const row = screen.getByRole('button', { name: /Bereich ohne Kennung/ });

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    // Aufgeklappt: das adressierbare Kind ist jetzt erreichbar.
    expect(screen.getByRole('button', { name: /Thema mit Kennung/ })).toBeInTheDocument();
  });

  it('wird nie als ausgewählt markiert, auch wenn keine Auswahl gesetzt ist', () => {
    render(<TreeNav items={items} onSelect={vi.fn()} selectedId={undefined} />);

    const row = screen.getByRole('button', { name: /Bereich ohne Kennung/ });
    expect(row.closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'false');
  });
});
