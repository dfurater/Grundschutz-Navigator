import { createElement, type ComponentType } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Outlet, createMemoryRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { NAVIGATION_PENDING_DELAY_MS, NavigationPendingIndicator, NavigationPendingProvider } from '@/app/navigationPending';
import type { Catalog, CatalogState, Control } from '@/domain/models';
import { SECURITY_TARGETS_NAMESPACE_URL } from '@/domain/vocabularyNamespaces';
import { CatalogDetailPanel } from '@/features/catalog/CatalogDetailPanel';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import '@/index.css';

/**
 * Tablet-Inline-Detailpanel mit echtem `ControlDetail` (GSPP-514): Der
 * Ladehinweis einer wartenden Navigation steht im erreichbaren Shell-Hinweis,
 * weil das Panel nicht modal ist; der Tab-Umlauf bleibt frei und überspringt
 * die Links der geschlossene Legende nativ.
 */

const securityTarget = (name: 'confidentiality' | 'integrity' | 'availability' | 'authenticity', value: string) => ({
  [name]: value,
  [`${name}Prop`]: { name, value, ns: SECURITY_TARGETS_NAMESPACE_URL },
});

const control = {
  id: 'GC.2.2',
  altIdentifier: 'alt-gc-2-2',
  title: 'Testkontrolle',
  groupId: 'GC.2',
  practiceId: 'GC',
  tags: [],
  taxonomy: [],
  threats: [],
  statement: 'Die Kontrolle schützt Daten.',
  statementRaw: 'Die Kontrolle schützt Daten.',
  guidance: '',
  statementProps: { zielobjektKategorien: [] },
  links: [],
  params: {},
  ...securityTarget('confidentiality', '2'),
  ...securityTarget('integrity', '1'),
  ...securityTarget('availability', '1'),
  ...securityTarget('authenticity', '0'),
} as Control;

const catalog = {
  catalogKey: 'gspp',
  uuid: 'test-catalog',
  practices: [],
  controls: [control],
  controlsById: new Map([[control.id, control]]),
  controlsByAltIdentifier: new Map(),
  backMatter: [],
  totalControls: 1,
} as unknown as Catalog;

const catalogState = {
  ...catalogCollectionDefaults(),
  catalog,
  catalogDocument: null,
  provenance: null,
  verification: null,
  vocabularyRegistry: createTestVocabularyRegistry(),
  vocabularyProvenance: null,
  vocabularyVerification: null,
  loading: false,
  error: null,
} as CatalogState;

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: () => catalogState,
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let releaseChunk: () => void = () => {};

afterEach(() => {
  releaseChunk();
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

/** Vokabulardetail als Lazy-Route, deren Chunk erst mit `releaseChunk` eintrifft. */
function deferredVocabularyRoute(): RouteObject {
  const arrived = new Promise<void>((resolve) => { releaseChunk = resolve; });
  return {
    path: '/vokabular/:namespaceId',
    lazy: async () => {
      await arrived;
      const Component: ComponentType = () => createElement('h1', null, 'Vokabular');
      return { Component };
    },
  };
}

/** Shell wie `AppShell`: Provider, Hinweis in `#root`, Inline-Panel als Seite. */
async function renderTabletPanel() {
  await page.viewport(800, 800);
  const router = createMemoryRouter([{
    element: createElement(NavigationPendingProvider, null,
      createElement(NavigationPendingIndicator),
      createElement(Outlet),
    ),
    children: [
      {
        path: '/',
        element: createElement('div', null,
          createElement('div', { 'data-tablet-detail-panel': '' },
            createElement(CatalogDetailPanel, {
              catalog,
              control,
              onClose: () => {},
              onNavigateToControl: () => {},
            }),
          ),
          createElement('button', { type: 'button' }, 'Weiter'),
        ),
      },
      deferredVocabularyRoute(),
    ],
  }]);
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(RouterProvider, { router }));
  });
  await document.fonts.ready;
  return host.querySelector('[data-tablet-detail-panel]') as HTMLElement;
}

function isOperable(el: Element) {
  return !el.closest('[hidden],[inert]') && el.checkVisibility({ visibilityProperty: true });
}

function focusTargets(dialog: Element) {
  return [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
}

test('Ladehinweis: genau ein erreichbarer Statusbereich im Shell-Hinweis, das Panel ist nicht modal', async () => {
  const panel = await renderTabletPanel();
  const legendToggle = [...panel.querySelectorAll<HTMLButtonElement>('button[aria-controls]')]
    .find((button) => button.textContent === 'Legende' && button.getAttribute('aria-controls') === 'legende-schutzziele')!;
  await userEvent.click(legendToggle);
  const vocabularyLink = panel.querySelector<HTMLAnchorElement>('#legende-schutzziele a[href^="/vokabular/"]')!;
  expect(vocabularyLink).not.toBeNull();

  await userEvent.click(vocabularyLink);
  await new Promise((resolve) => setTimeout(resolve, NAVIGATION_PENDING_DELAY_MS + 100));

  const reachable = [...document.querySelectorAll('output, [role="status"]')]
    .filter((status) => !status.closest('[inert]'));
  expect(reachable).toHaveLength(1);
  const [status] = reachable;
  // Der Hinweis der Shell in `#root` bleibt ohne modales Panel erreichbar.
  expect(host?.contains(status)).toBe(true);
  expect(status.closest('[inert]')).toBeNull();
  expect(status.textContent).toBe('Seite wird geladen…');
  expect(status.checkVisibility({ visibilityProperty: true, opacityProperty: true })).toBe(true);
  const box = status.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
});

test('Tab-Umlauf: verlässt das Inline-Panel zum nachfolgenden Inhalt und überspringt die geschlossene Legende', async () => {
  const panel = await renderTabletPanel();
  expect(panel.querySelector('[hidden] a[href]')).not.toBeNull();
  const operable = focusTargets(panel).filter(isOperable);
  const first = operable[0];
  const last = operable.at(-1)!;

  // Kein Fallenzwang: Hinter dem letzten Panel-Ziel folgt der Seiteninhalt.
  last.focus();
  await userEvent.tab();
  expect(panel.contains(document.activeElement)).toBe(false);
  expect(document.activeElement?.textContent).toBe('Weiter');

  // Die verborgenen Legenden-Links bleiben dabei unerreichbar.
  first.focus();
  for (let index = 0; index <= operable.length; index += 1) {
    await userEvent.tab();
    expect(document.activeElement?.closest('[hidden]')).toBeNull();
    if (!panel.contains(document.activeElement)) break;
  }
  expect(panel.contains(document.activeElement)).toBe(false);
});
