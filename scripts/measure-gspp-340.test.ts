import { describe, expect, it } from 'vitest';
import {
  countLinesByArea,
  countPhysicalLines,
  measureCandidateBundles,
  measureCandidateLoc,
} from './measure-gspp-340.mjs';

const sampleSource = `
// Ausschließlich kommentierende Zeile
import value from 'fixture';

// GSPP-340 area: Öffnen und Versionieren
function open() {
  return value; // Inline-Kommentar zählt als Codezeile.
}

/*
 * Mehrzeiliger Kommentar zählt nicht.
 */
// GSPP-340 area: CRUD
function put() {}
`;

describe('GSPP-340 LOC-Zählregel', () => {
  it('zählt physische, nichtleere und nicht ausschließlich kommentierende Zeilen', () => {
    expect(countPhysicalLines(sampleSource)).toBe(5);
  });

  it('weist Kandidatencode reproduzierbar den markierten Funktionsbereichen zu', () => {
    expect(countLinesByArea(sampleSource)).toEqual({
      Scaffolding: 1,
      'Öffnen und Versionieren': 3,
      CRUD: 1,
    });
  });

  it('schneidet Migration und Öffnen für beide Kandidaten semantisch deckungsgleich', () => {
    const { candidates } = measureCandidateLoc();

    expect(candidates.dexie.areas).toMatchObject({
      'Schema-Migration': 52,
      'Öffnen und Versionieren': 32,
    });
    expect(candidates.idb.areas).toMatchObject({
      'Schema-Migration': 70,
      'Öffnen und Versionieren': 48,
    });
  });

  it('liefert bei Wiederholung identische Bundle-Messwerte', async () => {
    expect(await measureCandidateBundles()).toEqual(await measureCandidateBundles());
  });
});
