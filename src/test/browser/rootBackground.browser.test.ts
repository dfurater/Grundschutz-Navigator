import { expect, test } from 'vitest';
import '@/index.css';
// `?raw` statt `readFileSync`: Vite löst den Pfad unabhängig vom
// Arbeitsverzeichnis auf (wie in `src/app/staticTitleFallback.test.ts`).
import indexHtml from '@/../index.html?raw';

function footerSurfaceColor(): string {
  const probe = document.createElement('div');
  probe.style.backgroundColor = 'var(--color-surface-base)';
  document.body.append(probe);
  try {
    return getComputedStyle(probe).backgroundColor;
  } finally {
    probe.remove();
  }
}

test('gibt html eine eigene deckende Hintergrundfarbe für Safaris Liquid-Glass-Leiste', () => {
  // Ohne eigene Farbe auf `html` zeigt Safari 26 unter seiner Leiste eine
  // undurchsichtige graue Fläche statt des Seiteninhalts (GSPP-447). Sie
  // entspricht der Footerfläche, sonst steht am Dokumentende ein andersfarbiger
  // Streifen unter dem Footer.
  const background = getComputedStyle(document.documentElement).backgroundColor;
  expect(background).not.toBe('rgba(0, 0, 0, 0)');
  expect(background).toBe(footerSurfaceColor());
});

test('färbt body mit den Klassen aus index.html in der Footerfläche', () => {
  // Safari färbt die Fläche unter der Leiste am Dokumentende nach `body`
  // (GSPP-487). Der Test setzt die tatsächlichen Klassen des `<body>`-Tags aus
  // `index.html` und prüft deren Wirkung mit dem geladenen Stylesheet.
  const bodyClassName = new DOMParser().parseFromString(indexHtml, 'text/html').body.className;
  expect(bodyClassName).not.toBe('');

  const originalClassName = document.body.className;
  document.body.className = bodyClassName;
  try {
    const background = getComputedStyle(document.body).backgroundColor;
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    expect(background).toBe(footerSurfaceColor());
  } finally {
    document.body.className = originalClassName;
  }
});
