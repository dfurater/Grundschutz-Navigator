import { expect } from 'vitest';

/**
 * Prüft den Seitentitel und zugleich, dass er aus genau einem `<title>` stammt.
 *
 * React dedupliziert hochgezogene `<title>`-Elemente nicht: Sind zwei zugleich
 * gemountet, gewinnt das zuletzt gerenderte, und ein reiner `document.title`-
 * Vergleich würde still gegen den falschen Knoten prüfen (GSPP-202).
 */
export function expectSingleDocumentTitle(expected: string): void {
  const titles = Array.from(document.head.querySelectorAll('title')).map(
    (element) => element.textContent,
  );

  expect(titles).toEqual([expected]);
  expect(document.title).toBe(expected);
}
