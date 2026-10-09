import { afterEach, expect, test, vi } from 'vitest';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { Footer } from '@/components/Footer';
import { DatenschutzPage } from '@/features/pages/DatenschutzPage';
import { LizenzenPage } from '@/features/pages/LizenzenPage';
import '@/index.css';

const verification = vi.hoisted(() => ({ valid: true }));
vi.mock('@/hooks/useCatalog', () => ({ useCatalog: () => ({ verification }) }));

let root: Root | undefined;
const fixtures: HTMLElement[] = [];
afterEach(() => {
  root?.unmount();
  root = undefined;
  for (const fixture of fixtures.splice(0)) fixture.remove();
});

function fixture() {
  const element = document.createElement('div');
  document.body.append(element);
  fixtures.push(element);
  return element;
}

// Canvas resolves Chromium's computed oklch colors to sRGB before WCAG luminance.
function luminance(color: string) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function assertContrast(element: HTMLElement, background: string) {
  const foreground = getComputedStyle(element).color;
  const values = [luminance(foreground), luminance(background)].sort((a, b) => a - b);
  expect((values[1] + 0.05) / (values[0] + 0.05), `${element.textContent}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
}

function backgroundOf(element: HTMLElement): string {
  const color = getComputedStyle(element).backgroundColor;
  if (color !== 'rgba(0, 0, 0, 0)') return color;
  return element.parentElement ? backgroundOf(element.parentElement) : 'white';
}

test('secondary text remains readable on base, subtle, row hover and selection surfaces', () => {
  for (const surface of ['surface-base', 'surface-subtle', 'slate-100', 'accent-soft']) {
    const element = fixture();
    element.style.backgroundColor = `var(--color-${surface})`;
    element.style.color = 'var(--color-text-muted)';
    element.textContent = `Filterzählung / Kennung / Metadaten (${surface})`;
    assertContrast(element, getComputedStyle(element).backgroundColor);
  }
});

test('both footer verification states and navigation links meet normal-text contrast', () => {
  const container = fixture();
  root = createRoot(container);
  for (const valid of [true, false]) {
    verification.valid = valid;
    flushSync(() => root?.render(createElement(MemoryRouter, {}, createElement(Footer))));
    for (const link of container.querySelectorAll('a')) assertContrast(link, backgroundOf(link));
  }
});

test('privacy and license links and license labels meet contrast on their actual surfaces', () => {
  const container = fixture();
  container.style.backgroundColor = 'var(--color-surface-base)';
  root = createRoot(container);
  for (const page of [DatenschutzPage, LizenzenPage]) {
    flushSync(() => root?.render(createElement(page)));
    for (const element of container.querySelectorAll<HTMLElement>('a, span, h3')) {
      if (!element.classList.contains('sr-only')) assertContrast(element, backgroundOf(element));
    }
  }
});

test('all mobile effort digits remain readable on their effort badge surface', () => {
  for (const level of [1, 2, 3, 4, 5]) {
    const element = fixture();
    element.style.backgroundColor = 'var(--color-status-aufwand-bg)';
    element.style.color = `var(--color-effort-level-${level}-text)`;
    element.textContent = String(level);
    assertContrast(element, getComputedStyle(element).backgroundColor);
  }
});
