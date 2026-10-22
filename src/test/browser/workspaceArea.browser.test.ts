import { createElement, Fragment, useEffect, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { createMemoryRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { afterEach, describe, expect, test } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { AppShell } from '@/app/AppShell';
import { createAppRoutes } from '@/app/appRoutes';
import { buildVerbundUrl, buildWorkspaceDocumentUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider, type AutosaveFlush } from '@/state/WorkspaceContext';
import { createA11yCatalogState } from '@/test/browser/a11yCatalogState';
import { assertNoAxeViolations } from '@/test/browser/axeAssertions';
import { openDrawer, settlePush } from '@/test/browser/mobileDrawerHarness';
import { SENTINEL_VERBUND, resetWorkspace, seedWorkspace, value } from '@/test/workspaceAreaFixture';
import '@/index.css';

/*
 * Bereich Informationsverbünde in Chromium (GSPP-577): Bereichswechsel auf den
 * drei Layoutstufen, Autosave vor dem Wechsel in den Katalog, Axe und
 * Touchziele. Der Speicher ist die echte IndexedDB des Browsers.
 */

const LAYOUTS = [
  { name: 'Desktop', width: 1440, height: 900, touch: false },
  { name: 'Tablet', width: 1032, height: 1376, touch: true },
  { name: 'Mobil', width: 390, height: 844, touch: true },
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
  await commands.setBrowserCoarsePointer(false);
  await resetWorkspace();
});

async function renderAt(path: string, width: number, height: number, touch: boolean, probe?: ReactNode) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, height);
  const currentRouter = createMemoryRouter(createAppRoutes(createElement(AppShell)), { initialEntries: [path] });
  router = currentRouter;
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root!.render(createElement(CatalogContext.Provider, { value: createA11yCatalogState() },
      createElement(WorkspaceProvider, null, probe, createElement(RouterProvider, { router: currentRouter }))));
  });
  await expect.poll(() => currentRouter.state.initialized).toBe(true);
  await expect.poll(() => host!.querySelector('main')?.textContent).toContain('Eigene Daten · kein Integritätsnachweis');
  await document.fonts.ready;
  return { shell: host, router: currentRouter };
}

function areaSwitchIn(container: Element) {
  return container.querySelector<HTMLElement>('nav[aria-label="Bereiche"]');
}

describe.each(LAYOUTS)('$name ($width px)', ({ name, width, height, touch }) => {
  test('Bereichswechsel ist sichtbar, zeigt den aktiven Bereich und ist per Tastatur bedienbar', async () => {
    const { verbundId } = await seedWorkspace();
    const { shell, router: current } = await renderAt(buildVerbundUrl(verbundId), width, height, touch);
    const header = shell.querySelector('header')!;
    let areas: HTMLElement;
    if (touch) {
      expect(areaSwitchIn(header)?.checkVisibility()).toBe(false);
      const aside = await openDrawer(shell);
      await settlePush(shell);
      areas = areaSwitchIn(aside)!;
    } else {
      areas = areaSwitchIn(header)!;
      expect(shell.querySelector('aside nav[aria-label="Bereiche"]')).toBeNull();
    }
    expect(areas.checkVisibility()).toBe(true);
    const workspaceLink = [...areas.querySelectorAll('a')].find((link) => link.textContent === 'Informationsverbünde')!;
    const catalogLink = [...areas.querySelectorAll('a')].find((link) => link.textContent === 'Katalog')!;
    expect(workspaceLink.getAttribute('aria-current')).toBe('true');
    expect(catalogLink.hasAttribute('aria-current')).toBe(false);
    if (touch) {
      for (const link of [workspaceLink, catalogLink]) {
        const box = link.getBoundingClientRect();
        expect(box.height, `${name}: ${link.textContent}`).toBeGreaterThanOrEqual(44);
        expect(box.width, `${name}: ${link.textContent}`).toBeGreaterThanOrEqual(44);
      }
    }

    catalogLink.focus();
    expect(document.activeElement).toBe(catalogLink);
    await userEvent.keyboard('{Enter}');
    await expect.poll(() => current.state.location.pathname).toBe('/katalog/gspp');
    await expect.poll(() => areaSwitchIn(touch ? shell.querySelector('aside')! : header)
      ?.querySelector('a[aria-current="true"]')?.textContent).toBe('Katalog');
  });

  test('Axe meldet auf Übersicht, Verbundseite und Dokumentdetail keinen Befund', async () => {
    const seeded = await seedWorkspace();
    for (const [label, path] of [
      ['Übersicht', buildWorkspaceIndexUrl()],
      ['Verbundseite', buildVerbundUrl(seeded.verbundId)],
      ['Dokumentdetail', buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId)],
    ] as const) {
      const { shell } = await renderAt(path, width, height, touch);
      await expect.poll(() => shell.querySelector('main h1:not(.sr-only)')?.textContent).toBeTruthy();
      await assertNoAxeViolations(shell, `${label} (${name})`, 'all');
      root!.unmount();
      router!.dispose();
      host!.remove();
    }
    root = undefined;
    router = undefined;
    host = undefined;
  });
});

describe.each(LAYOUTS.filter((layout) => layout.touch))('Touchziele $name', ({ name, width, height }) => {
  test('jedes Bedienelement in Inhalt und Schublade misst mindestens 44 × 44 px', async () => {
    const seeded = await seedWorkspace();
    for (const path of [
      buildWorkspaceIndexUrl(),
      buildVerbundUrl(seeded.verbundId),
      buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId),
    ]) {
      const { shell } = await renderAt(path, width, height, true);
      await expect.poll(() => shell.querySelector('main h1:not(.sr-only)')?.textContent).toBeTruthy();
      const aside = await openDrawer(shell);
      await settlePush(shell);
      // Links im Fließtext sind nach WCAG 2.5.8 ausgenommen und tragen `catalog-prose-link`.
      const targets = [...shell.querySelectorAll<HTMLElement>('main a, main button, main input, aside a, aside button')]
        .filter((element) => !element.classList.contains('catalog-prose-link') && element.checkVisibility()
          && !element.classList.contains('resize-handle'));
      expect(targets.length).toBeGreaterThan(0);
      for (const target of targets) {
        // Optionsfelder bedient man über ihre umschließende Beschriftung; sie ist das Touchziel.
        const box = (target.matches('input[type="radio"], input[type="checkbox"]') ? target.closest('label') ?? target : target).getBoundingClientRect();
        const label = `${name} ${path}: ${target.textContent || target.getAttribute('aria-label')}`;
        expect(box.height, label).toBeGreaterThanOrEqual(44);
        expect(box.width, label).toBeGreaterThanOrEqual(44);
      }
      expect(aside).toBeTruthy();
      root!.unmount();
      router!.dispose();
      host!.remove();
    }
    root = undefined;
    router = undefined;
    host = undefined;
  });
});

function AutosaveProbe({ flush }: Readonly<{ flush: AutosaveFlush }>) {
  const { registerAutosave } = useWorkspace();
  useEffect(() => registerAutosave(flush), [registerAutosave, flush]);
  return null;
}

test('der Wechsel in den Katalog speichert einen offenen Entwurf, bevor die Katalogroute erscheint', async () => {
  const seeded = await seedWorkspace();
  const draftSource = structuredClone(seeded.ssp.source) as { 'system-security-plan': { metadata: { title: string } } };
  draftSource['system-security-plan'].metadata.title = 'Ungespeicherter Arbeitsstand';
  const savedAt: string[] = [];
  const routerRef: { current?: ReturnType<typeof createMemoryRouter> } = {};
  const flush: AutosaveFlush = async () => {
    const store = value(await WorkspaceStore.open());
    try {
      const result = await store.autosaveDraft(seeded.ssp.localId, seeded.ssp.savedAt, null, draftSource);
      savedAt.push(routerRef.current!.state.location.pathname);
      return result;
    } finally {
      store.close();
    }
  };
  const rendered = await renderAt(buildVerbundUrl(seeded.verbundId), 1440, 900, false,
    createElement(Fragment, null, createElement(AutosaveProbe, { flush })));
  routerRef.current = rendered.router;
  const current = rendered.router;
  await expect.poll(() => rendered.shell.querySelector('main h1')?.textContent).toBe(SENTINEL_VERBUND);

  const catalogLink = [...areaSwitchIn(rendered.shell.querySelector('header')!)!.querySelectorAll('a')]
    .find((link) => link.textContent === 'Katalog')!;
  await userEvent.click(catalogLink);
  await expect.poll(() => current.state.location.pathname).toBe('/katalog/gspp');

  expect(savedAt).toEqual([buildVerbundUrl(seeded.verbundId)]);
  const store = value(await WorkspaceStore.open());
  try {
    const draft = value(await store.getDraft(seeded.ssp.localId));
    expect((draft?.source as typeof draftSource)['system-security-plan'].metadata.title).toBe('Ungespeicherter Arbeitsstand');
  } finally {
    store.close();
  }
});
