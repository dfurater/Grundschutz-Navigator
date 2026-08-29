import { describe, expect, it } from 'vitest';
import { removeStaticTitleFallback } from './staticTitleFallback';

describe('removeStaticTitleFallback', () => {
  it('removes only the marked bootstrap fallback title', () => {
    const targetDocument = document.implementation.createHTMLDocument('Test');
    targetDocument.head.innerHTML = [
      '<title data-page-title-fallback>Grundschutz++ Navigator</title>',
      '<title>Unabhängiger Titel</title>',
    ].join('');

    removeStaticTitleFallback(targetDocument);

    expect(targetDocument.head.querySelector('[data-page-title-fallback]')).toBeNull();
    expect(targetDocument.head.querySelector('title')?.textContent).toBe('Unabhängiger Titel');
  });
});
