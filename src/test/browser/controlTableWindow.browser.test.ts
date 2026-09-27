import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import type { Control } from '@/domain/models';
import { ControlTable } from '@/features/catalog/ControlTable';
// Wie in `main.tsx`: Ohne das Stylesheet lägen die Scrollleisten im Fluss
// und verlängerten den Scrollbereich um die Scrollposition.
import 'overlayscrollbars/overlayscrollbars.css';
import '@/index.css';

/*
 * Fensterung der Katalogtabelle mit echter Tabellengeometrie (GSPP-262).
 *
 * `useRowWindow.test.ts` gibt `getBoundingClientRect()` vor. Hier rendert
 * Chromium die Tabelle mit `border-collapse`, geladenen Schriften und den
 * Spalten des jeweiligen Breakpoints. Maßstab ist die Lage, die jede Zeile in
 * der vollständigen Liste hätte: Datenbeginn plus Index mal Zeilenabstand.
 * Misst die Fensterung einen falschen Abstand, verschieben sich die Zeilen
 * hinter einem Platzhalter oder das Fenster reicht nicht bis zum Rand. Geprüft
 * werden die Zustände der App: mit und ohne Auswahlspalte sowie mit einer per
 * Tastatur auf die letzte Zeile gesetzten Tab-Stopp-Zeile, die außerhalb des
 * Fensters gerendert bleibt und einen weiteren Platzhalter erzeugt.
 */

const ROW_COUNT = 400;
const SCROLLER_HEIGHT_PX = 480;
/* Halber Rand aus `border-collapse` plus Subpixel-Rundung. */
const TOLERANCE_PX = 1;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function makeControl(index: number): Control {
  return {
    id: `GC.${Math.floor(index / 10) + 1}.${(index % 10) + 1}`,
    title: `Kontrolle ${index} mit einem Titel, der auf eine Zeile gekürzt wird, weil er länger ist als die Spalte`,
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    taxonomy: [],
    threats: [],
    statement: '',
    statementRaw: '',
    guidance: '',
    statementProps: { zielobjektKategorien: [] },
    links: [],
    params: {},
    modalverb: 'MUSS',
    securityLevel: 'normal-SdT',
    effortLevel: '3',
  };
}

const controls = Array.from({ length: ROW_COUNT }, (_, index) => makeControl(index));
const controlsById = new Map(controls.map((control) => [control.id, control]));

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
  // Scroll-Event, ResizeObserver und die Nachmessung im Layout-Effekt.
  for (let frame = 0; frame < 4; frame++) await nextFrame();
}

interface Scenario {
  readonly label: string;
  readonly showSelection: boolean;
  readonly holdLastRow: boolean;
}

const SCENARIOS: readonly Scenario[] = [
  { label: 'ohne Auswahlspalte', showSelection: false, holdLastRow: false },
  { label: 'mit Auswahlspalte', showSelection: true, holdLastRow: false },
  { label: 'mit Auswahlspalte und Tab-Stopp auf der letzten Zeile', showSelection: true, holdLastRow: true },
];

const baseProps = {
  controls,
  controlsById,
  sort: [{ field: 'id' as const, direction: 'asc' as const }],
  onSortChange: () => {},
  onSelectControl: () => {},
};

async function renderTable({ showSelection, holdLastRow }: Scenario): Promise<HTMLElement> {
  host = document.createElement('div');
  host.style.display = 'flex';
  host.style.flexDirection = 'column';
  host.style.height = `${SCROLLER_HEIGHT_PX}px`;
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(showSelection
      ? createElement(ControlTable, { ...baseProps, checkedIds: new Set<string>(), onCheckedChange: () => {} })
      : createElement(ControlTable, { ...baseProps, showSelection: false }));
  });
  await document.fonts.ready;
  await settle();
  const scroller = host.firstElementChild as HTMLElement;
  if (holdLastRow) {
    // Wie in der App: Ende auf der fokussierten ersten Zeile setzt den Tab-Stopp.
    const firstRow = scroller.querySelector<HTMLElement>('tr[data-row-index="0"]')!;
    firstRow.focus();
    firstRow.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await settle();
    expect(document.activeElement?.getAttribute('data-row-index')).toBe(String(ROW_COUNT - 1));
  }
  return scroller;
}

function dataRows(scroller: HTMLElement): HTMLTableRowElement[] {
  return [...scroller.querySelectorAll<HTMLTableRowElement>('tbody tr[data-row-index]')];
}

function rowIndex(row: HTMLElement): number {
  return Number(row.dataset.rowIndex);
}

/** Abstand zweier aufeinanderfolgender Zeilen mitten in einem Lauf, ohne Platzhalter davor. */
function measuredPitch(rows: HTMLTableRowElement[]): number {
  const run = rows.filter((row, i) => i > 1 && rowIndex(rows[i - 1]) === rowIndex(row) - 1
    && rowIndex(rows[i - 2]) === rowIndex(row) - 2);
  expect(run.length).toBeGreaterThan(1);
  const [first, second] = run;
  return second.getBoundingClientRect().top - first.getBoundingClientRect().top;
}

async function expectWindowMatchesFullList(scroller: HTMLElement, scrollTop: number, scenario: Scenario) {
  scroller.scrollTop = scrollTop;
  await settle();

  const rows = dataRows(scroller);
  if (scenario.holdLastRow) {
    // Die Tab-Stopp-Zeile bleibt gerendert, auch weit außerhalb des Fensters.
    expect(rowIndex(rows.at(-1)!)).toBe(ROW_COUNT - 1);
  }
  expect(rows.some((row) => row.querySelector('input[type="checkbox"]') !== null)).toBe(scenario.showSelection);
  const pitch = measuredPitch(rows);
  const tbodyTop = scroller.querySelector('tbody')!.getBoundingClientRect().top;
  // Jede gerenderte Zeile steht dort, wo sie in der vollständigen Liste stünde.
  for (const row of rows) {
    expect(Math.abs(row.getBoundingClientRect().top - (tbodyTop + rowIndex(row) * pitch)))
      .toBeLessThanOrEqual(TOLERANCE_PX);
  }

  // Der sichtbare Datenbereich unter der Sticky-Kopfzeile ist lückenlos gefüllt.
  const viewport = scroller.getBoundingClientRect();
  const headerBottom = scroller.querySelector('thead')!.getBoundingClientRect().bottom;
  const visible = rows.filter((row) => {
    const box = row.getBoundingClientRect();
    return box.bottom > headerBottom && box.top < viewport.bottom;
  });
  const indices = visible.map(rowIndex);
  expect(indices).toEqual(indices.map((_, i) => indices[0] + i));
  expect(visible[0].getBoundingClientRect().top).toBeLessThanOrEqual(headerBottom + TOLERANCE_PX);
  const lastBottom = visible.at(-1)!.getBoundingClientRect().bottom;
  if (scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight) {
    // Am Ende steht die letzte Zeile der Liste vollständig im Bild.
    expect(rowIndex(visible.at(-1)!)).toBe(ROW_COUNT - 1);
    expect(lastBottom).toBeLessThanOrEqual(viewport.bottom + TOLERANCE_PX);
  } else {
    expect(lastBottom).toBeGreaterThanOrEqual(viewport.bottom - TOLERANCE_PX);
  }

  // Gesamthöhe wie bei der vollständigen Liste: Scrollleiste und Endposition stimmen.
  const theadHeight = scroller.querySelector('thead')!.getBoundingClientRect().height;
  expect(Math.abs(scroller.scrollHeight - (theadHeight + ROW_COUNT * pitch)))
    .toBeLessThanOrEqual(2 * TOLERANCE_PX);
}

for (const [label, width] of [['Desktop', 1280], ['unterhalb von sm', 600]] as const) {
  for (const scenario of SCENARIOS) {
    test(`fenstert die Tabelle ${label} (${width} px) ${scenario.label} deckungsgleich mit der vollständigen Liste`, async () => {
      await page.viewport(width, 800);
      const scroller = await renderTable(scenario);
      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight;

      for (const scrollTop of [0, 1234, Math.round(maxScrollTop / 2), maxScrollTop - 17, maxScrollTop]) {
        await expectWindowMatchesFullList(scroller, scrollTop, scenario);
      }
    });
  }
}
