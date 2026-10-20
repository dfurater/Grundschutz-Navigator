import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, test } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import type { VerbundId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { resetWorkspace, seedWorkspace, value } from '@/test/workspaceAreaFixture';
import '@/index.css';

/*
 * Profile-Station in Chromium (GSPP-292): Bearbeitungsansicht auf den drei
 * Layoutstufen mit Axe und Touchzielen, Tastaturbedienung der Reiter und
 * Autosave des Profilentwurfs beim Wechsel in den Katalog. Speicher ist die
 * IndexedDB des Browsers; Analyse und Export laufen im echten Modul-Worker.
 */

const LAYOUTS = [
  { name: 'Desktop', width: 1440, height: 900, touch: false },
  { name: 'Tablet', width: 1032, height: 1376, touch: true },
  { name: 'Mobil', width: 390, height: 844, touch: true },
] as const;

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;

function unmount() {
  root?.unmount();
  router?.dispose();
  host?.remove();
  root = undefined;
  router = undefined;
  host = undefined;
}

afterEach(async () => {
  unmount();
  await commands.setBrowserCoarsePointer(false);
  await resetWorkspace();
});

async function renderAt(path: string, width: number, height: number, touch: boolean) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, height);
  const current = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  router = current;
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
      createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: current }))));
  });
  await expect.poll(() => current.state.initialized).toBe(true);
  await document.fonts.ready;
  return { shell: host, router: current };
}

/** Ein Profil auf einem lokalen Katalog des Verbunds, gebunden und mit `include-controls`. */
async function boundProfile(verbundId: VerbundId): Promise<WorkspaceEnvelope> {
  const store = value(await WorkspaceStore.open());
  try {
    const catalogSource = makeSchemaValidOscalDocument('catalog', '1.2.2');
    (catalogSource.catalog as { metadata: { title: string } }).metadata.title = 'Lokaler Katalog';
    const catalog = value(await store.addDocument(verbundId, { source: catalogSource, context: { trustClass: 'class-2-local-user' }, rootType: 'catalog', oscalVersion: '1.2.2' }));
    const profileSource = makeSchemaValidOscalDocument('profile', '1.2.2');
    (profileSource.profile as { metadata: { title: string } }).metadata.title = 'Lokales Paket';
    const profile = value(await store.addDocument(verbundId, { source: profileSource, context: { trustClass: 'class-2-local-user' }, rootType: 'profile', oscalVersion: '1.2.2' }));
    const href = (profileSource.profile as { imports: { href: string }[] }).imports[0].href;
    value(await store.setBinding({ fromLocalId: profile.localId, pointer: '/profile/imports/0/href', href, target: { kind: 'local', localId: catalog.localId } }, profile.savedAt));
    return profile;
  } finally {
    store.close();
  }
}

async function editorReady(shell: HTMLElement) {
  await expect.poll(() => shell.querySelector('[role="tablist"]')).toBeTruthy();
  await expect.poll(() => shell.querySelector('section[aria-label="Diagnosen"]')?.textContent, { timeout: 15_000 }).toContain('Schema');
}

describe.each(LAYOUTS)('$name ($width px)', ({ name, width, height, touch }) => {
  test('Axe meldet auf Neuanlage und Bearbeitungsansicht keinen Befund; Touchziele messen 44 px', async () => {
    const seeded = await seedWorkspace();
    const profile = await boundProfile(seeded.verbundId);

    const station = await renderAt(buildStationUrl(seeded.verbundId, 'profile'), width, height, touch);
    await expect.poll(() => [...station.shell.querySelectorAll('button')].find((button) => button.textContent === 'Neues Profil')).toBeTruthy();
    [...station.shell.querySelectorAll('button')].find((button) => button.textContent === 'Neues Profil')!.click();
    await expect.poll(() => station.shell.querySelector('form h3')?.textContent).toBe('Neues Profil');
    await assertNoAxeViolations(station.shell, `Neuanlage (${name})`, 'all');
    unmount();

    const { shell } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), width, height, touch);
    await editorReady(shell);
    await expect.poll(() => shell.querySelector('input[aria-label="ac-1 auswählen"]')).toBeTruthy();
    await assertNoAxeViolations(shell, `Bearbeitungsansicht (${name})`, 'all');
    if (touch) {
      const targets = [...shell.querySelectorAll<HTMLElement>('main button, main select, main label:has(> input[type="checkbox"])')]
        .filter((element) => element.checkVisibility());
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        const box = target.getBoundingClientRect();
        const label = `${name}: ${target.textContent || target.getAttribute('aria-label')}`;
        expect(box.height, label).toBeGreaterThanOrEqual(44);
        expect(box.width, label).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

test('Reiter sind per Pfeiltaste bedienbar', async () => {
  const seeded = await seedWorkspace();
  const profile = await boundProfile(seeded.verbundId);
  const { shell } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), 1440, 900, false);
  await editorReady(shell);
  const tabs = [...shell.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  tabs[0].focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(document.activeElement).toBe(tabs[1]);
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  await expect.poll(() => shell.querySelector('section[aria-labelledby^="dokument-referenzen"]')?.checkVisibility()).toBe(true);
});

test('der Wechsel in den Katalog speichert einen offenen Profilentwurf über registerAutosave()', async () => {
  const seeded = await seedWorkspace();
  const profile = await boundProfile(seeded.verbundId);
  const { shell, router: current } = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), 1440, 900, false);
  await editorReady(shell);
  await expect.poll(() => shell.querySelector('input[aria-label="ac-1 auswählen"]')).toBeTruthy();
  shell.querySelector<HTMLInputElement>('input[aria-label="ac-1 auswählen"]')!.click();
  // Sofort wechseln: Die Verzögerung des Autosaves ist noch nicht abgelaufen.
  const catalogLink = [...shell.querySelectorAll('header nav[aria-label="Bereiche"] a')].find((link) => link.textContent === 'Katalog') as HTMLElement;
  await userEvent.click(catalogLink);
  await expect.poll(() => current.state.location.pathname).toBe('/katalog/gspp');
  const store = value(await WorkspaceStore.open());
  try {
    const draft = value(await store.getDraft(profile.localId));
    const imports = (draft?.source as { profile: { imports: { 'include-controls'?: unknown }[] } }).profile.imports;
    expect(imports[0]['include-controls']).toEqual([{}]);
    const stored = value(await store.getDocument(profile.localId));
    expect(stored?.source).toEqual(profile.source);
  } finally {
    store.close();
  }
});
