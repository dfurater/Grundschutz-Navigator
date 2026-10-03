import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import type { Control } from '@/domain/models';
import type { FilterPanelProps } from '@/features/catalog/FilterPanel';
import { CatalogToolbar } from '@/features/catalog/CatalogToolbar';
import '@/index.css';

/*
 * Geometrie des mobilen Katalog-Headers (GSPP-471) mit echten Media Queries,
 * Schriften und Silbentrennung in Chromium. `CatalogToolbar.mobileHeader.test.tsx`
 * prüft nur Klassen; hier wird gemessen, was davon im Browser ankommt.
 */

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

const control = { id: 'TOP.1.1', title: 'Testkontrolle' } as Control;

async function renderToolbar(
  width: number,
  title: string,
  hasActiveFilters = false,
  checkedIds: ReadonlySet<string> = new Set<string>(),
) {
  await page.viewport(width, 800);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(CatalogToolbar, {
      title,
      filteredCount: hasActiveFilters ? 31 : 35,
      totalCount: 35,
      hasActiveFilters,
      onClearFilters: () => {},
      checkedIds,
      mobileSelectMode: false,
      onToggleMobileSelectMode: () => {},
      onClearSelection: () => {},
      filteredControls: [control],
      allControls: [control],
      sectionFilename: 'grundschutz-TOP.1.csv',
      filterPanelProps: {} as FilterPanelProps,
      isDesktop: false,
    }));
  });
  await document.fonts.ready;
  const heading = host.querySelector('h1')!;
  const toolbar = heading.closest('.sticky')!;
  const actions = ['Kontrollen auswählen', 'Filter anzeigen', 'CSV exportieren'].map(
    (name) => host!.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!,
  );
  return { heading, toolbar, actions };
}

const lineHeight = 18 * 1.35;
const isFullyVisible = (element: Element) => element.scrollHeight <= element.clientHeight + 1;

for (const width of [360, 375, 390, 430]) {
  test.each([
    ['Sicherheitsvorfallsbehandlung', 1],
    ['Betriebsumgebung und Sensibilisierung', null],
    ['Auswahl von Produkten und Dienstleistungen - Zusammenarbeit', 2],
  ])(`zeigt „%s“ bei ${width} px vollständig`, async (title, lines) => {
    const { heading, toolbar } = await renderToolbar(width, title);

    expect(isFullyVisible(heading)).toBe(true);
    const renderedLines = Math.round(heading.clientHeight / lineHeight);
    if (lines !== null) expect(renderedLines).toBe(lines);
    // Einzeilig höchstens so hoch wie vorher (79 px), zweizeilig die gewollte Mehrhöhe.
    const height = toolbar.getBoundingClientRect().height;
    expect(height).toBeLessThanOrEqual(renderedLines === 1 ? 79 : 103);
  });

  test(`setzt Auswahl, Filter und CSV bei ${width} px als gleich große Schalter an den Rand`, async () => {
    const { actions } = await renderToolbar(width, 'Governance und Compliance');

    for (const action of actions) {
      const box = action.getBoundingClientRect();
      expect([box.width, box.height]).toEqual([44, 44]);
    }
    const last = actions.at(-1)!;
    expect(last.getBoundingClientRect().right).toBe(width);
    // Glyphenbox höchstens 2 px innerhalb des 12-px-Seitenrands der Liste.
    const glyphGap = width - last.querySelector('svg')!.getBoundingClientRect().right;
    expect(glyphGap).toBeGreaterThanOrEqual(12);
    expect(glyphGap).toBeLessThanOrEqual(14);
  });
}

test('kürzt einen Namen mit mehr als zwei Zeilen sauber', async () => {
  const { heading } = await renderToolbar(
    360,
    'Informationssicherheitsmanagementsystemverwaltungsvorschriften und Ergänzungsdokumentation mit sehr viel mehr Text',
  );

  expect(Math.round(heading.clientHeight / lineHeight)).toBe(2);
  expect(isFullyVisible(heading)).toBe(false);
});

test('hält Anzahl, „Filter zurücksetzen“ und Aktionen bei 360 px in einer Zeile', async () => {
  const { heading, toolbar, actions } = await renderToolbar(360, 'Governance und Compliance', true);
  const reset = host!.querySelector('button[aria-label="Filter zurücksetzen"]')!;

  const resetBox = reset.getBoundingClientRect();
  expect(resetBox.top).toBeGreaterThan(heading.getBoundingClientRect().bottom);
  expect(resetBox.right).toBeLessThanOrEqual(actions[0].getBoundingClientRect().left);
  expect(Math.abs(resetBox.top + resetBox.height / 2 - (actions[0].getBoundingClientRect().top + 22)))
    .toBeLessThanOrEqual(1);
  expect(toolbar.getBoundingClientRect().height).toBeLessThanOrEqual(79);
});

test('lässt die Aktionen bei sehr schmaler Breite umbrechen, statt „Filter zurücksetzen“ zu überdecken', async () => {
  const { actions } = await renderToolbar(200, 'Governance und Compliance', true);
  const reset = host!.querySelector('button[aria-label="Filter zurücksetzen"]')!.getBoundingClientRect();

  for (const action of actions) {
    const box = action.getBoundingClientRect();
    const overlaps = box.left < reset.right && reset.left < box.right
      && box.top < reset.bottom && reset.top < box.bottom;
    expect(overlaps).toBe(false);
  }
  expect(actions.at(-1)!.getBoundingClientRect().right).toBe(200);
});

test.each([
  ['ab sm', 700, 57],
  ['ab md', 800, 51],
])('behält %s die einzeilige Toolbar (%i px)', async (_label, width, height) => {
  const { heading, toolbar, actions } = await renderToolbar(width, 'Governance und Compliance');

  expect(toolbar.getBoundingClientRect().height).toBe(height);
  const headingBox = heading.getBoundingClientRect();
  expect(getComputedStyle(heading).whiteSpace).toBe('nowrap');
  expect(Math.abs(actions[0].getBoundingClientRect().top + 22 - (headingBox.top + headingBox.height / 2)))
    .toBeLessThanOrEqual(2);
});

test.each([
  ['ohne Filter', false],
  ['mit aktivem Filter', true],
])('zeigt eine erhaltene Auswahl ohne Auswahlmodus bei 360 px sichtbar und aufhebbar (%s)', async (_label, hasActiveFilters) => {
  const { actions } = await renderToolbar(360, 'Governance und Compliance', hasActiveFilters, new Set([control.id]));
  const clear = host!.querySelector<HTMLButtonElement>('button[aria-label="Auswahl aufheben"]')!;
  const chip = clear.parentElement!;

  expect(chip.checkVisibility()).toBe(true);
  expect(chip).toHaveTextContent('1 ausgewählt');
  const chipBox = chip.getBoundingClientRect();
  const visible = [...host!.querySelectorAll('button')].filter((button) => button.checkVisibility());
  for (const button of visible) {
    if (chip.contains(button)) continue;
    const box = button.getBoundingClientRect();
    const overlaps = box.left < chipBox.right && chipBox.left < box.right
      && box.top < chipBox.bottom && chipBox.top < box.bottom;
    expect(overlaps).toBe(false);
  }
  expect(actions.at(-1)!.getBoundingClientRect().right).toBe(360);
  expect(chipBox.right).toBeLessThanOrEqual(360);
});
