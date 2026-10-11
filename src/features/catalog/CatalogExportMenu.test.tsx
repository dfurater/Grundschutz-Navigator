import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { CatalogExportMenu } from './CatalogExportMenu';

vi.mock('@/features/export/csvExport', () => ({
  downloadCSV: vi.fn(),
}));

const firstControl = {
  id: 'TOP.1.1',
  title: 'Erste Kontrolle',
} as Control;
const secondControl = {
  id: 'TOP.1.2',
  title: 'Zweite Kontrolle',
} as Control;

const mockedDownloadCSV = vi.mocked(downloadCSV);

describe('CatalogExportMenu', () => {
  beforeEach(() => {
    mockedDownloadCSV.mockReset();
  });

  it('exports the filtered section from the primary action', () => {
    render(
      <CatalogExportMenu
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV Export' }));

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl],
      'grundschutz-TOP.1.csv',
    );
  });

  it('exports all checked controls even when some fall outside the filtered view', () => {
    render(
      <CatalogExportMenu
        checkedIds={new Set([firstControl.id, secondControl.id])}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export (2)' }));

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl, secondControl],
      'grundschutz-auswahl.csv',
    );
  });

  it('keeps the primary export button enabled when the current view is empty but a selection is retained', () => {
    render(
      <CatalogExportMenu
        checkedIds={new Set([firstControl.id])}
        filteredControls={[]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.2.csv"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Export (1)' });
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl],
      'grundschutz-auswahl.csv',
    );
  });

  it('autofocuses the first menu item and closes on Escape or outside click', () => {
    const view = render(
      <CatalogExportMenu
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);

    expect(screen.getByRole('menu')).toHaveAttribute('tabindex', '-1');
    expect(
      screen.getByRole('menuitem', { name: 'Aktuelle Ansicht (1)' }),
    ).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.mouseDown(view.container);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('exports the full catalog from the menu', () => {
    render(
      <CatalogExportMenu
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Weitere Exportoptionen' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Gesamtkatalog (2)' }));

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl, secondControl],
      'grundschutz-gesamtkatalog.csv',
    );
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
  it.each([
    [[], [firstControl], 'Aktuelle Ansicht (1)'],
    [[firstControl.id], [firstControl], 'Auswahl exportieren (1)'],
    [[], [firstControl, secondControl], 'Gesamtkatalog (2)'],
    [[], [], 'Gesamtkatalog (2)'],
  ])('focuses the first enabled item for selection %j and view %j', (ids, controls, name) => {
    render(<CatalogExportMenu checkedIds={new Set(ids)} filteredControls={controls} allControls={[firstControl, secondControl]} sectionFilename="view.csv" />);
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Exportoptionen' }));
    expect(screen.getByRole('menuitem', { name })).toHaveFocus();
  });

  it('wraps arrow navigation and supports Home/End while skipping disabled items', () => {
    render(<CatalogExportMenu checkedIds={new Set([firstControl.id])} filteredControls={[]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" />);
    fireEvent.click(screen.getByRole('button', { name: 'Weitere Exportoptionen' }));
    const selected = screen.getByRole('menuitem', { name: 'Auswahl exportieren (1)' });
    const all = screen.getByRole('menuitem', { name: 'Gesamtkatalog (2)' });
    const menu = screen.getByRole('menu');
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(all).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(selected).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(all).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(selected).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(all).toHaveFocus();
  });

  it.each(['Escape', 'Tab'])('returns focus before closing with %s', (key) => {
    render(<CatalogExportMenu checkedIds={new Set()} filteredControls={[firstControl]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" />);
    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('menu'), { key });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('returns focus after export and after clicking a non-focusable outside target', () => {
    const view = render(<CatalogExportMenu checkedIds={new Set()} filteredControls={[firstControl]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" />);
    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Aktuelle Ansicht (1)' }));
    expect(mockedDownloadCSV).toHaveBeenCalledWith([firstControl], 'view.csv');
    expect(trigger).toHaveFocus();
    fireEvent.click(trigger);
    fireEvent.mouseDown(view.container);
    expect(trigger).toHaveFocus();
  });

});
