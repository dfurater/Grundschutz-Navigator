import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { MobileNavigationContext } from '@/state/MobileNavigationContext';
import { SearchResultsToolbar } from './SearchResultsToolbar';

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));

function makeControl(id: string): Control {
  return { id, title: `Kontrolle ${id}` } as Control;
}

describe('SearchResultsToolbar', () => {
  it('releases an open export sheet while the mobile navigation owns focus', () => {
    const toolbar = (navigationOpen: boolean) => (
      <MobileNavigationContext.Provider value={navigationOpen}>
        <SearchResultsToolbar
          checkedIds={new Set()}
          onClearSelection={vi.fn()}
          mobileSelectMode={false}
          onToggleMobileSelectMode={vi.fn()}
          isDesktop={false}
          desktopViewControls={[makeControl('A.1')]}
          mobileViewControls={[makeControl('A.1')]}
          allControls={[makeControl('A.1')]}
          onSelectionExported={vi.fn()}
        />
      </MobileNavigationContext.Provider>
    );
    const view = render(toolbar(false));
    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    expect(screen.getByText('Exportieren als CSV')).toBeInTheDocument();
    expect(document.querySelector('body')!.style.overflow).toBe('hidden');

    view.rerender(toolbar(true));

    expect(screen.queryByRole('button', { name: 'CSV exportieren' })).not.toBeInTheDocument();
    expect(screen.queryByText('Exportieren als CSV')).not.toBeInTheDocument();
    expect(document.querySelector('body')!.style.overflow).not.toBe('hidden');
    view.rerender(toolbar(false));
    expect(screen.getByRole('button', { name: 'CSV exportieren' })).toBeInTheDocument();
    expect(screen.queryByText('Exportieren als CSV')).not.toBeInTheDocument();
  });

  it('shows the selection count and delegates clearing and the mobile toggle', () => {
    const onClearSelection = vi.fn();
    const onToggleMobileSelectMode = vi.fn();

    render(
      <SearchResultsToolbar
        checkedIds={new Set(['S.1'])}
        onClearSelection={onClearSelection}
        mobileSelectMode={false}
        onToggleMobileSelectMode={onToggleMobileSelectMode}
        isDesktop={false}
        desktopViewControls={[makeControl('S.1')]}
        mobileViewControls={[makeControl('S.1')]}
        allControls={[makeControl('S.1')]}
        onSelectionExported={vi.fn()}
      />,
    );

    expect(screen.getByText('1 ausgewählt')).toHaveClass('hidden', 'sm:flex');

    fireEvent.click(screen.getByRole('button', { name: 'Auswahl aufheben' }));
    expect(onClearSelection).toHaveBeenCalledOnce();

    const toggle = screen.getByRole('button', { name: 'Kontrollen auswählen' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(onToggleMobileSelectMode).toHaveBeenCalledOnce();
  });

  it('exports the desktop current view in table sort order under the fixed search filename', () => {
    const desktopControls = [makeControl('A.1'), makeControl('B.1')];

    render(
      <SearchResultsToolbar
        checkedIds={new Set()}
        onClearSelection={vi.fn()}
        mobileSelectMode={false}
        onToggleMobileSelectMode={vi.fn()}
        isDesktop
        desktopViewControls={desktopControls}
        mobileViewControls={[makeControl('B.1'), makeControl('A.1')]}
        allControls={desktopControls}
        onSelectionExported={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV Export' }));

    expect(downloadCSV).toHaveBeenCalledWith(
      desktopControls,
      'grundschutz-suchergebnisse.csv',
    );
  });

  it('exports the mobile current view in relevance order under the fixed search filename', () => {
    const relevanceOrder = [makeControl('B.1'), makeControl('A.1')];

    render(
      <SearchResultsToolbar
        checkedIds={new Set()}
        onClearSelection={vi.fn()}
        mobileSelectMode={false}
        onToggleMobileSelectMode={vi.fn()}
        isDesktop={false}
        desktopViewControls={[makeControl('A.1'), makeControl('B.1')]}
        mobileViewControls={relevanceOrder}
        allControls={relevanceOrder}
        onSelectionExported={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    fireEvent.click(screen.getByRole('button', { name: /Aktuelle Ansicht/ }));

    expect(downloadCSV).toHaveBeenCalledWith(
      relevanceOrder,
      'grundschutz-suchergebnisse.csv',
    );
  });

  it('reports when a selection export from the mobile sheet finishes', () => {
    const selected = [makeControl('A.1')];
    const onSelectionExported = vi.fn();

    render(
      <SearchResultsToolbar
        checkedIds={new Set(['A.1'])}
        onClearSelection={vi.fn()}
        mobileSelectMode
        onToggleMobileSelectMode={vi.fn()}
        isDesktop={false}
        desktopViewControls={[makeControl('A.1'), makeControl('B.1')]}
        mobileViewControls={[makeControl('A.1'), makeControl('B.1')]}
        allControls={[makeControl('A.1'), makeControl('B.1')]}
        onSelectionExported={onSelectionExported}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl exportieren (1)' }),
    );

    expect(downloadCSV).toHaveBeenCalledWith(selected, 'grundschutz-auswahl.csv');
    expect(onSelectionExported).toHaveBeenCalledOnce();
  });

  it('mounts exactly one export access per breakpoint (GSPP-268)', () => {
    const props = {
      checkedIds: new Set<string>(),
      onClearSelection: vi.fn(),
      mobileSelectMode: false,
      onToggleMobileSelectMode: vi.fn(),
      desktopViewControls: [makeControl('A.1'), makeControl('B.1')],
      mobileViewControls: [makeControl('B.1'), makeControl('A.1')],
      allControls: [makeControl('A.1'), makeControl('B.1')],
      onSelectionExported: vi.fn(),
    };

    const view = render(<SearchResultsToolbar {...props} isDesktop={false} />);

    expect(screen.queryByRole('button', { name: 'CSV Export' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Weitere Exportoptionen' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'CSV exportieren' })).toBeInTheDocument();

    view.rerender(<SearchResultsToolbar {...props} isDesktop />);

    expect(screen.getByRole('button', { name: 'CSV Export' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Weitere Exportoptionen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CSV exportieren' })).not.toBeInTheDocument();
  });

  it('verwendet Auswahl-Schalter, CSV-Auslöser und Chip-Regel des Katalogs (GSPP-471)', () => {
    const props = {
      checkedIds: new Set(['S.1']),
      onClearSelection: vi.fn(),
      onToggleMobileSelectMode: vi.fn(),
      desktopViewControls: [makeControl('S.1')],
      mobileViewControls: [makeControl('S.1')],
      allControls: [makeControl('S.1')],
      onSelectionExported: vi.fn(),
    };
    const view = render(<SearchResultsToolbar {...props} mobileSelectMode isDesktop={false} />);

    const toggle = screen.getByRole('button', { name: 'Auswahl beenden' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('select-toggle-tint')).toBeInTheDocument();
    expect(toggle.querySelectorAll('svg path')).toHaveLength(5);

    const csv = screen.getByRole('button', { name: 'CSV exportieren' });
    expect(csv).toHaveClass('min-h-[44px]', 'min-w-[44px]', 'bg-transparent');
    expect(csv).toHaveTextContent('');

    expect(screen.queryByText('1 ausgewählt')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Auswahl aufheben' })).toBeNull();

    view.rerender(<SearchResultsToolbar {...props} mobileSelectMode isDesktop />);
    expect(screen.getByText('1 ausgewählt')).toBeInTheDocument();
  });
});
