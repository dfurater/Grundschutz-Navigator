import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { expect } from 'vitest';
import { commands, page } from 'vitest/browser';
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

export async function renderShell(width: number, route = '/gibt-es-nicht') {
  await page.viewport(width, HEIGHT);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const catalogState = { ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}), loading: false };
  flushSync(() => {
    root?.render(createElement(CatalogContext.Provider, { value: catalogState },
      createElement(MemoryRouter, { initialEntries: [route] }, createElement(AppShell)),
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

/** Lässt das Verschieben der Seite und die Abdunklung sofort enden. */
export async function settlePush(shell: HTMLElement) {
  for (const animation of shell.getAnimations({ subtree: true })) {
    if (!(animation.effect instanceof KeyframeEffect)) continue;
    const target = animation.effect.target;
    if (target instanceof HTMLElement && target.closest('aside') === null) animation.finish();
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
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

/**
 * Selbst gebaute `TouchEvent`s erreichen nur die Handler; ob der Browser
 * scrollt oder abbricht, prüft erst `swipe` mit echten Berührungen.
 */
export function touchEvent(type: string, target: Element, x: number, y: number) {
  const touch = new Touch({ identifier: 1, target, clientX: x, clientY: y });
  const active = type === 'touchend' || type === 'touchcancel' ? [] : [touch];
  return new TouchEvent(type, {
    bubbles: true,
    cancelable: true,
    touches: active,
    targetTouches: active,
    changedTouches: [touch],
  });
}

/** Startet eine Berührung und zieht sie über die Punkte; liefert das Loslassen. */
export function drag(target: Element, from: readonly [number, number], points: readonly (readonly [number, number])[]) {
  target.dispatchEvent(touchEvent('touchstart', target, ...from));
  let last = from;
  const moves = points.map(([x, y]) => {
    last = [x, y];
    return target.dispatchEvent(touchEvent('touchmove', target, x, y));
  });
  return {
    moves,
    release: () => target.dispatchEvent(touchEvent('touchend', target, ...last)),
  };
}

/** Langsames Loslassen: Der Finger stand vorher still, es gibt keinen Wurf. */
export async function pause() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

/** Koordinaten des Testframes in Koordinaten der Browser-Seite. */
function toPage(x: number, y: number) {
  const frame = window.frameElement;
  if (!frame) return { x, y };
  const box = frame.getBoundingClientRect();
  const scale = box.width / window.innerWidth;
  return { x: box.left + x * scale, y: box.top + y * scale };
}

/**
 * Eine vom Browser erzeugte Berührung (`dispatchBrowserTouch`) von `from` nach
 * `to` in gleichmäßigen Schritten mit kurzem Takt. Koordinaten gelten für den
 * Testframe.
 */
export async function swipe(from: readonly [number, number], to: readonly [number, number], steps = 12) {
  const start = toPage(...from);
  await commands.dispatchBrowserTouch('start', start.x, start.y);
  for (let step = 1; step <= steps; step++) {
    const point = toPage(
      from[0] + ((to[0] - from[0]) * step) / steps,
      from[1] + ((to[1] - from[1]) * step) / steps,
    );
    await commands.dispatchBrowserTouch('move', point.x, point.y);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  // Der Finger steht vor dem Loslassen still: kein Wurf, die Strecke entscheidet.
  await new Promise((resolve) => setTimeout(resolve, 150));
  await commands.dispatchBrowserTouch('end');
}
