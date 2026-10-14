import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { HeaderBar } from '@/components/HeaderBar';
import { INPUT_MODALITY_ATTRIBUTE, useInputModality } from '@/hooks/useInputModality';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  document.documentElement.removeAttribute(INPUT_MODALITY_ATTRIBUTE);
});

function ModalityShell() {
  useInputModality();
  return createElement(HeaderBar, { onMenuToggle: () => {} });
}

const hasRing = (element: Element) => getComputedStyle(element).boxShadow !== 'none';

// Echtes Stylesheet und echte Tastatur: Die Variante `kbd-focus` entscheidet über
// den sichtbaren Ring, während `:focus-visible` und der Fokus unverändert bleiben.
test('blendet den Ring am Menü-Symbol nur nach Zeiger-Eingabe aus', async () => {
  await page.viewport(375, 800);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(MemoryRouter, null, createElement(ModalityShell)));
  });
  const menu = host.querySelector<HTMLButtonElement>('button[aria-label="Menü öffnen"]')!;

  // `userEvent.tab()` verschiebt den Fokus ohne `keydown`; die Tastatur löst es echt aus.
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(menu);
  expect(menu.matches(':focus-visible')).toBe(true);
  expect(document.documentElement.getAttribute(INPUT_MODALITY_ATTRIBUTE)).toBe('keyboard');
  expect(hasRing(menu)).toBe(true);

  document.documentElement.removeAttribute(INPUT_MODALITY_ATTRIBUTE);
  expect(hasRing(menu)).toBe(true);

  document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  expect(document.documentElement.getAttribute(INPUT_MODALITY_ATTRIBUTE)).toBe('pointer');
  expect(document.activeElement).toBe(menu);
  expect(menu.matches(':focus-visible')).toBe(true);
  expect(hasRing(menu)).toBe(false);

  await userEvent.keyboard('{Shift}');
  expect(hasRing(menu)).toBe(false);

  await userEvent.keyboard('a');
  expect(document.activeElement).toBe(menu);
  expect(document.documentElement.getAttribute(INPUT_MODALITY_ATTRIBUTE)).toBe('keyboard');
  expect(hasRing(menu)).toBe(true);
});
