import { afterEach, expect, test } from 'vitest';
import { HEIGHT, WIDTH, openDrawer, renderShell, settlePush, unmountShell } from './mobileDrawerHarness';

afterEach(unmountShell);

/** Mobile Push-Schublade (GSPP-493): Verschieben, Abdunklung, Wischgesten. */

const DRAWER_WIDTH = WIDTH * 0.85;

function touchEvent(type: string, target: Element, x: number, y: number) {
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
function drag(target: Element, from: readonly [number, number], points: readonly (readonly [number, number])[]) {
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
async function pause() {
  await new Promise((resolve) => setTimeout(resolve, 150));
}

const parts = (shell: HTMLElement) => ({
  /** Träger von `data-mobile-nav` und den Gestenvariablen. */
  root: shell.querySelector<HTMLElement>('[data-mobile-nav]')!,
  aside: shell.querySelector('aside')!,
  main: shell.querySelector('main')!,
  header: shell.querySelector<HTMLElement>('[data-sticky-header]')!,
  backdrop: shell.querySelector<HTMLElement>('[data-testid="mobile-nav-backdrop"]')!,
});

test('schiebt App-Kopf, Inhalt und Abdunklung um die Breite der Schublade nach rechts', async () => {
  const shell = await renderShell(WIDTH);
  const { main, header, backdrop } = parts(shell);
  // Geschlossen bleibt die Seite ohne `translate`, sonst wäre sie Bezugsrahmen fester Elemente.
  expect(getComputedStyle(main).translate).toBe('none');
  expect(getComputedStyle(header).translate).toBe('none');
  expect(getComputedStyle(backdrop).opacity).toBe('0');
  expect(getComputedStyle(backdrop).pointerEvents).toBe('none');

  const aside = await openDrawer(shell);
  await settlePush(shell);
  const drawerBox = aside.getBoundingClientRect();
  expect(drawerBox.width).toBeCloseTo(DRAWER_WIDTH, 0);
  expect(drawerBox.top).toBe(0);
  expect(drawerBox.height).toBe(HEIGHT);
  for (const pushed of [main, header, backdrop]) {
    expect(pushed.getBoundingClientRect().left).toBeCloseTo(drawerBox.right, 1);
  }
  // Unter Safaris schwebender Leiste malt ein weißer Schatten die Fläche unter
  // der Schublade aus, ohne das Dokument zu verlängern.
  expect(getComputedStyle(aside).boxShadow).toBe('rgb(255, 255, 255) 0px 128px 0px 0px');
  expect(getComputedStyle(backdrop).backgroundColor).toBe('rgba(0, 0, 0, 0.64)');
  expect(getComputedStyle(backdrop).opacity).toBe('1');
});

test('lässt Schublade und Seite beim Wischen nach links dem Finger folgen und gleitet ohne Wurf zurück', async () => {
  const shell = await renderShell(WIDTH);
  const aside = await openDrawer(shell);
  const { main, backdrop } = parts(shell);
  await settlePush(shell);

  const gesture = drag(aside, [300, 400], [[290, 401], [250, 402], [200, 402]]);
  expect(gesture.moves.at(-1)).toBe(false);
  expect(aside.getBoundingClientRect().left).toBeCloseTo(-100, 0);
  expect(main.getBoundingClientRect().left).toBeCloseTo(DRAWER_WIDTH - 100, 0);
  expect(Number(getComputedStyle(backdrop).opacity)).toBeCloseTo(1 - 100 / DRAWER_WIDTH, 2);

  await pause();
  gesture.release();
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  expect(main.inert).toBe(true);
  expect(parts(shell).root.style.getPropertyValue('--mobile-nav-drag')).toBe('');
});

test('schließt die Schublade, wenn sie über die Hälfte nach links gezogen wird', async () => {
  const shell = await renderShell(WIDTH);
  const aside = await openDrawer(shell);
  const { main } = parts(shell);

  const gesture = drag(aside, [320, 400], [[300, 400], [200, 400], [100, 400]]);
  await pause();
  gesture.release();
  expect(main.inert).toBe(false);
  expect(aside.inert).toBe(true);
  await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
  await expect.poll(() => getComputedStyle(main).translate).toBe('none');
});

test('schließt die Schublade bei einem kurzen Wurf nach links und übernimmt dessen Tempo', async () => {
  const shell = await renderShell(WIDTH);
  // Mit Überblendung: Erst das Ende der Bewegung setzt deren Tempo zurück.
  const aside = await openDrawer(shell, { animated: true });
  const { main, backdrop } = parts(shell);

  const gesture = drag(backdrop, [380, 400], [[368, 400], [355, 400], [340, 400]]);
  gesture.release();
  expect(main.inert).toBe(false);
  const motion = parts(shell).root.style.getPropertyValue('--mobile-nav-motion');
  expect(motion).toMatch(/^\d+ms cubic-bezier\(0, 0, 0.2, 1\)$/);
  expect(Number.parseInt(motion, 10)).toBeLessThan(220);
  await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
  // Nach der Freigabe gilt wieder die Standardbewegung.
  await expect.poll(() => parts(shell).root.style.getPropertyValue('--mobile-nav-motion')).toBe('');
});

test('öffnet die Schublade beim Wischen nach rechts über die Seite, fingergeführt und an der Dokumentposition', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const { aside, main, header } = parts(shell);

  const gesture = drag(main, [40, 400], [[52, 401], [150, 402], [240, 402]]);
  expect(gesture.moves.at(-1)).toBe(false);
  expect(parts(shell).root.dataset.mobileNav).toBe('open');
  const box = aside.getBoundingClientRect();
  expect(box.left).toBeCloseTo(200 - DRAWER_WIDTH, 0);
  expect(box.top).toBe(0);
  expect(header.getBoundingClientRect().left).toBeCloseTo(200, 0);
  expect(document.documentElement.style.overflow).toBe('hidden');
  expect(window.scrollY).toBe(HEIGHT);

  await pause();
  gesture.release();
  expect(main.inert).toBe(true);
  expect(aside.inert).toBe(false);
  await expect.poll(() => aside.getBoundingClientRect().left).toBe(0);
  expect(window.scrollY).toBe(HEIGHT);
});

test('lässt eine kurze Öffnen-Geste zurückgleiten und gibt das Dokument wieder frei', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const { aside, main } = parts(shell);

  const gesture = drag(main, [40, 400], [[60, 400], [100, 400]]);
  await pause();
  gesture.release();
  expect(main.inert).toBe(false);
  expect(parts(shell).root.dataset.mobileNav).toBe('closed');
  await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
  await expect.poll(() => aside.style.top).toBe('0px');
  expect(document.documentElement.style.overflow).toBe('');
  expect(window.scrollY).toBe(HEIGHT);
});

test('öffnet bei senkrechtem Wischen, nach links und auf festen Ebenen nicht', async () => {
  const shell = await renderShell(WIDTH);
  const { main } = parts(shell);

  const vertical = drag(main, [100, 400], [[104, 380], [110, 300]]);
  expect(vertical.moves.every(Boolean)).toBe(true);
  vertical.release();

  const leftwards = drag(main, [300, 400], [[280, 400], [200, 400]]);
  expect(leftwards.moves.every(Boolean)).toBe(true);
  leftwards.release();

  const sheet = document.createElement('div');
  sheet.style.position = 'fixed';
  main.append(sheet);
  const onSheet = drag(sheet, [40, 400], [[60, 400], [200, 400]]);
  expect(onSheet.moves.every(Boolean)).toBe(true);
  onSheet.release();

  expect(parts(shell).root.dataset.mobileNav).toBe('closed');
  expect(main.inert).toBe(false);
});
