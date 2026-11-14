import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, inject, test } from 'vitest';
import { page } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildCatalogUrl, buildControlUrl, buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import '@/index.css';

declare module 'vitest' {
  export interface ProvidedContext {
    visualRegression: boolean;
  }
}

/*
 * Visuelle Regression (GSPP-533, GSPP-577, GSPP-616): Katalogliste, Detail, Filter, Suche,
 * Übersicht der Informationsverbünde und Verbund-Übersicht mit Stationskarten je
 * Desktop und Mobil gegen eingecheckte Referenzbilder
 * (`…-chromium-linux.png`). Erzeugt und geprüft werden sie nur im gepinnten
 * Playwright-Container (`npm run test:browser:visual`,
 * `npm run test:browser:update-references`), weil Chromium Schrift abhängig
 * von der Systemumgebung rastert; im übrigen Browserlauf bleibt die Datei aus.
 */

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobil', width: 390, height: 844 },
] as const;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;

afterEach(async () => {
  root?.unmount();
  router?.dispose();
  host?.remove();
  root = undefined;
  router = undefined;
  host = undefined;
  await resetWorkspace();
});

async function renderAt(path: string, width: number, height: number) {
  await page.viewport(width, height);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
      createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: router! })),
    ));
  });
  await expect.poll(() => router!.state.initialized).toBe(true);
  await expect.poll(() => host!.querySelector('main h1')).not.toBeNull();
  return host;
}

async function expectScreen(name: string) {
  await document.fonts.ready;
  await expect.element(page.elementLocator(document.body)).toMatchScreenshot(name, {
    screenshotOptions: { animations: 'disabled', caret: 'hide' },
  });
}

describe.skipIf(!inject('visualRegression')).each(VIEWPORTS)('Ansicht $name', ({ name, width, height }) => {
  test('Katalogliste', async () => {
    const shell = await renderAt(buildCatalogUrl(ENTRY_CATALOG_KEY), width, height);
    await expect.poll(() => shell.querySelector('main')?.textContent).toContain('Netz segmentieren');
    await expectScreen(`katalogliste-${name}`);
  });

  test('Detail', async () => {
    const shell = await renderAt(buildControlUrl(ENTRY_CATALOG_KEY, 'a11y-access'), width, height);
    await expect.poll(() => shell.querySelector('[data-control-detail-title]')?.textContent)
      .toContain('Zugriff schützen');
    await expectScreen(`detail-${name}`);
  });

  test('Filter', async () => {
    const shell = await renderAt(`${buildCatalogUrl(ENTRY_CATALOG_KEY)}?el=2`, width, height);
    await expect.poll(() => shell.querySelector('main')?.textContent).toContain('Zugriff schützen');
    if (name === 'mobil') {
      await page.getByRole('button', { name: /^Filter anzeigen/ }).click();
      await expect.poll(() => document.querySelector('dialog[open]')?.checkVisibility()).toBe(true);
    }
    await expectScreen(`filter-${name}`);
  });

  test('Informationsverbünde', async () => {
    await seedWorkspace();
    const shell = await renderAt(buildWorkspaceIndexUrl(), width, height);
    await expect.poll(() => shell.querySelector('main')?.textContent).toContain('2 Informationsverbünde');
    // Mobil ist die Übersicht höher als der Viewport; wie bei der Verbund-Übersicht wächst er auf die Dokumenthöhe.
    await page.viewport(width, Math.max(height, document.documentElement.scrollHeight));
    await expectScreen(`informationsverbuende-${name}`);
  });

  test('Informationsverbund', async () => {
    const { verbundId, profile, assessmentResults } = await seedWorkspace();
    const catalog = await readStore(store => store.addDocument(verbundId, {
      source: makeSchemaValidOscalDocument('catalog', '1.2.2'), rootType: 'catalog', oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' },
    }));
    const profileSource = structuredClone(profile.source) as { profile: { imports: { href: string }[] } };
    profileSource.profile.imports[0].href = 'catalog.json';
    const localProfile = await readStore(store => store.replaceDocument(profile.localId, profile.savedAt, null, {
      source: profileSource, rootType: 'profile', oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' },
    }));
    await readStore(store => store.setBinding({ fromLocalId: profile.localId, pointer: '/profile/imports/0/href', href: 'catalog.json', target: { kind: 'local', localId: catalog.localId } }, localProfile.savedAt));
    const results = structuredClone(assessmentResults.source) as { 'assessment-results': { results: { findings?: unknown[] }[] } };
    results['assessment-results'].results[0].findings = [
      { target: { status: { state: 'satisfied' } } },
      { target: { status: { state: 'not-satisfied' } } },
      { target: {} },
    ];
    await readStore(store => store.replaceDocument(assessmentResults.localId, assessmentResults.savedAt, null, {
      source: results, rootType: 'assessment-results', oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' },
    }));
    const shell = await renderAt(buildVerbundUrl(verbundId), width, height);
    await expect.poll(() => shell.querySelector('main')?.textContent).toContain('Prüfergebnisse');
    await expect.poll(() => shell.querySelector('main')?.textContent).toContain('1 von 1 aufgenommen');
    await expect.poll(() => shell.querySelector('main')?.textContent).toContain('1 von 1 dokumentiert');
    await expect.poll(() => shell.querySelector('main')?.textContent).toContain('3 Findings · 1 nicht erfüllt · 1 ohne auswertbaren Status');
    await expect.poll(() => shell.querySelector('nav[aria-label="Stationen"] a')?.textContent).toBe('Übersicht');
    // Chromium malt ein Element-Bildschirmfoto nur im Viewport; mobil scrollt das Dokument,
    // daher wächst der Viewport auf die Dokumenthöhe, damit alle fünf Karten im Bild liegen.
    await page.viewport(width, Math.max(height, document.documentElement.scrollHeight));
    await expectScreen(`informationsverbund-${name}`);
  });

  test('Suche', async () => {
    const shell = await renderAt('/suche?q=Zugriff', width, height);
    await expect.poll(() => shell.querySelector('[data-testid^="search-results-"]')?.textContent)
      .toContain('Zugriff schützen');
    await expectScreen(`suche-${name}`);
  });
});
