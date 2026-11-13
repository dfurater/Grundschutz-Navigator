// Gesamtlöschung mit zwei App-Instanzen in Chromium (GSPP-635). Tab A bedient den Löschdialog der App; Tab B ist ein
// zweiter WorkspaceProvider mit eigenem Lock-Client (iframe gleicher Origin) und öffnet den Speicher wie beim Betreten
// des Bereichs. Speicher und Web Locks sind die echten des Browsers.
import Dexie from 'dexie';
import { createElement, useEffect, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildWorkspaceIndexUrl } from '@/app/routes';
import { WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createWorkspaceSession } from '@/state/workspaceSession';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { SENTINEL_VERBUND, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';
import { document as oscalDocument, open, value } from '@/test/browser/workspaceStoreFixtures';

const ENTRY = 'Alle lokalen Daten löschen…';
const CONFIRM = 'Alle lokalen Daten endgültig löschen';
const cleanups: (() => void)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  await resetWorkspace();
});

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  flushSync(() => { root.render(element); });
  cleanups.push(() => { root.unmount(); host.remove(); });
  return host;
}

const button = (text: string) => [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === text);
const databases = async () => (await indexedDB.databases()).map((database) => database.name);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Tab A: die App im Bereich Informationsverbünde mit dem geseedeten Bestand. */
async function appTab() {
  const router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [buildWorkspaceIndexUrl()] });
  // Der Provider beendet seine Sitzung erst mit dem Tab; hier endet sie mit dem Test.
  const session = createWorkspaceSession();
  cleanups.push(() => { router.dispose(); session.leave(); });
  const host = mount(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
    createElement(WorkspaceProvider, { session, children: createElement(RouterProvider, { router }) })));
  await expect.poll(() => [...host.querySelectorAll('a')].some((link) => link.textContent === SENTINEL_VERBUND)).toBe(true);
}

/** Öffnet in Tab A den Löschdialog; die freigegebene Bestätigung belegt, dass Tab A das Tor exklusiv hält. */
async function openDeletion() {
  button(ENTRY)!.click();
  await expect.poll(() => button(CONFIRM)?.disabled).toBe(false);
}

function WorkspaceStatus() {
  const { activate, status } = useWorkspace();
  useEffect(() => { activate(); }, [activate]);
  return createElement('output', null, status);
}

/** Tab B: öffnet den Bereich, während Tab A das Tor hält, und wartet deshalb auf die Anmeldung. */
async function waitingTab(): Promise<() => string | null | undefined> {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const session = createWorkspaceSession(frame.contentWindow!.navigator.locks);
  cleanups.push(() => { session.leave(); frame.remove(); });
  const host = mount(createElement(WorkspaceProvider, { session, children: createElement(WorkspaceStatus) }));
  const status = () => host.querySelector('output')?.textContent;
  await pause(300);
  expect(status()).toBe('opening');
  return status;
}

test('ein während der Löschung wartender Tab legt die Datenbank nach dem Abschluss nicht neu an', async () => {
  await seedWorkspace();
  await appTab();
  await openDeletion();
  const statusB = await waitingTab();
  button(CONFIRM)!.click();
  await expect.poll(() => document.body.textContent).toContain('Lokale Daten gelöscht');
  await expect.poll(statusB).toBe('deleted');
  // Auch danach öffnet kein Tab die Datenbank von selbst.
  await pause(500);
  expect(await databases()).not.toContain(WORKSPACE_DATABASE_NAME);
  expect(statusB()).toBe('deleted');
  expect(button('Sicherung wiederherstellen…')?.disabled).toBe(false);
});

test('nach dem Abbruch öffnet der wartende Tab den unveränderten Bestand', async () => {
  await seedWorkspace();
  await appTab();
  await openDeletion();
  const statusB = await waitingTab();
  button('Abbrechen')!.click();
  await expect.poll(statusB).toBe('ready');
  expect(await databases()).toContain(WORKSPACE_DATABASE_NAME);
});

test('ohne Web Locks bleibt die Löschung mit stabiler Diagnose gesperrt; der Gesamtexport bleibt verfügbar', async () => {
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  cleanups.push(() => { delete (navigator as { locks?: LockManager }).locks; });
  expect(navigator.locks).toBeUndefined();
  await seedWorkspace();
  await appTab();
  button(ENTRY)!.click();
  await expect.poll(() => document.querySelector('[data-diagnostic]')?.getAttribute('data-diagnostic')).toBe('WORKSPACE_SESSION_UNAVAILABLE');
  expect(button(CONFIRM)?.disabled).toBe(true);
  expect(button('Vorher sichern')?.disabled).toBe(true);
  button('Abbrechen')!.click();
  expect(button('Sicherung exportieren')?.disabled).toBe(false);
  expect(await databases()).toContain(WORKSPACE_DATABASE_NAME);
});

test('Gesamtlöschung entfernt alle sieben Stores einschließlich Prüfspur und Baseline', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('One'));
  const a = value(await store.addDocument(verbund.verbundId, await oscalDocument('A')));
  const b = value(await store.addDocument(verbund.verbundId, await oscalDocument('B')));
  value(await store.appendCheckpoint(a.localId, a.savedAt, null, 0));
  value(await store.setBinding({ fromLocalId: b.localId, pointer: '/catalog/metadata/title', href: 'B', target: { kind: 'local', localId: a.localId } }, b.savedAt));
  value(await store.autosaveDraft(b.localId, value(await store.getDocument(b.localId))!.savedAt, null, { text: 'B' }));
  const db = new Dexie(WORKSPACE_DATABASE_NAME);
  await db.open();
  try {
    expect(db.tables).toHaveLength(7);
    for (const table of db.tables) expect(await table.count(), table.name).toBeGreaterThan(0);
  } finally { db.close(); }
  value(await store.deleteAll('delete-workspace'));
  expect((await indexedDB.databases()).map(database => database.name)).not.toContain(WORKSPACE_DATABASE_NAME);
});
