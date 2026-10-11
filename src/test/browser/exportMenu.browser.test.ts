import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Control } from '@/domain/models';
import { CatalogExportMenu } from '@/features/catalog/CatalogExportMenu';
import { ControlTable } from '@/features/catalog/ControlTable';
import 'overlayscrollbars/overlayscrollbars.css';
import { downloadCSV } from '@/features/export/csvExport';
import '@/index.css';

vi.mock('@/features/export/csvExport', () => ({ downloadCSV: vi.fn() }));
const controls = Array.from({ length: 40 }, (_, i) => ({ id: `GC.${i}`, title: `Kontrolle ${i}` } as Control));
let host: HTMLDivElement;
let root: Root;
afterEach(() => { root.unmount(); host.remove(); document.getSelection()?.removeAllRanges(); vi.clearAllMocks(); });

const selectControl = vi.fn();
async function renderMenu(selected = false, empty = false, withTable = false) {
  await page.viewport(1280, 800);
  host = document.createElement('div');
  host.style.padding = '40px';
  document.body.append(host);
  root = createRoot(host);
  root.render(createElement('div', null,
    createElement('button', null, 'Vorher'),
    createElement(CatalogExportMenu, {
      checkedIds: new Set(selected ? [controls[0].id] : []),
      filteredControls: empty ? [] : controls.slice(0, 35),
      allControls: controls,
      sectionFilename: 'grundschutz-GC.csv',
    }),
    createElement('button', null, 'Nachher'),
    createElement('p', null, 'Statische Fläche'),
    withTable && createElement(ControlTable, {
      controls: controls.slice(0, 2),
      controlsById: new Map(controls.map(control => [control.id, control])),
      sort: [{ field: 'id', direction: 'asc' }],
      onSortChange: () => {},
      onSelectControl: selectControl,
      showSelection: false,
    }),
  ));
  await expect.poll(() => host.querySelector('[aria-haspopup]')).not.toBeNull();
}
const trigger = () => host.querySelector<HTMLButtonElement>('[aria-haspopup]')!;
const item = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(e => e.textContent?.replace(/\s+/g, ' ').trim() === name)!;

test('GC-35: arrows, bounds, Escape and native Tab sequence with visible focus', async () => {
  await renderMenu();
  trigger().focus();
  await userEvent.keyboard('{Enter}');
  expect(document.activeElement).toBe(item('Aktuelle Ansicht (35)'));
  expect(getComputedStyle(document.activeElement!).boxShadow).not.toBe('none');
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(item('Gesamtkatalog (40)'));
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(item('Aktuelle Ansicht (35)'));
  await userEvent.keyboard('{End}');
  expect(document.activeElement).toBe(item('Gesamtkatalog (40)'));
  await userEvent.keyboard('{Home}{Escape}');
  expect(document.activeElement).toBe(trigger());
  expect(getComputedStyle(trigger()).boxShadow).not.toBe('none');
  await userEvent.keyboard('{ArrowDown}');
  await userEvent.tab();
  expect(document.activeElement?.textContent).toBe('Nachher');
  expect(host.querySelector('[role="menu"]')).toBeNull();
  trigger().focus();
  await userEvent.keyboard('{ArrowUp}');
  await userEvent.tab({ shift: true });
  expect(document.activeElement?.textContent).toContain('CSV Export');
  expect(host.querySelector('[role="menu"]')).toBeNull();
});

test.each(['{Enter}', ' '])('native %s activates current-view export and returns focus', async (key) => {
  await renderMenu();
  trigger().focus();
  await userEvent.keyboard('{Enter}');
  await userEvent.keyboard(key);
  expect(downloadCSV).toHaveBeenCalledWith(controls.slice(0, 35), 'grundschutz-GC.csv');
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

test('disabled view is skipped and selection/full-catalog exports keep their scope', async () => {
  await renderMenu(true, true);
  trigger().click();
  await expect.poll(() => document.activeElement?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Auswahl exportieren (1)');
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(item('Gesamtkatalog (40)'));
  await userEvent.keyboard('{Enter}');
  expect(downloadCSV).toHaveBeenLastCalledWith(controls, 'grundschutz-gesamtkatalog.csv');
  trigger().click();
  await expect.poll(() => host.querySelector('[role="menu"]')).not.toBeNull();
  await userEvent.keyboard(' ');
  expect(downloadCSV).toHaveBeenLastCalledWith([controls[0]], 'grundschutz-auswahl.csv');
});

test('outside click preserves a button target and returns focus for static content', async () => {
  await renderMenu();
  trigger().click();
  await expect.poll(() => host.querySelector('[role="menu"]')).not.toBeNull();
  await userEvent.click(page.getByRole('button', { name: 'Nachher' }));
  expect(document.activeElement?.textContent).toBe('Nachher');
  trigger().click();
  await expect.poll(() => host.querySelector('[role="menu"]')).not.toBeNull();
  await userEvent.click(page.getByText('Statische Fläche'));
  expect(document.activeElement).toBe(trigger());
});

test('outside text can be selected by a native drag while the export menu is open', async () => {
  await renderMenu();
  trigger().click();
  await expect.poll(() => host.querySelector('[role="menu"]')).not.toBeNull();
  const text = page.getByText('Statische Fläche');
  const bounds = text.element().getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(text.element());
  const textBounds = range.getBoundingClientRect();
  await userEvent.dragAndDrop(text, text, {
    sourcePosition: { x: textBounds.left - bounds.left + 1, y: textBounds.top - bounds.top + textBounds.height / 2 },
    targetPosition: { x: textBounds.right - bounds.left - 1, y: textBounds.top - bounds.top + textBounds.height / 2 },
  });
  expect(document.getSelection()?.toString()).toBe('Statische Fläche');
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).not.toBe(trigger());
});

test('outside double click selects text without delayed return focus', async () => {
  await renderMenu();
  trigger().click();
  await expect.poll(() => host.querySelector('[role="menu"]')).not.toBeNull();
  await userEvent.dblClick(page.getByText('Statische Fläche'), { position: { x: 12, y: 10 } });
  expect(document.getSelection()?.toString().trim()).toBe('Statische');
  expect(document.activeElement).not.toBe(trigger());
  expect(host.querySelector('[role="menu"]')).toBeNull();
});


test('outside click on a negative-tabindex table row updates its roving tab stop', async () => {
  await renderMenu(false, false, true);
  const firstRow = host.querySelector<HTMLElement>('tr[data-row-index="0"]')!;
  const secondRow = host.querySelector<HTMLElement>('tr[data-row-index="1"]')!;
  expect(firstRow.tabIndex).toBe(0);
  expect(secondRow.tabIndex).toBe(-1);
  trigger().click();
  await expect.poll(() => host.querySelector('[role="menu"]')).not.toBeNull();
  await userEvent.click(page.getByText('Kontrolle 1', { exact: true }));
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(secondRow);
  expect(selectControl).toHaveBeenCalledWith(controls[1]);
  await expect.poll(() => secondRow.tabIndex).toBe(0);
  expect(firstRow.tabIndex).toBe(-1);
});
