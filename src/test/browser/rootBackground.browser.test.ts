import { expect, test } from 'vitest';
import '@/index.css';

test('gibt html eine eigene deckende Hintergrundfarbe für Safaris Liquid-Glass-Leiste', () => {
  // Ohne eigene Farbe auf `html` zeigt Safari 26 unter seiner Leiste eine
  // undurchsichtige graue Fläche statt des Seiteninhalts (GSPP-447). Sie
  // entspricht der Footerfläche, sonst steht am Dokumentende ein andersfarbiger
  // Streifen unter dem Footer.
  const probe = document.createElement('div');
  probe.style.backgroundColor = 'var(--color-surface-base)';
  document.body.append(probe);
  try {
    const background = getComputedStyle(document.documentElement).backgroundColor;
    expect(background).not.toBe('rgba(0, 0, 0, 0)');
    expect(background).toBe(getComputedStyle(probe).backgroundColor);
  } finally {
    probe.remove();
  }
});
