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
});
