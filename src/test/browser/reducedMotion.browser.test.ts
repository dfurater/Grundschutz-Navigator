import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, test } from 'vitest';
import { commands, page } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildControlUrl } from '@/app/routes';
import { CatalogContext } from '@/state/CatalogContext';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import '@/index.css';

/*
 * Reduced Motion ohne `!important` (GSPP-533): Die Regel am Ende von
 * `index.css` steht außerhalb jeder Kaskadenebene und muss gegen jede Ebene
 * gewinnen — Tailwind-Utilities, eigene Regeln (`app`) und OverlayScrollbars
 * (`vendor`). Inline-Transitions prüfen die Einstellung selbst.
 */

const SAMPLES = [
  ['Utility', 'transition-colors duration-150'],
  ['eigene Regel (app)', 'skip-link'],
  ['Ziehgriff (app)', 'resize-handle'],
  ['OverlayScrollbars (vendor)', 'os-scrollbar'],
] as const;

let root: Root | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
const created: HTMLElement[] = [];

afterEach(async () => {
  root?.unmount();
  router?.dispose();
  root = undefined;
  router = undefined;
  for (const element of created.splice(0)) element.remove();
  await commands.setBrowserReducedMotion();
});

function sample(className: string) {
  const element = document.createElement('div');
  element.className = className;
  document.body.append(element);
  created.push(element);
  return element;
}

const longestDurationMs = (element: Element, property: 'transitionDuration' | 'animationDuration') =>
  Math.max(...getComputedStyle(element)[property].split(',').map((value) => Number.parseFloat(value) * 1000));

describe('Reduced Motion', () => {
  test.each(SAMPLES)('hält Übergänge an: %s', async (_label, className) => {
    const element = sample(className);
    expect(longestDurationMs(element, 'transitionDuration')).toBeGreaterThanOrEqual(150);

    await commands.setBrowserReducedMotion(true);
    expect(longestDurationMs(element, 'transitionDuration')).toBeLessThan(1);
  });

  test('schaltet die Einblendanimation des Panels ab', async () => {
    const element = sample('animate-panel-in');
    expect(getComputedStyle(element).animationName).toBe('panel-slide-in');

    await commands.setBrowserReducedMotion(true);
    expect(getComputedStyle(element).animationName).toBe('none');
  });

  test.each([false, true])('Detailspalte des Desktops bei reduzierter Bewegung %s', async (reduce) => {
    await commands.setBrowserReducedMotion(reduce);
    await page.viewport(1440, 900);
    router = createMemoryRouter(createAppRoutes(createElement(AppShell)), {
      initialEntries: [buildControlUrl(ENTRY_CATALOG_KEY, 'a11y-access')],
    });
    const host = document.createElement('div');
    host.id = 'root';
    document.body.append(host);
    created.push(host);
    root = createRoot(host);
    flushSync(() => {
      root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
        createElement(RouterProvider, { router: router! }),
      ));
    });
    await expect.poll(() => host.querySelector('aside[aria-label="Kontrolldetails"]')).not.toBeNull();
    const column = host.querySelector<HTMLElement>('aside[aria-label="Kontrolldetails"]')!;
    expect(column.style.transition).toBe(reduce ? 'none' : 'width var(--duration-normal) var(--easing-default)');
  });
});
