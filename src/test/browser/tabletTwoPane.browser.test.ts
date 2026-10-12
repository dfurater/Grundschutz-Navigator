import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { CONTROL_ROUTE_PATTERN, CATALOG_ROUTE_PATTERN, GROUP_ROUTE_PATTERN } from '@/app/routes';
import { CatalogBrowser } from '@/features/catalog/CatalogBrowser';
import type { Catalog, CatalogState, Control } from '@/domain/models';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import '@/index.css';

/**
 * Tablet-Zwei-Pane-Ansicht mit echtem `CatalogBrowser` (GSPP-514): Trefferliste
 * und Inline-Detail stehen bei 768 und 1023 px nebeneinander, das Detail ist
 * vollständig und beide Spalten scrollen unabhängig. Volle Detailinhalte
 * (Anforderung, Umsetzungshinweise, Zusammenhänge) und eine lange Liste, damit
 * Zuschnitt und Scrollkopplung auffielen.
 */

const LONG_STATEMENT = 'Die Architektur verankert Verfahren und Regelungen zum Schutz der Netze und der damit verbundenen Infrastrukturen. ';
const LONG_GUIDANCE = 'Die Netzarchitektur ist der strukturierte Entwurf aller Netzinfrastrukturen einschließlich Segmentierung, Filterung und Redundanz wichtiger Systeme. ';

function makeControl(id: string, title: string, overrides: Partial<Control> = {}): Control {
  const [practiceId, groupId] = [id.split('.')[0], id.split('.').slice(0, 2).join('.')];
  return {
    id,
    altIdentifier: `alt-${id.toLowerCase().replaceAll('.', '-')}`,
    title,
    groupId,
    practiceId,
    modalverb: 'MUSS',
    securityLevel: 'normal-SdT',
    effortLevel: '2',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: LONG_STATEMENT.repeat(6),
    statementRaw: LONG_STATEMENT.repeat(6),
    guidance: LONG_GUIDANCE.repeat(10),
    statementProps: {
      ergebnis: '',
      praezisierung: '',
      handlungsworte: '',
      dokumentation: '',
      zielobjektKategorien: [],
    },
    links: [],
    params: {},
    ...overrides,
  } as Control;
}

const topic1Controls: Control[] = [
  makeControl('TOP.1.1', 'Verfahren und Regelungen', {
    tags: ['netz'],
    links: [{ targetId: 'TOP.1.2', href: '#TOP.1.2', rel: 'required', relStatus: 'custom' }],
  }),
  ...['TOP.1.1.1', 'TOP.1.1.2', 'TOP.1.1.3'].map((id, index) =>
    makeControl(id, `Erweiterung ${index + 1}`, { parentId: 'TOP.1.1' }),
  ),
  ...Array.from({ length: 12 }, (_, index) => makeControl(`TOP.1.${index + 2}`, `Kontrolle ${index + 2}`)),
];
const topic2Controls: Control[] = Array.from({ length: 8 }, (_, index) =>
  makeControl(`TOP.2.${index + 1}`, `Thema-2-Kontrolle ${index + 1}`),
);
const controls = [...topic1Controls, ...topic2Controls];

const catalog = {
  catalogKey: 'gspp',
  uuid: 'tablet-test-catalog',
  metadata: { title: 'Grundschutz++-Katalog' },
  practices: [{
    id: 'TOP',
    title: 'Testpraktik',
    label: 'TOP',
    topics: [
      {
        id: 'TOP.1',
        title: 'Erstes Thema',
        label: '1',
        practiceId: 'TOP',
        controlCount: topic1Controls.length,
        controlIds: topic1Controls.map((control) => control.id),
      },
      {
        id: 'TOP.2',
        title: 'Zweites Thema',
        label: '2',
        practiceId: 'TOP',
        controlCount: topic2Controls.length,
        controlIds: topic2Controls.map((control) => control.id),
      },
    ],
    controlCount: controls.length,
  }],
  controls,
  controlsById: new Map(controls.map((control) => [control.id, control])),
  controlsByAltIdentifier: new Map(controls.map((control) => [control.altIdentifier!, control])),
  backMatter: [],
  totalControls: controls.length,
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

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

async function renderCatalog(width: number, entry = '/katalog/gspp') {
  await page.viewport(width, 800);
  const router = createMemoryRouter([
    { path: CONTROL_ROUTE_PATTERN, element: createElement(CatalogBrowser) },
    { path: GROUP_ROUTE_PATTERN, element: createElement(CatalogBrowser) },
    { path: CATALOG_ROUTE_PATTERN, element: createElement(CatalogBrowser) },
  ], { initialEntries: [entry] });
  host = document.createElement('div');
  host.id = 'root';
  // Begrenzte Höhe wie `main` in der App-Shell, damit die Spalten ihre
  // eigenen Scrollbereiche erhalten statt mitzuwachsen.
  host.style.height = '800px';
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.overflow = 'hidden';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(RouterProvider, { router }));
  });
  await document.fonts.ready;
  return { shell: host, router };
}

/** Nächster scrollbarer Vorfahr mit Überlauf. */
function scrollerOf(element: Element) {
  let node: Element | null = element.parentElement;
  while (node) {
    if (node.scrollHeight - node.clientHeight > 10) return node as HTMLElement;
    node = node.parentElement;
  }
  throw new Error('kein scrollbarer Vorfahr gefunden');
}

function rowButton(shell: ParentNode, id: string) {
  return shell.querySelector(`[data-control-row="${id}"]`) as HTMLButtonElement;
}

function tabletPanel(shell: ParentNode) {
  return shell.querySelector('[data-testid="tablet-detail-panel"]') as HTMLElement;
}

test.each([768, 1023])('zeigt bei %i px Liste und vollständiges Inline-Detail nebeneinander mit unabhängigem Scroll', async (width) => {
  const { shell } = await renderCatalog(width);

  await userEvent.click(rowButton(shell, 'TOP.1.1'));
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  const panel = tabletPanel(shell);

  // Kein Dialog, keine Sperren: beide Spalten bleiben bedienbar.
  expect(document.querySelector('dialog')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.documentElement.style.overflow).toBe('');

  // Nebeneinander in Desktop-Lesebreite, vollständig im Bild.
  const listScroller = scrollerOf(rowButton(shell, 'TOP.1.2'));
  const panelBox = panel.getBoundingClientRect();
  const listBox = listScroller.getBoundingClientRect();
  expect(listBox.left).toBeLessThan(panelBox.left);
  expect(panelBox.width).toBeCloseTo(420, 0);
  expect(panelBox.right).toBeLessThanOrEqual(width + 1);
  expect(panelBox.bottom).toBeLessThanOrEqual(window.innerHeight + 1);
  expect(rowButton(shell, 'TOP.1.2').checkVisibility()).toBe(true);

  // Vollständiger Detailinhalt statt angeschnittenem Ausschnitt.
  for (const heading of ['Anforderung', 'Umsetzungshinweise', 'Zusammenhänge']) {
    expect(panel.querySelectorAll('h1, h2, h3, h4').length).toBeGreaterThan(0);
    expect([...panel.querySelectorAll('h1, h2, h3, h4')].some((el) => el.textContent?.includes(heading))).toBe(true);
  }
  const panelScroller = panel.querySelector('[data-control-detail-scroll]') as HTMLElement;
  expect(panelScroller.scrollHeight).toBeGreaterThan(panelScroller.clientHeight);
  expect(listScroller.scrollHeight).toBeGreaterThan(listScroller.clientHeight);

  // Unabhängiges Scrollen: Das Panel wandert, die Liste steht — und umgekehrt.
  panelScroller.scrollTop = panelScroller.scrollHeight;
  await expect.poll(() => panelScroller.scrollTop).toBeGreaterThan(0);
  expect(listScroller.scrollTop).toBe(0);
  listScroller.scrollTop = 200;
  const panelTop = panelScroller.scrollTop;
  await expect.poll(() => listScroller.scrollTop).toBe(200);
  expect(panelScroller.scrollTop).toBe(panelTop);

  // Der Fokus liegt auf der Detailüberschrift.
  expect(document.activeElement?.getAttribute('data-control-detail-title')).not.toBeNull();
});

test.each([768, 1023])('gibt bei %i px nach herausgescrollter Zeile Fokus und Sichtbarkeit an die Zeile zurück', async (width) => {
  const { shell } = await renderCatalog(width);

  await userEvent.click(rowButton(shell, 'TOP.1.1'));
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  const listScroller = scrollerOf(rowButton(shell, 'TOP.1.2'));

  // Die auslösende Zeile aus dem sichtbaren Listenbereich scrollen.
  listScroller.scrollTop = listScroller.scrollHeight;
  await expect.poll(() => listScroller.scrollTop).toBeGreaterThan(0);

  // Nur keydown: Das keyup von userEvent ginge an die bereits ungemountete
  // Überschrift und zöge den Fokus auf `body` — ein Testartefakt, kein
  // Anwendungsverhalten (echte Tastaturen bewegen den Fokus bei keyup nicht).
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await expect.poll(() => shell.querySelector('[data-testid="tablet-detail-panel"]')).toBeNull();

  const row = rowButton(shell, 'TOP.1.1');
  expect(document.activeElement).toBe(row);
  // Die fokussierte Zeile steht wieder im sichtbaren Listenbereich.
  const rowBox = row.getBoundingClientRect();
  const listBox = listScroller.getBoundingClientRect();
  expect(rowBox.top).toBeGreaterThanOrEqual(listBox.top - 1);
  expect(rowBox.bottom).toBeLessThanOrEqual(listBox.bottom + 1);
});
