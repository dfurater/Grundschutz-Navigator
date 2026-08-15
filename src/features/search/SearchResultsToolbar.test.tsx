import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { SearchResultsToolbar } from './SearchResultsToolbar';

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));

function makeControl(id: string): Control {
  return { id, title: `Kontrolle ${id}` } as Control;
}

describe('SearchResultsToolbar', () => {
  it('shows the selection count and delegates clearing and the mobile toggle', () => {
    const onClearSelection = vi.fn();
    const onToggleMobileSelectMode = vi.fn();

    render(
      <SearchResultsToolbar
        checkedIds={new Set(['S.1'])}
        onClearSelection={onClearSelection}
        mobileSelectMode={false}
        onToggleMobileSelectMode={onToggleMobileSelectMode}
        desktopViewControls={[makeControl('S.1')]}
        mobileViewControls={[makeControl('S.1')]}
        allControls={[makeControl('S.1')]}
        onSelectionExported={vi.fn()}
      />,
    );

    expect(screen.getByText('1 ausgewählt')).toBeInTheDocument();

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
        desktopViewControls={[makeControl('A.1'), makeControl('B.1')]}
        mobileViewControls={relevanceOrder}
        allControls={relevanceOrder}
        onSelectionExported={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
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
        desktopViewControls={[makeControl('A.1'), makeControl('B.1')]}
        mobileViewControls={[makeControl('A.1'), makeControl('B.1')]}
        allControls={[makeControl('A.1'), makeControl('B.1')]}
        onSelectionExported={onSelectionExported}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl exportieren (1)' }),
    );

    expect(downloadCSV).toHaveBeenCalledWith(selected, 'grundschutz-auswahl.csv');
    expect(onSelectionExported).toHaveBeenCalledOnce();
  });
});
