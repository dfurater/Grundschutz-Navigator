import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import type { FilterPanelProps } from './FilterPanel';
import { CatalogToolbar } from './CatalogToolbar';

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));

const control = {
  id: 'TOP.1.1',
  title: 'Testkontrolle',
} as Control;

describe('CatalogToolbar', () => {
  it('renders title and counts and delegates selection actions', () => {
    const onToggleMobileSelectMode = vi.fn();
    const onClearSelection = vi.fn();

    render(
      <CatalogToolbar
        title="TOP.1 — Testthema"
        filteredCount={1}
        totalCount={2}
        hasActiveFilters={false}
        onClearFilters={vi.fn()}
        checkedIds={new Set([control.id])}
        mobileSelectMode={false}
        onToggleMobileSelectMode={onToggleMobileSelectMode}
        onClearSelection={onClearSelection}
        filteredControls={[control]}
        allControls={[control]}
        sectionFilename="grundschutz-TOP.1.csv"
        filterPanelProps={{} as FilterPanelProps}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'TOP.1 — Testthema' }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 / 2 Kontrollen')).toBeInTheDocument();
    expect(screen.getByText('1 von 2')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Kontrollen auswählen' }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));

    expect(onToggleMobileSelectMode).toHaveBeenCalledOnce();
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it('delegates mobile filter reset and selection-export completion', () => {
    const onClearFilters = vi.fn();
    const onSelectionExported = vi.fn();

    render(
      <CatalogToolbar
        title="Alle Kontrollen"
        filteredCount={1}
        totalCount={2}
        hasActiveFilters
        onClearFilters={onClearFilters}
        checkedIds={new Set([control.id])}
        mobileSelectMode
        onToggleMobileSelectMode={vi.fn()}
        onClearSelection={vi.fn()}
        filteredControls={[control]}
        allControls={[control]}
        sectionFilename="grundschutz-katalog.csv"
        filterPanelProps={{} as FilterPanelProps}
        onSelectionExported={onSelectionExported}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Filter zurücksetzen' }),
    );

    expect(onClearFilters).toHaveBeenCalledOnce();
    expect(
      screen.getByRole('button', { name: 'Auswahl beenden' }),
    ).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl exportieren (1)' }),
    );

    expect(downloadCSV).toHaveBeenCalledWith(
      [control],
      'grundschutz-auswahl.csv',
    );
    expect(onSelectionExported).toHaveBeenCalledOnce();
  });
});
