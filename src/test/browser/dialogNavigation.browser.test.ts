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
import { CatalogMobileDetailOverlay } from '@/features/catalog/CatalogDetailPanel';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import '@/index.css';

/**
 * Detail-Overlay zwischen `md` und `lg` mit echtem `ControlDetail` (GSPP-509):
 * Der Ladehinweis einer wartenden Navigation steht im Dialog, und der
 * Tab-Umlauf überspringt die Links der geschlossenen Legende.
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

/** Shell wie `AppShell`: Provider, Hinweis in `#root`, Overlay als Seite. */
async function renderOverlay() {
  await page.viewport(800, 800);
  const router = createMemoryRouter([{
    element: createElement(NavigationPendingProvider, null,
      createElement(NavigationPendingIndicator),
      createElement(Outlet),
    ),
    children: [
      {
        path: '/',
        element: createElement(CatalogMobileDetailOverlay, {
          catalog,
          control,
          active: true,
          onClose: () => {},
          onNavigateToControl: () => {},
        }),
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
  return page.getByRole('dialog').element() as HTMLDialogElement;
}

function isOperable(el: Element) {
  return !el.closest('[hidden],[inert]') && el.checkVisibility({ visibilityProperty: true });
}

function focusTargets(dialog: Element) {
  return [...dialog.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')];
}

test('Ladehinweis: genau ein erreichbarer Statusbereich, sichtbar im Detail-Dialog', async () => {
  const dialog = await renderOverlay();
  const legendToggle = [...dialog.querySelectorAll<HTMLButtonElement>('button[aria-controls]')]
    .find((button) => button.textContent === 'Legende' && button.getAttribute('aria-controls') === 'legende-schutzziele')!;
  await userEvent.click(legendToggle);
  const vocabularyLink = dialog.querySelector<HTMLAnchorElement>('#legende-schutzziele a[href^="/vokabular/"]')!;
  expect(vocabularyLink).not.toBeNull();

  await userEvent.click(vocabularyLink);
  await new Promise((resolve) => setTimeout(resolve, NAVIGATION_PENDING_DELAY_MS + 100));

  const reachable = [...document.querySelectorAll('output, [role="status"]')]
    .filter((status) => !status.closest('[inert]'));
  expect(reachable).toHaveLength(1);
  const [status] = reachable;
  expect(dialog.contains(status)).toBe(true);
  expect(status.textContent).toBe('Seite wird geladen…');
  expect(status.checkVisibility({ visibilityProperty: true, opacityProperty: true })).toBe(true);
  const box = status.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
  // Der Hinweis der Shell liegt in `#root` und ist inert.
  expect(host?.querySelector('output')?.closest('[inert]')).toBe(host);
});

test('Tab-Umlauf: bleibt über beide Enden im Dialog und überspringt die geschlossene Legende', async () => {
  const dialog = await renderOverlay();
  expect(dialog.querySelector('[hidden] a[href]')).not.toBeNull();
  const operable = focusTargets(dialog).filter(isOperable);
  const first = operable[0];
  const last = operable.at(-1)!;

  first.focus();
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(last);
  await userEvent.tab();
  expect(document.activeElement).toBe(first);

  for (let index = 0; index <= operable.length; index += 1) {
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.closest('[hidden]')).toBeNull();
  }
});
