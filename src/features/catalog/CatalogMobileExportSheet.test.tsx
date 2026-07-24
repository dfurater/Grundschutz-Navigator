import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { CatalogMobileExportSheet } from './CatalogMobileExportSheet';

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

function getBody(): HTMLBodyElement {
  const body = document.querySelector('body');
  if (!(body instanceof HTMLBodyElement)) {
    throw new Error('Test-DOM hat kein body-Element');
  }
  return body;
}

describe('CatalogMobileExportSheet', () => {
  beforeEach(() => {
    mockedDownloadCSV.mockReset();
    getBody().style.overflow = 'clip';
  });

  afterEach(() => {
    getBody().style.overflow = '';
  });

  it('traps focus, closes on Escape, restores focus and restores scroll', () => {
    render(
      <CatalogMobileExportSheet
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'CSV' });

    trigger.focus();
    fireEvent.click(trigger);

    expect(
      screen.getByRole('button', { name: 'Aktuelle Ansicht (1)' }),
    ).toHaveFocus();
    expect(getBody().style.overflow).toBe('hidden');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(
      screen.queryByRole('heading', { name: 'Exportieren als CSV' }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(getBody().style.overflow).toBe('clip');
  });

  it('closes when its backdrop is clicked', () => {
    const view = render(
      <CatalogMobileExportSheet
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    const backdrop = view.container.querySelector(
      '.fixed.inset-0[aria-hidden="true"]',
    );
    expect(backdrop).not.toBeNull();
    fireEvent.click(backdrop!);

    expect(
      screen.queryByRole('heading', { name: 'Exportieren als CSV' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['Auswahl exportieren (1)', 'grundschutz-auswahl.csv', [firstControl]],
    ['Aktuelle Ansicht (1)', 'grundschutz-TOP.1.csv', [firstControl]],
    [
      'Gesamtkatalog (2)',
      'grundschutz-gesamtkatalog.csv',
      [firstControl, secondControl],
    ],
  ])('exports %s with the expected filename', (buttonName, filename, controls) => {
    const onSelectionExported = vi.fn();
    render(
      <CatalogMobileExportSheet
        checkedIds={new Set([firstControl.id])}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
        onSelectionExported={onSelectionExported}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(screen.getByRole('button', { name: buttonName }));

    expect(mockedDownloadCSV).toHaveBeenCalledWith(controls, filename);
    expect(
      screen.queryByRole('heading', { name: 'Exportieren als CSV' }),
    ).not.toBeInTheDocument();
    expect(onSelectionExported).toHaveBeenCalledTimes(
      buttonName.startsWith('Auswahl') ? 1 : 0,
    );
  });

  it('keeps the trigger enabled when the current view is empty but a selection is retained', () => {
    render(
      <CatalogMobileExportSheet
        checkedIds={new Set([firstControl.id])}
        filteredControls={[]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.2.csv"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'CSV' });
    expect(trigger).not.toBeDisabled();

    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl exportieren (1)' }),
    );

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl],
      'grundschutz-auswahl.csv',
    );
  });

  it('exports all checked controls even when some fall outside the filtered view', () => {
    render(
      <CatalogMobileExportSheet
        checkedIds={new Set([firstControl.id, secondControl.id])}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl exportieren (2)' }),
    );

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl, secondControl],
      'grundschutz-auswahl.csv',
    );
  });
});
