import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { expect } from 'vitest';
import { page } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import '@/index.css';

/** Aufbau der App-Shell für die Browser-Prüfungen der mobilen Schublade. */

export const WIDTH = 402;
export const HEIGHT = 874;
export const HEADER_HEIGHT = 56;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

export function unmountShell() {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  window.scrollTo(0, 0);
}

export async function renderShell(width: number) {
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

export async function openDrawer(shell: HTMLElement, { animated = false } = {}) {
  shell.querySelector<HTMLButtonElement>('button[aria-controls]')!.click();
  const aside = shell.querySelector('aside')!;
  // Der Drawer gleitet per `translate` herein; gemessen wird die Endlage.
  if (!animated) aside.style.transition = 'none';
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  return aside;
}

export function closeDrawer(shell: HTMLElement) {
  shell.querySelector<HTMLButtonElement>('button[aria-label="Menü schließen"]')!.click();
}

export function translateTransition(element: HTMLElement) {
  return element.getAnimations().find(
    (animation) => animation instanceof CSSTransition && animation.transitionProperty === 'translate',
  );
}

/**
 * Entfernt den Seitenfüller und liefert die Höhe der verkürzten Seite, wie sie
 * ohne die Schublade wäre.
 */
export function shortenPage(shell: HTMLElement, aside: HTMLElement) {
  shell.querySelector<HTMLElement>('#main-content > div')!.remove();
  const display = aside.style.display;
  aside.style.display = 'none';
  const shortenedPageHeight = document.documentElement.scrollHeight;
  aside.style.display = display;
  return shortenedPageHeight;
}
