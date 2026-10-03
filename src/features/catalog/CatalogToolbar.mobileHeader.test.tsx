import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import type { FilterPanelProps } from './FilterPanel';
import { CatalogToolbar } from './CatalogToolbar';

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));
vi.mock('./FilterPanel', () => ({
  FilterPanel: () => <button type="button">Filteraktion</button>,
}));

const control = {
  id: 'TOP.1.1',
  title: 'Testkontrolle',
} as Control;

describe('mobiler Header (GSPP-471)', () => {
  const baseProps = {
    title: 'Auswahl von Produkten und Dienstleistungen - Zusammenarbeit',
    filteredCount: 12,
    totalCount: 35,
    hasActiveFilters: true,
    onClearFilters: vi.fn(),
    checkedIds: new Set([control.id]),
    onToggleMobileSelectMode: vi.fn(),
    onClearSelection: vi.fn(),
    filteredControls: [control],
    allControls: [control],
    sectionFilename: 'grundschutz-TOP.1.csv',
    filterPanelProps: {} as FilterPanelProps,
  };

  it('setzt die Überschrift unter sm umbrechend auf höchstens zwei Zeilen und ab sm einzeilig', () => {
    render(<CatalogToolbar {...baseProps} mobileSelectMode={false} isDesktop={false} />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveClass(
      'text-lg/[1.35]',
      'text-balance',
      '[hyphens:auto]',
      'line-clamp-2',
      'sm:line-clamp-none',
      'sm:truncate',
      'sm:text-base',
    );
    expect(heading).not.toHaveClass('truncate');
  });

  it('zeigt Auswahl, Filter und CSV als gleich große Icon-Schalter am Viewport-Rand', () => {
    render(<CatalogToolbar {...baseProps} mobileSelectMode={false} isDesktop={false} />);

    const actions = [
      screen.getByRole('button', { name: 'Kontrollen auswählen' }),
      screen.getByRole('button', { name: 'Filter anzeigen' }),
      screen.getByRole('button', { name: 'CSV exportieren' }),
    ];
    for (const action of actions) {
      expect(action).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'bg-transparent');
      expect(action).toHaveTextContent('');
      expect(action.querySelector('svg')).toHaveClass('w-4', 'h-4');
    }
    const group = actions[0].parentElement;
    expect(actions.every((action) => action.parentElement === group)).toBe(true);
    expect(group).toHaveClass('-mr-3', 'sm:mr-0', 'sm:gap-2');
  });

  it('führt Anzahl und „Filter zurücksetzen“ unter sm in Zeile 2 vor den Aktionen', () => {
    render(<CatalogToolbar {...baseProps} mobileSelectMode={false} isDesktop={false} />);

    const count = screen.getByText('12 von 35');
    expect(count).toHaveAttribute('aria-live', 'polite');
    const meta = count.parentElement;
    expect(meta).toHaveClass('sm:hidden', 'flex-wrap');
    expect(meta).toContainElement(screen.getByRole('button', { name: 'Filter zurücksetzen' }));
    expect(meta?.nextElementSibling).toContainElement(
      screen.getByRole('button', { name: 'CSV exportieren' }),
    );
  });

  it('zeigt den aktiven Auswahl-Schalter als Akzent-Glyphe auf Tönung statt als Fläche', () => {
    const view = render(
      <CatalogToolbar {...baseProps} mobileSelectMode={false} isDesktop={false} />,
    );
    const inactive = screen.getByRole('button', { name: 'Kontrollen auswählen' });
    expect(inactive).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('select-toggle-tint')).toBeNull();

    view.rerender(<CatalogToolbar {...baseProps} mobileSelectMode isDesktop={false} />);

    const active = screen.getByRole('button', { name: 'Auswahl beenden' });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active).toHaveClass('bg-transparent');
    expect(active).not.toHaveClass('bg-[var(--color-primary-main)]');
    expect(screen.getByTestId('select-toggle-tint')).toHaveClass(
      'absolute',
      'inset-1',
      'bg-[var(--color-accent-soft)]',
    );
    expect(active.querySelector('svg')).toHaveClass('text-[var(--color-accent-default)]');
    expect(active.querySelectorAll('svg path')).toHaveLength(5);
  });

  it('blendet den Zähler-Chip im mobilen Auswahlmodus aus, im Desktop-Layout nicht', () => {
    const view = render(<CatalogToolbar {...baseProps} mobileSelectMode isDesktop={false} />);

    expect(screen.queryByText('1 ausgewählt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Auswahl aufheben' })).toBeNull();

    view.rerender(<CatalogToolbar {...baseProps} mobileSelectMode isDesktop />);

    expect(screen.getByText('1 ausgewählt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Auswahl aufheben' })).toBeInTheDocument();
  });
});
