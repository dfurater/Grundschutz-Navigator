import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { buildControlUrl, CONTROL_ROUTE_PATTERN } from '@/app/routes';
import { Tooltip } from '@/components/Tooltip';
import type { Catalog, CatalogState, Control } from '@/domain/models';
import { CatalogBrowser } from '@/features/catalog/CatalogBrowser';
import { CatalogContext } from '@/state/CatalogContext';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import '@/index.css';

/*
 * Geöffneter Tooltip im schmaler gezogenen Detail-Panel (Greptile-Befunde in
 * den PRs #307 und #308).
 *
 * Ziehen am Panelrand ändert die Breite ohne Fenster- oder Scrollereignis,
 * und `useDragToResize` verhindert beim Mousedown den Fokuswechsel: Ein per
 * Tastatur geöffneter Tooltip bleibt offen. Der erste Test verengt ein Panel
 * direkt und prüft die Geometrie: Chromium bricht den Tooltip wirklich um,
 * und nach dem Verengen muss er innerhalb der neuen Panelkante stehen. Der
 * zweite rendert den Katalog-Browser und zieht mit echter Maus am Handle, damit
 * auch die Verbindung von Handle, `useDragToResize` und Panel abgesichert ist.
 *
 * Zwei weitere Tests öffnen in einem niedrigen Panel einen Tooltip, der weder
 * unter noch über seinen Auslöser passt (Greptile-Befunde in den PRs #313 und
 * #314): Er darf den Auslöser nicht verdecken, damit dieser antippbar bleibt,
 * und sein begrenzter Inhalt muss sich zu Ende scrollen lassen: Das Scrollen
 * im Tooltip löst keine Nachmessung aus, und eine Nachmessung beim Scrollen
 * des Panels behält die Scrollposition.
 */

const EDGE_GAP_PX = 8;
const NARROW_PANEL_PX = 320;
/* Subpixel-Rundung. */
const TOLERANCE_PX = 1;
const TOOLTIP_SCROLL_PX = 40;
const EXPLANATION = 'Eine lange Erklärung, die breiter ist als das verengte Panel und deshalb umbrechen muss, '
  + 'damit sie vollständig lesbar bleibt.';

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settle(): Promise<void> {
  // Größenänderung, ResizeObserver und die Nachmessung.
  for (let frame = 0; frame < 4; frame++) await nextFrame();
}

function mount(element: Parameters<Root['render']>[0]): HTMLDivElement {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(element);
  });
  return host;
}

function expectInsidePanel(tooltip: HTMLElement, area: Element) {
  const box = tooltip.getBoundingClientRect();
  const bounds = area.getBoundingClientRect();
  expect(box.left).toBeGreaterThanOrEqual(bounds.left + EDGE_GAP_PX - TOLERANCE_PX);
  expect(box.right).toBeLessThanOrEqual(bounds.right - EDGE_GAP_PX + TOLERANCE_PX);
}

test('hält einen per Tastatur geöffneten Tooltip nach dem Verengen des Panels innerhalb der Panelkante', async () => {
  await page.viewport(1280, 800);
  const panel = mount(createElement('p', null, createElement(Tooltip, {
    idPrefix: 'tt-panel',
    content: EXPLANATION,
    // Ohne Umbruch bleibt der Auslöser breit, und mit ihm der Tooltip darunter.
    describeTarget: (id: string) => createElement('button', {
      type: 'button', 'aria-describedby': id, style: { whiteSpace: 'nowrap' },
    }, 'Begriffsbestimmung mit einer ungewöhnlich langen Bezeichnung'),
  })));
  panel.dataset.controlDetailScroll = '';
  panel.style.width = '720px';
  panel.style.height = '400px';
  panel.style.overflowY = 'auto';
  await document.fonts.ready;

  const trigger = panel.querySelector('button')!;
  trigger.focus();
  await settle();
  const tooltip = panel.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tooltip.hidden).toBe(false);
  expectInsidePanel(tooltip, panel);
  // Breiter als das verengte Panel: Ohne Nachmessung ragte er über dessen Kante.
  expect(tooltip.getBoundingClientRect().width).toBeGreaterThan(NARROW_PANEL_PX - 2 * EDGE_GAP_PX);

  panel.style.width = `${NARROW_PANEL_PX}px`;
  await settle();

  expect(document.activeElement).toBe(trigger);
  expect(tooltip.hidden).toBe(false);
  expectInsidePanel(tooltip, panel);
});

/** Öffnet per Fokus einen Tooltip, der im niedrigen, scrollbaren Panel auf keine Seite ganz passt. */
async function openInLowPanel(idPrefix: string) {
  await page.viewport(1280, 800);
  // Innenabstand unten: Das Panel selbst lässt sich scrollen.
  const panel = mount(createElement('p', { style: { paddingTop: '90px', paddingBottom: '400px' } }, createElement(Tooltip, {
    idPrefix,
    content: Array.from({ length: 6 }, () => EXPLANATION).join(' '),
    describeTarget: (id: string) => createElement('button', { type: 'button', 'aria-describedby': id }, 'Begriff'),
  })));
  panel.dataset.controlDetailScroll = '';
  panel.style.width = `${NARROW_PANEL_PX}px`;
  panel.style.height = '180px';
  panel.style.overflowY = 'auto';
  await document.fonts.ready;

  const trigger = panel.querySelector('button')!;
  trigger.focus();
  await settle();
  const tooltip = panel.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(tooltip.hidden).toBe(false);
  // Natürlich höher als der Platz auf jeder Seite des Auslösers.
  expect(tooltip.scrollHeight).toBeGreaterThan(panel.clientHeight / 2);
  return { panel, trigger, tooltip };
}

test('verdeckt den Auslöser nicht, wenn der Tooltip in einem niedrigen Panel auf keine Seite ganz passt', async () => {
  const { panel, trigger, tooltip } = await openInLowPanel('tt-low-panel');

  const box = tooltip.getBoundingClientRect();
  const target = trigger.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  expect(box.bottom <= target.top + TOLERANCE_PX || box.top >= target.bottom - TOLERANCE_PX).toBe(true);
  expect(box.top).toBeGreaterThanOrEqual(bounds.top + EDGE_GAP_PX - TOLERANCE_PX);
  expect(box.bottom).toBeLessThanOrEqual(bounds.bottom - EDGE_GAP_PX + TOLERANCE_PX);
  expect(document.elementFromPoint(target.left + target.width / 2, target.top + target.height / 2)).toBe(trigger);
});

/** Beobachtet Nachmessungen: Jede schreibt das style-Attribut des Tooltips neu. Liefert das Zählen. */
function watchRemeasures(tooltip: HTMLElement): () => number {
  const records: MutationRecord[] = [];
  const observer = new MutationObserver((batch) => records.push(...batch));
  observer.observe(tooltip, { attributes: true, attributeFilter: ['style'] });
  return () => {
    records.push(...observer.takeRecords());
    observer.disconnect();
    return records.length;
  };
}

test('misst beim Scrollen im begrenzten Tooltip nicht neu und behält seine Scrollposition beim Scrollen des Panels', async () => {
  const { panel, tooltip } = await openInLowPanel('tt-low-scroll');
  expect(tooltip.scrollHeight).toBeGreaterThan(tooltip.clientHeight + TOOLTIP_SCROLL_PX);

  // Scrollen im Tooltip verschiebt weder Auslöser noch sichtbaren Bereich.
  const remeasures = watchRemeasures(tooltip);
  tooltip.scrollTop = TOOLTIP_SCROLL_PX;
  await settle();
  expect(remeasures()).toBe(0);
  expect(tooltip.scrollTop).toBeCloseTo(TOOLTIP_SCROLL_PX, 0);

  // Das Panel scrollt: Der Tooltip misst neu, sein Inhalt bleibt, wo er war.
  const transformBefore = tooltip.style.transform;
  const panelRemeasures = watchRemeasures(tooltip);
  panel.scrollTop = 4;
  await settle();
  expect(panelRemeasures()).toBeGreaterThan(0);
  expect(tooltip.style.transform).not.toBe(transformBefore);
  expect(tooltip.scrollTop).toBeCloseTo(TOOLTIP_SCROLL_PX, 0);
});

const CONTROL: Control = {
  id: 'GC.1.1',
  altIdentifier: 'gc-1-1',
  title: 'Verfahren dokumentieren',
  groupId: 'GC.1',
  practiceId: 'GC',
  tags: [],
  taxonomy: [],
  threats: [],
  statement: 'Die Institution MUSS ihre Verfahren fristgerecht dokumentieren.',
  statementRaw: 'Die Institution MUSS ihre Verfahren fristgerecht dokumentieren.',
  guidance: '',
  statementProps: { praezisierung: 'fristgerecht', zielobjektKategorien: [] },
  links: [],
  params: {},
  modalverb: 'MUSS',
};

function catalogState(): CatalogState {
  const catalog: Catalog = {
    catalogKey: 'gspp',
    uuid: 'test-catalog',
    metadata: {
      title: 'Testkatalog',
      lastModified: '2026-09-27T00:00:00Z',
      version: 'test',
      oscalVersion: '1.1.3',
      props: [],
      links: [],
      roles: [],
      parties: [],
      responsibleParties: [],
    },
    practices: [],
    controlsById: new Map([[CONTROL.id, CONTROL]]),
    controlsByAltIdentifier: new Map([[CONTROL.altIdentifier!, CONTROL]]),
    controls: [CONTROL],
    backMatter: [],
    totalControls: 1,
  };
  return {
    ...catalogCollectionDefaults(),
    catalogDocument: null,
    catalog,
    provenance: null,
    verification: null,
    vocabularyRegistry: createTestVocabularyRegistry(),
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}

test('hält den Tooltip beim Ziehen am Handle des Katalog-Browsers offen und innerhalb der neuen Panelkante', async () => {
  await page.viewport(1280, 800);
  const app = mount(createElement(CatalogContext.Provider, { value: catalogState() },
    createElement(MemoryRouter, { initialEntries: [buildControlUrl('gspp', CONTROL.altIdentifier!)] },
      createElement(Routes, null,
        createElement(Route, { path: CONTROL_ROUTE_PATTERN, element: createElement(CatalogBrowser) })))));
  app.style.display = 'flex';
  app.style.height = '800px';
  await document.fonts.ready;
  await settle();

  const panel = app.querySelector('[data-control-detail-scroll]')!;
  const sidebar = panel.closest('aside')!;
  const startWidth = sidebar.getBoundingClientRect().width;
  expect(startWidth).toBeGreaterThan(NARROW_PANEL_PX);

  // Präzisierung ohne Vokabeleintrag: eigenes Fokusziel mit Hover-Tooltip.
  const clause = panel.querySelector<HTMLElement>('[tabindex="0"][aria-describedby]')!;
  expect(clause).toHaveTextContent('fristgerecht');
  clause.focus();
  await settle();
  const tooltip = document.getElementById(clause.getAttribute('aria-describedby')!)!;
  expect(tooltip.hidden).toBe(false);

  // Echte Maus: Mousedown am Handle, Bewegung nach rechts verengt das Panel.
  const narrowBy = startWidth - NARROW_PANEL_PX;
  await userEvent.dragAndDrop(page.getByRole('button', { name: 'Panelbreite anpassen' }), sidebar, {
    sourcePosition: { x: 3, y: 100 },
    targetPosition: { x: 3 + narrowBy, y: 100 },
  });
  await settle();

  expect(sidebar.getBoundingClientRect().width).toBeCloseTo(NARROW_PANEL_PX, 0);
  expect(document.activeElement).toBe(clause);
  expect(tooltip.hidden).toBe(false);
  expectInsidePanel(tooltip, panel);
});
