import axe from 'axe-core';
import { createElement, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Routes, Route } from 'react-router';
import { HeaderBar } from '@/components/HeaderBar';
import { SearchPage } from '@/features/search/SearchPage';
import { afterEach, expect, test, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import type { Catalog, Control } from '@/domain/models';
import { emptyFilters } from '@/hooks/useFilteredControls';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import {
  filterPanelFacetCounts,
  makeFilterPanelCatalogState,
} from '@/test/fixtures/filterPanel';
import { CatalogDetailPanel } from '@/features/catalog/CatalogDetailPanel';
import { CatalogMobileExportSheet } from '@/features/catalog/CatalogMobileExportSheet';
import { CatalogMobileFilterSheet } from '@/features/catalog/CatalogMobileFilterSheet';
import { useTabletDetailPanel } from '@/hooks/useTabletDetailPanel';
import '@/index.css';

/**
 * Filter-Sheet und Export-Sheet als modale Dialoge (GSPP-503) sowie das
 * Tablet-Inline-Detailpanel als nicht modale Zwei-Pane-Ansicht (GSPP-514):
 * Rolle, Name und modaler Zustand, inerter Hintergrund, Tab-Umlauf, Escape
 * und Fokus-Rückkehr in Chromium sowie axe ohne Verstöße am offenen Dialog
 * bzw. Panel. Das Detail ersetzt `ControlDetail` durch Überschrift und
 * Schließaktion, weil hier nur der Rahmen geprüft wird.
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
      h('h2', { id: props.titleId, 'data-control-detail-title': '', tabIndex: -1 }, props.control.title),
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

afterEach(async () => {
  await commands.setBrowserFontSize();
  await commands.setBrowserSafeArea();
  scene.reset();
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function renderSurface(surface: ReactNode) {
  flushSync(() => {
    root?.render(createElement(MemoryRouter, null,
      createElement(HeaderBar),
      createElement('button', { type: 'button' }, 'Suche im App-Kopf'),
      createElement(Routes, null,
        createElement(Route, { path: '/', element: null }),
        createElement(Route, { path: '/suche', element: createElement(SearchPage) }),
      ),
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
    activeCount: 0,
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
 * Szene im Tablet-Band wie im `CatalogBrowser` (GSPP-514): Liste mit Zeile,
 * Export-Sheet in der Toolbar und Inline-Detail neben der Liste. `asPage`
 * bildet den Breitenwechsel unter `md` nach: Die Liste wird `hidden`, und die
 * Detailseite setzt den Fokus im Layout-Effekt auf ihre Überschrift
 * (`useDocumentDetailPage`). Das Inline-Panel folgt `useTabletDetailPanel`.
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
  useTabletDetailPanel({
    enabled: !asPage,
    controlId: detailOpen ? control.id : null,
    onClose: () => scene.set({ detailOpen: false }),
  });
  return createElement(
    'div',
    // Nebeneinander wie im `CatalogBrowser` (Liste flexibel, Panel daneben).
    { style: { display: 'flex' } },
    createElement(CatalogMobileExportSheet, {
      checkedIds: new Set<string>(),
      filteredControls: [control],
      allControls: [control],
      sectionFilename: 'test.csv',
    }),
    createElement('div', { hidden: detailOpen && asPage },
      createElement('button', { type: 'button', 'data-control-row': control.id }, 'Zeile TOP.1.1'),
    ),
    detailOpen && asPage ? createElement(DetailPage) : null,
    detailOpen && !asPage
      ? createElement('div', { 'data-tablet-detail-panel': '', 'data-testid': 'tablet-detail-panel' },
        createElement(CatalogDetailPanel, {
          catalog,
          control,
          onClose: () => scene.set({ detailOpen: false }),
          onNavigateToControl: () => {},
        }),
      )
      : null,
  );
}

function openDetail() {
  flushSync(() => scene.set({ detailOpen: true }));
}

function tabletPanel(scope: ParentNode) {
  return scope.querySelector('[data-testid="tablet-detail-panel"]')!;
}

test('Tablet-Detail: Inline-Panel neben der Liste, kein Dialog, Escape kehrt zur auslösenden Zeile zurück', async () => {
  const shell = await renderWithBackground(900, createElement(TabletScene));
  const row = buttonByName(shell, 'Zeile TOP.1.1');
  row.focus();

  openDetail();

  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  const panel = tabletPanel(shell);
  // Kein modaler Dialog: Hintergrund und Dokument bleiben frei.
  expect(document.querySelector('dialog')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.documentElement.style.overflow).toBe('');
  // Liste und Detail stehen nebeneinander, beide vollständig im Bild.
  expect(row.checkVisibility()).toBe(true);
  const rowBox = row.getBoundingClientRect();
  const panelBox = panel.getBoundingClientRect();
  expect(rowBox.left).toBeLessThan(panelBox.left);
  expect(panelBox.right).toBeLessThanOrEqual(900 + 0.5);
  expect(panelBox.bottom).toBeLessThanOrEqual(window.innerHeight + 0.5);
  // Der Fokus wandert beim Öffnen auf die Detailüberschrift.
  expect(document.activeElement?.textContent).toBe('Testkontrolle');
  expect(panel.contains(document.activeElement)).toBe(true);

  const axeResult = await axe.run(panel, { resultTypes: ['violations'] });
  expect(axeResult.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);

  await userEvent.keyboard('{Escape}');

  await expect.poll(() => shell.querySelector('[data-testid="tablet-detail-panel"]')).toBeNull();
  expect(document.activeElement).toBe(row);
});

test('Tablet-Detail: Breitenwechsel unter md überlässt den Fokus der Detailseite', async () => {
  const shell = await renderWithBackground(900, createElement(TabletScene));
  buttonByName(shell, 'Zeile TOP.1.1').focus();
  openDetail();
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();

  flushSync(() => scene.set({ asPage: true }));

  expect(shell.querySelector('[data-testid="tablet-detail-panel"]')).toBeNull();
  expect(document.querySelector('dialog')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement?.textContent).toBe('Detailseite');
});

test('Sheet über Tablet-Detail: Escape schließt nur das Sheet, das Panel bleibt', async () => {
  const shell = await renderWithBackground(900, createElement(TabletScene));
  const trigger = buttonByName(shell, 'CSV exportieren');
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const sheet = document.querySelector('dialog')!;
  expect(sheet.contains(document.activeElement)).toBe(true);

  // Browser-Vorwärts auf eine Kontrollroute öffnet das Inline-Detail neben der Liste.
  openDetail();
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  // Der Fokus bleibt im modalen Sheet; das Panel stiehlt ihn nicht.
  expect(sheet.contains(document.activeElement)).toBe(true);

  // Escape aus dem Sheet schließt nur das Sheet.
  await userEvent.keyboard('{Escape}');

  await expect.poll(() => document.querySelector('dialog')).toBeNull();
  expect(tabletPanel(shell)).not.toBeNull();
  expect([...document.body.children].some((child) => child.hasAttribute('inert'))).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

function filterSheet(hasActiveFilters = false, filteredCount = 3) {
  return createElement(CatalogMobileFilterSheet, {
    activeCount: 0,
    filterPanelProps: {
      filters: emptyFilters,
      facetCounts: filterPanelFacetCounts,
      filteredFacetCounts: filterPanelFacetCounts,
      hasActiveFilters,
      filteredCount,
      totalCount: filteredCount,
      onFiltersChange: () => {},
      onClearFilters: () => {},
    },
  });
}

function exportSheet() {
  return createElement(CatalogMobileExportSheet, {
    checkedIds: new Set([control.id]),
    filteredControls: [control],
    allControls: [control],
    sectionFilename: 'test.csv',
  });
}

/** Ganz im sichtbaren Bereich seines Scrollcontainers. */
/** Wartet, bis das `scroll`-Event einer programmatischen Scrollposition zugestellt ist. */
function nextFrames() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function expectWithin(element: Element, container: Element) {
  const box = element.getBoundingClientRect();
  const frame = container.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(frame.top - 0.5);
  expect(box.bottom).toBeLessThanOrEqual(frame.bottom + 0.5);
}

/** Ganz im Fenster; die Toleranz deckt Subpixel-Lagen des unten verankerten Sheets ab. */
function expectInViewport(element: Element) {
  const box = element.getBoundingClientRect();
  expect(box.top).toBeGreaterThanOrEqual(-0.5);
  expect(box.bottom).toBeLessThanOrEqual(window.innerHeight + 0.5);
}

/**
 * Niedriges Fenster (700 × 250 px), auch mit 32 px Standardschrift: Das unten
 * verankerte Sheet schneidet unten ab; Überschrift und Schließaktion stehen im
 * Kopf und bleiben sichtbar, die Aktionen darunter sind per Scrollen erreichbar.
 */
test.each([
  ['Filter-Sheet', 'Filter anzeigen', 'Schließen (3)', 16, () => filterSheet(), true],
  ['Filter-Sheet', 'Filter anzeigen', 'Schließen (3)', 32, () => filterSheet(), true],
  ['Export-Sheet', 'CSV exportieren', 'Schließen', 16, exportSheet, true],
  ['Export-Sheet', 'CSV exportieren', 'Schließen', 32, exportSheet, true],
] as const)('%s bei 250 px Fensterhöhe und %s: Überschrift und „%s“ bleiben sichtbar (%i px Schrift)', async (_name, triggerName, closeName, fontSize, surface, lastActionReachable) => {
  await commands.setBrowserFontSize(fontSize);
  const shell = await renderWithBackground(700, surface());
  await page.viewport(700, 250);
  buttonByName(shell, triggerName).click();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));

  expectInViewport(document.getElementById(dialog.getAttribute('aria-labelledby')!)!);
  const close = buttonByName(dialog, closeName);
  expectInViewport(close);
  expect(close.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBe(close);

  if (lastActionReachable) {
    // Die letzte Aktion lässt sich in ihren Scrollbereich holen. Eine Checkbox
    // ist `sr-only`; sichtbar und bedienbar ist ihre beschriftete Zeile.
    const actions = [...dialog.querySelectorAll<HTMLElement>('button:not([data-dialog-close]), input')];
    const lastAction = actions.at(-1)!;
    const visibleTarget = lastAction.closest('label') ?? lastAction;
    visibleTarget.scrollIntoView({ block: 'nearest' });
    expectInViewport(visibleTarget);
    expectWithin(visibleTarget, visibleTarget.closest('[data-overlayscrollbars-viewport]')!);
  }

  close.click();
  await expect.poll(() => document.querySelector('dialog')).toBeNull();
});

test('Filter-Sheet: „Schließen (3)“ überdeckt bei aktiven Filtern „Zurücksetzen“ nicht', async () => {
  const shell = await renderWithBackground(402, filterSheet(true));
  buttonByName(shell, 'Filter anzeigen').click();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));

  const done = buttonByName(dialog, 'Schließen (3)');
  const reset = buttonByName(dialog, 'Zurücksetzen');
  const doneBox = done.getBoundingClientRect();
  const resetBox = reset.getBoundingClientRect();
  expect(doneBox.height).toBeGreaterThanOrEqual(44);
  expect(doneBox.bottom <= resetBox.top || resetBox.bottom <= doneBox.top).toBe(true);
  // Jeder Punkt der Trefferfläche von „Schließen (3)“ trifft „Schließen (3)“.
  for (const y of [doneBox.top + 1, doneBox.top + doneBox.height / 2, doneBox.bottom - 1]) {
    expect(document.elementFromPoint(doneBox.left + doneBox.width / 2, y)?.closest('button')).toBe(done);
  }
});

test('Filter-Sheet: Größenwechsel bewahrt Fokus und manuelle Klappzustände', async () => {
  await commands.setBrowserFontSize(32);
  const shell = await renderWithBackground(700, filterSheet(true));
  await page.viewport(700, 250);
  buttonByName(shell, 'Filter anzeigen').click();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  const heading = dialog.querySelector<HTMLElement>('[data-scroll-summary]')!;
  await expect.poll(() => heading.dataset.scrollSummary).toBe('true');
  const section = [...dialog.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')].at(-1)!;
  const initialExpanded = section.getAttribute('aria-expanded');
  section.click();
  await expect.poll(() => section.getAttribute('aria-expanded')).not.toBe(initialExpanded);
  const expanded = section.getAttribute('aria-expanded');
  const checkbox = dialog.querySelector<HTMLInputElement>('input')!;
  checkbox.focus();
  const checked = checkbox.checked;

  await page.viewport(700, 800);
  await expect.poll(() => heading.dataset.scrollSummary).toBe('false');
  expect(dialog.querySelector('input')).toBe(checkbox);
  expect(checkbox.checked).toBe(checked);
  expect(document.activeElement).toBe(checkbox);
  expect(section.getAttribute('aria-expanded')).toBe(expanded);

  await commands.setBrowserFontSize(16);
  await page.viewport(700, 250);
  await expect.poll(() => heading.dataset.scrollSummary).toBe('false');
  expect(document.activeElement).toBe(checkbox);
  buttonByName(dialog, 'Schließen (3)').click();
});

/** Filter-Sheet mit 32 px Schrift bei 700 × 800 px; die Sektionenliste scrollt selbst. */
async function openScrollingFilterSheet() {
  await commands.setBrowserFontSize(32);
  const shell = await renderWithBackground(700, filterSheet(true));
  buttonByName(shell, 'Filter anzeigen').click();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
  const heading = dialog.querySelector<HTMLElement>('[data-scroll-summary]')!;
  await expect.poll(() => heading.dataset.scrollSummary).toBe('false');
  const scroller = () => dialog.querySelector<HTMLElement>('[data-filter-scroll]')!;
  /** Fenster auf `height` setzen und den erwarteten Kopfmodus abwarten. */
  const resize = async (height: number, scrollSummary: 'true' | 'false') => {
    await page.viewport(700, height);
    await expect.poll(() => heading.dataset.scrollSummary).toBe(scrollSummary);
  };
  return { dialog, scroller, resize };
}

test('Filter-Sheet: Größenwechsel erhält die Position einer gescrollten Liste', async () => {
  const { dialog, scroller, resize } = await openScrollingFilterSheet();
  const rows = [...dialog.querySelectorAll('label')];
  const row = rows[Math.floor(rows.length / 2)];
  const offset = () => row.getBoundingClientRect().top - scroller().getBoundingClientRect().top;
  scroller().scrollTop += offset();
  // Die Zeile steht oben in einem gescrollten Bereich; danach das scroll-Event zustellen.
  const expectRowOnTop = async () => {
    expect(scroller().scrollTop).toBeGreaterThan(0);
    expect(Math.abs(offset())).toBeLessThanOrEqual(1);
    await nextFrames();
  };
  await expectRowOnTop();
  await resize(250, 'true');
  await expectRowOnTop();
  await resize(800, 'false');
  await expectRowOnTop();
  buttonByName(dialog, 'Schließen (3)').click();
});

test('Filter-Sheet: Vergrößern nahe dem neuen Scrolllimit behält die Listenposition', async () => {
  const { dialog, scroller, resize } = await openScrollingFilterSheet();
  const sections = scroller();
  // Knapp innerhalb des Scrollwegs, den die Liste bei 800 px Fensterhöhe fasst.
  const anchor = sections.scrollHeight - sections.clientHeight - 2;
  expect(anchor).toBeGreaterThan(0);

  await resize(250, 'true');
  const body = scroller();
  const offset = sections.getBoundingClientRect().top - body.getBoundingClientRect().top + body.scrollTop;
  body.scrollTop = anchor + offset;
  await expect.poll(() => body.scrollTop).toBeGreaterThanOrEqual(anchor + offset - 1);
  await nextFrames();

  await resize(800, 'false');
  expect(Math.abs(scroller().scrollTop - anchor)).toBeLessThanOrEqual(1);
  buttonByName(dialog, 'Schließen (3)').click();
});

test('Filter-Sheet: aufgeklappte Zeilen bleiben nach Einklappen aller Sektionen erreichbar', async () => {
  await commands.setBrowserFontSize(32);
  const shell = await renderWithBackground(700, filterSheet());
  await page.viewport(700, 250);
  buttonByName(shell, 'Filter anzeigen').click();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
  const heading = dialog.querySelector<HTMLElement>('[data-scroll-summary]')!;
  await expect.poll(() => heading.dataset.scrollSummary).toBe('true');
  for (const section of dialog.querySelectorAll<HTMLButtonElement>('button[aria-expanded="true"]')) section.click();
  await expect.poll(() => heading.dataset.scrollSummary).toBe('false');
  dialog.querySelector<HTMLButtonElement>('button[aria-expanded]')!.click();
  await expect.poll(() => heading.dataset.scrollSummary).toBe('true');
  const row = [...dialog.querySelectorAll('label')].at(-1)!;
  row.scrollIntoView({ block: 'nearest' });
  expectInViewport(row);
  expectWithin(row, row.closest('[data-overlayscrollbars-viewport]')!);
});

test.each([665, 1000])('Filter-Sheet: Titel und Schließen (%i) bei 320 px und doppelter Standardschrift bleiben sichtbar', async (count) => {
  await commands.setBrowserFontSize(32);
  const shell = await renderWithBackground(320, filterSheet(false, count));
  buttonByName(shell, 'Filter anzeigen').click();
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  const dialog = document.querySelector('dialog')!;
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished));
  const title = dialog.querySelector('h2')!;
  const close = buttonByName(dialog, `Schließen (${count})`);
  expectInViewport(title);
  expectInViewport(close);
  expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
  expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(close.getBoundingClientRect().left);
  for (const element of [title, close]) {
    expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth);
  }
  close.click();
  await expect.poll(() => document.querySelector('dialog')).toBeNull();
});

const sheetGeometries = [
  [320, 640, 16],
  [390, 844, 16],
  [700, 250, 16],
  [320, 640, 32],
  [390, 844, 32],
  [700, 250, 32],
] as const;

for (const [name, triggerName, closeName, surface] of [
  ['Filter', 'Filter anzeigen', 'Schließen (3)', () => filterSheet()],
  ['Export', 'CSV exportieren', 'Schließen', exportSheet],
] as const) {
  test.each(sheetGeometries)(`${name}: Tokens und erreichbare letzte Aktion bei %i × %i / %i px Schrift mit Bottom-Inset`, async (width, height, fontSize) => {
    await commands.setBrowserFontSize(fontSize);
    await commands.setBrowserSafeArea(34);
    const shell = await renderWithBackground(width, surface());
    await page.viewport(width, height);
    buttonByName(shell, triggerName).focus();
    buttonByName(shell, triggerName).click();
    await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
    const dialog = document.querySelector('dialog')!;
    await expectBottomSheetGeometry(dialog, width);
    const style = getComputedStyle(dialog);
    expect(style.borderTopLeftRadius).toBe(`${fontSize / 2}px`);
    expect(style.borderTopRightRadius).toBe(`${fontSize / 2}px`);
    expect(style.borderBottomLeftRadius).toBe('0px');
    const tokenProbe = document.createElement('div');
    tokenProbe.style.boxShadow = 'var(--shadow-overlay)';
    dialog.append(tokenProbe);
    expect(style.boxShadow).toBe(getComputedStyle(tokenProbe).boxShadow);
    tokenProbe.remove();
    expect(style.paddingBottom).toBe('34px');
    expect(dialog.getBoundingClientRect().height).toBeLessThanOrEqual((height <= fontSize * 20 ? height : height * 0.8) + 0.5);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
    const actions = [...dialog.querySelectorAll<HTMLElement>('button:not([data-dialog-close]), input')];
    const last = actions.at(-1)!;
    const target = last.closest('label') ?? last;
    const scroll = target.closest('[data-overlayscrollbars-viewport]')!;
    target.scrollIntoView({ block: 'nearest' });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expectWithin(target, scroll);
    expectInViewport(target);
    expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight - 34 + 0.5);
    expect(dialog.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom).toBeCloseTo(34, 0);
    expectInViewport(buttonByName(dialog, closeName));
    await commands.setBrowserSafeArea();
    await expect.poll(() => getComputedStyle(dialog).paddingBottom).toBe('0px');
    buttonByName(dialog, closeName).click();
    await expect.poll(() => document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(buttonByName(shell, triggerName));
  });
}

/** Suchkürzel aus den echten Dialograhmen mit nativem Chromium-inert. */
test.each([
  ['Filter', 'Filter anzeigen', '{Control>}k{/Control}', filterSheet],
  ['Filter', 'Filter anzeigen', '{Meta>}k{/Meta}', filterSheet],
  ['Export', 'CSV exportieren', '{Control>}k{/Control}', exportSheet],
  ['Export', 'CSV exportieren', '{Meta>}k{/Meta}', exportSheet],
] as const)('%s: %s gibt den Header frei (%s)', async (_name, triggerName, shortcut, surface) => {
  const shell = await renderWithBackground(800, surface());
  const trigger = buttonByName(shell, triggerName);
  trigger.focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  expect(shell.hasAttribute('inert')).toBe(true);
  const search = shell.querySelector<HTMLInputElement>('[data-testid="header-search"]')!;
  search.focus();
  expect(document.activeElement).not.toBe(search);

  await userEvent.keyboard(shortcut);

  await expect.poll(() => document.querySelector('dialog')).toBeNull();
  await expect.poll(() => document.activeElement).toBe(search);
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.documentElement.style.overflow).toBe('');
  await userEvent.keyboard('test');
  expect(search.value).toBe('test');
});

test.each(['{Control>}k{/Control}', '{Meta>}k{/Meta}'])('Suchkürzel %s beendet das Sheet vor dem Suchfokus, das Tablet-Panel bleibt', async (shortcut) => {
  const shell = await renderWithBackground(800, createElement(TabletScene));
  buttonByName(shell, 'CSV exportieren').focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();
  openDetail();
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  expect(document.querySelector('dialog')).not.toBeNull();

  await userEvent.keyboard(shortcut);

  await expect.poll(() => document.querySelector('dialog')).toBeNull();
  // Das Inline-Panel ist kein modaler Dialog und bleibt stehen.
  expect(tabletPanel(shell)).not.toBeNull();
  const search = shell.querySelector<HTMLInputElement>('[data-testid="header-search"]')!;
  await expect.poll(() => document.activeElement).toBe(search);
  expect([...document.body.children].some((child) => child.hasAttribute('inert'))).toBe(false);
  expect(document.documentElement.style.overflow).toBe('');
  await userEvent.tab();
  expect(search.closest('[inert]')).toBeNull();
});

test.each([
  ['Filter anzeigen', '{Control>}k{/Control}', filterSheet],
  ['Filter anzeigen', '{Meta>}k{/Meta}', filterSheet],
  ['CSV exportieren', '{Control>}k{/Control}', exportSheet],
  ['CSV exportieren', '{Meta>}k{/Meta}', exportSheet],
] as const)('Unter sm: %s gibt die Suchseite frei (%s)', async (triggerName, shortcut, surface) => {
  const shell = await renderWithBackground(402, surface());
  buttonByName(shell, triggerName).focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.querySelector('dialog')).not.toBeNull();

  await userEvent.keyboard(shortcut);

  await expect.poll(() => document.querySelector('dialog')).toBeNull();
  await expect.poll(() => shell.querySelector('[aria-label="Suchbegriff eingeben"]')).not.toBeNull();
  const search = shell.querySelector<HTMLInputElement>('[aria-label="Suchbegriff eingeben"]')!;
  await expect.poll(() => document.activeElement).toBe(search);
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.documentElement.style.overflow).toBe('');
});
