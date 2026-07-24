import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { CatalogMobileSelectionBar } from './CatalogMobileSelectionBar';

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

describe('CatalogMobileSelectionBar', () => {
  beforeEach(() => {
    mockedDownloadCSV.mockReset();
  });

  it('exports all checked controls even when some fall outside the filtered view', () => {
    const onDone = vi.fn();
    render(
      <CatalogMobileSelectionBar
        checkedIds={new Set([firstControl.id, secondControl.id])}
        allControls={[firstControl, secondControl]}
        onDone={onDone}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Export (2)' }));

    expect(mockedDownloadCSV).toHaveBeenCalledWith(
      [firstControl, secondControl],
      'grundschutz-auswahl.csv',
    );
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('keeps export disabled without a selection and supports finishing directly', () => {
    const onDone = vi.fn();
    render(
      <CatalogMobileSelectionBar
        checkedIds={new Set()}
        allControls={[firstControl, secondControl]}
        onDone={onDone}
      />,
    );

    expect(screen.getByText('Tippen zum Auswählen')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export (0)' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(mockedDownloadCSV).not.toHaveBeenCalled();
  });
});
