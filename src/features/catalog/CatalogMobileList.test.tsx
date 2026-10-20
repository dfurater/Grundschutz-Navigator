import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { useTabletDetailPanel } from '@/hooks/useTabletDetailPanel';
import { renderHook } from '@testing-library/react';
import { CatalogMobileList, type CatalogMobileListHandle } from './CatalogMobileList';

vi.mock('@/features/export/csvExport', () => ({ downloadCSV: vi.fn() }));
const controls = Array.from({ length: 1000 }, (_, index) => ({
  id: `GC.1.${index}`, title: `Kontrolle ${index}`, groupId: 'GC.1', practiceId: 'GC',
  tags: [], threats: [], links: [], params: {},
} as unknown as Control));
const props = {
  controls, controlsById: new Map(controls.map((control) => [control.id, control])),
  allControls: controls, hasOwnScrollArea: true, selectMode: false,
  checkedIds: new Set<string>(), onSelect: vi.fn(), onCheckedChange: vi.fn(),
  onSelectionDone: vi.fn(),
};

afterEach(() => vi.restoreAllMocks());

describe('CatalogMobileList', () => {
  it('begrenzt das DOM und hält den Fokus nach Scrollen, Sortieren und Filtern', () => {
    const view = render(<CatalogMobileList {...props} />);
    const first = screen.getByRole('button', { name: /GC.1.0 / });
    const scroller = first.closest('[data-row-index]')!.parentElement!;
    Object.defineProperty(scroller, 'clientHeight', { value: 440 });
    act(() => first.focus());
    fireEvent.scroll(scroller, { target: { scrollTop: 44000 } });
    expect(first).toHaveFocus();
    expect(view.container.querySelectorAll('[data-control-row]').length).toBe(27);
    expect(view.container.querySelector('[data-control-row="GC.1.500"]')).not.toBeNull();
    view.rerender(<CatalogMobileList {...props} controls={[...controls].reverse()} />);
    expect(first).toHaveFocus();
    view.rerender(<CatalogMobileList {...props} controls={[]} />);
    expect(screen.getByText('Keine Kontrollen gefunden')).toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-control-row]')).toHaveLength(0);
  });

  it.each([false, true])('tabbt über fehlende Nachbarn in beiden Richtungen (Auswahl: %s)', (selectMode) => {
    const view = render(<CatalogMobileList {...props} selectMode={selectMode} />);
    const first = screen.getByRole('button', { name: /GC.1.0 / });
    const scroller = first.closest('[data-row-index]')!.parentElement!;
    act(() => first.focus());
    fireEvent.scroll(scroller, { target: { scrollTop: 44000 } });
    fireEvent.keyDown(first, { key: 'Tab' });
    const next = selectMode
      ? screen.getByRole('checkbox', { name: 'GC.1.1 auswählen' })
      : screen.getByRole('button', { name: /GC.1.1 / });
    expect(next).toHaveFocus();
    fireEvent.keyDown(next, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: /GC.1.0 / })).toHaveFocus();
    expect(view.container.querySelectorAll('[data-control-row]').length).toBeLessThan(40);
  });

  it('rendert das fehlende Tablet-Rückkehrziel und lehnt herausgefilterte Ziele ab', () => {
    const ref = createRef<CatalogMobileListHandle>();
    render(<CatalogMobileList {...props} ref={ref} />);
    act(() => {
      ref.current!.focusControl(controls.at(-1)!.id);
      ref.current!.focusControl(controls[0].id);
    });
    expect(screen.getByRole('button', { name: /GC.1.0 / })).toHaveFocus();
    const hookProps = { controlId: null as string | null };
    const { rerender } = renderHook(({ controlId }) => useTabletDetailPanel({
      enabled: true, controlId, scopeKey: 'test', listReady: true, onClose: vi.fn(),
      onRestoreRowFocus: (id) => ref.current!.focusControl(id),
    }), { initialProps: hookProps });
    rerender({ controlId: controls.at(-1)!.id });
    rerender({ controlId: null });
    expect(screen.getByRole('button', { name: /GC.1.999 / })).toHaveFocus();
    act(() => { expect(ref.current!.focusControl('missing')).toBe(false); });
    act(() => { expect(ref.current!.focusControl(controls.at(-1)!.id)).toBe(true); });
    expect(screen.getByRole('button', { name: /GC.1.999 / })).toHaveFocus();
  });

  it('zählt und exportiert die vollständige Auswahl einschließlich ungefensterter Treffer', () => {
    render(<CatalogMobileList {...props} selectMode checkedIds={new Set(controls.map((control) => control.id))} />);
    expect(screen.getByText('1000 ausgewählt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Auswahl als CSV exportieren, 1000 ausgewählt' }));
    expect(downloadCSV).toHaveBeenCalledWith(controls, 'grundschutz-auswahl.csv');
  });

  it('misst beim Dokumentscroll den Listenoffset und erhält das Fenster einer verborgenen Liste', () => {
    let top = -44000;
    let visible = true;
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(() => (visible ? [{}] : []) as unknown as DOMRectList);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = this.dataset.rowIndex;
      return { top: index === undefined ? top : Number(index) * 88 + top, height: index === undefined ? 88000 : 88 } as DOMRect;
    });
    const view = render(<CatalogMobileList {...props} hasOwnScrollArea={false} />);
    expect(view.container.querySelector('[data-control-row="GC.1.500"]')).not.toBeNull();
    const count = view.container.querySelectorAll('[data-control-row]').length;
    visible = false;
    top = 0;
    act(() => { globalThis.dispatchEvent(new Event('scroll')); });
    expect(view.container.querySelectorAll('[data-control-row]')).toHaveLength(count);
    visible = true;
    act(() => { globalThis.dispatchEvent(new Event('resize')); });
    expect(view.container.querySelector('[data-control-row="GC.1.0"]')).not.toBeNull();
  });
});
