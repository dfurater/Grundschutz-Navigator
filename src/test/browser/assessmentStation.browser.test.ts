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
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';
import { AR_UUIDS, makeFullAssessmentResults } from '@/test/fixtures/assessmentResults';
import { readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';
import '@/index.css';

let root: Root | undefined;
let host: HTMLDivElement | undefined;
let router: ReturnType<typeof createMemoryRouter> | undefined;
function unmount() { root?.unmount(); router?.dispose(); host?.remove(); }
afterEach(async () => { unmount(); await commands.setBrowserCoarsePointer(false); await resetWorkspace(); });

async function renderAt(path: string, width: number, touch: boolean) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, 960);
  router = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  host = document.createElement('div'); host.id = 'root'; document.body.append(host);
  root = createRoot(host);
  flushSync(() => root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
    createElement(WorkspaceProvider, null, createElement(RouterProvider, { router: router! })))));
  await expect.poll(() => router!.state.initialized).toBe(true);
  await document.fonts.ready;
  return host;
}
function upload(shell: HTMLElement, json: string) {
  const input = shell.querySelector<HTMLInputElement>('input[type="file"]')!;
  const files = new DataTransfer(); files.items.add(new File([json], 'privater-dateiname.json', { type: 'application/json' }));
  input.files = files.files; input.dispatchEvent(new Event('change', { bubbles: true }));
}

// Der globale Browser-Egress-Guard beobachtet auch Worker und alle passiven Evidenzpfade.
describe.each([{ width: 1440, touch: false }, { width: 1032, touch: true }, { width: 390, touch: true }])('Assessment Results bei $width px', ({ width, touch }) => {
  test('importiert im echten Worker, öffnet erneut und lässt Evidenz ohne Nutzeraktion passiv', async () => {
    const seeded = await seedWorkspace();
    let shell = await renderAt(buildStationUrl(seeded.verbundId, 'assessment'), width, touch);
    await expect.poll(() => shell.querySelector('input[type="file"]')).toBeTruthy();
    await assertNoAxeViolations(shell, `Results-Import ${width}`, 'all');
    upload(shell, '{"RESULTS_GEHEIM":');
    await expect.poll(() => shell.querySelector('[role="alert"]')?.textContent).toContain('json-syntax');
    expect(shell.querySelector('[role="alert"]')?.textContent).not.toContain('RESULTS_GEHEIM');
    const source = makeFullAssessmentResults();
    source['assessment-results'].metadata.title = 'Prüfergebnisse – synthetische Prüfung';
    Object.assign(source['assessment-results'].results[0].findings[0], { title: 'Netzwerksegmentierung nicht nachgewiesen' });
    upload(shell, JSON.stringify(source));
    await expect.poll(() => shell.querySelector('h1')?.textContent, { timeout: 15000 }).toBe(source['assessment-results'].metadata.title);
    await expect.poll(() => [...shell.querySelectorAll('button')].some(button => button.textContent === 'Findings · 2')).toBe(true);
    const path = router!.state.location.pathname;
    expect(JSON.stringify(router!.state.location)).not.toContain(AR_UUIDS.results);
    expect(document.title).not.toContain(source['assessment-results'].metadata.title);
    const imported = (await readStore(store => store.listDocuments(seeded.verbundId))).find(doc => path.endsWith(doc.localId))!;
    expect(imported.documentState).toBe('imported');
    expect((await readStore(store => store.getDocument(imported.localId)))?.source).toEqual(source);
    unmount();
    shell = await renderAt(path, width, touch);
    const finding = page.getByRole('button', { name: /Netzwerksegmentierung nicht nachgewiesen/ });
    await expect.poll(() => shell.textContent).toContain('Netzwerksegmentierung nicht nachgewiesen');
    await finding.click();
    await expect.poll(() => shell.querySelector('[aria-label="Finding-Detail"]')?.checkVisibility()).toBe(true);
    expect(shell.textContent).toContain('ohne verknüpften Beleg');
    expect(shell.querySelector('main img, main iframe, main object, main embed')).toBeNull();
    expect(shell.textContent).not.toContain('PHNjcmlwdD4=');
    await assertNoAxeViolations(shell, `Finding ${width}`, 'all');
    if (width === 1440) await page.screenshot({ path: '../../../.vitest/attachments/gspp-614-findings-desktop.png', fullPage: true });
    if (width === 390) {
      const detail = shell.querySelector<HTMLElement>('[aria-label="Finding-Detail"] > div:last-child')!;
      expect(detail.scrollHeight).toBeLessThanOrEqual(detail.clientHeight + 1);
      await page.screenshot({ path: '../../../.vitest/attachments/gspp-614-finding-mobile.png', fullPage: true });
    }
    const close = page.getByRole('button', { name: width < 744 ? 'Zur Liste' : 'Detail schließen', exact: true });
    await close.click();
    if (width < 744) {
      await expect.poll(() => (document.activeElement as HTMLElement)?.dataset.assessmentEntry).toBe('/assessment-results/results/0/findings/0');
      await page.screenshot({ path: '../../../.vitest/attachments/gspp-614-list-mobile.png', fullPage: true });
    }
    const observations = [...shell.querySelectorAll('button')].find(button => button.textContent === 'Observations · 2')!;
    observations.focus();
    await userEvent.keyboard('{Enter}');
    await page.getByRole('button', { name: new RegExp(AR_UUIDS.observation) }).click();
    await expect.poll(() => [...shell.querySelectorAll('button')].some(button => button.textContent === 'Herunterladen' && button.checkVisibility())).toBe(true);
    expect(shell.textContent).toContain('<script>alert(1)</script>');
    expect(shell.textContent).toContain('Prüferin');
    await assertNoAxeViolations(shell, `Observation ${width}`, 'all');
    if (width === 1440) await page.screenshot({ path: '../../../.vitest/attachments/gspp-614-observations-desktop.png', fullPage: true });
    await close.click();
    await page.getByRole('button', { name: 'Risks · 1', exact: true }).click();
    await page.getByRole('button', { name: /Risiko/ }).click();
    expect(shell.textContent).toContain('planned');
    expect(shell.textContent).toContain('https://threats.invalid/T-1.json');
    expect(shell.querySelector('main a[href^="https:"]')).toBeNull();
    await assertNoAxeViolations(shell, `Risk ${width}`, 'all');
    if (width === 1440) await page.screenshot({ path: '../../../.vitest/attachments/gspp-614-risks-desktop.png', fullPage: true });
    expect(shell.scrollWidth).toBeLessThanOrEqual(width);
    if (touch) for (const button of shell.querySelectorAll<HTMLElement>('main button')) {
      if (button.checkVisibility()) expect(button.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    }
    await close.click();
    const diagnostics = page.getByText('Modelldiagnosen 0', { exact: true });
    await diagnostics.click();
    await userEvent.keyboard('{Tab}');
    expect(await commands.assertNoBrowserEgress()).toBeUndefined();
  });
});

test.each([1440, 1032])('öffnet tiefe Listenzeilen bei %i px im sichtbaren Detailpanel', async width => {
  const seeded = await seedWorkspace();
  const source = makeFullAssessmentResults();
  const original = source['assessment-results'].results[0].findings[0];
  Object.assign(source['assessment-results'].results[0], { findings: Array.from({ length: 70 }, (_, index) => ({
    ...original, uuid: `00000000-0000-4000-8000-${String(3000 + index).padStart(12, '0')}` as typeof AR_UUIDS.finding,
    title: `Feststellung ${index}`,
  })) });
  const doc = await readStore(store => store.addDocument(seeded.verbundId, {
    source: JSON.parse(JSON.stringify(source)), rootType: 'assessment-results', oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' },
  }, 'imported'));
  const shell = await renderAt(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId), width, width === 1032);
  await expect.poll(() => shell.querySelector('[data-assessment-entry]')).toBeTruthy();
  const list = shell.querySelector<HTMLElement>('section[aria-label="Findings"]')!;
  expect(list.getBoundingClientRect().bottom).toBeLessThanOrEqual(shell.querySelector('main')!.getBoundingClientRect().bottom + 1);
  await page.getByRole('button', { name: /Weitere Findings/ }).click();
  await page.getByRole('button', { name: /Feststellung 69/ }).click();
  const detail = shell.querySelector<HTMLElement>('[aria-label="Finding-Detail"]')!;
  expect(detail.getBoundingClientRect().top).toBeLessThan(300);
  expect(detail.getBoundingClientRect().bottom).toBeLessThanOrEqual(shell.querySelector('main')!.getBoundingClientRect().bottom + 1);
});
