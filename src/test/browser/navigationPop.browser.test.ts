import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { PAGE_TITLES, PRODUCT_TITLE } from '@/app/pageTitles';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import '@/index.css';

/*
 * Zurück-Navigation (POP) auf eine noch nicht geladene Lazy-Route in Chromium
 * (GSPP-506): Der Browser hat die Adresszeile schon gewechselt, wenn der Router
 * das Ereignis verarbeitet. Bis der Chunk da ist, bleiben vorige Seite und Titel
 * stehen, und nach der Schwelle meldet der Hinweis das Warten; danach erscheint
 * die Zielseite.
 *
 * Der Router führt seinen Verlauf in einem eingebetteten Same-Origin-Frame
 * (`createBrowserRouter`, Option `window`): Der Egress-Guard wertet jede
 * Navigation des Testframes, auch `pushState`, als Verstoß. Der Frame lädt
 * `favicon.svg`, ein Dokument ohne Skripte; die Router-Pfade setzt `pushState`.
 */

const control = vi.hoisted(() => {
  let open: () => void = () => {};
  const searchOpened = new Promise<void>((resolve) => { open = resolve; });
  return { searchOpened, openSearch: () => open() };
});

vi.mock('@/features/home/HomePage', async () => {
  const { createElement: h } = await import('react');
  return { HomePage: () => h('h1', null, 'Startseite') };
});
vi.mock('@/features/search/SearchPage', async () => {
  await control.searchOpened;
  const { createElement: h } = await import('react');
  return { SearchPage: () => h('h1', null, 'Suchseite') };
});

const PENDING_TEXT = 'Seite wird geladen…';
const basename = '/gspp-pop-history';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let historyFrame: HTMLIFrameElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  historyFrame?.remove();
  root = undefined;
  host = undefined;
  historyFrame = undefined;
});

/** Same-Origin-Frame, dessen Verlauf und Adresse der Router verwendet. */
async function openHistoryFrame(): Promise<Window> {
  historyFrame = document.createElement('iframe');
  const loaded = new Promise((resolve) => historyFrame!.addEventListener('load', resolve, { once: true }));
  historyFrame.src = '/favicon.svg';
  document.body.append(historyFrame);
  await loaded;
  const frameWindow = historyFrame.contentWindow!;
  expect(frameWindow.document.scripts).toHaveLength(0);
  return frameWindow;
}

function heading(): string | undefined {
  return host!.querySelector('main h1')?.textContent ?? undefined;
}

function pendingVisible(): boolean {
  const main = host!.querySelector('main')!;
  return [...host!.querySelectorAll('output')]
    .some((output) => !main.contains(output) && output.textContent?.includes(PENDING_TEXT));
}

test('Chromium: Zurück auf eine ungeladene Lazy-Route wechselt die Adresszeile sofort, Seite und Titel erst mit dem Chunk', async () => {
  const frameWindow = await openHistoryFrame();
  // Verlauf vor dem Routerstart: voriger Eintrag Suche, aktueller Eintrag Start.
  frameWindow.history.replaceState(null, '', `${basename}/suche`);
  frameWindow.history.pushState(null, '', `${basename}/`);

  const router = createBrowserRouter(createAppRoutes(createElement(AppShell)), { basename, window: frameWindow });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const catalogState = { ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}), loading: false };
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: catalogState },
      createElement(RouterProvider, { router }),
    ));
  });
  await expect.poll(heading).toBe('Startseite');
  await expect.poll(() => document.title).toBe(PRODUCT_TITLE);

  frameWindow.history.back();

  await expect.poll(() => frameWindow.location.pathname).toBe(`${basename}/suche`);
  await expect.poll(() => router.state.navigation.state).toBe('loading');
  await expect.poll(pendingVisible, { timeout: 2000 }).toBe(true);
  expect(heading()).toBe('Startseite');
  expect(document.title).toBe(PRODUCT_TITLE);

  control.openSearch();

  await expect.poll(heading).toBe('Suchseite');
  expect(frameWindow.location.pathname).toBe(`${basename}/suche`);
  expect(document.title.startsWith(PAGE_TITLES.search)).toBe(true);
  await expect.poll(pendingVisible).toBe(false);
  expect(router.state.navigation.state).toBe('idle');
  router.dispose();
});
