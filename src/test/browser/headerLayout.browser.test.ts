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

function placeholderFits(input: HTMLInputElement) {
  const style = getComputedStyle(input);
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = style.font;
  const textWidth = context.measureText(input.placeholder).width;
  const contentWidth = input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return { textWidth, contentWidth };
}

// Echte Media Queries, Schriften und Boxen statt Klassenvergleiche im jsdom.
test.each([320, 375, 402, 430, 639, 640, 767, 768, 1024, 1440])(
  'trägt bei %i px nur Menü, Marke und Suche, zentriert und überlappungsfrei',
  async (width) => {
    const header = await renderHeader(width);
    const headerBox = header.getBoundingClientRect();
    const menu = header.querySelector<HTMLButtonElement>('button[aria-label="Menü öffnen"]')!;
    const brand = [...header.querySelectorAll('a')].find((link) => link.textContent === 'Grundschutz++ Navigator')!;
    const searchLink = header.querySelector<HTMLAnchorElement>('a[aria-label="Suche"]')!;
    const search = header.querySelector<HTMLInputElement>('input[type="search"]')!;
    const text = brand.querySelector('span')!;
    const targets = [brand, ...[menu, searchLink].filter((target) => target.checkVisibility())];

    expect(headerBox.height).toBe(56);
    expect(menu.checkVisibility()).toBe(width < 768);
    expect(searchLink.checkVisibility()).toBe(width < 640);
    expect(search.checkVisibility()).toBe(width >= 640);
    expect(header.querySelector('[aria-haspopup]')).toBeNull();

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

    // Marke einzeilig und ohne Überlauf, auch bei 320 px.
    expect(text.getBoundingClientRect().height).toBeLessThan(2 * parseFloat(getComputedStyle(text).lineHeight));
    expect(text.scrollWidth).toBeLessThanOrEqual(text.clientWidth + 1);
    expect(brand.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);

    // Menü- und Lupen-Icon liegen auf der 16-px-Flucht.
    if (menu.checkVisibility()) {
      expect(Math.abs(menu.querySelector('svg')!.getBoundingClientRect().left - 16)).toBeLessThanOrEqual(1);
      expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(brand.getBoundingClientRect().left);
    }
    if (searchLink.checkVisibility()) {
      expect(Math.abs(searchLink.querySelector('svg')!.getBoundingClientRect().right - (width - 16))).toBeLessThanOrEqual(1);
      expect(brand.getBoundingClientRect().right).toBeLessThanOrEqual(searchLink.getBoundingClientRect().left);
      expect(searchLink.getAttribute('href')).toBe('/suche');
    }

    if (search.checkVisibility()) {
      const searchBox = search.getBoundingClientRect();
      expect(brand.getBoundingClientRect().right).toBeLessThanOrEqual(searchBox.left);
      expect(searchBox.right).toBeLessThanOrEqual(width - 16);

      // Der Platzhalter steht vollständig (GSPP-477).
      const { textWidth, contentWidth } = placeholderFits(search);
      expect(textWidth).toBeLessThanOrEqual(contentWidth);

      // Der Tastaturhinweis erscheint erst ab 1024 px.
      expect(header.querySelector('kbd')!.checkVisibility()).toBe(width >= 1024);
    }

    // Ab xl steht die Suche mittig, rechts bleibt die Spalte leer.
    if (width >= 1280) {
      const column = search.closest('div.hidden')!.getBoundingClientRect();
      expect(Math.abs(column.left + column.width / 2 - width / 2)).toBeLessThanOrEqual(1);
    }
  },
);
