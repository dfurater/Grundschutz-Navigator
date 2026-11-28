import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'vite';
import { injectStartPageMarkup, renderStartPageMarkup } from './startPagePrerender.ts';

vi.mock('vite', () => ({ createServer: vi.fn() }));

const TEMPLATE = '<body><div id="root"></div></body>';

afterEach(() => {
  vi.mocked(createServer).mockReset();
});

function mockServer(ssrLoadModule: () => Promise<unknown>) {
  const server = { ssrLoadModule: vi.fn(ssrLoadModule), close: vi.fn(async () => {}) };
  vi.mocked(createServer).mockResolvedValue(server as unknown as Awaited<ReturnType<typeof createServer>>);
  return server;
}

describe('renderStartPageMarkup', () => {
  it.each([
    ['/', '/'],
    ['/preview/', '/preview'],
  ])('rendert mit der Router-Basis wie src/main.tsx bei Deployment-Basis %s', async (base, basename) => {
    const renderStartPage = vi.fn(async () => '<main>Start</main>');
    const server = mockServer(async () => ({ renderStartPage }));

    await expect(renderStartPageMarkup('/projekt', base)).resolves.toBe('<main>Start</main>');

    expect(renderStartPage).toHaveBeenCalledWith(basename);
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('gibt einen Ladefehler weiter und schließt den Server trotzdem', async () => {
    const failure = new Error('SSR-Modul fehlt');
    const server = mockServer(async () => { throw failure; });

    await expect(renderStartPageMarkup('/projekt', '/')).rejects.toBe(failure);

    expect(server.close).toHaveBeenCalledOnce();
  });
});

describe('injectStartPageMarkup', () => {
  it('setzt das Markup in den leeren App-Root ein', () => {
    expect(injectStartPageMarkup(TEMPLATE, '<main>Start $&</main>')).toBe(
      '<body><div id="root"><main>Start $&</main></div></body>',
    );
  });

  it.each([
    ['ohne leeren App-Root', '<body><div id="root"><p>x</p></div></body>', '<p>y</p>', /exactly one empty #root/],
    ['mit zwei leeren App-Roots', TEMPLATE + TEMPLATE, '<p>y</p>', /exactly one empty #root/],
    ['mit leerem Markup', TEMPLATE, '  ', /is empty/],
    ['mit Skript im Markup', TEMPLATE, '<p>y</p><SCRIPT>alert(1)</SCRIPT>', /must not contain scripts/],
  ])('bricht %s ab', (_case, html, markup, message) => {
    expect(() => injectStartPageMarkup(html, markup)).toThrow(message);
  });
});
