import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import '@/index.css';

const WIDTH = 402;
const HEIGHT = 874;
const HEADER_HEIGHT = 56;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  window.scrollTo(0, 0);
});

async function renderShell(width: number) {
  await page.viewport(width, HEIGHT);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const catalogState = { ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}), loading: false };
  flushSync(() => {
    root?.render(createElement(CatalogContext.Provider, { value: catalogState },
      createElement(MemoryRouter, { initialEntries: ['/gibt-es-nicht'] }, createElement(AppShell)),
    ));
  });
  // Lange Seite, damit das Dokument wie eine Kontrollliste scrollt.
  const filler = document.createElement('div');
  filler.style.height = `${HEIGHT * 3}px`;
  host.querySelector('#main-content')!.prepend(filler);
  await document.fonts.ready;
  return host;
}

async function openDrawer(shell: HTMLElement, { animated = false } = {}) {
  shell.querySelector<HTMLButtonElement>('button[aria-controls]')!.click();
  const aside = shell.querySelector('aside')!;
  // Der Drawer gleitet per `translate` herein; gemessen wird die Endlage.
  if (!animated) aside.style.transition = 'none';
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  return aside;
}

function closeDrawer(shell: HTMLElement) {
  shell.querySelector<HTMLButtonElement>('button[aria-label="Menü schließen"]')!.click();
}

test('rendert den offenen mobilen Drawer ohne festes oder sticky Element, damit Safari seine Leiste nicht füllt', async () => {
  const shell = await renderShell(WIDTH);
  const aside = await openDrawer(shell);

  const backdrop = shell.querySelector<HTMLElement>('[data-testid="mobile-nav-backdrop"]')!;
  for (const element of [backdrop, aside, ...aside.querySelectorAll('*')]) {
    expect(['fixed', 'sticky']).not.toContain(getComputedStyle(element).position);
  }
});

test.each([0, HEIGHT])('legt den Drawer bei Scrollposition %i px unter den App-Kopf und sperrt das Dokument', async (scrollY) => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, scrollY);
  const aside = await openDrawer(shell);
  expect(window.scrollY).toBe(scrollY);

  const box = aside.getBoundingClientRect();
  expect(box.top).toBe(HEADER_HEIGHT);
  expect(box.bottom).toBe(window.innerHeight);

  const backdrop = shell.querySelector('[data-testid="mobile-nav-backdrop"]')!.getBoundingClientRect();
  expect(backdrop.top).toBeLessThanOrEqual(HEADER_HEIGHT);
  expect(backdrop.bottom).toBeGreaterThanOrEqual(window.innerHeight);
  expect(backdrop.left).toBe(0);
  expect(backdrop.right).toBe(WIDTH);

  // Gesperrt wird `html`; `body` bleibt ohne eigenen Scrollbereich, sonst klebte
  // der App-Kopf an ihm und verschwände aus dem Bild.
  expect(getComputedStyle(document.documentElement).overflowY).toBe('hidden');
  expect(getComputedStyle(document.body).overflowY).toBe('visible');
  const header = shell.querySelector('[data-sticky-header]')!.getBoundingClientRect();
  expect(header.top).toBe(0);
  expect(document.elementFromPoint(20, HEADER_HEIGHT / 2)?.closest('[data-sticky-header]')).not.toBeNull();
});

test('lässt die Seite bei offenem Drawer auch per Mausrad nicht scrollen', async () => {
  const shell = await renderShell(WIDTH);
  // Ziel ist der stets sichtbare App-Kopf: `userEvent.wheel` scrollt ein Ziel
  // außerhalb des Bildschirms erst programmatisch heran, und das lässt auch
  // eine gesperrte Seite zu. Gegenprobe: Ohne Drawer bewegt das Mausrad die Seite.
  const header = shell.querySelector('[data-sticky-header]')!;
  await userEvent.wheel(header, { delta: { y: 300 } });
  await expect.poll(() => window.scrollY).toBeGreaterThan(0);
  const scrollY = window.scrollY;

  const aside = await openDrawer(shell);
  await userEvent.wheel(header, { delta: { y: 300 } });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(window.scrollY).toBe(scrollY);
  expect(aside.getBoundingClientRect().top).toBe(HEADER_HEIGHT);
});

test('gibt das Dokument nach dem Schließen frei und verlängert es nicht', async () => {
  const shell = await renderShell(WIDTH);
  const pageHeight = document.documentElement.scrollHeight;
  window.scrollTo(0, pageHeight - HEIGHT);
  const aside = await openDrawer(shell, { animated: true });
  closeDrawer(shell);
  await expect.poll(() => shell.querySelector('[data-testid="mobile-nav-backdrop"]')).toBeNull();
  expect(document.documentElement.style.overflow).toBe('');
  // Nach dem Hinausgleiten liegt die geschlossene Schublade wieder oben.
  await expect.poll(() => aside.style.top).toBe('0px');
  expect(document.documentElement.scrollHeight).toBe(pageHeight);
});

test('verlängert eine verkürzte Seite beim Schließen während eines aktiven Resizes nicht', async () => {
  const shell = await renderShell(1024);
  const aside = shell.querySelector('aside')!;
  const resizeHandle = shell.querySelector<HTMLButtonElement>('button[aria-label="Sidebar-Breite anpassen"]')!;
  resizeHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 256 }));

  await page.viewport(WIDTH, HEIGHT);
  await expect.poll(() => getComputedStyle(resizeHandle).display).toBe('none');
  expect(aside.style.transition).toBe('none');

  const longPageHeight = document.documentElement.scrollHeight;
  window.scrollTo(0, longPageHeight - HEIGHT);
  const openedOffset = window.scrollY;
  shell.querySelector<HTMLButtonElement>('button[aria-controls]')!.click();
  await expect.poll(() => aside.style.top).toBe(`${openedOffset}px`);

  const filler = shell.querySelector<HTMLElement>('#main-content > div')!;
  filler.remove();
  const display = aside.style.display;
  aside.style.display = 'none';
  const shortenedPageHeight = document.documentElement.scrollHeight;
  aside.style.display = display;
  expect(shortenedPageHeight).toBeLessThan(longPageHeight);

  closeDrawer(shell);
  await expect.poll(() => aside.style.top).toBe('0px');
  expect(document.documentElement.scrollHeight).toBe(shortenedPageHeight);

  document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
});

test('legt einen offenen Drawer nach einem Wechsel über md und zurück wieder unter den App-Kopf', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const aside = await openDrawer(shell);

  // Gewartet wird, bis React den Wechsel verarbeitet hat (`inert` am
  // Hauptbereich), nicht nur das CSS: Sonst sähe die Shell `md` nie.
  const main = shell.querySelector('main')!;
  await page.viewport(1024, HEIGHT);
  await expect.poll(() => main.inert).toBe(false);
  await page.viewport(WIDTH, HEIGHT);
  await expect.poll(() => main.inert).toBe(true);

  expect(shell.querySelector('[data-testid="mobile-nav-backdrop"]')).not.toBeNull();
  await expect.poll(() => aside.getBoundingClientRect().top).toBe(HEADER_HEIGHT);
  expect(window.scrollY).toBe(0);
});

test('lässt die Seitenleiste ab md neben dem Inhalt in voller Höhe stehen', async () => {
  const shell = await renderShell(1024);
  const aside = shell.querySelector('aside')!;
  expect(getComputedStyle(aside).position).toBe('relative');
  expect(aside.style.top).toBe('');
  const box = aside.getBoundingClientRect();
  expect(box.top).toBe(HEADER_HEIGHT);
  expect(box.left).toBe(0);
  expect(box.width).toBe(256);
  expect((aside.firstElementChild as HTMLElement).getBoundingClientRect().height).toBe(box.height);
  expect(document.documentElement.style.overflow).toBe('');
});
