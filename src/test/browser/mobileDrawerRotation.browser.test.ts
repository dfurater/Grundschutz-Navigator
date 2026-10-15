import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, test } from 'vitest';
import { commands, page } from 'vitest/browser';
import { CatalogContext } from '@/state/CatalogContext';
import { DESKTOP_QUERY, OWN_SCROLL_AREA_QUERY } from '@/hooks/breakpointQueries';
import { appShellAt } from './appShellRouter';
import { closeDrawer, openDrawer, settlePush, scrollerOf } from './mobileDrawerHarness';
import { createTabletCatalogState } from './tabletCatalogFixture';
import '@/index.css';

interface Profile {
  readonly width: number;
  readonly height: number;
  readonly touch: boolean;
}

const PHONE: Profile = { width: 390, height: 844, touch: true };
let root: Root | undefined;
let host: HTMLDivElement | undefined;

afterEach(async () => {
  root?.unmount();
  host?.remove();
  root = undefined;
  host = undefined;
  window.scrollTo(0, 0);
  await commands.setBrowserCoarsePointer(false);
});

async function applyProfile({ width, height, touch }: Profile) {
  await commands.setBrowserCoarsePointer(touch);
  await page.viewport(width, height);
}

async function renderApp(profile: Profile) {
  await applyProfile(profile);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  flushSync(() => {
    root?.render(createElement(CatalogContext.Provider, { value: createTabletCatalogState() }, appShellAt('/katalog/gspp')));
  });
  await document.fonts.ready;
  await expect.poll(() => host!.querySelector('[data-control-row]')).not.toBeNull();
  return host;
}

const menuButton = (shell: ParentNode) => shell.querySelector<HTMLButtonElement>('button[aria-controls]')!;

test('hält den offenen Drawer nach Rotation von Dokument- zu internem Scrollen und zurück im Viewport', async () => {
  const shell = await renderApp(PHONE);
  window.scrollTo(0, 420);
  await expect.poll(() => window.scrollY).toBe(420);
  const aside = await openDrawer(shell, { animated: true });
  expect(aside.style.top).toBe('420px');

  // Breiten- und Höhenwechsel unter md behalten die erfasste Dokumentlage.
  await applyProfile({ width: 667, height: 390, touch: true });
  await settlePush(shell);
  expect(matchMedia(OWN_SCROLL_AREA_QUERY).matches).toBe(false);
  expect(aside.style.top).toBe('420px');
  expect(aside.getBoundingClientRect().top).toBe(0);
  await applyProfile(PHONE);
  await settlePush(shell);
  expect(aside.style.top).toBe('420px');

  const landscape: Profile = { width: 844, height: 390, touch: true };
  for (const profile of [landscape, PHONE]) {
    await applyProfile(profile);
    await expect.poll(() => aside.style.top).toBe('0px');
    await settlePush(shell);
    expect(matchMedia(OWN_SCROLL_AREA_QUERY).matches).toBe(profile === landscape);
    expect(matchMedia(DESKTOP_QUERY).matches).toBe(false);
    expect(menuButton(shell)).toHaveAttribute('aria-expanded', 'true');
    expect(window.scrollY).toBe(0);
    const box = aside.getBoundingClientRect();
    expect(box.top).toBe(0);
    expect(box.bottom).toBe(profile.height);
    expect(box.left).toBe(0);
    expect(box.right).toBeLessThanOrEqual(profile.width);
    const close = aside.querySelector<HTMLButtonElement>('button[aria-label="Menü schließen"]')!;
    const closeBox = close.getBoundingClientRect();
    expect(closeBox.top).toBeGreaterThanOrEqual(0);
    expect(closeBox.bottom).toBeLessThanOrEqual(profile.height);
    expect(close.contains(document.elementFromPoint(closeBox.left + closeBox.width / 2, closeBox.top + closeBox.height / 2))).toBe(true);

    if (profile === landscape) {
      closeDrawer(shell);
      await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
      const listScroller = scrollerOf(shell.querySelector('[data-control-row="TOP.1.2"]')!);
      listScroller.scrollTop = 200;
      await expect.poll(() => listScroller.scrollTop).toBe(200);
      expect(window.scrollY).toBe(0);
      await openDrawer(shell, { animated: true });
      expect(aside.style.top).toBe('0px');
      expect(aside.getBoundingClientRect().top).toBe(0);
      expect(listScroller.scrollTop).toBe(200);
    }
  }

  // Schließen gibt das Dokument frei; erneutes Öffnen erfasst seine neue Lage.
  closeDrawer(shell);
  await expect.poll(() => menuButton(shell).getAttribute('aria-expanded')).toBe('false');
  await expect.poll(() => aside.getBoundingClientRect().right).toBeLessThanOrEqual(0);
  expect(document.documentElement.style.overflow).toBe('');
  window.scrollTo(0, 280);
  await expect.poll(() => window.scrollY).toBe(280);
  await openDrawer(shell, { animated: true });
  expect(aside.style.top).toBe('280px');
  expect(aside.getBoundingClientRect().top).toBe(0);
});
