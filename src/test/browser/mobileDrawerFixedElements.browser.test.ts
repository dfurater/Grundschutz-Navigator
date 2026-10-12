import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  HEIGHT,
  WIDTH,
  closeDrawer,
  openDrawer,
  renderShell,
  translateTransition,
  unmountShell,
} from './mobileDrawerHarness';

/**
 * Feste Seitenelemente bei offener mobiler Schublade (GSPP-515). Die Schublade
 * legt sich als Overlay über die Seite, ohne sie zu verschieben. Solange sie
 * offen ist, treten Auswahlleiste und Sheet-Trigger zurück, damit kein festes
 * Element mit der Schublade um den unteren Bildschirmrand konkurriert; das
 * Schließen gibt sie sofort frei, während die Schublade noch hinausgleitet.
 * Als Seite dienen die echte Auswahlleiste und die echte Toolbar mit den
 * Triggern der mobilen Sheets.
 */

vi.mock('@/features/home/HomePage', async () => {
  const { createElement, Fragment } = await import('react');
  const { CatalogMobileSelectionBar } = await import('@/features/catalog/CatalogMobileSelectionBar');
  const { CatalogToolbar } = await import('@/features/catalog/CatalogToolbar');
  const { emptyFilters } = await import('@/hooks/useFilteredControls');
  return {
    HomePage: () => createElement(
      Fragment,
      null,
      createElement(CatalogToolbar, {
        title: 'Testthema',
        filteredCount: 1,
        totalCount: 1,
        hasActiveFilters: false,
        onClearFilters: () => {},
        checkedIds: new Set(['a']),
        mobileSelectMode: false,
        onToggleMobileSelectMode: () => {},
        onClearSelection: () => {},
        filteredControls: [],
        allControls: [],
        sectionFilename: 'test.csv',
        filterPanelProps: { filters: emptyFilters } as never,
        isDesktop: false,
      }),
      createElement(CatalogMobileSelectionBar, {
        checkedIds: new Set(['a']),
        allControls: [],
        onDone: () => {},
      }),
    ),
  };
});

afterEach(unmountShell);

const selectionBar = (shell: HTMLElement) => [...shell.querySelectorAll<HTMLElement>('div.fixed')]
  .find((element) => element.querySelector('output') !== null) ?? null;

const sheetTrigger = (shell: HTMLElement, label: string) => [...shell.querySelectorAll<HTMLButtonElement>('button')]
  .find((button) => button.getAttribute('aria-label') === label || button.textContent?.trim() === label) ?? null;

/** Die festen Seitenelemente, die bei Bewegung der Seite zurücktreten müssen. */
const fixedElements = (shell: HTMLElement) => ({
  bar: selectionBar(shell),
  filter: sheetTrigger(shell, 'Filter anzeigen'),
  exportSheet: sheetTrigger(shell, 'CSV exportieren'),
});

test('hält feste Auswahlleiste und Sheet-Trigger nur bei offener Schublade zurück', async () => {
  const shell = await renderShell(WIDTH, '/');
  window.scrollTo(0, HEIGHT);
  const aside = shell.querySelector('aside')!;

  // Ruhelage: Die feste Leiste richtet sich nach dem Bildschirm.
  await expect.poll(() => fixedElements(shell).bar).not.toBeNull();
  expect(fixedElements(shell).filter).not.toBeNull();
  expect(fixedElements(shell).exportSheet).not.toBeNull();
  expect(selectionBar(shell)!.getBoundingClientRect().bottom).toBe(window.innerHeight);

  // Bei offener Schublade treten sie zurück.
  await openDrawer(shell, { animated: true });
  expect(Object.values(fixedElements(shell))).toEqual([null, null, null]);

  // Das Hinausgleiten wird angehalten, damit die Messung nicht vom Takt abhängt.
  closeDrawer(shell);
  await Promise.resolve();
  const slide = translateTransition(aside);
  expect(slide).toBeDefined();
  slide!.pause();

  // Die Schublade gleitet noch hinaus, die Elemente stehen schon bereit.
  await expect.poll(() => fixedElements(shell).bar).not.toBeNull();
  expect(fixedElements(shell).filter).not.toBeNull();
  expect(fixedElements(shell).exportSheet).not.toBeNull();
  expect(selectionBar(shell)!.getBoundingClientRect().bottom).toBe(window.innerHeight);
  slide!.finish();
});

// Während eines Seitenleisten-Resizes läuft die Schublade ohne Bewegung; das
// Schließen stellt sie sofort zurück, und die festen Elemente kehren zurück.
test('gibt die festen Elemente beim Schließen während eines Seitenleisten-Resizes sofort frei', async () => {
  const shell = await renderShell(1024, '/');
  window.scrollTo(0, HEIGHT);
  const resizeHandle = shell.querySelector<HTMLButtonElement>('button[aria-label="Sidebar-Breite anpassen"]')!;
  resizeHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 256 }));

  await page.viewport(WIDTH, HEIGHT);
  await expect.poll(() => getComputedStyle(resizeHandle).display).toBe('none');

  await openDrawer(shell);
  expect(fixedElements(shell).bar).toBeNull();

  closeDrawer(shell);
  await expect.poll(() => fixedElements(shell).bar).not.toBeNull();
  expect(selectionBar(shell)!.getBoundingClientRect().bottom).toBe(window.innerHeight);

  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
