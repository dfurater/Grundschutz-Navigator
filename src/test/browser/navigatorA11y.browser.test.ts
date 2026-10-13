import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildCatalogUrl, buildControlUrl } from '@/app/routes';
import { CatalogContext } from '@/state/CatalogContext';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;

afterEach(() => {
  root?.unmount();
  router?.dispose();
  host?.remove();
  root = undefined;
  router = undefined;
  host = undefined;
});

async function renderState(path: string, width: number) {
  await page.viewport(width, 900);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
      createElement(RouterProvider, { router: router! }),
    ));
  });
  await expect.poll(() => router!.state.initialized).toBe(true);
  await expect.poll(() => host!.querySelector('main h1')).not.toBeNull();
  await document.fonts.ready;
  return host;
}

test.each([390, 1440])('Startseite bei %i px: Axe nach sichtbarem Katalogüberblick', async (width) => {
  const shell = await renderState('/', width);
  expect(shell.querySelector('main h1')?.textContent).toBe('Grundschutz++ Navigator');
  expect(shell.querySelector('footer')?.closest('main')).toBeNull();
  expect(shell.querySelector('main')?.textContent).toContain('Testpraktik');
  await assertNoAxeViolations(shell, `Startseite (${width} px)`, 'all');
});

test.each([390, 1440])('Katalog bei %i px: Axe nach gerenderter Kontrollliste', async (width) => {
  const shell = await renderState(buildCatalogUrl(ENTRY_CATALOG_KEY), width);
  await expect.poll(() => shell.querySelector('main')?.textContent).toContain('Zugriff schützen');
  expect(shell.querySelector('main')?.textContent).toContain('Netz segmentieren');
  if (width === 1440) {
    expect(shell.querySelector('aside[aria-label="Katalog-Explorer"]')).not.toBeNull();
    expect(shell.querySelector('aside[aria-label="Katalogfilter"]')).not.toBeNull();
    expect(shell.querySelector('thead th:last-child')?.textContent).toBe('Details öffnen');
  }
  await assertNoAxeViolations(shell, `Katalog (${width} px)`, 'all');
});

test.each([390, 1440])('Suchergebnisse bei %i px: Axe nach echtem Suchtreffer', async (width) => {
  const shell = await renderState('/suche?q=Zugriff', width);
  await expect.poll(() => shell.querySelector('[data-testid^="search-results-"]')?.textContent)
    .toContain('Zugriff schützen');
  expect(shell.querySelector('main h1')?.textContent).toContain('Suchergebnisse');
  expect(shell.querySelector('main')?.textContent).toContain('1 Ergebnis');
  await assertNoAxeViolations(shell, `Suchergebnisse (${width} px)`, 'all');
});

test.each([390, 1440])('Control-Detail bei %i px: Axe mit echten Detailinhalten', async (width) => {
  const shell = await renderState(buildControlUrl(ENTRY_CATALOG_KEY, 'a11y-access'), width);
  await expect.poll(() => shell.querySelector('[data-control-detail-title]')?.textContent)
    .toContain('Zugriff schützen');
  if (width === 1440) {
    expect(shell.querySelector('aside[aria-label="Kontrolldetails"]')).not.toBeNull();
  }
  const detail = shell.querySelector('[data-control-detail-scroll]')!;
  expect(detail.textContent).toContain('Die Organisation MUSS den Zugriff auf Daten schützen.');
  expect(detail.textContent).toContain('Berechtigungen werden regelmäßig geprüft und dokumentiert.');
  await assertNoAxeViolations(shell, `Control-Detail (${width} px)`, 'all');
});
