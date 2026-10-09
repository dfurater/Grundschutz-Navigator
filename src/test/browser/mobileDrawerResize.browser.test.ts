import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { HEIGHT, drag, openDrawer, pause, renderShell, touchEvent, unmountShell } from './mobileDrawerHarness';

afterEach(unmountShell);

/**
 * Dreht ein kleines Smartphone mitten in einer Wischgeste ins Querformat,
 * wächst die Schublade (`min(85vw, 22.5rem)`) von 318,75 auf 360 px, und ihre
 * `width`-Transition bleibt eingeschaltet. Die Geste endet dann wie bei
 * `touchcancel`, statt mit der beim Aufsetzen gemessenen Breite weiterzurechnen.
 */

const PORTRAIT = 375;
const LANDSCAPE = 667;

/**
 * Wartet auf das `resize` der neuen Breite: Ein verspätetes `resize` der
 * vorigen Größe beendete das Warten sonst vor der Drehung.
 */
function resizedTo(width: number) {
  return new Promise<void>((resolve) => {
    const onResize = () => {
      if (window.innerWidth !== width) return;
      window.removeEventListener('resize', onResize);
      resolve();
    };
    window.addEventListener('resize', onResize);
  });
}

async function renderPortrait() {
  const shell = await renderShell(PORTRAIT);
  await expect.poll(() => window.innerWidth).toBe(PORTRAIT);
  return shell;
}

async function rotate() {
  const resized = resizedTo(LANDSCAPE);
  await page.viewport(LANDSCAPE, HEIGHT);
  await resized;
}

/** Wartet, bis die Schublade keine Transition mehr hat. */
async function settled(aside: HTMLElement) {
  await expect.poll(() => aside.getAnimations().length).toBe(0);
}

const shellRoot = (shell: HTMLElement) => shell.querySelector<HTMLElement>('[data-mobile-nav]')!;

test('beendet eine Schließen-Geste, wenn sich beim Drehen die Breite der Schublade ändert', async () => {
  const shell = await renderPortrait();
  const aside = await openDrawer(shell, { animated: true });
  const root = shellRoot(shell);
  const gesture = drag(aside, [300, 400], [[290, 401], [250, 402], [200, 402]]);
  expect(root.style.getPropertyValue('--mobile-nav-drag')).toBe('-100px');

  await rotate();
  expect(root.style.getPropertyValue('--mobile-nav-drag')).toBe('');
  // Weitere Ereignisse derselben Berührung bleiben ohne Wirkung.
  expect(aside.dispatchEvent(touchEvent('touchmove', aside, 20, 402))).toBe(true);
  await pause();
  gesture.release();
  expect(root.dataset.mobileNav).toBe('open');
  expect(shell.querySelector('main')!.inert).toBe(true);
});

test('beendet eine Öffnen-Vorschau, wenn sich beim Drehen die Breite der Schublade ändert', async () => {
  const shell = await renderPortrait();
  const root = shellRoot(shell);
  const main = shell.querySelector('main')!;
  const gesture = drag(main, [40, 400], [[52, 401], [150, 402], [240, 402]]);
  expect(root.dataset.mobileNav).toBe('open');

  await rotate();
  expect(root.dataset.mobileNav).toBe('closed');
  expect(root.style.getPropertyValue('--mobile-nav-drag')).toBe('');
  expect(main.dispatchEvent(touchEvent('touchmove', main, 400, 402))).toBe(true);
  await pause();
  gesture.release();
  expect(root.dataset.mobileNav).toBe('closed');
  expect(main.inert).toBe(false);
});

// Schublade und verschobene Seite folgen derselben Bewegung; sonst überlappte
// die wachsende Schublade die Seite während der Drehung um bis zu 26 px.
test('hält Schublade und Seite beim Drehen mit offener Schublade in jedem Frame bündig', async () => {
  const shell = await renderPortrait();
  const aside = await openDrawer(shell, { animated: true });
  const main = shell.querySelector('main')!;
  await settled(aside);

  await rotate();
  const gaps: number[] = [];
  const start = performance.now();
  while (performance.now() - start < 300) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    gaps.push(Math.abs(main.getBoundingClientRect().left - aside.getBoundingClientRect().right));
  }
  expect(aside.getBoundingClientRect().width).toBeCloseTo(360, 0);
  expect(Math.max(...gaps)).toBeLessThan(0.5);
});

test('beginnt während des Breitenangleichs keine Geste und danach mit der neuen Breite', async () => {
  const shell = await renderPortrait();
  const aside = await openDrawer(shell, { animated: true });
  const root = shellRoot(shell);
  const backdrop = shell.querySelector<HTMLElement>('[data-testid="mobile-nav-backdrop"]')!;
  await settled(aside);

  await rotate();
  const early = drag(aside, [300, 400], [[290, 401], [250, 402], [200, 402]]);
  expect(root.style.getPropertyValue('--mobile-nav-drag')).toBe('');
  early.release();

  await settled(aside);
  const gesture = drag(aside, [300, 400], [[290, 401], [250, 402], [200, 402]]);
  expect(root.style.getPropertyValue('--mobile-nav-drag')).toBe('-100px');
  expect(Number(getComputedStyle(backdrop).opacity)).toBeCloseTo(1 - 100 / 360, 2);
  await pause();
  gesture.release();
});
