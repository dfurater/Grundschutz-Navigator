import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { CONTROL_ROUTE_PATTERN, CATALOG_ROUTE_PATTERN, GROUP_ROUTE_PATTERN } from '@/app/routes';
import { CatalogBrowser } from '@/features/catalog/CatalogBrowser';
import { HeaderBar } from '@/components/HeaderBar';
import { Footer } from '@/components/Footer';
import { createTabletCatalogState } from './tabletCatalogFixture';
import '@/index.css';

/**
 * Tablet-Zwei-Pane-Ansicht mit echtem `CatalogBrowser` (GSPP-514): Trefferliste
 * und Inline-Detail stehen bei 768 und 1023 px nebeneinander, das Detail ist
 * vollständig und beide Spalten scrollen unabhängig. Der Katalog
 * (`tabletCatalogFixture.ts`) trägt volle Detailinhalte und eine lange Liste.
 */

const catalogState = createTabletCatalogState();

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

async function renderCatalog(width: number, entry = '/katalog/gspp', height = 800, withAppChrome = false) {
  await page.viewport(width, height);
  const screen = withAppChrome
    ? createElement('div', { style: { height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' } },
      createElement(HeaderBar),
      createElement('main', { style: { flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
        createElement(CatalogBrowser)),
      createElement(Footer))
    : createElement(CatalogBrowser);
  const router = createMemoryRouter([
    { path: CONTROL_ROUTE_PATTERN, element: screen },
    { path: GROUP_ROUTE_PATTERN, element: screen },
    { path: CATALOG_ROUTE_PATTERN, element: screen },
  ], { initialEntries: [entry] });
  host = document.createElement('div');
  host.id = 'root';
  // Begrenzte Höhe wie `main` in der App-Shell, damit die Spalten ihre
  // eigenen Scrollbereiche erhalten statt mitzuwachsen.
  host.style.height = `${height}px`;
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

test('hält den Tablet-Detailkopf bei 844 × 390 px kompakt und erreicht die Anforderung über dem App-Footer', async () => {
  const { shell } = await renderCatalog(844, '/katalog/gspp', 390, true);

  await userEvent.click(rowButton(shell, 'TOP.1.1.1'));
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  const panel = tabletPanel(shell);
  const panelScroller = panel.querySelector('[data-control-detail-scroll]') as HTMLElement;
  const listScroller = scrollerOf(rowButton(shell, 'TOP.1.2'));
  const detailTitle = panel.querySelector('[data-control-detail-title]') as HTMLElement;
  const fixedHeader = detailTitle.closest('.border-b') as HTMLElement;
  const fixedHeaderBox = fixedHeader.getBoundingClientRect();
  const footer = shell.querySelector('footer') as HTMLElement;
  const footerBox = footer.getBoundingClientRect();
  const appHeader = shell.querySelector('header') as HTMLElement;
  const appHeaderBox = appHeader.getBoundingClientRect();
  const main = shell.querySelector('main') as HTMLElement;

  await userEvent.click(panel.querySelector('[aria-label="Praktik: Governance und Compliance"]') as HTMLButtonElement);

  const vocabularyCard = panel.querySelector('#vocab-card-practice') as HTMLElement;
  const parentControl = panel.querySelector('[aria-label="Teil von TOP.1.1 Verfahren und Regelungen"]') as HTMLElement;
  expect(vocabularyCard).not.toBeNull();
  expect(parentControl).not.toBeNull();
  expect(panelScroller.contains(vocabularyCard)).toBe(true);
  expect(panelScroller.contains(parentControl)).toBe(true);
  expect(panelScroller.contains(detailTitle)).toBe(false);
  expect(panelScroller.clientHeight).toBeGreaterThan(0);
  expect(panelScroller.scrollHeight).toBeGreaterThan(panelScroller.clientHeight);
  expect(footerBox.top).toBeGreaterThan(appHeaderBox.bottom);
  expect(main.getBoundingClientRect().bottom).toBeLessThanOrEqual(footerBox.top + 1);

  const listScrollTop = listScroller.scrollTop;
  const requirementHeading = [...panel.querySelectorAll('h1, h2, h3, h4')]
    .find((heading) => heading.textContent?.includes('Anforderung')) as HTMLElement;
  const requirementText = requirementHeading.closest('section')?.querySelector('p') as HTMLElement;
  const scrollBox = panelScroller.getBoundingClientRect();
  panelScroller.scrollTop += requirementText.getBoundingClientRect().bottom - scrollBox.bottom;
  await expect.poll(() => panelScroller.scrollTop).toBeGreaterThan(0);
  const requirementTextBox = requirementText.getBoundingClientRect();
  expect(requirementTextBox.bottom).toBeLessThanOrEqual(scrollBox.bottom + 1);
  expect(requirementTextBox.bottom).toBeLessThanOrEqual(footer.getBoundingClientRect().top + 1);
  expect(panelScroller.contains(document.elementFromPoint(
    (requirementTextBox.left + requirementTextBox.right) / 2,
    requirementTextBox.bottom - 2,
  ))).toBe(true);

  panelScroller.scrollTop = panelScroller.scrollHeight;
  expect(listScroller.scrollTop).toBe(listScrollTop);

  const lastContent = panelScroller.lastElementChild as HTMLElement;
  const lastContentBox = lastContent.getBoundingClientRect();
  expect(lastContentBox.bottom).toBeLessThanOrEqual(scrollBox.bottom + 1);
  const finalHeaderBox = fixedHeader.getBoundingClientRect();
  expect(finalHeaderBox.top).toBe(fixedHeaderBox.top);
  expect(finalHeaderBox.bottom).toBe(fixedHeaderBox.bottom);
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
