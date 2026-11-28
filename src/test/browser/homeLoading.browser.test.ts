import { createElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { expect, test } from 'vitest';
import { commands, page } from 'vitest/browser';
import { HomePage } from '@/features/home/HomePage';
import { CatalogContext } from '@/state/CatalogContext';
import { createA11yCatalogState } from './a11yCatalogState';
import '@/index.css';

test('die Einleitung bleibt bei 320 px und doppelter Standardschrift an ihrer Position', async () => {
  await commands.setBrowserFontSize(32);
  await page.viewport(320, 850);
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const loaded = createA11yCatalogState();
  const renderHome = (state: typeof loaded) => {
    flushSync(() => root.render(createElement(CatalogContext.Provider, { value: state },
      createElement(MemoryRouter, null, createElement(HomePage)),
    )));
  };

  try {
    renderHome({ ...loaded, catalog: null, loading: true });
    await document.fonts.ready;
    const heading = page.getByRole('heading', { name: 'Was ist Grundschutz++?' });
    const before = heading.element().getBoundingClientRect().top;

    renderHome(loaded);
    await document.fonts.ready;
    await expect.element(page.getByText('1 Praktiken · 1 Themen · 2 Kontrollen')).toBeVisible();
    expect(heading.element().getBoundingClientRect().top).toBeCloseTo(before, 1);
  } finally {
    root.unmount();
    host.remove();
    await commands.setBrowserFontSize();
  }
});
