import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { HeaderBar } from '@/components/HeaderBar';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

async function renderHeader(width: number) {
  await page.viewport(width, 800);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(MemoryRouter, null,
      createElement(HeaderBar, { onMenuToggle: () => {} }),
    ));
  });
  await document.fonts.ready;
  return host.querySelector('header')!;
}

const centerY = (box: DOMRect) => box.top + box.height / 2;

// Echte Media Queries, Schriften und Boxen statt Klassenvergleiche im jsdom.
test.each([320, 375, 402, 430, 639, 640, 767, 768, 1024, 1440])(
  'hält die Header-Ziele bei %i px zentriert, erreichbar und überlappungsfrei',
  async (width) => {
    const header = await renderHeader(width);
    const headerBox = header.getBoundingClientRect();
    const menu = header.querySelector<HTMLButtonElement>('button[aria-label="Menü öffnen"]')!;
    const brand = header.querySelector<HTMLAnchorElement>('a[aria-label="Zur Startseite"]')!;
    const switcher = header.querySelector<HTMLButtonElement>('button[aria-label="Katalog wechseln"]')!;
    const text = brand.querySelector('span')!;
    const targets = [brand, switcher, ...(menu.checkVisibility() ? [menu] : [])];

    expect(headerBox.height).toBe(56);
    expect(menu.checkVisibility()).toBe(width < 768);
    for (const target of targets) {
      const box = target.getBoundingClientRect();
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(Math.abs(centerY(box) - centerY(headerBox))).toBeLessThanOrEqual(1);
      expect(box.top).toBeGreaterThanOrEqual(headerBox.top);
      expect(box.bottom).toBeLessThanOrEqual(headerBox.bottom);
      for (const icon of target.querySelectorAll('svg')) {
        expect(Math.abs(centerY(icon.getBoundingClientRect()) - centerY(headerBox))).toBeLessThanOrEqual(1);
      }
    }

    expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
    expect(text.scrollHeight).toBeLessThanOrEqual(text.clientHeight + 1);
    expect(brand.getBoundingClientRect().right).toBeLessThanOrEqual(switcher.getBoundingClientRect().left - 8);
    expect(switcher.getBoundingClientRect().right).toBeLessThanOrEqual(width);

    const search = header.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(search.checkVisibility()).toBe(width >= 640);
    if (search.checkVisibility()) {
      const searchBox = search.getBoundingClientRect();
      expect(brand.getBoundingClientRect().right).toBeLessThanOrEqual(searchBox.left);
      expect(searchBox.right).toBeLessThanOrEqual(switcher.getBoundingClientRect().left);
    }
  },
);
