import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  afterEach(() => document.getSelection()?.removeAllRanges());

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
    fireEvent.click(view.container);
    expect(trigger).toHaveFocus();
  });

  it('allows native selection to start without returning focus on outside mousedown', () => {
    const view = render(<CatalogExportMenu checkedIds={new Set()} filteredControls={[firstControl]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" />);
    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
    fireEvent(view.container, event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).not.toHaveFocus();
  });

  it('preserves an outside text selection after click', () => {
    const view = render(<><CatalogExportMenu checkedIds={new Set()} filteredControls={[firstControl]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" /><p>Markierbarer Text</p></>);
    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);
    const text = screen.getByText('Markierbarer Text');
    fireEvent.mouseDown(text);
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    fireEvent.click(text);
    expect(selection.toString()).toBe('Markierbarer Text');
    expect(trigger).not.toHaveFocus();
    selection.removeAllRanges();
    view.unmount();
  });

  it.each(['secondary click', 'new mousedown', 'unmount'])('discards pending return focus after %s', (reason) => {
    const view = render(<><CatalogExportMenu checkedIds={new Set()} filteredControls={[firstControl]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" /><p>Außenfläche</p></>);
    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);
    const text = screen.getByText('Außenfläche');
    fireEvent.mouseDown(text, { button: reason === 'secondary click' ? 2 : 0 });
    const focus = vi.spyOn(trigger, 'focus');
    if (reason === 'new mousedown') fireEvent.mouseDown(text);
    if (reason === 'unmount') view.unmount();
    fireEvent.click(reason === 'unmount' ? document.documentElement : text);
    expect(focus).not.toHaveBeenCalled();
  });

  it('does not steal focus acquired by another control before the outside click', () => {
    render(<><CatalogExportMenu checkedIds={new Set()} filteredControls={[firstControl]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" /><p>Außenfläche</p><input aria-label="Anderes Feld" /></>);
    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);
    const text = screen.getByText('Außenfläche');
    fireEvent.mouseDown(text);
    const input = screen.getByRole('textbox', { name: 'Anderes Feld' });
    input.focus();
    fireEvent.click(text);
    expect(input).toHaveFocus();
  });

  it.each(['prevented click', 'different target'])('does not return focus for a %s', (reason) => {
    render(<><CatalogExportMenu checkedIds={new Set()} filteredControls={[firstControl]} allControls={[firstControl, secondControl]} sectionFilename="view.csv" /><p>Außenfläche</p><p>Andere Fläche</p></>);
    const trigger = screen.getByRole('button', { name: 'Weitere Exportoptionen' });
    fireEvent.click(trigger);
    const text = screen.getByText('Außenfläche');
    fireEvent.mouseDown(text);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
    if (reason === 'prevented click') event.preventDefault();
    fireEvent(reason === 'different target' ? screen.getByText('Andere Fläche') : text, event);
    expect(trigger).not.toHaveFocus();
  });

});
