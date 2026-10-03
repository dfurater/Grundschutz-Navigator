import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
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

function getBody(): HTMLBodyElement {
  const body = document.querySelector('body');
  if (!(body instanceof HTMLBodyElement)) {
    throw new Error('Test-DOM hat kein body-Element');
  }
  return body;
}

describe('CatalogToolbar', () => {
  afterEach(() => {
    getBody().style.overflow = '';
  });

  it('renders title and counts and delegates selection actions', () => {
    const onToggleMobileSelectMode = vi.fn();
    const onClearSelection = vi.fn();

    render(
      <CatalogToolbar
        title="Testthema"
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
        isDesktop={false}
      />,
    );

    // Die Bereichsüberschrift zeigt nur den übergebenen Namen (GSPP-447) und
    // dient als Rückkehrziel nach dem Schließen der mobilen Detailseite.
    const heading = screen.getByRole('heading', { level: 1, name: 'Testthema' });
    expect(heading).toHaveAttribute('data-catalog-scope-heading');
    expect(heading).toHaveAttribute('tabindex', '-1');
    expect(screen.getByText('1 / 2 Kontrollen')).toBeInTheDocument();
    expect(screen.getByText('1 von 2')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Kontrollen auswählen' }),
    );
    // Außerhalb des mobilen Auswahlmodus bleibt der Chip, unter sm per CSS
    // ausgeblendet (GSPP-471).
    expect(screen.getByText('1 ausgewählt')).toHaveClass('hidden', 'sm:flex');
    fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));

    expect(onToggleMobileSelectMode).toHaveBeenCalledOnce();
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it('unmounts open mobile sheets while they are suspended and releases their scroll lock', () => {
    const toolbar = (mobileSheetsSuspended: boolean) => (
      <CatalogToolbar
        title="Testthema"
        filteredCount={1}
        totalCount={1}
        hasActiveFilters={false}
        onClearFilters={vi.fn()}
        checkedIds={new Set()}
        mobileSelectMode={false}
        onToggleMobileSelectMode={vi.fn()}
        onClearSelection={vi.fn()}
        filteredControls={[control]}
        allControls={[control]}
        sectionFilename="grundschutz-TOP.1.csv"
        filterPanelProps={{} as FilterPanelProps}
        isDesktop={false}
        mobileSheetsSuspended={mobileSheetsSuspended}
      />
    );
    const view = render(toolbar(false));
    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));
    expect(getBody().style.overflow).toBe('hidden');

    view.rerender(toolbar(true));

    expect(screen.queryByRole('button', { name: 'Filter anzeigen' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'CSV exportieren' })).toBeNull();
    expect(getBody().style.overflow).toBe('');

    view.rerender(toolbar(false));

    expect(screen.getByRole('button', { name: 'Filter anzeigen' })).toBeInTheDocument();
    expect(screen.queryByText('Filteraktion')).toBeNull();
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
        isDesktop={false}
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

    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl exportieren (1)' }),
    );

    expect(downloadCSV).toHaveBeenCalledWith(
      [control],
      'grundschutz-auswahl.csv',
    );
    expect(onSelectionExported).toHaveBeenCalledOnce();
  });

  it('unmounts open mobile sheets at the desktop breakpoint', () => {
    getBody().style.overflow = 'scroll';
    const props = {
      title: 'Alle Kontrollen',
      filteredCount: 1,
      totalCount: 1,
      hasActiveFilters: false,
      onClearFilters: vi.fn(),
      checkedIds: new Set<string>(),
      mobileSelectMode: false,
      onToggleMobileSelectMode: vi.fn(),
      onClearSelection: vi.fn(),
      filteredControls: [control],
      allControls: [control],
      sectionFilename: 'grundschutz-katalog.csv',
      filterPanelProps: {} as FilterPanelProps,
    };
    const view = render(<CatalogToolbar {...props} isDesktop={false} />);

    fireEvent.click(screen.getByRole('button', { name: 'Filter anzeigen' }));
    expect(screen.getByRole('button', { name: 'Filteraktion' })).toBeInTheDocument();
    expect(getBody().style.overflow).toBe('hidden');

    view.rerender(<CatalogToolbar {...props} isDesktop />);

    expect(
      screen.queryByRole('button', { name: 'Filteraktion' }),
    ).not.toBeInTheDocument();
    expect(getBody().style.overflow).toBe('scroll');

    view.rerender(<CatalogToolbar {...props} isDesktop={false} />);
    expect(
      screen.queryByRole('button', { name: 'Filteraktion' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    expect(
      screen.getByRole('heading', { name: 'Exportieren als CSV' }),
    ).toBeInTheDocument();
    expect(getBody().style.overflow).toBe('hidden');

    view.rerender(<CatalogToolbar {...props} isDesktop />);

    expect(
      screen.queryByRole('heading', { name: 'Exportieren als CSV' }),
    ).not.toBeInTheDocument();
    expect(getBody().style.overflow).toBe('scroll');
  });

  it('mounts the export menu only on desktop (GSPP-268)', () => {
    const props = {
      title: 'Alle Kontrollen',
      filteredCount: 1,
      totalCount: 1,
      hasActiveFilters: false,
      onClearFilters: vi.fn(),
      checkedIds: new Set<string>(),
      mobileSelectMode: false,
      onToggleMobileSelectMode: vi.fn(),
      onClearSelection: vi.fn(),
      filteredControls: [control],
      allControls: [control],
      sectionFilename: 'grundschutz-katalog.csv',
      filterPanelProps: {} as FilterPanelProps,
    };
    const view = render(<CatalogToolbar {...props} isDesktop={false} />);

    expect(screen.queryByRole('button', { name: 'CSV Export' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Weitere Exportoptionen' }),
    ).not.toBeInTheDocument();

    view.rerender(<CatalogToolbar {...props} isDesktop />);

    expect(screen.getByRole('button', { name: 'CSV Export' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Weitere Exportoptionen' }),
    ).toBeInTheDocument();

    view.rerender(<CatalogToolbar {...props} isDesktop={false} />);

    expect(screen.queryByRole('button', { name: 'CSV Export' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Weitere Exportoptionen' }),
    ).not.toBeInTheDocument();
  });
});
