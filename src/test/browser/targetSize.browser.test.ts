import axe from 'axe-core';
import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { commands, page } from 'vitest/browser';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import { Footer } from '@/components/Footer';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import { VocabularyNamespacePage } from '@/features/vocabularies/VocabularyNamespacePage';
import { VocabularyOverviewPage } from '@/features/vocabularies/VocabularyOverviewPage';
import '@/index.css';

/**
 * Trefferflächen von Vokabularübersicht, Quellenlink der Vokabularseite, Footer
 * und Filter-Checkboxlabels (GSPP-501). WCAG 2.5.8 prüft axe über die Regel `target-size` an den echten
 * Chromium-Boxen; das 44-px-Projektziel unterhalb von `lg` (64rem) ist keine
 * axe-Regel und steht deshalb als Boxmaß daneben.
 */

const registry = buildVocabularyRegistry({
  sourceCommitSha: 'snapshot-123',
  namespaces: ['documentation_guidelines', 'basethreats', 'practices'].map((name) => ({
    source: {
      namespace: `https://example.com/namespaces/${name}.csv`,
      repository: 'https://example.com/repo',
      path: `documentation/namespaces/${name}.csv`,
      fileName: `${name}.csv`,
      routeId: `documentation-namespaces-${name}`,
      gitBlobSha: `blob-${name}`,
    },
    columnOrder: ['Begriff', 'Definition'],
    valueColumn: 'Begriff',
    definitionColumn: 'Definition',
    entries: [],
  })),
});

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: () => ({
    verification: { valid: true },
    vocabularyRegistry: registry,
    loading: false,
    error: null,
  }),
}));

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  await commands.setBrowserFontSize();
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

async function renderSurfaces(width: number) {
  await page.viewport(width, 900);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(MemoryRouter, null,
      createElement(VocabularyOverviewPage),
      createElement('div', { 'data-testid': 'filter' },
        createElement(CheckboxLabel, { label: 'Standard', count: 12, checked: false, onChange: () => {} }),
        createElement(CheckboxLabel, { label: 'Erhöht', count: 3, checked: true, onChange: () => {} }),
      ),
      createElement(Footer),
    ));
  });
  await document.fonts.ready;
  return host;
}

async function renderNamespacePage(width: number) {
  await page.viewport(width, 900);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(MemoryRouter, { initialEntries: ['/vokabular/documentation-namespaces-practices'] },
      createElement(Routes, null,
        createElement(Route, { path: '/vokabular/:namespaceId', element: createElement(VocabularyNamespacePage) }),
      ),
    ));
  });
  await document.fonts.ready;
  return host;
}

function targets(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('a[href], label')];
}

const WIDTHS = [320, 390, 768, 1023, 1024, 1440];

test.each(WIDTHS)('erfüllt WCAG 2.5.8 (axe target-size) bei %i px', async (width) => {
  const container = await renderSurfaces(width);
  const result = await axe.run(container, { runOnly: { type: 'rule', values: ['target-size'] } });
  expect(result.violations.map((violation) => violation.nodes.map((node) => node.target))).toEqual([]);
  expect(result.incomplete).toEqual([]);
  expect(result.passes).toHaveLength(1);
});

test.each(WIDTHS)('erfüllt WCAG 2.5.8 (axe target-size) auf der Vokabularseite bei %i px', async (width) => {
  const container = await renderNamespacePage(width);
  const result = await axe.run(container, { runOnly: { type: 'rule', values: ['target-size'] } });
  expect(result.violations.map((violation) => violation.nodes.map((node) => node.target))).toEqual([]);
  expect(result.incomplete).toEqual([]);
  expect(result.passes).toHaveLength(1);
});

test.each(WIDTHS)('gibt dem Quellenlink der Vokabularseite bei %i px die Zielhöhe seines Bereichs', async (width) => {
  const container = await renderNamespacePage(width);
  const sourceLink = container.querySelector<HTMLAnchorElement>('a[target="_blank"]');
  expect(sourceLink?.textContent).toBe('documentation/namespaces/practices.csv');
  expect(sourceLink?.getBoundingClientRect().height).toBeGreaterThanOrEqual(width < 1024 ? 44 : 24);
});

test.each(WIDTHS.filter((width) => width < 1024))(
  'gibt Links und Labels bei %i px 44 px Höhe ohne Überlappung',
  async (width) => {
    const container = await renderSurfaces(width);
    const boxes = targets(container).map((element) => ({ element, box: element.getBoundingClientRect() }));
    expect(boxes.length).toBeGreaterThan(10);
    for (const { element, box } of boxes) {
      expect(box.height, element.textContent ?? '').toBeGreaterThanOrEqual(44);
      expect(box.width, element.textContent ?? '').toBeGreaterThanOrEqual(44);
    }
    for (const [index, first] of boxes.entries()) {
      for (const second of boxes.slice(index + 1)) {
        const overlaps = first.box.left < second.box.right - 0.5 && second.box.left < first.box.right - 0.5
          && first.box.top < second.box.bottom - 0.5 && second.box.top < first.box.bottom - 0.5;
        expect(overlaps, `${first.element.textContent} / ${second.element.textContent}`).toBe(false);
      }
    }
  },
);

test('löst Titel, Quelle und Label an den Rändern ihrer Fläche genau ihr eigenes Ziel aus', async () => {
  const container = await renderSurfaces(390);
  for (const element of targets(container)) {
    const box = element.getBoundingClientRect();
    element.scrollIntoView({ block: 'center' });
    const rect = element.getBoundingClientRect();
    const x = rect.left + Math.min(rect.width / 2, 20);
    for (const y of [rect.top + 1, rect.bottom - 1]) {
      const hit = document.elementFromPoint(x, y)?.closest('a[href], label');
      expect(hit, `${element.textContent} @ ${box.height}`).toBe(element);
    }
  }
});

test('erzeugt bei 200 % Standardschrift keinen horizontalen Überlauf', async () => {
  await commands.setBrowserFontSize(32);
  for (const width of [320, 390, 768, 1440]) {
    await renderSurfaces(width);
    expect(document.documentElement.scrollWidth, `${width} px`).toBeLessThanOrEqual(document.documentElement.clientWidth);
    root?.unmount();
    host?.remove();
  }
});
