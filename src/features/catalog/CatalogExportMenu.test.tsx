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

  it('exports only checked controls that remain in the filtered result', () => {
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
});
