import { describe, expect, it } from 'vitest';
import { compareControlIds, compareGermanText } from './germanCollation';

describe('compareControlIds', () => {
  it('sorts numeric ID segments by value, not lexically', () => {
    expect(['GC.1.10', 'GC.1.2', 'GC.10.1', 'GC.2.1'].sort(compareControlIds)).toEqual([
      'GC.1.2',
      'GC.1.10',
      'GC.2.1',
      'GC.10.1',
    ]);
  });

  it('matches localeCompare with the same locale and options', () => {
    const ids = ['DET.3.1', 'GC.1.10', 'GC.1.2', 'ASST.12.4', 'ASST.2.11', 'GC.1', 'gc.1.3'];
    const expected = [...ids].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));

    expect([...ids].sort(compareControlIds)).toEqual(expected);
  });
});

describe('compareGermanText', () => {
  it('matches localeCompare for German text including umlauts', () => {
    const words = ['Zugriff', 'Änderung', 'Übersicht', 'Aufbewahrung', 'ölen', 'Oberfläche', 'straße', 'Strasse'];
    const expected = [...words].sort((a, b) => a.localeCompare(b, 'de'));

    expect([...words].sort(compareGermanText)).toEqual(expected);
  });
});
