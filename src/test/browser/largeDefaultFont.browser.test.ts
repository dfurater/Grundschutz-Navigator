import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { commands, page } from 'vitest/browser';
import { parseCatalog } from '@/adapters/oscalAdapter';
import { CATALOG_ROUTE_PATTERN } from '@/app/routes';
import { CatalogBrowser } from '@/features/catalog/CatalogBrowser';
import { SearchPage } from '@/features/search/SearchPage';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import { createStartupCatalogSource } from '@/test/fixtures/startupCatalog';
import { HEIGHT, renderShell, swipe, unmountShell } from './mobileDrawerHarness';
import '@/index.css';

/**
 * Breakpoints bei vergrößerter Browser-Standardschrift (GSPP-495, GSPP-496).
 * `rem` in Media Queries hängt an der Standardschrift, Tailwind legt `md` auf
 * `48rem` und `lg` auf `64rem`. Bei 20 px liegen die Grenzen bei 960 px und
 * 1280 px. Die Media-Query-Abos der App müssen dieselben Grenzen melden wie
 * die CSS-Regeln, sonst passen gemountete Teilbäume und sichtbare Klassen
 * nicht zusammen.
 */

const FONT_SIZE = 20;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(async () => {
  await commands.setBrowserFontSize(FONT_SIZE);
});

afterEach(async () => {
  await commands.dispatchBrowserTouch('reset');
  await commands.setBrowserFontSize();
  unmountShell();
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

const drawerState = (shell: HTMLElement) => shell.querySelector<HTMLElement>('[data-mobile-nav]')!.dataset.mobileNav;

test('öffnet und schließt die mobile Schublade bei 20 px Standardschrift unterhalb von md (GSPP-495)', async () => {
  // 800 px liegen zwischen 768 px und `48rem` (960 px).
  const shell = await renderShell(800);
  expect(matchMedia('(width < 48rem)').matches).toBe(true);
  const aside = shell.querySelector('aside')!;
  const menuButton = shell.querySelector<HTMLButtonElement>('button[aria-controls]')!;
  expect(menuButton.checkVisibility()).toBe(true);

  menuButton.click();
  await expect.poll(() => drawerState(shell)).toBe('open');
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  expect(getComputedStyle(aside).translate).toBe('0px');
  expect(aside.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth);

  // Die Wischgeste schließt sie wieder und öffnet sie erneut.
  const drawerWidth = aside.getBoundingClientRect().width;
  await swipe([drawerWidth - 40, HEIGHT / 2], [40, HEIGHT / 2 + 60]);
  await expect.poll(() => drawerState(shell)).toBe('closed');
  await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);

  await swipe([40, HEIGHT / 2], [drawerWidth, HEIGHT / 2 + 60]);
  await expect.poll(() => drawerState(shell)).toBe('open');
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
});

function catalogState() {
  const catalog = parseCatalog(createStartupCatalogSource('large-default-font').catalog, {
    catalogKey: ENTRY_CATALOG_KEY,
  });
  return {
    ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}),
    catalog,
    loading: false,
  };
}

async function renderPage(route: string) {
  // 1100 px liegen zwischen 1024 px und `64rem` (1280 px).
  await page.viewport(1100, HEIGHT);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(CatalogContext.Provider, { value: catalogState() },
      createElement(MemoryRouter, { initialEntries: [route] },
        createElement(Routes, null,
          createElement(Route, { path: CATALOG_ROUTE_PATTERN, element: createElement(CatalogBrowser) }),
          createElement(Route, { path: '/suche', element: createElement(SearchPage) }),
        ),
      ),
    ));
  });
  await document.fonts.ready;
  expect(matchMedia('(width < 64rem)').matches).toBe(true);
  return host;
}

const visible = (element: Element | null) => element?.checkVisibility() ?? false;

test.each([
  ['Katalogseite', '/katalog/gspp'],
  ['Suchseite', '/suche?q=Kontrolle'],
])('zeigt die %s bei 20 px Standardschrift unterhalb von lg konsistent mobil (GSPP-496)', async (_name, route) => {
  const view = await renderPage(route);
  await expect.poll(() => view.textContent).toContain('Kontrolle');

  // Die Kontrollen stehen sichtbar in der mobilen Liste, nicht in einer
  // gemounteten, aber per `lg:flex` verborgenen Desktop-Tabelle.
  expect(view.querySelector('table')).toBeNull();
  const row = [...view.querySelectorAll('button, a')].find((element) => element.textContent?.includes('Kontrolle'));
  expect(visible(row ?? null)).toBe(true);

  // Genau ein Export-Zugang: der mobile, kein Desktop-Menü daneben.
  expect(view.querySelector('button[aria-label="Exportoptionen"]')).toBeNull();
  expect(visible(view.querySelector('button[aria-label="CSV exportieren"]'))).toBe(true);
  expect(visible(view.querySelector('button[aria-label="Kontrollen auswählen"]'))).toBe(true);
});
