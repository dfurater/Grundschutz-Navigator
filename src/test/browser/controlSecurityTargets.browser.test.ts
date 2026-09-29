import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import type { VocabularyResolution } from '@/domain/vocabulary';
import { ControlSecurityTargets } from '@/features/catalog/ControlSecurityTargets';
import '@/index.css';

const resolved = {} as VocabularyResolution;
const labels = ['Vertraulichkeit', 'Integrität', 'Verfügbarkeit', 'Authentizität'];
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function renderAtWidth(width: number) {
  host = document.createElement('div');
  host.style.width = `${width}px`;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(ControlSecurityTargets, {
      securityTargets: labels.map((label, index) => ({
        key: String(index),
        label,
        relevance: String(index % 3),
        targetResolution: resolved,
        levelResolution: resolved,
      })),
      isVocabularyActive: () => false,
      onToggleVocabulary: () => {},
      renderVocabularyCard: () => null,
    }));
  });
  return host;
}

/** Umschaltpunkt des Rasters: `@min-[18.5rem]` in `ControlSecurityTargets`. */
const PAIRS_BREAKPOINT_REM = 18.5;

function groupsOf(panel: HTMLElement) {
  return [...panel.querySelectorAll<HTMLElement>('[role="group"]')];
}

function expectRows(panel: HTMLElement, pairsPerRow: 1 | 2) {
  const groups = groupsOf(panel);
  expect(groups).toHaveLength(4);
  const tops = groups.map((group) => group.getBoundingClientRect().top);
  if (pairsPerRow === 2) {
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBe(tops[3]);
    expect(tops[0]).toBeLessThan(tops[2]);
  } else {
    expect(tops[0]).toBeLessThan(tops[1]);
    expect(tops[1]).toBeLessThan(tops[2]);
    expect(tops[2]).toBeLessThan(tops[3]);
  }
}

/** Namen und Punkte vollständig im Inhalt: kein Überlauf, nichts abgeschnitten. */
function expectInside(panel: HTMLElement) {
  const { left, right } = panel.getBoundingClientRect();
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth);
  for (const group of groupsOf(panel)) {
    for (const child of group.children) {
      const box = child.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(left);
      expect(box.right).toBeLessThanOrEqual(right);
    }
  }
}

async function renderWithFonts(width: number) {
  const panel = renderAtWidth(width);
  await document.fonts.ready;
  return panel;
}

test('zeigt bei 288 px Inhalt (320-px-Fenster) ein Schutzziel je Zeile ohne Überlauf', async () => {
  const panel = await renderWithFonts(288);
  expectRows(panel, 1);
  expectInside(panel);
});

test('wechselt unmittelbar am gemessenen Umschaltpunkt auf zwei Schutzziele je Zeile', async () => {
  const breakpoint = PAIRS_BREAKPOINT_REM * 16;
  const below = await renderWithFonts(breakpoint - 1);
  expectRows(below, 1);
  expectInside(below);
  root?.unmount();
  below.remove();

  const at = await renderWithFonts(breakpoint);
  expectRows(at, 2);
  expectInside(at);
});

test('passt das 2×2-Raster in den Inhalt eines 393- und 402-px-Fensters', async () => {
  for (const width of [361, 370]) {
    const panel = await renderWithFonts(width);
    expectRows(panel, 2);
    expectInside(panel);
    root?.unmount();
    panel.remove();
  }
});

test('fällt bei vergrößerter Grundschrift (20 px) im 393-px-Fenster auf ein Schutzziel je Zeile zurück', async () => {
  document.documentElement.style.fontSize = '20px';
  try {
    const panel = await renderWithFonts(361);
    expectRows(panel, 1);
    expectInside(panel);
  } finally {
    document.documentElement.style.fontSize = '';
  }
});

test('bietet für die Relevanz keine eigene Schaltfläche an', async () => {
  const panel = await renderWithFonts(370);
  expect(panel.querySelector('button[aria-label^="Relevanz"]')).toBeNull();
  expect(panel.querySelectorAll('button')).toHaveLength(4);
});
