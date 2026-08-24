import { describe, expect, it } from 'vitest';
import { classifyJsonValueKind, compareJsonGraphs } from './oscalGraphCompare';

describe('classifyJsonValueKind', () => {
  it('unterscheidet die Wertarten, die JSON.parse liefern kann', () => {
    expect(classifyJsonValueKind({})).toBe('object');
    expect(classifyJsonValueKind([])).toBe('array');
    expect(classifyJsonValueKind('x')).toBe('string');
    expect(classifyJsonValueKind(1)).toBe('number');
    expect(classifyJsonValueKind(true)).toBe('boolean');
    expect(classifyJsonValueKind(null)).toBe('null');
  });

  it('führt nicht-endliche Zahlen und negative Null als eigene Wertarten', () => {
    expect(classifyJsonValueKind(JSON.parse('1e400'))).toBe('non-finite-number');
    expect(classifyJsonValueKind(JSON.parse('-1e400'))).toBe('non-finite-number');
    expect(classifyJsonValueKind(JSON.parse('-0'))).toBe('negative-zero');
    expect(classifyJsonValueKind(0)).toBe('number');
  });
});

describe('compareJsonGraphs', () => {
  it('findet keine Differenz zwischen tiefgleichen Graphen', () => {
    const graph = { a: [1, { b: 'x' }], c: { d: null } };
    expect(compareJsonGraphs(graph, structuredClone(graph))).toEqual([]);
  });

  it('meldet einen Blattwechsel mit Pfad und Wertarten', () => {
    const differences = compareJsonGraphs(
      { catalog: { metadata: { title: 'alt' } } },
      { catalog: { metadata: { title: 'neu' } } },
    );
    expect(differences).toEqual([
      {
        path: '$.catalog.metadata.title',
        kind: 'value-changed',
        leftKind: 'string',
        rightKind: 'string',
      },
    ]);
  });

  it('erkennt Infinity→null trotz byte-identischer Serialisierung (Befund 7)', () => {
    const original = JSON.parse('{"v":1e400}');
    const exported = JSON.parse(JSON.stringify(original));

    // Die Serialisierungsebene ist blind: beide Seiten schreiben null.
    expect(JSON.stringify(original)).toBe(JSON.stringify(exported));

    expect(compareJsonGraphs(original, exported)).toEqual([
      {
        path: '$.v',
        kind: 'value-changed',
        leftKind: 'non-finite-number',
        rightKind: 'null',
      },
    ]);
  });

  it('erkennt −0→0 trotz byte-identischer Serialisierung (Befund 7)', () => {
    const original = JSON.parse('{"v":-0}');
    const exported = JSON.parse(JSON.stringify(original));

    expect(JSON.stringify(original)).toBe(JSON.stringify(exported));
    expect(compareJsonGraphs(original, exported)).toEqual([
      {
        path: '$.v',
        kind: 'value-changed',
        leftKind: 'negative-zero',
        rightKind: 'number',
      },
    ]);
  });

  it('meldet Textabweichungen ohne Wertänderung nicht', () => {
    // Dieselben geparsten Werte aus unterschiedlich geschriebenen Quelltexten:
    // 1E2 → 100, 1.0 → 1, "\/" → "/" — der Vergleich läuft auf dem Graphen,
    // nie auf den Quellbytes.
    const left = JSON.parse('{"a":1E2,"b":1.0,"c":"A","d":"\\/"}');
    const right = JSON.parse('{"a":100,"b":1,"c":"A","d":"/"}');
    expect(compareJsonGraphs(left, right)).toEqual([]);
  });

  it('meldet die Umsortierung numerischer Objektschlüssel nicht', () => {
    // Die Umsortierung geschieht in JSON.parse selbst und ist von ADR-2
    // ausgenommen; beide Seiten parsen deshalb identisch geordnet.
    const left = JSON.parse('{"m":{"1":0,"0":1}}') as { m: Record<string, number> };
    const right = JSON.parse('{"m":{"0":1,"1":0}}') as { m: Record<string, number> };

    expect(Object.keys(left.m)).toEqual(Object.keys(right.m));
    expect(compareJsonGraphs(left, right)).toEqual([]);
  });

  it('ordnet Objektschlüssel kanonisch, bevor Reihenfolge verglichen wird', () => {
    // Gemischte Insertion: Integer-artige Schlüssel wandern in beiden Parses
    // nach vorn; die nicht-numerische Einfügereihenfolge bleibt vergleichbar.
    const left = JSON.parse('{"m":{"b":1,"2":0,"a":2}}');
    const right = JSON.parse('{"m":{"2":0,"b":1,"a":2}}');
    expect(compareJsonGraphs(left, right)).toEqual([]);

    const reordered = JSON.parse('{"m":{"2":0,"a":2,"b":1}}');
    expect(compareJsonGraphs(left, reordered)).toEqual([
      {
        path: '$.m',
        kind: 'key-order-changed',
        leftKind: 'object',
        rightKind: 'object',
      },
    ]);
  });

  it('meldet fehlende und zusätzliche Schlüssel', () => {
    const differences = compareJsonGraphs(
      { a: 1, b: { c: 2 } },
      { a: 1, b: {}, d: 3 },
    );
    expect(differences).toContainEqual({
      path: '$.b.c',
      kind: 'key-missing',
      leftKind: 'number',
      rightKind: 'undefined-absent',
    });
    expect(differences).toContainEqual({
      path: '$.d',
      kind: 'key-added',
      leftKind: 'undefined-absent',
      rightKind: 'number',
    });
  });

  it('meldet Längen- und Typabweichungen in Arrays elementweise', () => {
    const differences = compareJsonGraphs(
      { list: [1, 2, 3] },
      { list: [1, 9] },
    );
    expect(differences).toContainEqual({
      path: '$.list[1]',
      kind: 'value-changed',
      leftKind: 'number',
      rightKind: 'number',
    });
    expect(differences).toContainEqual({
      path: '$.list[2]',
      kind: 'item-missing',
      leftKind: 'number',
      rightKind: 'undefined-absent',
    });
    expect(compareJsonGraphs({ x: [] }, { x: {} })).toEqual([
      {
        path: '$.x',
        kind: 'type-changed',
        leftKind: 'array',
        rightKind: 'object',
      },
    ]);
  });

  it('liefert Unterschiede deterministisch in Traversierungsreihenfolge', () => {
    // Ein fehlender Teilbaum wird einmal gemeldet, nicht bis zum Blatt
    // aufgezählt — weniger Ausgabe, kleinere Leckfläche.
    const differences = compareJsonGraphs(
      { b: 1, a: { y: 1, x: 2 } },
      {},
    );
    expect(differences.map((entry) => entry.path)).toEqual(['$.b', '$.a']);
    expect(differences[1]).toEqual({
      path: '$.a',
      kind: 'key-missing',
      leftKind: 'object',
      rightKind: 'undefined-absent',
    });
  });
});
