import { afterEach, expect, test } from 'vitest';
import { commands, page } from 'vitest/browser';
import { HEIGHT, WIDTH, openDrawer, renderShell, settlePush, swipe, unmountShell } from './mobileDrawerHarness';

/**
 * Mobile Push-Schublade (GSPP-493) mit vom Browser erzeugten Touch-Eingaben
 * (GSPP-494). Die Prüfungen in `mobileDrawerSwipe.browser.test.ts` schicken
 * selbst gebaute `TouchEvent`s an ein Ziel und belegen nur die Handler. Hier
 * entscheidet Chromium, ob es scrollt, die Berührung als Wischgeste an die
 * Handler gibt oder sie mit `touchcancel` abbricht, und geprüft wird die
 * tatsächliche Scrollposition.
 */

afterEach(async () => {
  await commands.dispatchBrowserTouch('reset');
  unmountShell();
});

/** Zählt die vom Browser gelieferten Touch-Ereignisse und deren Abbrüche. */
function recordTouches() {
  const counts = { touchmove: 0, touchcancel: 0 };
  const listeners = (['touchmove', 'touchcancel'] as const).map((type) => {
    const listener = () => { counts[type]++; };
    document.addEventListener(type, listener, { capture: true, passive: true });
    return () => document.removeEventListener(type, listener, { capture: true });
  });
  return { counts, stop: () => listeners.forEach((remove) => remove()) };
}

/** Der senkrecht scrollende Baumbereich der Schublade, mit Inhalt über seine Höhe hinaus. */
function scrollableTree(aside: HTMLElement) {
  const tree = [...aside.querySelectorAll<HTMLElement>('*')]
    .find((element) => getComputedStyle(element).overflowY === 'auto' && element.clientHeight > 100)!;
  const filler = document.createElement('div');
  filler.style.height = `${HEIGHT * 3}px`;
  tree.append(filler);
  expect(tree.scrollHeight).toBeGreaterThan(tree.clientHeight);
  return tree;
}

const root = (shell: HTMLElement) => shell.querySelector<HTMLElement>('[data-mobile-nav]')!;

test('scrollt den Baum der offenen Schublade senkrecht, ohne sie zu schließen oder die Seite zu bewegen', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const aside = await openDrawer(shell);
  await settlePush(shell);
  const tree = scrollableTree(aside);
  const touches = recordTouches();

  await swipe([120, 600], [124, 250]);
  touches.stop();

  expect(tree.scrollTop).toBeGreaterThan(200);
  expect(touches.counts.touchmove).toBeGreaterThan(0);
  expect(root(shell).dataset.mobileNav).toBe('open');
  expect(aside.getBoundingClientRect().left).toBe(0);
  expect(window.scrollY).toBe(HEIGHT);
});

test('schließt die offene Schublade beim waagerechten Wischen, ohne den Baum zu scrollen', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const aside = await openDrawer(shell);
  await settlePush(shell);
  const tree = scrollableTree(aside);
  const touches = recordTouches();

  await swipe([300, 500], [60, 560]);
  touches.stop();

  // `touch-pan-y` überlässt dem Browser nur senkrechtes Scrollen; die
  // waagerechte Geste bleibt bei den Handlern und wird nicht abgebrochen.
  expect(touches.counts.touchcancel).toBe(0);
  expect(touches.counts.touchmove).toBeGreaterThan(1);
  await expect.poll(() => root(shell).dataset.mobileNav).toBe('closed');
  await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
  expect(tree.scrollTop).toBe(0);
  expect(window.scrollY).toBe(HEIGHT);
});

test('öffnet die Schublade beim waagerechten Wischen über die Seite und lässt deren Scrollposition', async () => {
  const shell = await renderShell(WIDTH);
  window.scrollTo(0, HEIGHT);
  const touches = recordTouches();

  await swipe([40, 500], [300, 560]);
  touches.stop();

  expect(touches.counts.touchcancel).toBe(0);
  await expect.poll(() => root(shell).dataset.mobileNav).toBe('open');
  expect(shell.querySelector('main')!.inert).toBe(true);
  expect(window.scrollY).toBe(HEIGHT);
});

test('scrollt die Seite senkrecht, ohne die Schublade zu öffnen', async () => {
  const shell = await renderShell(WIDTH);
  const touches = recordTouches();

  await swipe([40, 700], [44, 250]);
  touches.stop();

  await expect.poll(() => window.scrollY).toBeGreaterThan(200);
  expect(root(shell).dataset.mobileNav).toBe('closed');
  expect(shell.querySelector('main')!.inert).toBe(false);
});

// Die Wischgeste braucht nur senkrechtes Scrollen vom Browser; Pinch-Zoom mit
// zwei Fingern bleibt in der Schublade erlaubt. Ab `md` gibt es keine Geste,
// und die Seitenleiste behält die volle Touch-Steuerung.
test('erlaubt in der Schublade Pinch-Zoom und ab md die volle Touch-Steuerung', async () => {
  const shell = await renderShell(WIDTH);
  const aside = shell.querySelector('aside')!;
  expect(getComputedStyle(aside).touchAction).toBe('pan-y pinch-zoom');

  await page.viewport(900, HEIGHT);
  await expect.poll(() => getComputedStyle(aside).touchAction).toBe('auto');
});
