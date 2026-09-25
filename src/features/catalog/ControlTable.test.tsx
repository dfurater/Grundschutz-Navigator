import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import type { SortConfig } from '@/hooks/useFilteredControls';
import { ControlTable } from './ControlTable';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Rollen und Verantwortlichkeiten festlegen',
    groupId: 'GC.1',
    practiceId: 'GC',
    securityLevel: 'normal-SdT',
    effortLevel: '3',
    modalverb: 'MUSS',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: 'Verantwortlichkeiten müssen festgelegt werden.',
    statementRaw: 'Verantwortlichkeiten müssen festgelegt werden.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
    },
    links: [],
    params: {},
    ...overrides,
  };
}

function renderTable(options: {
  controls?: Control[];
  sort?: SortConfig;
  checkedIds?: Set<string>;
  showSelection?: boolean;
  onSortChange?: (sort: SortConfig) => void;
  onSelectControl?: (control: Control) => void;
  onCheckedChange?: (ids: Set<string>) => void;
} = {}) {
  const controls = options.controls ?? [makeControl()];
  const selectionProps = options.showSelection === false
    ? { showSelection: false as const }
    : {
        checkedIds: options.checkedIds ?? new Set<string>(),
        onCheckedChange: options.onCheckedChange ?? vi.fn(),
      };

  return render(
    <ControlTable
      controls={controls}
      controlsById={new Map(controls.map((control) => [control.id, control]))}
      sort={options.sort ?? [{ field: 'id', direction: 'asc' }]}
      onSortChange={options.onSortChange ?? vi.fn()}
      onSelectControl={options.onSelectControl ?? vi.fn()}
      {...selectionProps}
    />,
  );
}

describe('ControlTable', () => {
  it('uses semantic sort buttons with aria-sort on the primary sort column', async () => {
    const user = userEvent.setup();
    const onSortChange = vi.fn();
    renderTable({ onSortChange });

    const idHeader = screen.getByRole('columnheader', { name: /ID/ });
    const titleHeader = screen.getByRole('columnheader', { name: /Titel/ });
    const titleButton = within(titleHeader).getByRole('button', { name: /Titel/ });

    expect(idHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(titleHeader).toHaveAttribute('aria-sort', 'none');
    expect(titleButton).toHaveClass('focus-visible:ring-2');

    titleButton.focus();
    await user.keyboard('{Enter}');

    expect(onSortChange).toHaveBeenCalledWith([{ field: 'title', direction: 'asc' }]);
  });

  it('keeps shift-click multi-sort on header buttons', () => {
    const onSortChange = vi.fn();
    renderTable({
      sort: [{ field: 'id', direction: 'asc' }],
      onSortChange,
    });

    const titleButton = within(
      screen.getByRole('columnheader', { name: /Titel/ }),
    ).getByRole('button', { name: /Titel/ });

    fireEvent.click(titleButton, { shiftKey: true });

    expect(onSortChange).toHaveBeenCalledWith([
      { field: 'id', direction: 'asc' },
      { field: 'title', direction: 'asc' },
    ]);
  });

  it('keeps classification columns visually compact while headers remain buttons', () => {
    renderTable();

    const row = screen.getAllByRole('row')[1];
    const cells = within(row).getAllByRole('cell');

    expect(cells[3].querySelector('.bg-red-600')).not.toBeNull();
    expect(within(cells[3]).getByText('MUSS')).toHaveClass('catalog-meta-text', 'text-slate-600');
    expect(within(cells[4]).getByText('normal-SdT')).toHaveClass('catalog-meta-text', 'text-slate-500');
    expect(within(cells[5]).getByText('3')).toHaveClass('catalog-meta-text', 'tabular-nums');
    expect(cells[5]).not.toHaveTextContent('Aufwand');
  });

  it('does not open detail when the row checkbox is clicked', async () => {
    const user = userEvent.setup();
    const onSelectControl = vi.fn();
    const onCheckedChange = vi.fn();
    renderTable({ onSelectControl, onCheckedChange });

    await user.click(screen.getByRole('checkbox', { name: 'GC.1.1 auswählen' }));

    expect(onSelectControl).not.toHaveBeenCalled();
    expect(onCheckedChange).toHaveBeenCalledWith(new Set(['GC.1.1']));
  });

  it('can render without selection controls for reference-only table usage', async () => {
    const user = userEvent.setup();
    const onSelectControl = vi.fn();
    renderTable({ showSelection: false, onSelectControl });

    expect(screen.queryByRole('checkbox', { name: 'Alle auswählen' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'GC.1.1 auswählen' })).not.toBeInTheDocument();

    const row = screen.getAllByRole('row')[1];
    row.focus();
    await user.keyboard(' ');

    expect(onSelectControl).not.toHaveBeenCalled();
  });

  it('keeps row keyboard behavior: Enter opens detail and Space toggles selection', async () => {
    const user = userEvent.setup();
    const control = makeControl();
    const onSelectControl = vi.fn();
    const onCheckedChange = vi.fn();
    renderTable({ controls: [control], onSelectControl, onCheckedChange });

    const row = screen.getAllByRole('row')[1];
    row.focus();
    await user.keyboard('{Enter}');
    await user.keyboard(' ');

    expect(onSelectControl).toHaveBeenCalledWith(control);
    expect(onCheckedChange).toHaveBeenCalledWith(new Set(['GC.1.1']));
  });

  it('does not render unchanged rows or recalculate depths on selection updates', () => {
    const firstTitle = vi.fn(() => 'Erste Kontrolle');
    const secondTitle = vi.fn(() => 'Zweite Kontrolle');
    const first = makeControl({ id: 'GC.1.1' });
    const second = makeControl({ id: 'GC.1.1.1', parentId: first.id });
    Object.defineProperty(first, 'title', { configurable: true, get: firstTitle });
    Object.defineProperty(second, 'title', { configurable: true, get: secondTitle });
    const controls = [first, second];
    const controlsById = new Map(controls.map((control) => [control.id, control]));
    const mapGet = vi.spyOn(controlsById, 'get');
    const onSortChange = vi.fn();
    const onSelectControl = vi.fn();
    const onCheckedChange = vi.fn();
    const sort: SortConfig = [{ field: 'id', direction: 'asc' }];
    const view = render(
      <ControlTable
        controls={controls}
        controlsById={controlsById}
        checkedIds={new Set()}
        sort={sort}
        onSortChange={onSortChange}
        onSelectControl={onSelectControl}
        onCheckedChange={onCheckedChange}
      />,
    );
    const secondRow = screen.getAllByRole('row')[2];
    const secondCheckbox = within(secondRow).getByRole('checkbox', {
      name: `${second.id} auswählen`,
    });

    firstTitle.mockClear();
    secondTitle.mockClear();
    mapGet.mockClear();
    const nextOnSelectControl = vi.fn();
    const nextOnCheckedChange = vi.fn();
    view.rerender(
      <ControlTable
        controls={controls}
        controlsById={controlsById}
        checkedIds={new Set([first.id])}
        sort={sort}
        onSortChange={onSortChange}
        onSelectControl={onSelectControl}
        onCheckedChange={onCheckedChange}
      />,
    );

    expect(firstTitle).toHaveBeenCalled();
    expect(secondTitle).not.toHaveBeenCalled();
    expect(mapGet).not.toHaveBeenCalled();

    firstTitle.mockClear();
    secondTitle.mockClear();
    mapGet.mockClear();
    view.rerender(
      <ControlTable
        controls={controls}
        controlsById={controlsById}
        selectedControlId={first.id}
        checkedIds={new Set([first.id])}
        sort={sort}
        onSortChange={onSortChange}
        onSelectControl={nextOnSelectControl}
        onCheckedChange={nextOnCheckedChange}
      />,
    );

    expect(firstTitle).toHaveBeenCalled();
    expect(secondTitle).not.toHaveBeenCalled();
    expect(mapGet).not.toHaveBeenCalled();

    fireEvent.click(secondCheckbox);
    fireEvent.click(secondRow);

    expect(nextOnCheckedChange).toHaveBeenCalledWith(new Set([first.id, second.id]));
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(nextOnSelectControl).toHaveBeenCalledWith(second);
    expect(onSelectControl).not.toHaveBeenCalled();
  });

  it('spans "select all" across a selection universe larger than the rendered rows', async () => {
    const user = userEvent.setup();
    const renderedControls = Array.from({ length: 50 }, (_, i) =>
      makeControl({ id: `GC.1.${i + 1}` }),
    );
    const hiddenControl = makeControl({ id: 'GC.1.51' });
    const selectableControls = [...renderedControls, hiddenControl];
    const onCheckedChange = vi.fn();

    render(
      <ControlTable
        controls={renderedControls}
        controlsById={new Map(selectableControls.map((c) => [c.id, c]))}
        selectableControls={selectableControls}
        checkedIds={new Set<string>()}
        sort={[{ field: 'id', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectControl={vi.fn()}
        onCheckedChange={onCheckedChange}
      />,
    );

    await user.click(screen.getByRole('checkbox', { name: 'Alle auswählen' }));

    expect(onCheckedChange).toHaveBeenCalledWith(
      new Set(selectableControls.map((c) => c.id)),
    );
  });

  it('shows the "select all" header as fully checked and demarks the whole universe, not just rendered rows', async () => {
    const user = userEvent.setup();
    const renderedControls = Array.from({ length: 50 }, (_, i) =>
      makeControl({ id: `GC.1.${i + 1}` }),
    );
    const hiddenControl = makeControl({ id: 'GC.1.51' });
    const selectableControls = [...renderedControls, hiddenControl];
    const onCheckedChange = vi.fn();

    render(
      <ControlTable
        controls={renderedControls}
        controlsById={new Map(selectableControls.map((c) => [c.id, c]))}
        selectableControls={selectableControls}
        checkedIds={new Set(selectableControls.map((c) => c.id))}
        sort={[{ field: 'id', direction: 'asc' }]}
        onSortChange={vi.fn()}
        onSelectControl={vi.fn()}
        onCheckedChange={onCheckedChange}
      />,
    );

    const selectAll = screen.getByRole('checkbox', { name: 'Alle auswählen' });
    expect((selectAll as HTMLInputElement).checked).toBe(true);
    expect((selectAll as HTMLInputElement).indeterminate).toBe(false);

    await user.click(selectAll);

    expect(onCheckedChange).toHaveBeenCalledWith(new Set());
  });

  it('keeps exactly one row tabbable when filtering shortens the result', () => {
    const controls = [
      makeControl({ id: 'GC.1.1' }),
      makeControl({ id: 'GC.1.2' }),
      makeControl({ id: 'GC.1.3' }),
    ];
    const controlsById = new Map(controls.map((control) => [control.id, control]));
    const props = {
      controlsById,
      checkedIds: new Set<string>(),
      sort: [{ field: 'id', direction: 'asc' }] as SortConfig,
      onSortChange: vi.fn(),
      onSelectControl: vi.fn(),
      onCheckedChange: vi.fn(),
    };
    const view = render(<ControlTable {...props} controls={controls} />);
    const initialRows = screen.getAllByRole('row').slice(1);

    fireEvent.keyDown(initialRows[0], { key: 'End' });
    expect(initialRows[2]).toHaveAttribute('tabindex', '0');

    view.rerender(<ControlTable {...props} controls={[controls[0]]} />);

    const remainingRows = screen.getAllByRole('row').slice(1);
    expect(remainingRows).toHaveLength(1);
    expect(remainingRows[0]).toHaveAttribute('tabindex', '0');
  });

  describe('windowing (GSPP-262)', () => {
    const manyControls = Array.from({ length: 300 }, (_, i) =>
      makeControl({ id: `GC.1.${i + 1}`, title: `Anforderung ${i + 1}` }),
    );
    const dataRows = () => screen.getAllByRole('row').slice(1);
    const rowIndices = () => dataRows().map((row) => Number(row.getAttribute('aria-rowindex')));

    it('renders only a window of rows but exposes the full list size to assistive technology', () => {
      const { container } = renderTable({ controls: manyControls });

      // Ohne Layout (jsdom) greift das Fallback-Fenster von 40 Zeilen plus 10 Überhang.
      expect(dataRows()).toHaveLength(50);
      expect(screen.getByRole('grid')).toHaveAttribute('aria-rowcount', '301');
      expect(screen.getAllByRole('row')[0]).toHaveAttribute('aria-rowindex', '1');
      expect(rowIndices()).toEqual(Array.from({ length: 50 }, (_, i) => i + 2));

      const spacer = container.querySelector('tbody tr[aria-hidden="true"]');
      expect(spacer).not.toBeNull();
      expect(spacer?.querySelector('td')).toHaveStyle({ height: `${250 * 41}px` });
    });

    it('moves focus to a row that was not rendered yet via End and ArrowDown', () => {
      renderTable({ controls: manyControls });

      fireEvent.keyDown(dataRows()[0], { key: 'End' });

      expect(document.activeElement).toHaveAttribute('aria-rowindex', '301');
      expect(document.activeElement).toHaveTextContent('GC.1.300');
      expect(dataRows().filter((row) => row.getAttribute('tabindex') === '0')).toHaveLength(1);

      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
      expect(document.activeElement).toHaveAttribute('aria-rowindex', '2');
      // Nur die Tab-Stopp-Zeile wird gehalten: Nach Home fällt Zeile 300 wieder heraus.
      expect(rowIndices()).not.toContain(301);

      fireEvent.focus(dataRows()[49]);
      fireEvent.keyDown(dataRows()[49], { key: 'ArrowDown' });

      expect(document.activeElement).toHaveAttribute('aria-rowindex', '52');
      expect(document.activeElement).toHaveTextContent('GC.1.51');
    });

    it('keeps the focused tab-stop row mounted when it is scrolled out of the window', () => {
      renderTable({ controls: manyControls });
      const firstRow = dataRows()[0];
      firstRow.focus();

      const scroller = screen.getByRole('grid').parentElement as HTMLElement;
      Object.defineProperty(scroller, 'scrollTop', { configurable: true, value: 200 * 41 });
      fireEvent.scroll(scroller);

      expect(rowIndices()[0]).toBe(2);
      expect(rowIndices()).toContain(2 + 200);
      expect(rowIndices()).not.toContain(2 + 100);
      expect(document.activeElement).toBe(firstRow);
      expect(firstRow).toHaveAttribute('tabindex', '0');
    });

    it('does not leave a focus request behind when a key stays on the same row', () => {
      const props = {
        controls: manyControls,
        controlsById: new Map(manyControls.map((c) => [c.id, c])),
        checkedIds: new Set<string>(),
        onSortChange: vi.fn(),
        onSelectControl: vi.fn(),
        onCheckedChange: vi.fn(),
      };
      const view = render(
        <>
          <button type="button">Außerhalb</button>
          <ControlTable {...props} sort={[{ field: 'id', direction: 'asc' }]} />
        </>,
      );
      const firstRow = dataRows()[0];
      firstRow.focus();
      fireEvent.keyDown(firstRow, { key: 'Home' });
      fireEvent.keyDown(firstRow, { key: 'ArrowUp' });

      const outside = screen.getByRole('button', { name: 'Außerhalb' });
      outside.focus();
      view.rerender(
        <>
          <button type="button">Außerhalb</button>
          <ControlTable {...props} sort={[{ field: 'title', direction: 'asc' }]} />
        </>,
      );

      expect(document.activeElement).toBe(outside);
    });

    it('keeps the focused control as tab stop when a re-sort moves it out of the window', () => {
      const props = {
        controlsById: new Map(manyControls.map((c) => [c.id, c])),
        checkedIds: new Set<string>(),
        sort: [{ field: 'id', direction: 'asc' }] as SortConfig,
        onSortChange: vi.fn(),
        onSelectControl: vi.fn(),
        onCheckedChange: vi.fn(),
      };
      const view = render(<ControlTable {...props} controls={manyControls} />);
      const firstRow = dataRows()[0];
      firstRow.focus();

      view.rerender(<ControlTable {...props} controls={[...manyControls].reverse()} />);

      expect(document.activeElement).toBe(firstRow);
      expect(firstRow).toHaveTextContent('GC.1.1');
      expect(firstRow).toHaveAttribute('aria-rowindex', '301');
      expect(firstRow).toHaveAttribute('tabindex', '0');
      expect(dataRows().filter((row) => row.getAttribute('tabindex') === '0')).toHaveLength(1);
    });
  });
});
