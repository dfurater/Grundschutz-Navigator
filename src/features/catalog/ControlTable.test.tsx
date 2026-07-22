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
});
