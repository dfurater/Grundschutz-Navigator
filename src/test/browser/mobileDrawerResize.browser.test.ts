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

async function rotate() {
  const resized = new Promise((resolve) => window.addEventListener('resize', resolve, { once: true }));
  await page.viewport(LANDSCAPE, HEIGHT);
  await resized;
}

const shellRoot = (shell: HTMLElement) => shell.querySelector<HTMLElement>('[data-mobile-nav]')!;

test('beendet eine Schließen-Geste, wenn sich beim Drehen die Breite der Schublade ändert', async () => {
  const shell = await renderShell(PORTRAIT);
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
  const shell = await renderShell(PORTRAIT);
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
