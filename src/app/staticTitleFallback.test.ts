import { describe, expect, it } from 'vitest';
// `?raw` statt `readFileSync(process.cwd(), …)`: Vite löst den Pfad zur
// Bauzeit relativ zu dieser Datei auf, unabhängig vom Arbeitsverzeichnis.
import indexHtml from '../../index.html?raw';
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

  it('is a no-op when no marked fallback is present', () => {
    const targetDocument = document.implementation.createHTMLDocument('Test');
    targetDocument.head.innerHTML = '<title>Bereits ersetzt</title>';

    removeStaticTitleFallback(targetDocument);

    expect(targetDocument.head.querySelector('title')?.textContent).toBe('Bereits ersetzt');
  });
});

describe('static title fallback deployment contract', () => {
  it('ships a marked product-title fallback that the selector matches', () => {
    const targetDocument = new DOMParser().parseFromString(indexHtml, 'text/html');

    const fallback = targetDocument.querySelector('head > title[data-page-title-fallback]');

    expect(fallback?.textContent).toBe('Grundschutz++ Navigator');
    expect(targetDocument.querySelectorAll('title')).toHaveLength(1);
  });
});
