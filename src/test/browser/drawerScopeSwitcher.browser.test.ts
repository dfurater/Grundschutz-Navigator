import { createElement, Fragment, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { createMemoryRouter, useLocation } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { useCatalog } from '@/hooks/useCatalog';
import type { CatalogState } from '@/domain/models';
import { CatalogProvider } from '@/state/CatalogContext';
import { openDrawer, settlePush } from './mobileDrawerHarness';
import '@/index.css';

// Echter Provider mit den ausgelieferten Katalogen: aktive Schlüssel und Titel
// werden wie in der App geladen, nicht mit einem leeren Testverzeichnis ersetzt.
const CATALOGS = [
  { key: 'gspp', title: 'Anwenderkatalog Grundschutz++', shortTitle: 'Grundschutz++' },
  { key: 'lieferkette', title: 'Supply Chain Security', shortTitle: 'Supply Chain Security' },
  { key: 'diva', title: 'DIVA - Durchgängige Identitätsprüfung, Verifikation und Absicherung', shortTitle: 'DIVA' },
  { key: 'wlan-gastnetze', title: 'Stand der Technik WLAN-Personal- und Gastnetze mit gemeinsamem Kennwort', shortTitle: 'WLAN-Personal- und Gastnetze' },
] as const;
const PROFILES = [
  { width: 320, height: 568, touch: true },
  { width: 390, height: 844, touch: true },
  { width: 744, height: 1133, touch: true },
  { width: 1032, height: 1376, touch: true },
  { width: 1133, height: 744, touch: true },
  { width: 1376, height: 1032, touch: true },
  { width: 1366, height: 768, touch: false },
];
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
let catalogState: CatalogState | undefined;
let committedLocationKey: string | undefined;

// Router-State kann vor dem React-Commit wechseln. Erst dessen Layout-Effekt
// bestätigt, dass die Shell den Routenwechsel samt Drawer-Schließen verarbeitet hat.
function LocationProbe() {
  const { key } = useLocation();
  useLayoutEffect(() => { committedLocationKey = key; }, [key]);
  return null;
}

function CatalogProbe() {
  const state = useCatalog();
  useLayoutEffect(() => { catalogState = state; }, [state]);
  return null;
}

async function expectLoadedCatalog(key: string) {
  await expect.poll(() => ({
    key: catalogState?.catalog?.catalogKey,
    selected: catalogState?.activeCatalogKey,
    loading: catalogState?.loading,
    error: catalogState?.error,
  }), { timeout: 5000 }).toEqual({ key, selected: key, loading: false, error: null });
}

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  router?.dispose();
  router = undefined;
  catalogState = undefined;
  committedLocationKey = undefined;
  await commands.setBrowserCoarsePointer(false);
  await commands.setBrowserFontSize();
});

function triggerIn(aside: HTMLElement) {
  return aside.querySelector<HTMLButtonElement>('[data-catalog-switcher] button[aria-expanded]');
}

function expectReachable(element: HTMLElement, width: number, height: number) {
  expect(element.checkVisibility()).toBe(true);
  const box = element.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(width);
  expect(box.bottom).toBeLessThanOrEqual(height);
  // checkVisibility und DOMRect erkennen Clipping durch Vorfahren nicht.
  for (const fraction of [0.2, 0.5, 0.8]) {
    const hit = document.elementFromPoint(box.left + box.width * fraction, box.top + box.height * fraction);
    expect(element.contains(hit), `${element.textContent || element.getAttribute('aria-label')} at ${fraction}: hit ${hit?.tagName}.${hit?.className}`).toBe(true);
  }
}

async function tap(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement!.getBoundingClientRect();
  const scale = frame.width / window.innerWidth;
  await commands.dispatchBrowserTouch('start', frame.left + (box.left + box.width / 2) * scale,
    frame.top + (box.top + box.height / 2) * scale);
  await commands.dispatchBrowserTouch('end');
}

async function renderCatalogShell(width: number, height: number) {
  await page.viewport(width, height);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  router = createMemoryRouter(createAppRoutes(createElement(Fragment, null, createElement(AppShell), createElement(LocationProbe))), { initialEntries: ['/katalog/gspp'] });
  flushSync(() => {
    root?.render(createElement(CatalogProvider, null,
      createElement(CatalogProbe), createElement(RouterProvider, { router: router! })));
  });
  await expectLoadedCatalog('gspp');
  return host.querySelector('aside')!;
}

test.each(PROFILES)('hält die Kontextwahl bei $width px (Touch: $touch) sichtbar und bedienbar', async ({ width, height, touch }) => {
  await commands.setBrowserCoarsePointer(touch);
  const aside = await renderCatalogShell(width, height);
  await expect.poll(() => triggerIn(aside)?.textContent).toContain(CATALOGS[0].shortTitle);
  await expect.poll(() => aside.querySelector('[role="tree"]')).not.toBeNull();
  await document.fonts.ready;
  if (touch) {
    await openDrawer(host!);
    await settlePush(host!);
  }
  const trigger = triggerIn(aside)!;
  const close = () => aside.querySelector<HTMLButtonElement>(touch
    ? 'button[aria-label="Menü schließen"]'
    : 'button[aria-label="Katalog-Explorer ausblenden"]')!;
  expectReachable(trigger, width, height);
  expectReachable(close(), width, height);

  const closedWidth = aside.getBoundingClientRect().width;
  const list = () => aside.querySelector<HTMLElement>('nav[aria-label="Verfügbare Kataloge"]:not([hidden])');

  trigger.focus();
  await userEvent.keyboard('{Enter}');
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
  expect(trigger).toHaveAccessibleDescription(CATALOGS[0].title);
  expect(document.activeElement).toBe(trigger);
  await userEvent.tab();
  expect(document.activeElement).toBe(list()?.querySelector('[aria-current="true"]'));
  await userEvent.keyboard('{Escape}');
  expect(list()).toBeNull();
  expect(document.activeElement).toBe(trigger);
  if (touch) expect(aside).not.toHaveAttribute('inert');

  for (const catalog of CATALOGS) {
    if (touch) await tap(trigger);
    else await userEvent.click(trigger);
    const listElement = list()!;
    expect(listElement).toBeVisible();
    // Die Liste steht in der Seitenleiste und ändert deren Breite nicht.
    expect(aside.getBoundingClientRect().width).toBe(closedWidth);

    const items = [...listElement.querySelectorAll<HTMLElement>('li > :is(a, button)')];
    expect(items).toHaveLength(CATALOGS.length);
    const current = listElement.querySelector<HTMLElement>('[aria-current="true"]')!;
    expect(current.textContent).toContain('Geöffnet');
    const currentStatusId = current.getAttribute('aria-describedby')?.split(' ')[0];
    expect(document.getElementById(currentStatusId ?? '')?.textContent).toBe('Geöffnet');
    const currentCount = catalogState!.catalog!.totalControls.toLocaleString('de-DE');
    expect(current.textContent).toContain(currentCount);
    const item = items.find((entry) => entry.textContent?.includes(catalog.title))!;
    const title = document.getElementById(item.getAttribute('aria-labelledby')!)!;
    expect(title).toHaveTextContent(catalog.title);
    expect(title.scrollWidth).toBe(title.clientWidth);
    if (catalog.title.length > 30) {
      expect(title.getBoundingClientRect().height).toBeGreaterThan(Number.parseFloat(getComputedStyle(title).lineHeight));
    }
    if (touch) expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    item.scrollIntoView({ block: 'nearest' });
    expectReachable(item, width, height);

    const previousLocationKey = router!.state.location.key;
    if (item !== current) expect(item.getAttribute('href')).toBe(`/katalog/${catalog.key}`);
    if (touch) await tap(item);
    else await userEvent.click(item);
    if (item === current) {
      expect(router!.state.location.key).toBe(previousLocationKey);
      expect(document.activeElement).toBe(trigger);
      if (touch) expect(aside).not.toHaveAttribute('inert');
    } else {
      await expect.poll(() => router!.state.location.key).not.toBe(previousLocationKey);
      await expect.poll(() => committedLocationKey).toBe(router!.state.location.key);
      await expectLoadedCatalog(catalog.key);
      await expect.poll(() => document.activeElement?.matches('[data-catalog-scope-heading]')).toBe(true);
      if (touch) {
        await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
        await openDrawer(host!);
        await settlePush(host!);
      }
    }
    expect(list()).toBeNull();
    await expect.poll(() => aside.getBoundingClientRect().width).toBe(closedWidth);
    expect(trigger.textContent).toContain(catalog.shortTitle);
    expectReachable(trigger, width, height);
    expectReachable(close(), width, height);
  }

  await router!.navigate(-1);
  await expectLoadedCatalog('diva');
  expect(trigger.textContent).toContain('DIVA');
  expect(list()).toBeNull();
  if (touch) {
    await openDrawer(host!);
    await settlePush(host!);
  }
  if (touch) {
    await tap(close());
    await expect.poll(() => host!.querySelector('[data-mobile-nav]')?.getAttribute('data-mobile-nav')).toBe('closed');
  }
});

// Mausklicks auch in der Schublade: Chromium lenkt einen Tipp auf die freie Fläche zum nächsten Baumknoten um.
test.each([
  { width: 390, height: 844, drawer: true },
  { width: 1366, height: 768, drawer: false },
])('bricht einen Wechsel bei $width px mit Escape ab, nachdem ein Klick den Fokus aus der Liste nimmt', async ({ width, height, drawer }) => {
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const realFetch = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (String(input).includes('catalog-diva.json')) await held;
    return realFetch(input, init);
  });
  try {
    const aside = await renderCatalogShell(width, height);
    await expect.poll(() => aside.querySelector('[role="tree"]')).not.toBeNull();
    if (drawer) {
      await openDrawer(host!);
      await settlePush(host!);
    }
    await userEvent.click(triggerIn(aside)!);
    const list = aside.querySelector<HTMLElement>('nav[aria-label="Verfügbare Kataloge"]:not([hidden])')!;
    const diva = list.querySelector<HTMLElement>('a[href="/katalog/diva"]')!;
    await userEvent.click(diva);
    await expect.poll(() => diva.getAttribute('aria-busy')).toBe('true');

    // Die freie Fläche unter der Liste gehört zum Katalogbaum und ist nicht fokussierbar.
    await userEvent.click(list.nextElementSibling as HTMLElement, { position: { x: 12, y: 3 } });
    expect(document.activeElement).toBe(document.body);
    await userEvent.keyboard('{Escape}');
    expect(diva).not.toHaveAttribute('aria-busy');

    release();
    await expect.poll(() => catalogState?.catalogs.get('diva')?.catalog ?? null, { timeout: 5000 }).not.toBeNull();
    expect(router!.state.location.pathname).toBe('/katalog/gspp');
    expect(list).toBeVisible();
    expect(host!.querySelector('[data-mobile-nav]')?.getAttribute('data-mobile-nav')).toBe(drawer ? 'open' : 'closed');
  } finally {
    release();
    vi.restoreAllMocks();
  }
});

test('bricht den Kurztitel der Werkzeugleiste bei 200 % Schrift im mobilen Direktlink um', async () => {
  await commands.setBrowserFontSize(32);
  await page.viewport(320, 568);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: ['/katalog/wlan-gastnetze'] });
  flushSync(() => {
    root?.render(createElement(CatalogProvider, null,
      createElement(CatalogProbe), createElement(RouterProvider, { router: router! })));
  });
  await expectLoadedCatalog('wlan-gastnetze');
  await expect.poll(() => host!.querySelector('[data-catalog-scope-heading]')).not.toBeNull();
  const heading = host.querySelector<HTMLElement>('[data-catalog-scope-heading]')!;
  await document.fonts.ready;
  const label = document.getElementById(heading.getAttribute('aria-describedby')!)!;
  expect(label.textContent).toContain(CATALOGS[3].shortTitle);
  const box = label.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(320);
  expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(320);
});
