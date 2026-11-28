import { describe, expect, it } from 'vitest';
import { injectStartPageMarkup } from './startPagePrerender.ts';

const TEMPLATE = '<body><div id="root"></div></body>';

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
