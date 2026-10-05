import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Control } from '@/domain/models';
import { downloadCSV } from '@/features/export/csvExport';
import { MobileNavigationContext } from '@/state/MobileNavigationContext';
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

  it('tritt bei offener mobiler Navigation zurück und erscheint danach wieder', () => {
    const bar = (navigationOpen: boolean) => (
      <MobileNavigationContext.Provider value={navigationOpen}>
        <CatalogMobileSelectionBar
          checkedIds={new Set([firstControl.id])}
          allControls={[firstControl]}
          onDone={vi.fn()}
        />
      </MobileNavigationContext.Provider>
    );
    const view = render(bar(true));
    expect(screen.queryByRole('button', { name: 'Fertig' })).not.toBeInTheDocument();

    view.rerender(bar(false));
    expect(screen.getByRole('button', { name: 'Fertig' })).toBeInTheDocument();
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

    fireEvent.click(
      screen.getByRole('button', { name: 'Auswahl als CSV exportieren, 2 ausgewählt' }),
    );

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

    expect(screen.queryByText('Tippen zum Auswählen')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Auswahl als CSV exportieren, 0 ausgewählt' }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(onDone).toHaveBeenCalledOnce();
    expect(mockedDownloadCSV).not.toHaveBeenCalled();
  });

  it('zeigt „Fertig“ links und die Zahl genau einmal sichtbar im Export-Button rechts (GSPP-471)', () => {
    const { container } = render(
      <CatalogMobileSelectionBar
        checkedIds={new Set([firstControl.id, secondControl.id])}
        allControls={[firstControl, secondControl]}
        onDone={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Fertig', 'Export2']);

    const exportButton = screen.getByRole('button', {
      name: 'Auswahl als CSV exportieren, 2 ausgewählt',
    });
    expect(exportButton).toBeEnabled();
    const counter = exportButton.querySelector('span[aria-hidden="true"]');
    expect(counter).toHaveTextContent('2');
    expect(counter).toHaveClass('bg-[var(--color-accent-soft)]', 'text-[var(--color-accent-default)]');
    expect(exportButton.querySelector('svg')).toHaveClass('text-[var(--color-accent-default)]');

    // Sichtbar steht die Zahl nur im Zähler; die Live-Region ist sr-only.
    expect(screen.getByRole('status')).toHaveTextContent('2 ausgewählt');
    expect(screen.getByRole('status')).toHaveClass('sr-only');
    expect(container.textContent).not.toMatch(/Export \(/);
  });

  it('kündigt Änderungen der Auswahl über die Live-Region an', () => {
    const view = render(
      <CatalogMobileSelectionBar
        checkedIds={new Set([firstControl.id])}
        allControls={[firstControl, secondControl]}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('1 ausgewählt');

    view.rerender(
      <CatalogMobileSelectionBar
        checkedIds={new Set([firstControl.id, secondControl.id])}
        allControls={[firstControl, secondControl]}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('2 ausgewählt');
  });
});
