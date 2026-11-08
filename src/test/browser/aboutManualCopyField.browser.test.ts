import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import type { Catalog } from '@/domain/models';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import { AboutPage } from '@/features/pages/AboutPage';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import '@/index.css';

/**
 * Das schreibgeschützte Prüfbefehlsfeld der About-Seite zeigt den langen Befehl
 * bei jeder Breite vollständig (GSPP-698): Die Höhe folgt dem Umbruch auch nach
 * einem Breitenwechsel, ohne innere Scrollleiste und ohne seitenweiten Überlauf.
 */

const catalog = {
  catalogKey: ENTRY_CATALOG_KEY,
  practices: [],
  metadata: {
    title: 'Testkatalog', lastModified: '2026-10-12', oscalVersion: '1.1.3',
    roles: [], parties: [], responsibleParties: [], props: [], links: [],
  },
} as unknown as Catalog;
const catalogState = {
  ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}),
  catalog,
  loading: false,
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
});

function renderAbout() {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(CatalogContext.Provider, { value: catalogState },
      createElement(MemoryRouter, null, createElement(AboutPage)),
    ));
  });
  return page.getByRole('textbox', { name: 'Prüfbefehl zum manuellen Kopieren' }).element() as HTMLTextAreaElement;
}

async function expectFullyVisible(field: HTMLTextAreaElement) {
  await expect.poll(() => field.scrollHeight - field.clientHeight).toBeLessThanOrEqual(0);
  expect(getComputedStyle(field).resize).toBe('none');
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth);
}

test('der Prüfbefehl bleibt bei schmal, breit und zurück vollständig sichtbar', async () => {
  await page.viewport(320, 800);
  const field = renderAbout();
  await document.fonts.ready;

  await expectFullyVisible(field);
  const narrowHeight = field.offsetHeight;

  await page.viewport(1280, 800);
  await expect.poll(() => field.offsetHeight).toBeLessThan(narrowHeight);
  await expectFullyVisible(field);

  await page.viewport(320, 800);
  await expect.poll(() => field.offsetHeight).toBe(narrowHeight);
  await expectFullyVisible(field);
});
