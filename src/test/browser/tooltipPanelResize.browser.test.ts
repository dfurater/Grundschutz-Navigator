import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Tooltip } from '@/components/Tooltip';
import '@/index.css';

/*
 * Geöffneter Tooltip im schmaler gezogenen Detail-Panel (Greptile-Befund im
 * Release-PR #307).
 *
 * Ziehen am Panelrand ändert die Breite ohne Fenster- oder Scrollereignis,
 * und `useDragToResize` verhindert beim Mousedown den Fokuswechsel: Ein per
 * Tastatur geöffneter Tooltip bleibt offen. `Tooltip.dismiss.test.tsx` gibt
 * die Geometrie vor; hier bricht Chromium den Tooltip wirklich um, und nach
 * dem Verengen muss er innerhalb der neuen Panelkante stehen.
 */

const EDGE_GAP_PX = 8;
const NARROW_PANEL_PX = 320;
/* Subpixel-Rundung. */
const TOLERANCE_PX = 1;
const EXPLANATION = 'Eine lange Erklärung, die breiter ist als das verengte Panel und deshalb umbrechen muss, '
  + 'damit sie vollständig lesbar bleibt.';

let root: Root | undefined;
let panel: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  panel?.remove();
  root = undefined;
  panel = undefined;
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
  // Größenänderung, ResizeObserver und die Nachmessung.
  for (let frame = 0; frame < 4; frame++) await nextFrame();
}

function expectInsidePanel(tooltip: HTMLElement, area: HTMLElement) {
  const box = tooltip.getBoundingClientRect();
  const bounds = area.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(bounds.left + EDGE_GAP_PX - TOLERANCE_PX);
  expect(box.right).toBeLessThanOrEqual(bounds.right - EDGE_GAP_PX + TOLERANCE_PX);
}

test('hält einen per Tastatur geöffneten Tooltip nach dem Verengen des Panels innerhalb der Panelkante', async () => {
  await page.viewport(1280, 800);
  panel = document.createElement('div');
  panel.dataset.controlDetailScroll = '';
  panel.style.width = '720px';
  panel.style.height = '400px';
  panel.style.overflowY = 'auto';
  document.body.append(panel);
  root = createRoot(panel);
  flushSync(() => {
    root?.render(createElement('p', null, createElement(Tooltip, {
      idPrefix: 'tt-panel',
      content: EXPLANATION,
      // Ohne Umbruch bleibt der Auslöser breit, und mit ihm der Tooltip darunter.
      describeTarget: (id: string) => createElement('button', {
        type: 'button', 'aria-describedby': id, style: { whiteSpace: 'nowrap' },
      }, 'Begriffsbestimmung mit einer ungewöhnlich langen Bezeichnung'),
    })));
  });
  await document.fonts.ready;

  const trigger = panel.querySelector('button')!;
  trigger.focus();
  await settle();
  const tooltip = panel.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tooltip.hidden).toBe(false);
  expectInsidePanel(tooltip, panel);
  // Breiter als das verengte Panel: Ohne Nachmessung ragte er über dessen Kante.
  expect(tooltip.getBoundingClientRect().width).toBeGreaterThan(NARROW_PANEL_PX - 2 * EDGE_GAP_PX);

  panel.style.width = `${NARROW_PANEL_PX}px`;
  await settle();

  expect(document.activeElement).toBe(trigger);
  expect(tooltip.hidden).toBe(false);
  expectInsidePanel(tooltip, panel);
});
