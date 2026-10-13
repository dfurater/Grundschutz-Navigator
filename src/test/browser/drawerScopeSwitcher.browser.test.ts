import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { CatalogProvider } from '@/state/CatalogContext';
import { appShellAt } from './appShellRouter';
import { openDrawer, settlePush } from './mobileDrawerHarness';
import '@/index.css';

// Echter Provider mit den ausgelieferten Katalogen: aktive Schlüssel und Titel
// werden wie in der App geladen, nicht mit einem leeren Testverzeichnis ersetzt.
const CATALOGS = [
  { key: 'gspp', title: 'Anwenderkatalog Grundschutz++' },
  { key: 'lieferkette', title: 'Supply Chain Security' },
  { key: 'wlan', title: 'Stand der Technik WLAN' },
] as const;
const PROFILES = [
  { width: 390, height: 844, touch: true },
  { width: 744, height: 1133, touch: true },
  { width: 1032, height: 1376, touch: true },
  { width: 1133, height: 744, touch: true },
  { width: 1376, height: 1032, touch: true },
  { width: 1366, height: 768, touch: false },
];
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  await commands.setBrowserCoarsePointer(false);
});

function triggerIn(aside: HTMLElement) {
  return aside.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
}

function expectReachable(element: HTMLElement, width: number, height: number) {
  expect(element.checkVisibility()).toBe(true);
  const box = element.getBoundingClientRect();
  expect(box.width).toBeGreaterThan(0);
  expect(box.height).toBeGreaterThan(0);
  expect(box.left).toBeGreaterThanOrEqual(0);
  expect(box.top).toBeGreaterThanOrEqual(0);
  expect(box.right).toBeLessThanOrEqual(width);
  expect(box.bottom).toBeLessThanOrEqual(height);
  // checkVisibility und DOMRect erkennen Clipping durch Vorfahren nicht.
  for (const fraction of [0.2, 0.5, 0.8]) {
    const hit = document.elementFromPoint(box.left + box.width * fraction, box.top + box.height * fraction);
    expect(element.contains(hit), `${element.textContent || element.getAttribute('aria-label')} at ${fraction}: hit ${hit?.tagName}.${hit?.className}`).toBe(true);
  }
}

async function tap(element: HTMLElement) {
  const box = element.getBoundingClientRect();
  const frame = window.frameElement!.getBoundingClientRect();
  const scale = frame.width / window.innerWidth;
  await commands.dispatchBrowserTouch('start', frame.left + (box.left + box.width / 2) * scale,
    frame.top + (box.top + box.height / 2) * scale);
  await commands.dispatchBrowserTouch('end');
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

test.each(PROFILES)('hält die Kontextwahl bei $width px (Touch: $touch) sichtbar und bedienbar', async ({ width, height, touch }) => {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, height);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(CatalogProvider, null, appShellAt('/katalog/gspp')));
  });
  const aside = host.querySelector('aside')!;
  await expect.poll(() => triggerIn(aside)?.textContent).toContain(CATALOGS[0].title);
  await expect.poll(() => aside.querySelector('[role="tree"]')).not.toBeNull();
  await document.fonts.ready;
  if (touch) {
    await openDrawer(host);
    await settlePush(host);
  }
  const trigger = triggerIn(aside)!;
  const close = aside.querySelector<HTMLButtonElement>(touch
    ? 'button[aria-label="Menü schließen"]'
    : 'button[aria-label="Katalog-Explorer ausblenden"]')!;
  expectReachable(trigger, width, height);
  expectReachable(close, width, height);

  // Jeder gelieferte Katalog muss auswählbar sein und nach dem Laden denselben
  // Titel im Kopf tragen. Eine Auswahl schließt die kompakte Schublade.
  for (const catalog of CATALOGS) {
    if (touch) await tap(triggerIn(aside)!);
    else await userEvent.click(triggerIn(aside)!);
    await expect.poll(() => aside.querySelector('[role="menu"]')).not.toBeNull();
    const items = [...aside.querySelectorAll<HTMLAnchorElement>('[role="menuitemradio"]')];
    expect(items).toHaveLength(CATALOGS.length);
    expect(items.filter((item) => item.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    const item = items.find((entry) => entry.textContent?.includes(catalog.title))!;
    expect(item.getAttribute('href')).toBe(`/katalog/${catalog.key}`);
    expectReachable(item, width, height);
    if (touch) await tap(item);
    else await userEvent.click(item);
    await expect.poll(() => aside.querySelector('[role="tree"]')).not.toBeNull();
    await expect.poll(() => triggerIn(aside)?.textContent).toContain(catalog.title);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (touch) {
      await expect.poll(() => host!.querySelector('[data-mobile-nav]')?.getAttribute('data-mobile-nav')).toBe('closed');
      await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
      await openDrawer(host!);
      await settlePush(host!);
    }
    expectReachable(triggerIn(aside)!, width, height);
    expectReachable(close, width, height);
  }
  if (touch) {
    await tap(close);
    await expect.poll(() => host!.querySelector('[data-mobile-nav]')?.getAttribute('data-mobile-nav')).toBe('closed');
  }
});
