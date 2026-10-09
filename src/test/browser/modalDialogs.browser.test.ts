import axe from 'axe-core';
import { createElement, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Catalog, Control } from '@/domain/models';
import { emptyFilters } from '@/hooks/useFilteredControls';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import {
  filterPanelFacetCounts,
  makeFilterPanelCatalogState,
} from '@/test/fixtures/filterPanel';
import { CatalogMobileDetailOverlay } from '@/features/catalog/CatalogDetailPanel';
import { CatalogMobileExportSheet } from '@/features/catalog/CatalogMobileExportSheet';
import { CatalogMobileFilterSheet } from '@/features/catalog/CatalogMobileFilterSheet';
import '@/index.css';

/**
 * Filter-Sheet, Export-Sheet und Tablet-Detail als modale Dialoge (GSPP-503):
 * Rolle, Name und modaler Zustand, inerter Hintergrund, Tab-Umlauf, Escape
 * und Fokus-Rückkehr in Chromium sowie axe ohne Verstöße am offenen Dialog.
 * Das Detail ersetzt `ControlDetail` durch Überschrift und Schließaktion, weil
 * hier nur der Dialograhmen geprüft wird.
 */

const vocabularyRegistry = createTestVocabularyRegistry();

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: () => makeFilterPanelCatalogState(vocabularyRegistry),
}));

vi.mock('@/features/catalog/ControlDetail', async () => {
  const { createElement: h, Fragment } = await import('react');
  return {
    ControlDetail: (props: { control: Control; onClose: () => void; titleId?: string }) => h(
      Fragment,
      null,
      h('button', { type: 'button', onClick: props.onClose }, 'Zurück zur Übersicht'),
      h('h2', { id: props.titleId }, props.control.title),
      h('a', { href: '#verweis' }, 'Verknüpfte Kontrolle'),
    ),
  };
});

const control = { id: 'TOP.1.1', title: 'Testkontrolle', links: [] } as unknown as Control;
const catalog = {
  catalogKey: 'gspp',
  controls: [control],
  controlsById: new Map([[control.id, control]]),
} as unknown as Catalog;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  scene.reset();
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function renderSurface(surface: ReactNode) {
  flushSync(() => {
    root?.render(createElement(MemoryRouter, null,
      createElement('button', { type: 'button' }, 'Suche im App-Kopf'),
      surface,
      createElement('a', { href: '#impressum' }, 'Impressum'),
    ));
  });
}

/** Rendert die Oberfläche mit Hintergrund: App-Kopf-Button vorn, Fußlink hinten. */
async function renderWithBackground(width: number, surface: ReactNode) {
  await page.viewport(width, 800);
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  renderSurface(surface);
  await document.fonts.ready;
  return host;
}

function buttonByName(scope: ParentNode, name: string) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name)!;
}

function dialogName(dialog: Element) {
  return document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent?.trim();
}

/** Das Sheet liegt bündig am unteren Rand und füllt die Breite; `<dialog>` bringt eigene Ränder und Maße mit. */
async function expectBottomSheetGeometry(dialog: Element, width: number) {
  // Gemessen wird die Endlage nach der Einblend-Animation (`animate-slide-up`).
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
  const box = dialog.getBoundingClientRect();
  expect(box.left).toBe(0);
  expect(box.width).toBe(width);
  expect(box.bottom).toBe(window.innerHeight);
  expect(getComputedStyle(dialog).borderTopWidth).toBe('0px');
}

async function expectNoAxeViolations(dialog: Element) {
  const result = await axe.run(dialog.parentElement!, { resultTypes: ['violations'] });
  expect(result.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

/** Tab und Shift+Tab bleiben im Dialog, auch über beide Enden hinweg. */
async function expectTabStaysInside(dialog: Element) {
  const stops = dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])').length;
  for (let index = 0; index <= stops; index += 1) {
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  for (let index = 0; index <= stops; index += 1) {
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
}

test('Filter-Sheet: benannter modaler Dialog, inerter Hintergrund, Escape gibt Fokus zurück', async () => {
  const shell = await renderWithBackground(402, createElement(CatalogMobileFilterSheet, {
    filterPanelProps: {
      filters: emptyFilters,
      facetCounts: filterPanelFacetCounts,
      filteredFacetCounts: filterPanelFacetCounts,
      hasActiveFilters: false,
      filteredCount: 3,
      totalCount: 3,
      onFiltersChange: () => {},
      onClearFilters: () => {},
    },
  }));
  const trigger = buttonByName(shell, 'Filter anzeigen');

  trigger.focus();
  await userEvent.keyboard('{Enter}');

  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  expect(dialogName(dialog)).toBe('Filter');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(shell.hasAttribute('inert')).toBe(true);
  expect(dialog.closest('[inert]')).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);
  await expectBottomSheetGeometry(dialog, 402);

  await expectTabStaysInside(dialog);
  await expectNoAxeViolations(dialog);

  await userEvent.keyboard('{Escape}');

  expect(document.querySelector('dialog')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(document.documentElement.style.overflow).toBe('');
});

test('Export-Sheet: benannter modaler Dialog, „Schließen“ gibt Fokus zurück', async () => {
  const shell = await renderWithBackground(402, createElement(CatalogMobileExportSheet, {
    checkedIds: new Set<string>(),
    filteredControls: [control],
    allControls: [control],
    sectionFilename: 'test.csv',
  }));
  const trigger = buttonByName(shell, 'CSV exportieren');

  trigger.focus();
  await userEvent.keyboard('{Enter}');

  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  expect(dialogName(dialog)).toBe('Exportieren als CSV');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(shell.hasAttribute('inert')).toBe(true);
  await expectBottomSheetGeometry(dialog, 402);

  await expectTabStaysInside(dialog);
  await expectNoAxeViolations(dialog);

  buttonByName(dialog, 'Schließen').click();

  await expect.poll(() => document.querySelector('dialog')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

/**
 * Szene zwischen `md` und `lg` wie im `CatalogBrowser`: Liste mit Zeile,
 * Export-Sheet in der Toolbar und Detail-Overlay. `asPage` bildet den
 * Breitenwechsel unter `md` nach: Die Liste wird `hidden`, und die Detailseite
 * setzt den Fokus im Layout-Effekt auf ihre Überschrift (`useDocumentDetailPage`).
 */
interface SceneState { readonly detailOpen: boolean; readonly asPage: boolean }

const scene = (() => {
  let state: SceneState = { detailOpen: false, asPage: false };
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(next: Partial<SceneState>) {
      state = { ...state, ...next };
      listeners.forEach((listener) => listener());
    },
    reset() {
      state = { detailOpen: false, asPage: false };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
})();

function DetailPage() {
  useLayoutEffect(() => document.getElementById('detail-page-heading')?.focus(), []);
  return createElement('h2', { id: 'detail-page-heading', tabIndex: -1 }, 'Detailseite');
}

function TabletScene() {
  const { detailOpen, asPage } = useSyncExternalStore(scene.subscribe, scene.get);
  return createElement(
    'div',
    null,
    createElement(CatalogMobileExportSheet, {
      checkedIds: new Set<string>(),
      filteredControls: [control],
      allControls: [control],
      sectionFilename: 'test.csv',
    }),
    createElement('div', { hidden: detailOpen && asPage },
      createElement('button', { type: 'button', 'data-control-row': '' }, 'Zeile TOP.1.1'),
    ),
    detailOpen && asPage ? createElement(DetailPage) : null,
    createElement(CatalogMobileDetailOverlay, {
      catalog,
      control,
      active: detailOpen && !asPage,
      onClose: () => scene.set({ detailOpen: false }),
      onNavigateToControl: () => {},
    }),
  );
}

function openDetail() {
  flushSync(() => scene.set({ detailOpen: true }));
}

test('Tablet-Detail: benannter modaler Dialog, Escape kehrt zur auslösenden Zeile zurück', async () => {
  const shell = await renderWithBackground(900, createElement(TabletScene));
  const row = buttonByName(shell, 'Zeile TOP.1.1');
  row.focus();

  openDetail();

  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  expect(dialogName(dialog)).toBe('Testkontrolle');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(shell.hasAttribute('inert')).toBe(true);
  expect(dialog.getBoundingClientRect().toJSON()).toMatchObject({ left: 0, top: 0, width: 900, height: 800 });

  await expectTabStaysInside(dialog);
  await expectNoAxeViolations(dialog);

  await userEvent.keyboard('{Escape}');

  await expect.poll(() => document.querySelector('dialog')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(row);
});

test('Tablet-Detail: Breitenwechsel unter md überlässt den Fokus der Detailseite', async () => {
  const shell = await renderWithBackground(900, createElement(TabletScene));
  buttonByName(shell, 'Zeile TOP.1.1').focus();
  openDetail();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();

  flushSync(() => scene.set({ asPage: true }));

  expect(document.querySelector('dialog')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement?.textContent).toBe('Detailseite');
});

test('Sheet unter Tablet-Detail: gemeinsames Schließen gibt den Fokus an den Sheet-Auslöser', async () => {
  const shell = await renderWithBackground(900, createElement(TabletScene));
  const trigger = buttonByName(shell, 'CSV exportieren');
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const sheet = document.querySelector('dialog')!;
  expect(sheet.contains(document.activeElement)).toBe(true);

  // Browser-Vorwärts auf eine Kontrollroute öffnet das Detail über dem Sheet.
  openDetail();
  await expect.poll(() => document.querySelectorAll('dialog').length).toBe(2);
  const detail = [...document.querySelectorAll('dialog')].find((el) => el !== sheet)!;
  expect(detail.contains(document.activeElement)).toBe(true);
  expect(sheet.closest('[inert]')).not.toBeNull();
  expect(detail.closest('[inert]')).toBeNull();

  // Escape schließt beide Ebenen in einem Commit.
  await userEvent.keyboard('{Escape}');

  await expect.poll(() => document.querySelectorAll('dialog').length).toBe(0);
  expect([...document.body.children].some((child) => child.hasAttribute('inert'))).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('Export-Sheet bei niedrigem Fenster: Überschrift bleibt sichtbar, Aktionen scrollen', async () => {
  const shell = await renderWithBackground(700, createElement(CatalogMobileExportSheet, {
    checkedIds: new Set([control.id]),
    filteredControls: [control],
    allControls: [control],
    sectionFilename: 'test.csv',
  }));
  await page.viewport(700, 250);
  buttonByName(shell, 'CSV exportieren').click();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));

  const heading = document.getElementById(dialog.getAttribute('aria-labelledby')!)!;
  expect(dialog.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  expect(heading.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  expect(buttonByName(dialog, 'Schließen').getBoundingClientRect().bottom).toBeLessThanOrEqual(250);
});
