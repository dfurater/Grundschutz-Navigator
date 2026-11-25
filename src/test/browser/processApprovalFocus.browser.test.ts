import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { withLoadedCatalog } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';
import '@/index.css';

/**
 * Fokus im Freigabedialog der SSP-Station (GSPP-684) in Chromium: Nach einer geschriebenen Rücknahme steht er auf der
 * Prozesszeile, beim Speichern einer Partei auf der Dialogüberschrift, Tab und Shift+Tab bleiben währenddessen im Dialog,
 * und nach einem Speicherfehler steht er wieder auf der Speicheraktion.
 */

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  flushSync(() => root?.unmount());
  router?.dispose();
  host?.remove();
  await resetWorkspace();
});

async function open(width: number) {
  const seeded = await seedWorkspace();
  const document_ = await readStore(store => store.addDocument(seeded.verbundId, { source: makeProcessCiaSsp('1.2.2'), context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2' }));
  await page.viewport(width, width < 768 ? 844 : 900);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [buildWorkspaceDocumentUrl(seeded.verbundId, document_.localId)] });
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(CatalogContext.Provider, { value: withLoadedCatalog(true) },
    createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: router! })))));
  await expect.poll(() => button('Freigabe zurücknehmen…'), { timeout: 8000 }).toBeTruthy();
  button('Freigabe zurücknehmen…')!.click();
  await expect.poll(() => document.querySelector('dialog')).toBeTruthy();
  return document_;
}

function button(name: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find(item => item.textContent === name);
}

test.each([1440, 390])('setzt den Fokus nach einer mit Enter bestätigten Rücknahme bei %i px auf die Prozesszeile', async (width) => {
  await open(width);
  (document.querySelector('dialog textarea') as HTMLTextAreaElement).focus();
  await userEvent.keyboard('Verfügbarkeit wird neu bewertet.');
  [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find(item => item.textContent === 'Freigabe zurücknehmen')!.focus();

  await userEvent.keyboard('{Enter}');

  await expect.poll(() => document.querySelector('dialog'), { timeout: 8000 }).toBeNull();
  await expect.poll(() => document.activeElement?.tagName).toBe('SUMMARY');
  expect(document.activeElement?.closest('details')?.querySelector('[aria-label="Leitungsfreigabe"]')).toBeTruthy();
  await expect.poll(() => document.body.textContent).toContain('Verfügbarkeit wird neu bewertet.');
  expect(document.activeElement?.tagName).toBe('SUMMARY');
});

test.each([1440, 390])('hält den Fokus beim Speichern einer Partei bei %i px im Dialog und gibt ihn nach einem Speicherkonflikt zurück', async (width) => {
  const stored = await open(width);
  button('+ Partei im SSP anlegen')!.click();
  await expect.poll(() => document.activeElement?.tagName).toBe('INPUT');
  await userEvent.keyboard('Behördenleitung');
  // Ein anderer Tab speichert neu; das Speichern der Partei trifft danach auf einen Konflikt.
  await readStore(store => store.saveDocument(stored.localId, stored.savedAt, null, { source: structuredClone(stored.source), context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2' }));
  let release = () => {};
  const held = new Promise<void>(done => { release = done; });
  const save = WorkspaceStore.prototype.saveDocument;
  vi.spyOn(WorkspaceStore.prototype, 'saveDocument').mockImplementation(async function (this: WorkspaceStore, ...args) { await held; return save.apply(this, args); });
  const saveParty = button('Partei speichern')!;
  saveParty.focus();

  await userEvent.keyboard('{Enter}');

  await expect.poll(() => document.querySelector('dialog')?.getAttribute('aria-busy')).toBe('true');
  expect(document.activeElement).toBe(document.querySelector('dialog h2'));
  // Tab-Umlauf in beide Richtungen, während das Fieldset deaktiviert ist.
  const dialog = document.querySelector('dialog')!;
  button('Abbrechen')!.focus();
  await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
  expect(dialog.contains(document.activeElement)).toBe(true);
  const confirm = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === 'Freigabe zurücknehmen')!;
  confirm.focus();
  await userEvent.keyboard('{Tab}');
  expect(dialog.contains(document.activeElement)).toBe(true);
  expect(document.activeElement).not.toBe(confirm);
  // Steht der Fokus auf einer anderen Dialogaktion, bleibt er dort; die Rückgabe greift nur von der Überschrift aus.
  dialog.querySelector('h2')!.focus();
  release();
  await expect.poll(() => document.querySelector('dialog [role="alert"]')?.textContent, { timeout: 8000 }).toContain('in einem anderen Tab geändert');
  expect(document.activeElement).toBe(saveParty);
  expect(saveParty.disabled).toBe(false);
});
