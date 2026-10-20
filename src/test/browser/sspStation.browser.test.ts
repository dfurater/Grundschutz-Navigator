import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, test } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildStationUrl } from '@/app/routes';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';
import { makeFullSsp, SSP_FIXTURE_IDS } from '@/test/fixtures/systemSecurityPlans';
import { readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;

function unmount() {
  root?.unmount();
  router?.dispose();
  host?.remove();
}

afterEach(async () => {
  unmount();
  await commands.setBrowserCoarsePointer(false);
  await resetWorkspace();
});

async function renderAt(path: string, width: number, touch: boolean) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, 900);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
    createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: router! })))));
  await expect.poll(() => router!.state.initialized).toBe(true);
  await document.fonts.ready;
  return host;
}

function upload(shell: HTMLElement, json: string) {
  const input = shell.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = new DataTransfer();
  files.items.add(new File([json], 'privater-dateiname.json', { type: 'application/json' }));
  input.files = files.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

async function expand(shell: HTMLElement) {
  for (let level = 0; level < 12; level++) {
    const closed = shell.querySelectorAll<HTMLDetailsElement>('main details:not([open])');
    if (!closed.length) return;
    for (const detail of closed) detail.querySelector('summary')!.click();
    await expect.poll(() => [...closed].every(detail => detail.open)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
  }
}

describe.each([{ width: 1440, touch: false }, { width: 1032, touch: true }, { width: 390, touch: true }])('SSP bei $width px', ({ width, touch }) => {
  test('echter Worker-Import, erneutes Öffnen und Keyboard-Lesen bleiben lokal und zugänglich', async () => {
    const seeded = await seedWorkspace();
    let shell = await renderAt(buildStationUrl(seeded.verbundId, 'ssp'), width, touch);
    await expect.poll(() => shell.querySelector('input[type="file"]')).toBeTruthy();
    await assertNoAxeViolations(shell, `SSP-Import ${width}`, 'all');
    upload(shell, '{"geheimerInhalt":');
    await expect.poll(() => shell.querySelector('[role="alert"]')?.textContent).toContain('json-syntax');
    expect(shell.querySelector('[role="alert"]')?.textContent).not.toContain('geheimerInhalt');
    await assertNoAxeViolations(shell, `SSP-Ablehnung ${width}`, 'all');

    const source = makeFullSsp();
    const body = source['system-security-plan'] as { metadata: { title: string }; 'system-characteristics': { description: string } };
    body.metadata.title = 'LOKALER_SSP_SENTINEL';
    body['system-characteristics'].description = '<img src="https://example.invalid/SSP_GEHEIM" onerror="alert(1)">';
    upload(shell, JSON.stringify(source));
    await expect.poll(() => shell.querySelector('h1')?.textContent, { timeout: 15_000 }).toBe(body.metadata.title);
    await expect.poll(() => shell.querySelector('summary')?.textContent, { timeout: 15_000 }).toBe('Metadaten');
    const path = router!.state.location.pathname;
    expect(JSON.stringify(router!.state.location)).not.toContain(body.metadata.title);
    expect(path).not.toContain(SSP_FIXTURE_IDS.ssp);
    expect(document.title).not.toContain(body.metadata.title);
    const documents = await readStore(store => store.listDocuments(seeded.verbundId));
    const imported = documents.find(document => path.endsWith(document.localId))!;
    expect(imported.documentState).toBe('imported');
    expect((await readStore(store => store.getDocument(imported.localId)))?.source).toEqual(source);

    unmount();
    shell = await renderAt(path, width, touch);
    await expect.poll(() => shell.querySelector('summary')?.textContent, { timeout: 15_000 }).toBe('Metadaten');
    const summary = shell.querySelector('summary')!;
    summary.focus();
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => summary.parentElement!.hasAttribute('open')).toBe(true);
    await page.screenshot({ path: `../../../.vitest/gspp294-${width}.png`, fullPage: false });
    await expand(shell);
    expect(shell.textContent).toContain('gspp-teilweise-geprueft');
    expect(shell.textContent).toContain('Von der Plattform geerbt.');
    expect(shell.textContent).toContain('SSP_GEHEIM');
    expect(shell.querySelector('main img, main iframe, main embed, main object, main a[href^="https:"]')).toBeNull();
    expect(shell.textContent).not.toContain('iVBORw0KGgo=');
    await assertNoAxeViolations(shell, `SSP-Lesen ${width}`, 'all');
    if (touch) {
      for (const target of shell.querySelectorAll<HTMLElement>('main summary')) {
        if (target.checkVisibility()) expect(target.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
      expect(shell.scrollWidth).toBeLessThanOrEqual(width);
    }
    expect(await commands.assertNoBrowserEgress()).toBeUndefined();
  });
});
