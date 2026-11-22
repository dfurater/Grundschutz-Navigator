import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, expect, test } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildScopeUrl } from '@/app/routes';
import { scopeBoundaryInput } from '@/domain/scopeBoundary';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { readStore, resetWorkspace } from '@/test/workspaceAreaFixture';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
afterEach(async () => { root?.unmount(); router?.dispose(); host?.remove(); await resetWorkspace(); });

async function renderScope(scopeId: string, width: number) {
  await page.viewport(width, 900);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [buildScopeUrl(scopeId)] });
  host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
    createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: router! })))));
  await expect.poll(() => router!.state.initialized).toBe(true);
  await document.fonts.ready;
}

const LONG_PATH = `\\\\dateiablage\\${'Informationssicherheit\\'.repeat(6)}Abgrenzung_Anwendungsbereich_Netzbetrieb_v2.docx`;
const LONG_PARTY = `Sicherheitsorganisation-${'Netzleitstelle-'.repeat(8)}Betrieb`;

test.each([320, 390])('bricht Quellenstand und Zuständigkeit bei %i px innerhalb der Karte um', async (width) => {
  const scope = await readStore((store) => store.createScope('Netzbetrieb'));
  await readStore((store) => store.saveScopeBoundary(scope.scopeId, scope.savedAt, {
    ...scopeBoundaryInput(undefined), sourceLabel: LONG_PATH, role: 'ISB', party: LONG_PARTY,
  }));
  await renderScope(scope.scopeId, width);
  await expect.poll(() => host!.textContent).toContain(LONG_PARTY);
  const card = host!.querySelector<HTMLElement>('section[aria-labelledby="scope-abgrenzung"]')!;
  const cardBox = card.getBoundingClientRect();
  for (const value of card.querySelectorAll<HTMLElement>('dd, dd span')) {
    const box = value.getBoundingClientRect();
    expect(box.right).toBeLessThanOrEqual(cardBox.right);
    expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1);
  }
  expect(cardBox.right).toBeLessThanOrEqual(width);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
});

test('führt den Tastaturfokus nach einem Speicherkonflikt zur Fehlerstelle und weiter zu „Aktuellen Stand laden“', async () => {
  const scope = await readStore((store) => store.createScope('Netzbetrieb'));
  await renderScope(scope.scopeId, 1440);
  const edit = page.getByRole('button', { name: /Abgrenzung erfassen/ });
  await expect.poll(() => edit.query()?.hasAttribute('disabled')).toBe(false);
  await edit.click();
  await page.getByLabelText('Schnittstellen').fill('Alt');
  // Ein zweiter Speicherzugriff ändert inzwischen die Abgrenzung.
  const [current] = await readStore((store) => store.listScopes());
  await readStore((store) => store.saveScopeBoundary(current.scopeId, current.savedAt, { ...scopeBoundaryInput(undefined), interfaces: 'Neu' }));
  (page.getByRole('button', { name: 'Speichern', exact: true }).element() as HTMLElement).focus();
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => document.activeElement?.querySelector('[role="alert"]')?.textContent).toContain('inzwischen geändert');
  const load = page.getByRole('button', { name: 'Aktuellen Stand laden' });
  await expect.poll(() => load.query()?.hasAttribute('disabled')).toBe(false);
  await userEvent.keyboard('{Tab}');
  expect(document.activeElement).toBe(load.element());
  await userEvent.keyboard('{Enter}');
  await expect.poll(() => (page.getByLabelText('Schnittstellen').element() as HTMLTextAreaElement).value).toBe('Neu');
  expect(document.activeElement?.tagName).toBe('H1');
});
