import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { PAGE_TITLES, PRODUCT_TITLE } from '@/app/pageTitles';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
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

function renderShell(path: string, catalogLoading: boolean) {
  const routes = createAppRoutes(createElement(AppShell));
  if (!catalogLoading) {
    const about = routes[0].children![0].children!.find((route) => route.path === '/about')!;
    // Die echte Routentabelle samt hydrateFallbackElement; nur das Seitenmodul wartet.
    about.lazy = () => new Promise(() => {});
  }
  router = createMemoryRouter(routes, { initialEntries: [path] });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const catalogState = { ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}), loading: catalogLoading };
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: catalogState },
      createElement(RouterProvider, { router: router! }),
    ));
  });
}

async function renderPendingRoute(width: number, height: number) {
  await page.viewport(width, height);
  renderShell('/about', false);
  await document.fonts.ready;
  await expect.poll(() => host!.querySelector('main output')?.textContent).toContain('Seite wird geladen…');
  return host!.querySelector<HTMLOutputElement>('main output')!;
}

/** Ladefläche des Katalogs, solange der Katalog selbst noch lädt. */
async function renderLoadingCatalog(width: number, height: number) {
  await page.viewport(width, height);
  renderShell(`/katalog/${ENTRY_CATALOG_KEY}`, true);
  await document.fonts.ready;
  await expect.poll(() => host!.querySelector('main')?.textContent).toContain('Katalog wird geladen…');
  return [...host!.querySelectorAll<HTMLElement>('main p')]
    .find((element) => element.textContent === 'Katalog wird geladen…')!
    .closest<HTMLElement>('.flex-1')!;
}

function expectReachableFooterLinks(area: Element) {
  const footer = host!.querySelector('footer')!;
  expect(footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(innerHeight);
  expect(area.getBoundingClientRect().bottom).toBeLessThanOrEqual(footer.getBoundingClientRect().top);
  for (const link of footer.querySelectorAll('a')) {
    const box = link.getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(0);
    expect(box.bottom).toBeLessThanOrEqual(innerHeight);
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
    expect(link.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2))).toBe(true);
  }
}

test.each([768, 1024, 1440])(
  'hält Footerlinks beim Direktaufruf einer wartenden Route bei %i × 300 px sichtbar und per Pointer erreichbar',
  async (width) => {
    const status = await renderPendingRoute(width, 300);
    expect(document.title).toBe(`${PAGE_TITLES.about} | ${PRODUCT_TITLE}`);
    expectReachableFooterLinks(status);
    const text = status.querySelector('span:last-child')!.getBoundingClientRect();
    expect(text.top).toBeGreaterThanOrEqual(status.getBoundingClientRect().top);
    expect(text.bottom).toBeLessThanOrEqual(status.getBoundingClientRect().bottom);
  },
);

test.each([390, 767])('behält unter md bei %i px die mobile Mindesthöhe der Ladefläche', async (width) => {
  const status = await renderPendingRoute(width, 300);
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  expect(status.getBoundingClientRect().height).toBeGreaterThanOrEqual(16 * rem);
  expect(getComputedStyle(status).minHeight).toBe(`${16 * rem}px`);
});

test.each([768, 1024, 1440])(
  'hält Footerlinks während des Katalog-Ladens bei %i × 300 px sichtbar und per Pointer erreichbar',
  async (width) => {
    const area = await renderLoadingCatalog(width, 300);
    expectReachableFooterLinks(area);
  },
);

test.each([390, 767])('behält unter md bei %i px die mobile Mindesthöhe der Katalog-Ladefläche', async (width) => {
  const area = await renderLoadingCatalog(width, 300);
  expect(area.getBoundingClientRect().height).toBeGreaterThanOrEqual(innerHeight / 2 - 0.5);
  expect(getComputedStyle(area).minHeight).toBe(`${innerHeight / 2}px`);
});
