import axe from 'axe-core';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { TreeNav, type TreeItem } from '@/components/TreeNav';
import { AppShell } from '@/app/AppShell';
import { parseCatalog } from '@/adapters/oscalAdapter';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import type { Catalog } from '@/domain/models';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

async function mount(width: number) {
  await page.viewport(width, 874);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
}

function rows() {
  return [...host!.querySelectorAll<HTMLButtonElement>('[role="treeitem"]')];
}
function tabstops() {
  return rows().filter((row) => row.tabIndex === 0);
}
function ownRow(item: HTMLButtonElement) {
  return item;
}

const nested: TreeItem[] = [
  { id: 'A', label: 'Alpha', children: [
    { label: 'Ohne Kennung', children: [{ id: 'A.1', label: 'Blatt' }] },
    { id: 'A.2', label: 'Zweites Kind' },
  ] },
  { id: 'B', label: 'Beta' },
];

test('Chromium: ein Tab-Einstieg, sichtbare Reihenfolge, Kind-/Elternwechsel und eigener Fokusring', async () => {
  await mount(1024);
  const onSelect = vi.fn();
  flushSync(() => root!.render(createElement('main', null,
    createElement('button', null, 'Vorher'),
    createElement(TreeNav, { items: nested, onSelect }),
    createElement('button', null, 'Nachher'),
  )));
  const buttons = host!.querySelectorAll<HTMLButtonElement>('button:not([role])');
  buttons[0].focus();
  await userEvent.tab();
  const alpha = rows()[0];
  expect(document.activeElement).toBe(alpha);
  expect(tabstops()).toEqual([alpha]);
  await userEvent.keyboard('{ArrowRight}{ArrowRight}');
  const anonymous = rows()[1];
  expect(document.activeElement).toBe(anonymous);
  await userEvent.keyboard('{ArrowRight}{ArrowRight}');
  const leaf = rows()[2];
  expect(document.activeElement).toBe(leaf);
  expect(getComputedStyle(ownRow(leaf)).boxShadow).not.toBe('none');
  expect(getComputedStyle(ownRow(alpha)).boxShadow).toBe('none');
  expect(getComputedStyle(ownRow(anonymous)).boxShadow).toBe('none');
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{ArrowDown}');
  expect(ownRow(document.activeElement as HTMLButtonElement).textContent).toBe('Zweites Kind');
  await userEvent.keyboard('{End}');
  expect(ownRow(document.activeElement as HTMLButtonElement).textContent).toBe('Beta');
  await userEvent.keyboard('{Home}');
  expect(document.activeElement).toBe(alpha);
  await userEvent.tab();
  expect(document.activeElement).toBe(buttons[1]);
  await userEvent.tab({ shift: true });
  expect(document.activeElement).toBe(alpha);
  expect(onSelect).not.toHaveBeenCalled();
  const result = await axe.run(host!, { resultTypes: ['violations'] });
  expect(result.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(({ target, failureSummary }) => ({target, failureSummary})) }))).toEqual([]);
});

test('Chromium: Aktivierung ohne ID bleibt lokal, Kindaktivierung navigiert genau einmal', async () => {
  await mount(1024);
  const onSelect = vi.fn();
  flushSync(() => root!.render(createElement(TreeNav, { items: nested, onSelect })));
  rows()[0].focus();
  await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}');
  expect(onSelect).not.toHaveBeenCalled();
  await userEvent.keyboard('{ArrowRight} ');
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('A.1');
  expect(rows()[0].getAttribute('aria-expanded')).toBe('true');
  // Maus auf dem eigenen Zeileninhalt, nicht auf der Kind-Untergruppe.
  await userEvent.click(ownRow(rows()[0]));
  expect(document.activeElement).toBe(rows()[0]);
  expect(tabstops()).toEqual([rows()[0]]);
  expect(rows()).toHaveLength(2);
});

async function mountRealCatalog(width: number) {
  await mount(width);
  const response = await fetch(`${import.meta.env.BASE_URL}data/catalog.json`);
  expect(response.ok).toBe(true);
  const catalog = parseCatalog((await response.json()).catalog, { catalogKey: ENTRY_CATALOG_KEY });
  renderCatalog(catalog);
  await document.fonts.ready;
  return catalog;
}

function renderCatalog(catalog: Catalog) {
  const value = {
    ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}),
    catalog,
    loading: false,
    activeCatalogKey: catalog.catalogKey,
    catalogDirectory: [{ catalogKey: catalog.catalogKey, title: catalog.metadata.title }],
  };
  flushSync(() => root!.render(createElement(CatalogContext.Provider, { value },
    createElement(MemoryRouter, { initialEntries: ['/gibt-es-nicht'] }, createElement(AppShell)),
  )));
}

test('Chromium: realer BSI-Katalog navigiert sichtbare Praktiken und Themen am Desktop', async () => {
  const catalog = await mountRealCatalog(1440);
  const first = rows()[0];
  first.focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(document.activeElement).toBe(rows()[1]);
  await userEvent.keyboard('{Home}{ArrowRight}{ArrowRight}');
  const child = document.activeElement as HTMLButtonElement;
  expect(child.dataset.testid).toBe(`tree-item-${catalog.practices[0].topics[0].id}`);
  expect(tabstops()).toEqual([child]);
  await userEvent.keyboard('{ArrowLeft}{ArrowLeft}{End}');
  expect(document.activeElement).toBe(rows().at(-1));
  expect(rows()).toHaveLength(catalog.practices.length);
});

test('Chromium: reale Baumaktivierung schließt den Drawer, erneutes Öffnen hat einen sichtbaren Tab-Einstieg', async () => {
  await mountRealCatalog(402);
  const menu = host!.querySelector<HTMLButtonElement>('button[aria-controls]')!;
  menu.click();
  const aside = host!.querySelector('aside')!;
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  rows()[0].focus();
  await userEvent.keyboard('{ArrowRight}{ArrowRight}{Enter}');
  await expect.poll(() => host!.querySelector('[data-mobile-nav]')!.getAttribute('data-mobile-nav')).toBe('closed');
  expect(document.activeElement).toBe(menu);
  expect(aside.inert).toBe(true);
  await userEvent.click(menu);
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  expect(tabstops()).toHaveLength(1);
  tabstops()[0].focus();
  expect(document.activeElement).toBe(tabstops()[0]);
  expect(document.activeElement!.closest('[inert]')).toBeNull();
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(menu);
});


test('Chromium: Katalogwechsel setzt Expansion und Tab-Einstieg auch bei gleichen Gruppen-IDs zurück', async () => {
  const catalog = await mountRealCatalog(1440);
  rows()[0].focus();
  await userEvent.keyboard('{ArrowRight}{ArrowRight}');
  expect(rows().length).toBeGreaterThan(catalog.practices.length);
  const search = host!.querySelector<HTMLInputElement>('input[type="search"]')!;
  search.focus();
  // Gleiche Struktur mit anderem Katalogschlüssel: Identität ist kataloggescopt.
  renderCatalog({ ...catalog, catalogKey: 'wlan' });
  expect(document.activeElement).toBe(search);
  expect(rows()).toHaveLength(catalog.practices.length);
  expect(tabstops()).toEqual([rows()[0]]);
});
