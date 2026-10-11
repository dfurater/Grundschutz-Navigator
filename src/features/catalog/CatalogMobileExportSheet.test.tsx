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

describe('CatalogMobileExportSheet', () => {
  beforeEach(() => {
    mockedDownloadCSV.mockReset();
    document.documentElement.style.overflow = 'clip';
  });

  afterEach(() => {
    document.documentElement.style.overflow = '';
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
    const trigger = screen.getByRole('button', { name: 'CSV exportieren' });

    trigger.focus();
    fireEvent.click(trigger);

    expect(
      screen.getByRole('button', { name: 'Aktuelle Ansicht (1)' }),
    ).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    expect(
      screen.queryByRole('heading', { name: 'Exportieren als CSV' }),
    ).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('clip');
  });

  it('opens as a modal dialog named by its heading, isolates the app and closes via Schließen (GSPP-503)', () => {
    const view = render(
      <CatalogMobileExportSheet
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );
    const trigger = screen.getByRole('button', { name: 'CSV exportieren' });

    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Exportieren als CSV' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(view.container).not.toContainElement(dialog);
    expect(view.container).toHaveAttribute('inert');

    fireEvent.click(screen.getByRole('button', { name: 'Schließen' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(view.container).not.toHaveAttribute('inert');
    expect(trigger).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('clip');
  });

  it('closes when its backdrop is clicked', () => {
    render(
      <CatalogMobileExportSheet
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    const backdrop = document.querySelector(
      '.fixed.inset-0[aria-hidden="true"]',
    );
    expect(backdrop).not.toBeNull();
    expect(backdrop!.className).not.toMatch(/\bbg-/);
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

    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
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

    const trigger = screen.getByRole('button', { name: 'CSV exportieren' });
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

    fireEvent.click(screen.getByRole('button', { name: 'CSV exportieren' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl exportieren (2)' }),
    );

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl, secondControl],
      'grundschutz-auswahl.csv',
    );
  });

  it('rendert den Auslöser als Icon-Schalter und deaktiviert ihn ohne Auswahl und ohne Ansicht (GSPP-471)', () => {
    const view = render(
      <CatalogMobileExportSheet
        checkedIds={new Set()}
        filteredControls={[firstControl]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    const trigger = screen.getByRole('button', { name: 'CSV exportieren' });
    expect(trigger).toHaveClass('lg:hidden', 'min-h-[44px]', 'min-w-[44px]', 'bg-transparent');
    expect(trigger).toHaveTextContent('');
    expect(trigger.querySelector('svg')).toHaveClass('w-4', 'h-4');
    expect(trigger).toBeEnabled();

    view.rerender(
      <CatalogMobileExportSheet
        checkedIds={new Set()}
        filteredControls={[]}
        allControls={[firstControl, secondControl]}
        sectionFilename="grundschutz-TOP.1.csv"
      />,
    );

    expect(screen.getByRole('button', { name: 'CSV exportieren' })).toBeDisabled();
  });
});
