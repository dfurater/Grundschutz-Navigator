import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { Input } from '@/components/Input';
import { IconSearch } from '@/components/icons';
import { SearchPage } from '@/features/search/SearchPage';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

async function renderInputs(width: number) {
  await page.viewport(width, 800);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(MemoryRouter, { initialEntries: ['/suche'] },
      createElement(SearchPage),
      createElement(Input, { id: 'shared-input', label: 'Eingabe', icon: IconSearch }),
    ));
  });
  await document.fonts.ready;
  return [
    host.querySelector<HTMLInputElement>('input[aria-label="Suchbegriff eingeben"]')!,
    host.querySelector<HTMLInputElement>('#shared-input')!,
  ];
}

test.each([360, 393, 639])('hält mobile Eingabefelder bei %i px mindestens 16 px groß', async (width) => {
  for (const input of await renderInputs(width)) {
    expect(input.checkVisibility()).toBe(true);
    expect(Number.parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
    input.focus();
    expect(Number.parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);

    const box = input.getBoundingClientRect();
    const icon = input.parentElement!.querySelector('svg')!.getBoundingClientRect();
    expect(Math.abs(icon.top + icon.height / 2 - (box.top + box.height / 2))).toBeLessThanOrEqual(1);
    expect(box.left + Number.parseFloat(getComputedStyle(input).paddingLeft) - icon.right).toBeGreaterThanOrEqual(8);
    expect(box.right).toBeLessThanOrEqual(width);
  }
});

test.each([640, 1024])('behält ab sm bei %i px die 14-px-Schrift bei', async (width) => {
  const [search, shared] = await renderInputs(width);
  expect(search.checkVisibility()).toBe(false);
  for (const input of [search, shared]) {
    expect(getComputedStyle(input).fontSize).toBe('14px');
  }
});
