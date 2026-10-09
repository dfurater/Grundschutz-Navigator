import { afterEach, expect, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import {
  HEIGHT,
  WIDTH,
  closeDrawer,
  openDrawer,
  renderShell,
  settlePush,
  translateTransition,
  unmountShell,
} from './mobileDrawerHarness';

/**
 * Feste Seitenelemente nach dem Schließen der mobilen Schublade (GSPP-494).
 * Ein anderer `translate`-Wert als `none` macht `main` zum Bezugsrahmen fester
 * Nachfahren; die Auswahlleiste darf deshalb erst zurückkehren, wenn die Seite
 * wieder an ihrer Ruhelage steht. Als Seite dienen die echte Auswahlleiste und
 * die echte Toolbar mit den Triggern der mobilen Sheets.
 */

vi.mock('@/features/home/HomePage', async () => {
  const { createElement, Fragment } = await import('react');
  const { CatalogMobileSelectionBar } = await import('@/features/catalog/CatalogMobileSelectionBar');
  const { CatalogToolbar } = await import('@/features/catalog/CatalogToolbar');
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
        filterPanelProps: {} as never,
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

test('hält feste Auswahlleiste und Sheet-Trigger beim Schließen zurück, bis die Seite wieder an ihrer Ruhelage steht', async () => {
  const shell = await renderShell(WIDTH, '/');
  window.scrollTo(0, HEIGHT);
  const main = shell.querySelector('main')!;

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
  const slide = translateTransition(main);
  expect(slide).toBeDefined();
  slide!.pause();
  expect(getComputedStyle(main).translate).not.toBe('none');
  expect(Object.values(fixedElements(shell))).toEqual([null, null, null]);

  slide!.finish();
  await expect.poll(() => fixedElements(shell).bar).not.toBeNull();
  expect(getComputedStyle(main).translate).toBe('none');
  expect(fixedElements(shell).filter).not.toBeNull();
  expect(fixedElements(shell).exportSheet).not.toBeNull();
  expect(selectionBar(shell)!.getBoundingClientRect().bottom).toBe(window.innerHeight);
});

// Während eines Seitenleisten-Resizes entfällt die Bewegung der Schublade, und
// die Seite darf nicht allein weiterlaufen: Sonst käme die Leiste zurück, solange
// `main` noch einen `translate`-Wert trägt (Review GSPP-494).
test('lässt die Seite beim Schließen während eines Seitenleisten-Resizes nicht allein hinausgleiten', async () => {
  const shell = await renderShell(1024, '/');
  window.scrollTo(0, HEIGHT);
  const main = shell.querySelector('main')!;
  const resizeHandle = shell.querySelector<HTMLButtonElement>('button[aria-label="Sidebar-Breite anpassen"]')!;
  resizeHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 256 }));

  await page.viewport(WIDTH, HEIGHT);
  await expect.poll(() => getComputedStyle(resizeHandle).display).toBe('none');
  const root = shell.querySelector<HTMLElement>('[data-mobile-nav]')!;
  expect(root.hasAttribute('data-sidebar-resizing')).toBe(true);

  await openDrawer(shell);
  // Die Seite steht erst nach der Push-Bewegung verschoben; zu Beginn trägt sie `0px`,
  // und von dort gäbe es beim Schließen keine Strecke und keine Transition.
  await settlePush(shell);
  expect(main.getBoundingClientRect().left).toBeGreaterThan(100);
  expect(fixedElements(shell).bar).toBeNull();

  closeDrawer(shell);
  await Promise.resolve();
  // Ohne Bewegung der Schublade gibt es auch keine der Seite: Sie steht sofort an ihrer Ruhelage.
  expect(translateTransition(main)).toBeUndefined();
  await expect.poll(() => fixedElements(shell).bar).not.toBeNull();
  expect(getComputedStyle(main).translate).toBe('none');
  expect(fixedElements(shell).bar!.getBoundingClientRect().bottom).toBe(window.innerHeight);

  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});
