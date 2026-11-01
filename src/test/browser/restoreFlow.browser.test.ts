import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, test } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildWorkspaceIndexUrl } from '@/app/routes';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';
import { SENTINEL_VERBUND, readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
afterEach(async () => {
  root?.unmount(); router?.dispose(); host?.remove();
  await commands.setBrowserCoarsePointer(false);
  await resetWorkspace();
});

async function renderOverview(width: number, touch: boolean) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, 960);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [buildWorkspaceIndexUrl()] });
  host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
    createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: router! })))));
  await expect.poll(() => router!.state.initialized).toBe(true);
  await document.fonts.ready;
  await expect.poll(() => button('Sicherung wiederherstellen…')?.disabled).toBe(false);
  return host;
}

const button = (name: string) => [...host!.querySelectorAll('button')].find(entry => entry.textContent === name);
function upload(json: string) {
  const input = host!.querySelector<HTMLInputElement>('input[type="file"][aria-label="Sicherungsdatei"]')!;
  const files = new DataTransfer(); files.items.add(new File([json], 'sicherung.json', { type: 'application/json' }));
  input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}
const noHorizontalOverflow = () => document.documentElement.scrollWidth <= document.documentElement.clientWidth;

// Der globale Browser-Egress-Guard beobachtet Backup-Worker und Prüfblatt.
describe.each([{ width: 1440, touch: false }, { width: 390, touch: true }])('Sicherung wiederherstellen bei $width px', ({ width, touch }) => {
  test('prüft eine Verbundsicherung im echten Worker und stellt sie per Tastatur wieder her', async () => {
    const seeded = await seedWorkspace();
    const file = await readStore(store => store.exportVerbundBackup(seeded.verbundId));
    await readStore(store => store.renameVerbund(seeded.verbundId, 'Umbenannt'));
    await renderOverview(width, touch);
    upload(file);
    await expect.poll(() => host!.textContent, { timeout: 15000 }).toContain(`„${SENTINEL_VERBUND}“ ersetzen`);
    expect(document.activeElement?.textContent).toBe('Sicherung wiederherstellen');
    expect(host!.textContent).toContain('Verbundsicherung');
    expect(host!.textContent).toContain('Vorhanden · geändert');
    expect(noHorizontalOverflow()).toBe(true);
    expect(document.title).not.toContain(SENTINEL_VERBUND);
    expect(JSON.stringify(router!.state.location)).not.toContain(SENTINEL_VERBUND);
    await assertNoAxeViolations(host!, `Verbundvorschau ${width}`);

    button(`„${SENTINEL_VERBUND}“ ersetzen`)!.focus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => host!.querySelector('[data-restored]')?.textContent).toContain(SENTINEL_VERBUND);
    await expect.poll(() => document.activeElement?.textContent).toBe('Informationsverbünde');
    expect([...host!.querySelectorAll('output')].some(entry => entry.textContent?.startsWith('Wiederhergestellt:'))).toBe(true);
    expect((await readStore(store => store.listVerbuende())).map(entry => entry.name).sort()).toEqual([SENTINEL_VERBUND, 'Zweiter Verbund'].sort());
    await assertNoAxeViolations(host!, `Ergebnis ${width}`);
  });

  test('lehnt eine fremde Datei ab und überschreibt nach einer Konkurrenzänderung nichts', async () => {
    await seedWorkspace();
    const whole = await readStore(store => store.exportBackup());
    await renderOverview(width, touch);
    upload('{"catalog":{"uuid":"00000000-0000-4000-8000-000000000000"}}');
    await expect.poll(() => host!.querySelector('[role="alert"]')?.textContent, { timeout: 15000 }).toContain('Datei abgelehnt');
    expect(button('Gesamten Bestand ersetzen')).toBeUndefined();
    await assertNoAxeViolations(host!, `Ablehnung ${width}`);

    upload(whole);
    await expect.poll(() => button('Gesamten Bestand ersetzen'), { timeout: 15000 }).toBeTruthy();
    const created = await readStore(store => store.createVerbund('Neu in anderem Tab'));
    button('Gesamten Bestand ersetzen')!.click();
    await expect.poll(() => host!.querySelector('[role="alert"]')?.textContent).toContain('Zielbereich inzwischen geändert');
    expect((await readStore(store => store.listVerbuende())).some(entry => entry.verbundId === created.verbundId)).toBe(true);
    expect(noHorizontalOverflow()).toBe(true);
    await assertNoAxeViolations(host!, `Konflikt ${width}`);
  });
});
