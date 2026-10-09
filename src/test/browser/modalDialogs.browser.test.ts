import axe from 'axe-core';
import { createElement, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import type { Catalog, Control } from '@/domain/models';
import { emptyFilters } from '@/hooks/useFilteredControls';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';
import {
  filterPanelFacetCounts,
  makeFilterPanelCatalogState,
} from '@/test/fixtures/filterPanel';
import { CatalogMobileDetailOverlay } from '@/features/catalog/CatalogDetailPanel';
import { CatalogMobileExportSheet } from '@/features/catalog/CatalogMobileExportSheet';
import { CatalogMobileFilterSheet } from '@/features/catalog/CatalogMobileFilterSheet';
import '@/index.css';

/**
 * Filter-Sheet, Export-Sheet und Tablet-Detail als modale Dialoge (GSPP-503):
 * Rolle, Name und modaler Zustand, inerter Hintergrund, Tab-Umlauf, Escape
 * und Fokus-Rückkehr in Chromium sowie axe ohne Verstöße am offenen Dialog.
 * Das Detail ersetzt `ControlDetail` durch Überschrift und Schließaktion, weil
 * hier nur der Dialograhmen geprüft wird.
 */

const vocabularyRegistry = createTestVocabularyRegistry();

vi.mock('@/hooks/useCatalog', () => ({
  useCatalog: () => makeFilterPanelCatalogState(vocabularyRegistry),
}));

vi.mock('@/features/catalog/ControlDetail', async () => {
  const { createElement: h, Fragment } = await import('react');
  return {
    ControlDetail: (props: { control: Control; onClose: () => void; titleId?: string }) => h(
      Fragment,
      null,
      h('button', { type: 'button', onClick: props.onClose }, 'Zurück zur Übersicht'),
      h('h2', { id: props.titleId }, props.control.title),
      h('a', { href: '#verweis' }, 'Verknüpfte Kontrolle'),
    ),
  };
});

const control = { id: 'TOP.1.1', title: 'Testkontrolle', links: [] } as unknown as Control;
const catalog = {
  catalogKey: 'gspp',
  controls: [control],
  controlsById: new Map([[control.id, control]]),
} as unknown as Catalog;

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function renderSurface(surface: ReactNode) {
  flushSync(() => {
    root?.render(createElement(MemoryRouter, null,
      createElement('button', { type: 'button' }, 'Suche im App-Kopf'),
      surface,
      createElement('a', { href: '#impressum' }, 'Impressum'),
    ));
  });
}

/** Rendert die Oberfläche mit Hintergrund: App-Kopf-Button vorn, Fußlink hinten. */
async function renderWithBackground(width: number, surface: ReactNode) {
  await page.viewport(width, 800);
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  renderSurface(surface);
  await document.fonts.ready;
  return host;
}

function buttonByName(scope: ParentNode, name: string) {
  return [...scope.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => (button.getAttribute('aria-label') ?? button.textContent?.trim()) === name)!;
}

function dialogName(dialog: Element) {
  return document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent?.trim();
}

async function expectNoAxeViolations(dialog: Element) {
  const result = await axe.run(dialog.parentElement!, { resultTypes: ['violations'] });
  expect(result.violations.map(({ id, nodes }) => `${id}: ${nodes.length}`)).toEqual([]);
}

/** Tab und Shift+Tab bleiben im Dialog, auch über beide Enden hinweg. */
async function expectTabStaysInside(dialog: Element) {
  const stops = dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled])').length;
  for (let index = 0; index <= stops; index += 1) {
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  for (let index = 0; index <= stops; index += 1) {
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
}

test('Filter-Sheet: benannter modaler Dialog, inerter Hintergrund, Escape gibt Fokus zurück', async () => {
  const shell = await renderWithBackground(402, createElement(CatalogMobileFilterSheet, {
    filterPanelProps: {
      filters: emptyFilters,
      facetCounts: filterPanelFacetCounts,
      filteredFacetCounts: filterPanelFacetCounts,
      hasActiveFilters: false,
      filteredCount: 3,
      totalCount: 3,
      onFiltersChange: () => {},
      onClearFilters: () => {},
    },
  }));
  const trigger = buttonByName(shell, 'Filter anzeigen');

  trigger.focus();
  await userEvent.keyboard('{Enter}');

  await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialogName(dialog)).toBe('Filter');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(shell.hasAttribute('inert')).toBe(true);
  expect(dialog.closest('[inert]')).toBeNull();
  expect(dialog.contains(document.activeElement)).toBe(true);

  await expectTabStaysInside(dialog);
  await expectNoAxeViolations(dialog);

  await userEvent.keyboard('{Escape}');

  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(trigger);
  expect(document.documentElement.style.overflow).toBe('');
});

test('Export-Sheet: benannter modaler Dialog, „Schließen“ gibt Fokus zurück', async () => {
  const shell = await renderWithBackground(402, createElement(CatalogMobileExportSheet, {
    checkedIds: new Set<string>(),
    filteredControls: [control],
    allControls: [control],
    sectionFilename: 'test.csv',
  }));
  const trigger = buttonByName(shell, 'CSV exportieren');

  trigger.focus();
  await userEvent.keyboard('{Enter}');

  await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialogName(dialog)).toBe('Exportieren als CSV');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(shell.hasAttribute('inert')).toBe(true);

  await expectTabStaysInside(dialog);
  await expectNoAxeViolations(dialog);

  buttonByName(dialog, 'Schließen').click();

  await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

test('Tablet-Detail: benannter modaler Dialog, Rückkehr zur auslösenden Zeile', async () => {
  function overlay(active: boolean) {
    return createElement(
      'div',
      null,
      createElement('button', { type: 'button', 'data-control-row': '' }, 'Zeile TOP.1.1'),
      createElement(CatalogMobileDetailOverlay, {
        catalog,
        control,
        active,
        onClose: () => {},
        onNavigateToControl: () => {},
      }),
    );
  }
  const shell = await renderWithBackground(900, overlay(false));
  const row = buttonByName(shell, 'Zeile TOP.1.1');
  row.focus();

  renderSurface(overlay(true));

  await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialogName(dialog)).toBe('Testkontrolle');
  expect(dialog.getAttribute('aria-modal')).toBe('true');
  expect(shell.hasAttribute('inert')).toBe(true);
  expect(dialog.getBoundingClientRect().width).toBe(900);

  await expectTabStaysInside(dialog);
  await expectNoAxeViolations(dialog);

  renderSurface(overlay(false));

  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(shell.hasAttribute('inert')).toBe(false);
  expect(document.activeElement).toBe(row);
});
