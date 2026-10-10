import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TreeNav, type TreeItem } from '@/components/TreeNav';

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

    const row = screen.getByRole('treeitem', { name: /Anwendungen/ });

    expect(row.className).toContain('focus-visible:ring-2');

    const classNames = [row, container.firstChild]
      .map((element) => (element instanceof HTMLElement ? element.className : ''))
      .join(' ');

    expect(classNames).not.toMatch(/\b(?:bg|text|border|ring)-slate-/);
    expect(classNames).not.toContain('focus:ring-');
  });

  it('gibt allen Kürzeln einer Ebene die Breite des längsten Kürzels', () => {
    render(
      <TreeNav
        items={[
          { id: 'GC', label: 'Governance', prefix: 'GC' },
          {
            id: 'KONF',
            label: 'Konfiguration',
            prefix: 'KONF',
            children: [
              { id: 'KONF.1', label: 'Thema eins', prefix: 'KONF.1' },
              { id: 'KONF.12', label: 'Thema zwölf', prefix: 'KONF.12' },
            ],
          },
          { id: 'OHNE', label: 'Ohne Kürzel' },
        ]}
        selectedId="KONF.1"
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('GC').style.width).toBe('calc(4ch + 0.5rem)');
    expect(screen.getByText('KONF').style.width).toBe('calc(4ch + 0.5rem)');
    expect(screen.getByText('KONF.1').style.width).toBe('calc(7ch + 0.5rem)');
    expect(screen.getByText('KONF.12').style.width).toBe('calc(7ch + 0.5rem)');
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
      screen.getByRole('treeitem', { name: /Unterpunkt/ }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('treeitem', { name: /Anwendungen/ }));

    expect(
      screen.queryByRole('treeitem', { name: /Unterpunkt/ }),
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

    expect(screen.getByRole('treeitem', { name: /Bereich ohne Kennung/ })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: /Bereich mit Kennung/ })).toBeInTheDocument();
  });

  it('löst beim Anklicken keine Navigation aus', () => {
    const onSelect = vi.fn();
    render(<TreeNav items={items} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole('treeitem', { name: /Bereich ohne Kennung/ }));
    expect(onSelect).not.toHaveBeenCalled();

    // Der adressierbare Nachbar navigiert unverändert.
    fireEvent.click(screen.getByRole('treeitem', { name: /Bereich mit Kennung/ }));
    expect(onSelect).toHaveBeenCalledWith('MIT');
  });

  it('bleibt per Tastatur aufklappbar, ohne ein Navigationsziel zu erzeugen', () => {
    const onSelect = vi.fn();
    render(<TreeNav items={items} onSelect={onSelect} />);
    const row = screen.getByRole('treeitem', { name: /Bereich ohne Kennung/ });

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(onSelect).not.toHaveBeenCalled();
    // Aufgeklappt: das adressierbare Kind ist jetzt erreichbar.
    expect(screen.getByRole('treeitem', { name: /Thema mit Kennung/ })).toBeInTheDocument();
  });

  it('wird nie als ausgewählt markiert, auch wenn keine Auswahl gesetzt ist', () => {
    render(<TreeNav items={items} onSelect={vi.fn()} selectedId={undefined} />);

    const row = screen.getByRole('treeitem', { name: /Bereich ohne Kennung/ });
    expect(row.closest('[role="treeitem"]')).toHaveAttribute('aria-selected', 'false');
  });
});


describe('TreeNav — Tastaturvertrag', () => {
  const items = [
    { id: 'A', label: 'Alpha', children: [
      { label: 'Ohne Kennung', children: [{ id: 'A.1', label: 'Blatt' }] },
      { id: 'A.2', label: 'Zweites Kind' },
    ] },
    { id: 'B', label: 'Beta' },
    { id: 'C', label: 'Gamma', children: [] },
  ];
  const row = (name: string) => screen.getByRole('treeitem', { name });
  const focus = (name: string) => act(() => row(name).focus());
  const key = (name: string) => fireEvent.keyDown(document.activeElement!, { key: name });
  const tabstops = () => screen.getAllByRole('treeitem').filter((item) => item.tabIndex === 0);

  it('hat genau einen benannten semantischen Treeitem-Tabstopp', () => {
    render(<TreeNav items={items} onSelect={vi.fn()} />);
    expect(screen.getByRole('tree', { name: 'Katalog-Explorer' })).toBeInTheDocument();
    expect(tabstops()).toEqual([row('Alpha')]);
    expect(row('Alpha')).toHaveAttribute('aria-expanded', 'false');
    expect(row('Gamma')).not.toHaveAttribute('aria-expanded');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('bewegt Fokus mit Up/Down und Home/End nur durch sichtbare Knoten', () => {
    const onSelect = vi.fn();
    render(<TreeNav items={items} onSelect={onSelect} />);
    focus('Alpha');
    key('ArrowUp');
    expect(row('Alpha')).toHaveFocus();
    key('ArrowDown');
    expect(row('Beta')).toHaveFocus();
    key('End');
    expect(row('Gamma')).toHaveFocus();
    key('ArrowDown');
    expect(row('Gamma')).toHaveFocus();
    key('Home');
    key('ArrowRight');
    key('ArrowDown');
    expect(row('Ohne Kennung')).toHaveFocus();
    key('ArrowDown');
    expect(row('Zweites Kind')).toHaveFocus();
    key('ArrowUp');
    expect(row('Ohne Kennung')).toHaveFocus();
    expect(tabstops()).toEqual([row('Ohne Kennung')]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('öffnet rechts vor dem Kindwechsel und schließt links vor dem Elternwechsel', () => {
    render(<TreeNav items={items} onSelect={vi.fn()} />);
    focus('Alpha');
    key('ArrowRight');
    expect(row('Alpha')).toHaveFocus();
    key('ArrowRight');
    expect(row('Ohne Kennung')).toHaveFocus();
    key('ArrowRight');
    key('ArrowRight');
    expect(row('Blatt')).toHaveFocus();
    key('ArrowRight');
    expect(row('Blatt')).toHaveFocus();
    key('ArrowLeft');
    expect(row('Ohne Kennung')).toHaveFocus();
    key('ArrowLeft');
    expect(row('Ohne Kennung')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Blatt' })).toBeNull();
    key('ArrowLeft');
    expect(row('Alpha')).toHaveFocus();
    key('ArrowLeft');
    key('ArrowLeft');
    expect(row('Alpha')).toHaveFocus();
  });

  it.each(['Enter', ' '])('aktiviert mit %s genau den fokussierten Knoten', (activation) => {
    const onSelect = vi.fn();
    render(<TreeNav items={items} onSelect={onSelect} />);
    focus('Alpha');
    key(activation);
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('A');
    key('ArrowRight');
    key(activation);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(row('Blatt')).toBeInTheDocument();
    key('ArrowRight');
    key(activation);
    expect(onSelect).toHaveBeenLastCalledWith('A.1');
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(row('Alpha')).toHaveAttribute('aria-expanded', 'true');
  });

  it('kollabiert ausgewählte Nachfahren und öffnet erst bei neuer Auswahl automatisch', () => {
    const { rerender } = render(<TreeNav items={items} selectedId="A.1" onSelect={vi.fn()} />);
    expect(tabstops()).toEqual([row('Blatt')]);
    fireEvent.click(row('Alpha').firstElementChild!);
    expect(row('Alpha')).toHaveFocus();
    expect(tabstops()).toEqual([row('Alpha')]);
    rerender(<TreeNav items={items} selectedId="A.1" onSelect={vi.fn()} />);
    expect(screen.queryByRole('treeitem', { name: 'Blatt' })).toBeNull();
    rerender(<TreeNav items={items} selectedId="A.2" onSelect={vi.fn()} />);
    expect(row('Zweites Kind')).toHaveAttribute('aria-selected', 'true');
    expect(row('Alpha')).toHaveFocus();
    expect(tabstops()).toEqual([row('Alpha')]);
  });

  it('repariert einen entfernten Fokus zum sichtbaren Elternknoten', () => {
    const { rerender } = render(<TreeNav items={items} selectedId="A.1" onSelect={vi.fn()} />);
    focus('Blatt');
    const reduced: TreeItem[] = [{ ...items[0], children: [items[0].children![0], items[0].children![1]] }, items[1]];
    reduced[0] = { ...reduced[0], children: [{ label: 'Ohne Kennung' }, items[0].children![1]] };
    rerender(<TreeNav items={reduced} onSelect={vi.fn()} />);
    expect(row('Ohne Kennung')).toHaveFocus();
    expect(tabstops()).toEqual([row('Ohne Kennung')]);
  });

  it('erhält externen Fokus bei leerem Baum und beim Austausch der Knoten', () => {
    const { rerender } = render(<><button>Außerhalb</button><TreeNav items={items} onSelect={vi.fn()} /></>);
    focus('Beta');
    act(() => screen.getByRole('button', { name: 'Außerhalb' }).focus());
    rerender(<><button>Außerhalb</button><TreeNav items={[]} onSelect={vi.fn()} /></>);
    expect(screen.getByRole('button')).toHaveFocus();
    rerender(<><button>Außerhalb</button><TreeNav items={[{ id: 'NEU', label: 'Neu' }]} onSelect={vi.fn()} /></>);
    expect(screen.getByRole('button')).toHaveFocus();
    expect(tabstops()).toEqual([row('Neu')]);
  });

  it('öffnet die Auswahl auch dann, wenn ihre Knoten erst später eintreffen', () => {
    const { rerender } = render(<TreeNav items={[]} selectedId="A.1" onSelect={vi.fn()} />);
    rerender(<TreeNav items={items} selectedId="A.1" onSelect={vi.fn()} />);
    expect(row('Blatt')).toHaveAttribute('aria-selected', 'true');
    expect(tabstops()).toEqual([row('Blatt')]);
  });

});
