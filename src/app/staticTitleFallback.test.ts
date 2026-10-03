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

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

// Wie `document.title` zählt nur ein `title` im HTML-Namespace als Seitentitel; das
// `<title>` eines Inline-SVG ist ein Bildtitel.
function pageTitles(targetDocument: Document) {
  return Array.from(targetDocument.querySelectorAll('title')).filter(
    (element) => element.namespaceURI === HTML_NAMESPACE,
  );
}

describe('static title fallback deployment contract', () => {
  it('ships a marked product-title fallback that the selector matches', () => {
    const targetDocument = new DOMParser().parseFromString(indexHtml, 'text/html');

    const fallback = targetDocument.querySelector('head > title[data-page-title-fallback]');

    expect(fallback?.textContent).toBe('Grundschutz++ Navigator');
    expect(pageTitles(targetDocument)).toHaveLength(1);
  });

  it('counts the title of an inline SVG in the template as no page title', () => {
    const withSvg = indexHtml.replace('</body>', '<svg><title>Bildtitel</title></svg></body>');

    const targetDocument = new DOMParser().parseFromString(withSvg, 'text/html');

    expect(targetDocument.querySelectorAll('title')).toHaveLength(2);
    expect(pageTitles(targetDocument)).toHaveLength(1);
  });
});
