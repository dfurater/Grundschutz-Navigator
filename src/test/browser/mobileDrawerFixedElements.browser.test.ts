import { afterEach, expect, test, vi } from 'vitest';
import { HEIGHT, WIDTH, closeDrawer, openDrawer, renderShell, translateTransition, unmountShell } from './mobileDrawerHarness';

/**
 * Feste Seitenelemente nach dem Schließen der mobilen Schublade (GSPP-494).
 * Ein anderer `translate`-Wert als `none` macht `main` zum Bezugsrahmen fester
 * Nachfahren; die Auswahlleiste darf deshalb erst zurückkehren, wenn die Seite
 * wieder an ihrer Ruhelage steht. Als Seite dient die echte Auswahlleiste.
 */

vi.mock('@/features/home/HomePage', async () => {
  const { createElement } = await import('react');
  const { CatalogMobileSelectionBar } = await import('@/features/catalog/CatalogMobileSelectionBar');
  return {
    HomePage: () => createElement(CatalogMobileSelectionBar, {
      checkedIds: new Set(['a']),
      allControls: [],
      onDone: () => {},
    }),
  };
});

afterEach(unmountShell);

const selectionBar = (shell: HTMLElement) => [...shell.querySelectorAll<HTMLElement>('div.fixed')]
  .find((element) => element.querySelector('output') !== null) ?? null;

test('hält die feste Auswahlleiste beim Schließen zurück, bis die Seite wieder an ihrer Ruhelage steht', async () => {
  const shell = await renderShell(WIDTH, '/');
  window.scrollTo(0, HEIGHT);
  const main = shell.querySelector('main')!;

  // Ruhelage: Die feste Leiste richtet sich nach dem Bildschirm.
  await expect.poll(() => selectionBar(shell)).not.toBeNull();
  expect(selectionBar(shell)!.getBoundingClientRect().bottom).toBe(window.innerHeight);

  // Bei offener Schublade tritt sie zurück.
  await openDrawer(shell, { animated: true });
  expect(selectionBar(shell)).toBeNull();

  // Das Hinausgleiten wird angehalten, damit die Messung nicht vom Takt abhängt.
  closeDrawer(shell);
  await Promise.resolve();
  const slide = translateTransition(main);
  expect(slide).toBeDefined();
  slide!.pause();
  expect(getComputedStyle(main).translate).not.toBe('none');
  expect(selectionBar(shell)).toBeNull();

  slide!.finish();
  await expect.poll(() => selectionBar(shell)).not.toBeNull();
  expect(getComputedStyle(main).translate).toBe('none');
  expect(selectionBar(shell)!.getBoundingClientRect().bottom).toBe(window.innerHeight);
});
