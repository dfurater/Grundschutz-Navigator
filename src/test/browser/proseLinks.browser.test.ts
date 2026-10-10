import axe from 'axe-core';
import { createElement, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import type { Catalog } from '@/domain/models';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import { CatalogTargetNotFound } from '@/features/catalog/CatalogTargetNotFound';
import { HomePage } from '@/features/home/HomePage';
import { DatenschutzPage } from '@/features/pages/DatenschutzPage';
import { ImpressumPage } from '@/features/pages/ImpressumPage';
import { LizenzenPage } from '@/features/pages/LizenzenPage';
import { CatalogContext } from '@/state/CatalogContext';
import { createInitialState, projectPublicState } from '@/state/catalogReducer';
import '@/index.css';
import { appShellAt } from './appShellRouter';

/**
 * Links mitten im Fließtext sind auch ohne Farbwahrnehmung als Links erkennbar
 * (WCAG 1.4.1, GSPP-502): axe `link-in-text-block` an den echten Chromium-Stilen
 * und dauerhafte Unterstreichung im Ruhe-, Hover- und Fokuszustand.
 */

const catalog = { catalogKey: ENTRY_CATALOG_KEY, practices: [] } as unknown as Catalog;
const catalogState = {
  ...projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}),
  catalog,
  loading: false,
};

let root: Root | undefined;
let host: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubEnv('VITE_IMPRESSUM_NAME', 'Erika Mustermann');
  vi.stubEnv('VITE_IMPRESSUM_STRASSE', 'Musterstraße 1');
  vi.stubEnv('VITE_IMPRESSUM_PLZ_ORT', '12345 Musterstadt');
  vi.stubEnv('VITE_IMPRESSUM_EMAIL', 'kontakt@example.com');
});

afterEach(() => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  vi.unstubAllEnvs();
});

/** `route === null`: Das Element bringt seinen Router selbst mit (Shell im Data-Router). */
function render(element: ReactElement, route: string | null = '/') {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(CatalogContext.Provider, { value: catalogState },
      route === null ? element : createElement(MemoryRouter, { initialEntries: [route] }, element),
    ));
  });
  return host;
}

const surfaces: ReadonlyArray<readonly [string, () => ReactElement, string | null, readonly string[]]> = [
  ['Startseite', () => createElement(HomePage), '/', ['Über das Projekt']],
  ['Datenschutz', () => createElement(DatenschutzPage), '/', ['kontakt@example.com', 'GitHub Privacy Statement', 'Data Privacy Framework']],
  ['Impressum', () => createElement(ImpressumPage), '/', ['kontakt@example.com']],
  ['Lizenzen', () => createElement(LizenzenPage), '/', ['Stand-der-Technik-Bibliothek', 'dfurater/Grundschutz-Navigator']],
  ['Katalogziel nicht gefunden', () => createElement(CatalogTargetNotFound, { catalog }), '/', ['Zum Katalog']],
  ['Seite nicht gefunden', () => appShellAt('/gibt-es-nicht'), null, ['Zur Startseite']],
];

function proseLinks(container: HTMLElement, names: readonly string[]) {
  return names.map((name) => {
    const link = [...container.querySelectorAll<HTMLAnchorElement>('a')]
      .find((candidate) => candidate.textContent?.trim().startsWith(name));
    expect(link, name).toBeDefined();
    return link!;
  });
}

test.each(surfaces)('%s: axe meldet keinen link-in-text-block-Verstoß', async (_name, element, route, names) => {
  const container = render(element(), route);
  expect(proseLinks(container, names)).toHaveLength(names.length);
  const result = await axe.run(container, { runOnly: { type: 'rule', values: ['link-in-text-block'] } });
  expect(result.violations).toEqual([]);
});

test.each(surfaces)('%s: Fließtextlinks bleiben in Ruhe, Hover und Fokus unterstrichen', async (_name, element, route, names) => {
  const container = render(element(), route);
  for (const link of proseLinks(container, names)) {
    // Die Unterstreichung endet am letzten sichtbaren Zeichen, nicht an einem Leerzeichen im Link.
    const visibleText = [...link.childNodes]
      .filter((node) => !(node instanceof HTMLElement && node.classList.contains('sr-only')))
      .map((node) => node.textContent).join('');
    expect(visibleText, `${link.textContent}: sichtbarer Linktext`).toBe(visibleText.trim());
    expect(getComputedStyle(link).textDecorationLine, `${link.textContent} in Ruhe`).toBe('underline');
    await userEvent.hover(link);
    expect(getComputedStyle(link).textDecorationLine, `${link.textContent} bei Hover`).toBe('underline');
    await userEvent.unhover(link);
    link.focus();
    expect(getComputedStyle(link).textDecorationLine, `${link.textContent} im Fokus`).toBe('underline');
    link.blur();
  }
});
