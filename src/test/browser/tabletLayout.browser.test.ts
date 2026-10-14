import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { commands, page } from 'vitest/browser';
import { CatalogContext } from '@/state/CatalogContext';
import { COMPACT_QUERY, DESKTOP_QUERY, OWN_SCROLL_AREA_QUERY } from '@/hooks/breakpointQueries';
import { appShellAt } from './appShellRouter';
import { openDrawer } from './mobileDrawerHarness';
import { createTabletCatalogState } from './tabletCatalogFixture';
import '@/index.css';

/**
 * Tablet-Ansicht über alle Gerätegrößen und Orientierungen (GSPP-523) mit der
 * echten App-Shell und dem echten Katalog-Browser in Chromium. Touch als
 * Eingabemöglichkeit (`any-pointer: coarse`) entscheidet zusammen mit der
 * Viewportbreite, ob Tabelle und persistente Navigation (Desktop) oder
 * Zwei-Pane-Ansicht und Schublade (Tablet) gelten. Die Breiten sind CSS-px
 * gängiger Geräte: iPad mini 744 × 1133, iPad Pro 13" 1032 × 1376.
 */

interface Profile {
  readonly width: number;
  readonly height: number;
  /** Touch als Eingabemöglichkeit (`any-pointer: coarse`), sonst nur Maus. */
  readonly touch: boolean;
}

const TABLETS = {
  'iPad mini, Hochformat': { width: 744, height: 1133, touch: true },
  'iPad Pro 13", Hochformat': { width: 1032, height: 1376, touch: true },
  'iPad mini, Querformat': { width: 1133, height: 744, touch: true },
  'iPad Pro 13", Querformat': { width: 1376, height: 1032, touch: true },
} satisfies Record<string, Profile>;
const PHONE: Profile = { width: 390, height: 844, touch: true };
const DESKTOP: Profile = { width: 1366, height: 768, touch: false };
const NARROW_WINDOW: Profile = { width: 900, height: 800, touch: false };

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  await commands.setBrowserCoarsePointer(false);
});

async function applyProfile({ width, height, touch }: Profile) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, height);
}

async function renderApp(profile: Profile, route = '/katalog/gspp', state = createTabletCatalogState()) {
  await applyProfile(profile);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(CatalogContext.Provider, { value: state }, appShellAt(route)));
  });
  await document.fonts.ready;
  await expect.poll(() => host!.querySelector('[data-control-row], tr[data-row-index]')).not.toBeNull();
  return host;
}

const rows = (shell: ParentNode) => [...shell.querySelectorAll<HTMLElement>('[data-control-row]')];
const rowIds = (shell: ParentNode) => rows(shell).map((row) => row.dataset.controlRow);
const rowFor = (shell: ParentNode, id: string) =>
  shell.querySelector<HTMLElement>(`[data-control-row="${id}"]`)!;
const tabletPanel = (shell: ParentNode) =>
  shell.querySelector<HTMLElement>('[data-testid="tablet-detail-panel"]');
const detailTitle = (shell: ParentNode) =>
  shell.querySelector<HTMLElement>('[data-control-detail-title]')?.textContent ?? '';
const TITLES: Record<string, string> = {
  'TOP.1.1': 'Verfahren und Regelungen',
  'TOP.1.3': 'Kontrolle 3',
  'TOP.2.2': 'Thema-2-Kontrolle 2',
};
const menuButton = (shell: ParentNode) =>
  shell.querySelector<HTMLButtonElement>('button[aria-controls]')!;

/** Nächster Vorfahr mit eigenem Scrollbereich. */
function scrollerOf(element: Element) {
  let node: Element | null = element.parentElement;
  while (node) {
    if (node.scrollHeight - node.clientHeight > 10) return node as HTMLElement;
    node = node.parentElement;
  }
  throw new Error('kein scrollbarer Vorfahr gefunden');
}

test.each(Object.entries(TABLETS))('zeigt %s als Tablet-Ansicht mit Zwei-Pane und Schublade', async (_name, profile) => {
  const shell = await renderApp(profile);

  // Eingabemöglichkeit und Bedingung: Touch ohne Desktop, auch ab 64 rem.
  expect(matchMedia('(any-pointer: coarse)').matches).toBe(true);
  expect(matchMedia(DESKTOP_QUERY).matches).toBe(false);
  expect(shell.querySelector('table')).toBeNull();

  rowFor(shell, 'TOP.1.1').click();
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  const panel = tabletPanel(shell)!;

  // Trefferliste und vollständiges Detail stehen nebeneinander im Bild.
  const listScroller = scrollerOf(rowFor(shell, 'TOP.1.2'));
  const panelBox = panel.getBoundingClientRect();
  const listBox = listScroller.getBoundingClientRect();
  expect(panel.checkVisibility()).toBe(true);
  expect(rowFor(shell, 'TOP.1.2').checkVisibility()).toBe(true);
  expect(listBox.right).toBeLessThanOrEqual(panelBox.left + 1);
  expect(panelBox.width).toBeCloseTo(420, 0);
  expect(panelBox.right).toBeLessThanOrEqual(profile.width + 1);
  for (const heading of ['Anforderung', 'Umsetzungshinweise', 'Zusammenhänge']) {
    expect([...panel.querySelectorAll('h1, h2, h3, h4')].some((el) => el.textContent?.includes(heading))).toBe(true);
  }

  // Beide Bereiche scrollen unabhängig voneinander.
  const panelScroller = panel.querySelector<HTMLElement>('[data-control-detail-scroll]')!;
  expect(panelScroller.scrollHeight).toBeGreaterThan(panelScroller.clientHeight);
  expect(listScroller.scrollHeight).toBeGreaterThan(listScroller.clientHeight);
  panelScroller.scrollTop = panelScroller.scrollHeight;
  await expect.poll(() => panelScroller.scrollTop).toBeGreaterThan(0);
  expect(listScroller.scrollTop).toBe(0);
  listScroller.scrollTop = 200;
  const panelTop = panelScroller.scrollTop;
  await expect.poll(() => listScroller.scrollTop).toBe(200);
  expect(panelScroller.scrollTop).toBe(panelTop);

  // Footerlinks bleiben auch ab 64 rem Breite 32 px hoch.
  const footerLinks = [...shell.querySelectorAll('footer a')];
  expect(footerLinks.length).toBeGreaterThan(0);
  for (const link of footerLinks) expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(31.5);

  // Die Katalognavigation ist keine persistente Spalte, sondern öffnet als Schublade.
  const aside = shell.querySelector('aside')!;
  expect(menuButton(shell).checkVisibility()).toBe(true);
  expect(aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
  await openDrawer(shell);
  expect(aside.getBoundingClientRect().left).toBe(0);
  expect(aside.getBoundingClientRect().width).toBeLessThan(profile.width);
});

test('behält bei 390 px mit Touch die Detailansicht als Seite', async () => {
  const shell = await renderApp(PHONE);

  expect(matchMedia('(any-pointer: coarse)').matches).toBe(true);
  expect(matchMedia(OWN_SCROLL_AREA_QUERY).matches).toBe(false);
  expect(shell.querySelector('table')).toBeNull();

  rowFor(shell, 'TOP.1.1').click();
  await expect.poll(() => detailTitle(shell)).toContain(TITLES['TOP.1.1']);

  // Das Detail ersetzt die Liste; kein Zwei-Pane-Panel daneben.
  expect(tabletPanel(shell)).toBeNull();
  expect(rowFor(shell, 'TOP.1.2').checkVisibility()).toBe(false);
  expect(shell.querySelector<HTMLElement>('[data-control-detail-title]')!.checkVisibility()).toBe(true);
  expect(menuButton(shell).checkVisibility()).toBe(true);
});

test('behält bei 1366 px mit Maus Tabelle und persistente Navigation', async () => {
  const shell = await renderApp(DESKTOP);

  expect(matchMedia('(any-pointer: coarse)').matches).toBe(false);
  expect(matchMedia(DESKTOP_QUERY).matches).toBe(true);
  expect(shell.querySelector('table')).not.toBeNull();

  // Persistente Navigation: Seitenleiste im Bild, kein Menüschalter.
  const aside = shell.querySelector('aside')!;
  expect(aside.getBoundingClientRect().left).toBe(0);
  expect(aside.getBoundingClientRect().width).toBeGreaterThan(200);
  expect(menuButton(shell).checkVisibility()).toBe(false);

  // Mit Maus genügen 24 px hohe Ziele (WCAG 2.5.8).
  const footerLinks = [...shell.querySelectorAll('footer a')];
  expect(footerLinks.length).toBeGreaterThan(0);
  for (const link of footerLinks) expect(link.getBoundingClientRect().height).toBeLessThan(40);

  shell.querySelector<HTMLElement>('tr[data-row-index="0"]')!.click();
  await expect.poll(() => detailTitle(shell)).toContain(TITLES['TOP.1.1']);
  expect(tabletPanel(shell)).toBeNull();
});

test('zeigt ein schmales Mausfenster unter 64 rem weiterhin als Tablet-Ansicht', async () => {
  const shell = await renderApp(NARROW_WINDOW);

  expect(matchMedia('(any-pointer: coarse)').matches).toBe(false);
  expect(shell.querySelector('table')).toBeNull();
  rowFor(shell, 'TOP.1.1').click();
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  expect(menuButton(shell).checkVisibility()).toBe(true);
});

test('behält bei Rotation und Größenänderung Auswahl, Filter und Listenbereich ohne Neuaufbau', async () => {
  const state = createTabletCatalogState({
    'TOP.1.3': { modalverb: 'SOLLTE' },
    'TOP.1.5': { modalverb: 'SOLLTE' },
    'TOP.2.1': { modalverb: 'SOLLTE' },
  });
  // Katalogwurzel mit Filter: Der Listenbereich umfasst beide Themen.
  const shell = await renderApp(TABLETS['iPad Pro 13", Hochformat'], '/katalog/gspp?mv=SOLLTE', state);
  const expectedRows = ['TOP.1.3', 'TOP.1.5', 'TOP.2.1'];
  await expect.poll(() => rowIds(shell)).toEqual(expectedRows);

  rowFor(shell, 'TOP.1.3').click();
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  await expect.poll(() => detailTitle(shell)).toContain(TITLES['TOP.1.3']);
  const list = rowFor(shell, 'TOP.1.5').parentElement;

  for (const profile of [
    TABLETS['iPad Pro 13", Querformat'],
    TABLETS['iPad Pro 13", Hochformat'],
    TABLETS['iPad mini, Hochformat'],
    TABLETS['iPad mini, Querformat'],
  ]) {
    await applyProfile(profile);
    await expect.poll(() => window.innerWidth).toBe(profile.width);

    // Dieselbe Auswahl, derselbe Filter, derselbe Bereich; die Ansicht bleibt Tablet.
    expect(tabletPanel(shell)).not.toBeNull();
    expect(detailTitle(shell)).toContain(TITLES['TOP.1.3']);
    expect(rowIds(shell)).toEqual(expectedRows);
    expect(rowFor(shell, 'TOP.1.5').parentElement).toBe(list);
  }
});

test('wechselt zwischen Tablet, Smartphone und Desktop ohne Verlust der Auswahl', async () => {
  const shell = await renderApp(TABLETS['iPad mini, Hochformat'], '/katalog/gspp?mv=MUSS');

  rowFor(shell, 'TOP.2.2').click();
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();

  // Schmal: das Detail wird Seite, die Auswahl bleibt.
  await applyProfile(PHONE);
  await expect.poll(() => tabletPanel(shell)).toBeNull();
  expect(detailTitle(shell)).toContain(TITLES['TOP.2.2']);

  // Breites Fenster mit Maus: Tabelle, Seitenleiste und Detail in der Desktop-Spalte.
  await applyProfile(DESKTOP);
  await expect.poll(() => shell.querySelector('table')).not.toBeNull();
  expect(tabletPanel(shell)).toBeNull();
  expect(detailTitle(shell)).toContain(TITLES['TOP.2.2']);

  // Zurück zum Tablet: Panel mit derselben Kontrolle.
  await applyProfile(TABLETS['iPad Pro 13", Querformat']);
  await expect.poll(() => tabletPanel(shell)).not.toBeNull();
  expect(detailTitle(shell)).toContain(TITLES['TOP.2.2']);
});

const MATRIX: readonly (readonly [number, boolean])[] = [
  [390, true], [744, true], [900, false], [1023, false], [1024, false], [1024, true],
  [1032, true], [1133, true], [1366, false], [1376, true], [1920, false], [1920, true],
];

test.each(MATRIX)('stimmen JS-Bedingung und CSS bei %i px (Touch: %s) überein', async (width, touch) => {
  await applyProfile({ width, height: 900, touch });
  const desktop = width >= 1024 && !touch;

  expect(matchMedia('(any-pointer: coarse)').matches).toBe(touch);
  expect(matchMedia(DESKTOP_QUERY).matches).toBe(desktop);
  expect(matchMedia(COMPACT_QUERY).matches).toBe(!desktop);

  // Die kompilierten Regeln folgen derselben Entscheidung wie die Abonnements.
  host = document.createElement('div');
  host.innerHTML = `
    <div id="shown-on-desktop" class="hidden desktop:block">d</div>
    <div id="open-compact" class="compact:data-[mobile-nav=open]:bg-white" data-mobile-nav="open">c</div>
    <div class="mobile-nav-shell"><aside id="drawer" class="mobile-nav-drawer">a</aside></div>`;
  document.body.append(host);
  expect(host.querySelector('#shown-on-desktop')!.checkVisibility()).toBe(desktop);
  expect(getComputedStyle(host.querySelector('#open-compact')!).backgroundColor === 'rgb(255, 255, 255)').toBe(!desktop);
  expect(getComputedStyle(host.querySelector('#drawer')!).translate !== 'none').toBe(!desktop);
});
