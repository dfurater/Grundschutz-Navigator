import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import {
  HEADER_HEIGHT,
  HEIGHT,
  WIDTH,
  closeDrawer,
  openDrawer,
  renderShell,
  shortenPage,
  translateTransition,
  unmountShell,
} from './mobileDrawerHarness';

afterEach(unmountShell);

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

test('hält den hinausgleitenden Drawer unter dem App-Kopf, wenn die Seite beim Schließen nach oben springt', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const aside = await openDrawer(shell, { animated: true });

  // Das Hinausgleiten wird angehalten, damit die Messung nicht vom Takt abhängt.
  // React committet das Schließen im Microtask nach dem Klick.
  closeDrawer(shell);
  await Promise.resolve();
  const slide = translateTransition(aside);
  expect(slide).toBeDefined();
  slide!.pause();

  // Wie eine Themenwahl im Drawer: Die neue Seite beginnt oben.
  window.scrollTo(0, 0);
  await expect.poll(() => aside.style.top).toBe('0px');
  const box = aside.getBoundingClientRect();
  expect(box.right).toBeGreaterThan(0);
  expect(box.top).toBe(HEADER_HEIGHT);

  const slideEnded = new Promise((resolve) => aside.addEventListener('transitionend', resolve, { once: true }));
  slide!.finish();
  await slideEnded;
  await Promise.resolve();
  expect(aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
  window.scrollTo(0, HEIGHT);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(aside.style.top).toBe('0px');
});

test('lässt den Drawer beim Schließen während des Hereingleitens unter dem App-Kopf hinausgleiten', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const aside = shell.querySelector('aside')!;
  shell.querySelector<HTMLButtonElement>('button[aria-controls]')!.click();
  await Promise.resolve();
  // Geschlossen wird mitten in der Einfahrt; ganz am Anfang gäbe es keine
  // Strecke, die umgekehrt werden könnte. Die Einfahrt steht dafür still auf
  // halber Dauer, unabhängig vom Takt.
  const slideIn = translateTransition(aside);
  expect(slideIn).toBeDefined();
  slideIn!.pause();
  slideIn!.currentTime = Number(slideIn!.effect!.getComputedTiming().duration) / 2;
  expect(aside.getBoundingClientRect().left).toBeGreaterThan(-256);
  expect(aside.getBoundingClientRect().left).toBeLessThan(0);

  // Das Schließen kehrt die laufende Einfahrt um; deren `transitioncancel`
  // kommt erst danach an und darf das Hinausgleiten nicht beenden.
  closeDrawer(shell);
  await Promise.resolve();
  const slide = translateTransition(aside);
  expect(slide).toBeDefined();
  slide!.pause();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));

  expect(aside.style.top).toBe(`${HEIGHT}px`);
  const box = aside.getBoundingClientRect();
  expect(box.right).toBeGreaterThan(0);
  expect(box.top).toBe(HEADER_HEIGHT);

  const slideEnded = new Promise((resolve) => aside.addEventListener('transitionend', resolve, { once: true }));
  slide!.finish();
  await slideEnded;
  await expect.poll(() => aside.style.top).toBe('0px');
});

test('legt einen Drawer, der vor dem ersten Frame wieder schließt, oben ab', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const aside = shell.querySelector('aside')!;
  const main = shell.querySelector('main')!;
  const menuButton = shell.querySelector<HTMLButtonElement>('button[aria-controls]')!;

  // Öffnen und Schließen im selben Task: Ohne Frame dazwischen beginnt
  // keine Translate-Transition, und kein `transitionend` folgt.
  flushSync(() => menuButton.click());
  expect(main.inert).toBe(true);
  flushSync(() => closeDrawer(shell));
  expect(main.inert).toBe(false);

  await expect.poll(() => aside.style.top).toBe('0px');
  expect(translateTransition(aside)).toBeUndefined();
  window.scrollTo(0, HEIGHT / 2);
  await new Promise((resolve) => requestAnimationFrame(resolve));
  expect(aside.style.top).toBe('0px');
});

test('verlängert eine verkürzte Seite beim Schließen während eines aktiven Resizes nicht', async () => {
  const shell = await renderShell(1024);
  const aside = shell.querySelector('aside')!;
  const resizeHandle = shell.querySelector<HTMLButtonElement>('button[aria-label="Sidebar-Breite anpassen"]')!;
  resizeHandle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 256 }));

  await page.viewport(WIDTH, HEIGHT);
  await expect.poll(() => getComputedStyle(resizeHandle).display).toBe('none');
  expect(aside.style.transition).toBe('none');

  const main = shell.querySelector('main')!;
  const menuButton = shell.querySelector<HTMLButtonElement>('button[aria-controls]')!;
  menuButton.click();
  await expect.poll(() => main.inert).toBe(true);
  closeDrawer(shell);
  await expect.poll(() => main.inert).toBe(false);

  const longPageHeight = document.documentElement.scrollHeight;
  window.scrollTo(0, longPageHeight - HEIGHT);
  const openedOffset = window.scrollY;
  expect(openedOffset).toBeGreaterThan(0);
  menuButton.click();
  await expect.poll(() => main.inert).toBe(true);
  await expect.poll(() => aside.style.top).toBe(`${openedOffset}px`);

  const shortenedPageHeight = shortenPage(shell, aside);
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

test('verlängert eine verkürzte Seite nicht, wenn die Breite während des Hinausgleitens über md und zurück wechselt', async () => {
  const shell = await renderShell(WIDTH);
  const longPageHeight = document.documentElement.scrollHeight;
  window.scrollTo(0, longPageHeight - HEIGHT);
  const openedOffset = window.scrollY;
  expect(openedOffset).toBeGreaterThan(0);
  const aside = await openDrawer(shell, { animated: true });
  expect(aside.style.top).toBe(`${openedOffset}px`);

  // Das Hinausgleiten wird angehalten, damit der Wechsel sicher hineinfällt.
  closeDrawer(shell);
  await Promise.resolve();
  const slide = translateTransition(aside);
  expect(slide).toBeDefined();
  slide!.pause();

  // Ab md trägt die Seitenleiste keine Lage; zurück unter md muss die
  // geschlossene Schublade oben liegen, obwohl kein `transitionend` mehr kommt.
  await page.viewport(1024, HEIGHT);
  await expect.poll(() => aside.style.top).toBe('');
  await page.viewport(WIDTH, HEIGHT);
  await expect.poll(() => aside.style.top).not.toBe('');
  expect(aside.style.top).toBe('0px');

  const shortenedPageHeight = shortenPage(shell, aside);
  expect(shortenedPageHeight).toBeLessThan(openedOffset);
  expect(document.documentElement.scrollHeight).toBe(shortenedPageHeight);
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
