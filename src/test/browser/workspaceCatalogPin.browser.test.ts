import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test } from 'vitest';
import { page } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import type { CatalogState, LoadedCatalogState } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { readCatalogPins } from '@/domain/workspaceCatalogPin';
import type { LocalId } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { storedValuesAndIndexKeys } from '@/test/browser/workspaceStoreFixtures';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { resetWorkspace, seedWorkspace, value } from '@/test/workspaceAreaFixture';
import '@/index.css';

/*
 * Katalogstand-Bindung in Chromium (GSPP-362): Die echte IndexedDB hält nach
 * der Profil-Neuanlage nur das Referenzpaar, keine Katalogbytes; ein späterer
 * anderer Auslieferungsstand sperrt das Profil, ohne den Speicher zu ändern.
 * Der globale Egress-Wächter der Browser-Suite bricht bei jedem Netzzugriff ab.
 */

const CATALOG_SENTINEL = 'KATALOG_KLASSE1_SENTINEL';
const DELIVERED = 'd'.repeat(40);
const LATER = 'e'.repeat(40);

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

function catalogState(sourceCommit: string): CatalogState {
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  (source.catalog as { metadata: { title: string } }).metadata.title = CATALOG_SENTINEL;
  const loaded = { catalogKey: 'gspp', catalogDocument: { source }, verification: { valid: true, sourceCommit } } as unknown as LoadedCatalogState;
  return { ...createA11yCatalogState(), catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp', loaded]]) };
}

async function renderAt(path: string, catalogs: CatalogState) {
  await page.viewport(1440, 900);
  const current = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  router = current;
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: catalogs },
      createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: current }))));
  });
  await expect.poll(() => current.state.initialized).toBe(true);
  return { shell: host, router: current };
}

function button(shell: HTMLElement, text: string): HTMLButtonElement | undefined {
  return [...shell.querySelectorAll('button')].find((candidate) => candidate.textContent === text);
}

test('eine Profil-Neuanlage speichert nur das Referenzpaar; ein späterer Stand sperrt ohne Schreibzugriff', async () => {
  const seeded = await seedWorkspace();
  const { shell, router: current } = await renderAt(buildStationUrl(seeded.verbundId, 'profile'), catalogState(DELIVERED));
  await expect.poll(() => button(shell, 'Neues Profil')).toBeTruthy();
  button(shell, 'Neues Profil')!.click();
  await expect.poll(() => shell.querySelector('form input[autocomplete="off"]')).toBeTruthy();
  const titleInput = shell.querySelector<HTMLInputElement>('form input[autocomplete="off"]')!;
  // React liest Eingaben über den nativen Setter; ein direktes `value =` übergeht den Zustand.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  setValue.call(titleInput, 'Gebundenes Paket');
  titleInput.dispatchEvent(new Event('input', { bubbles: true }));
  await expect.poll(() => [...shell.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((radio) => !radio.disabled && radio.closest('label')?.textContent?.includes('catalog-gspp'))).toBeTruthy();
  [...shell.querySelectorAll<HTMLInputElement>('input[type="radio"]')].find((radio) => radio.closest('label')?.textContent?.includes('catalog-gspp'))!.click();
  await expect.poll(() => button(shell, 'Profil anlegen')?.disabled).toBe(false);
  button(shell, 'Profil anlegen')!.click();
  await expect.poll(() => current.state.location.pathname, { timeout: 15_000 }).toMatch(/\/dokument\//);
  const localId = current.state.location.pathname.split('/').at(-1) as LocalId;

  const store = value(await WorkspaceStore.open());
  const created = value(await store.getDocument(localId));
  store.close();
  expect(readCatalogPins(created?.source, 'profile')).toEqual(new Map([['gspp', DELIVERED]]));
  const persisted = await storedValuesAndIndexKeys();
  expect(persisted).toContain(DELIVERED);
  expect(persisted).not.toContain(CATALOG_SENTINEL);

  root!.unmount();
  router!.dispose();
  host!.remove();
  const later = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, localId), catalogState(LATER));
  await expect.poll(() => later.shell.querySelector('[data-catalog-pin="not-delivered"]'), { timeout: 15_000 }).toBeTruthy();
  for (const save of [...later.shell.querySelectorAll('button')].filter((candidate) => candidate.textContent === 'Speichern')) {
    expect(save.disabled).toBe(true);
  }
  expect(await storedValuesAndIndexKeys()).toBe(persisted);
});
