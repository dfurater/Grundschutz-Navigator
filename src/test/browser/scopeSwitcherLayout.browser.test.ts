import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { ScopeSwitcher } from '@/components/ScopeSwitcher';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

// Die drei upstream-Titel (OSCAL metadata.title) der ausgelieferten Kataloge.
const ITEMS = [
  { key: 'gspp', title: 'Anwenderkatalog Grundschutz++', href: '/katalog/gspp' },
  { key: 'lieferkette', title: 'Supply Chain Security', href: '/katalog/lieferkette' },
  { key: 'wlan', title: 'Stand der Technik WLAN', href: '/katalog/wlan' },
];

// Standardbreite der Navigationsleiste, Desktop-Explorer wie mobiler Drawer.
const SIDEBAR_WIDTH = 256;

async function renderHead(width: number, activeKey: string) {
  await page.viewport(width, 800);
  host = document.createElement('div');
  host.style.width = `${SIDEBAR_WIDTH}px`;
  host.style.background = 'white';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(MemoryRouter, null,
      createElement(ScopeSwitcher, {
        label: 'Katalog',
        items: ITEMS,
        activeKey,
        trailing: createElement('button', { type: 'button', style: { width: 44, height: 44 } }, '×'),
      }),
    ));
  });
  await document.fonts.ready;
  const trigger = host.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
  return { head: trigger.parentElement!.parentElement!, trigger };
}

function expectAtMostTwoUnclampedLines(title: HTMLElement) {
  const box = title.getBoundingClientRect();
  expect(parseFloat(getComputedStyle(title).lineHeight)).toBe(18);
  expect(box.height).toBeLessThanOrEqual(36);
  expect(title.scrollHeight).toBeLessThanOrEqual(title.clientHeight + 1);
  expect(title.scrollWidth).toBeLessThanOrEqual(title.clientWidth + 1);
}

const WIDTHS = [320, 375, 402, 430, 639, 640, 767, 768, 1024, 1440];

test.each(WIDTHS.flatMap((width) => ITEMS.map(({ key }) => [width, key] as const)))(
  'hält den Kopf bei %i px mit Katalog %s 51 px hoch und den Titel in höchstens zwei Zeilen',
  async (width, key) => {
    const { head, trigger } = await renderHead(width, key);
    const headBox = head.getBoundingClientRect();
    const triggerBox = trigger.getBoundingClientRect();

    expect(headBox.height).toBe(51);
    expect(headBox.width).toBe(SIDEBAR_WIDTH);
    expect(triggerBox.height).toBeGreaterThanOrEqual(44);
    expect(triggerBox.top).toBeGreaterThanOrEqual(headBox.top);
    expect(triggerBox.bottom).toBeLessThanOrEqual(headBox.bottom);
    expectAtMostTwoUnclampedLines(trigger.querySelector<HTMLElement>('span[lang="de"]')!);
  },
);

test.each([402, 768])('zeigt das geöffnete Menü bei %i px vollständig und so breit wie den Kopf', async (width) => {
  const { head, trigger } = await renderHead(width, 'gspp');
  flushSync(() => trigger.click());

  const menu = host!.querySelector<HTMLElement>('[role="menu"]')!;
  const menuBox = menu.getBoundingClientRect();
  const headBox = head.getBoundingClientRect();

  expect(menuBox.width).toBe(headBox.width - 8);
  expect(Math.round(menuBox.top - headBox.bottom)).toBe(4);
  expect(menuBox.left).toBeGreaterThanOrEqual(0);
  expect(menuBox.right).toBeLessThanOrEqual(width);
  expect(menuBox.bottom).toBeLessThanOrEqual(800);

  const items = [...menu.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
  expect(items).toHaveLength(ITEMS.length);
  for (const item of items) {
    expect(item.getBoundingClientRect().height).toBeGreaterThanOrEqual(40);
    expectAtMostTwoUnclampedLines(item.querySelector<HTMLElement>('span[lang="de"]')!);
  }
});
