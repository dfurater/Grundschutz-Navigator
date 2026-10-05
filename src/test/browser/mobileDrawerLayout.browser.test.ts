import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
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

async function openDrawer(shell: HTMLElement) {
  shell.querySelector<HTMLButtonElement>('button[aria-controls]')!.click();
  const aside = shell.querySelector('aside')!;
  // Der Drawer gleitet per `translate` herein; gemessen wird die Endlage.
  aside.style.transition = 'none';
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  return aside;
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

test('gibt das Dokument nach dem Schließen wieder frei', async () => {
  const shell = await renderShell(WIDTH);
  await openDrawer(shell);
  shell.querySelector<HTMLButtonElement>('button[aria-label="Menü schließen"]')!.click();
  await expect.poll(() => shell.querySelector('[data-testid="mobile-nav-backdrop"]')).toBeNull();
  expect(document.documentElement.style.overflow).toBe('');
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
