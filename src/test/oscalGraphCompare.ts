// =============================================================================
// Graphvergleich mit Object.is-Semantik — zweite Vergleichsebene des
// Round-trip-Harnischs (GSPP-298, Befund 7)
//
// Der Serialisierungsvergleich `JSON.stringify(a) === JSON.stringify(b)` ist
// für zwei über wohlgeformtes JSON erreichbare Werte blind: `Infinity` und
// `-0` überleben `JSON.stringify` nicht, und beide Vergleichsseiten erleiden
// denselben Verlust. Dieser Vergleicher läuft auf dem geparsten Graphen und
// ist die einzige Ebene, auf der diese Werte überhaupt prüfbar sind.
//
// Testwerkzeug, keine Produktionsschnittstelle. Differenzeinträge tragen
// ausschließlich Pfade und Wertarten — nie Rohwerte aus dem Dokument.
// =============================================================================

/**
 * Wertarten des geparsten JSON-Graphen.
 *
 * `non-finite-number` und `negative-zero` existieren nur nach `JSON.parse`;
 * `JSON.stringify` schreibt sie als `null` beziehungsweise `0` weg.
 * `undefined-absent` markiert die Abwesenheitsseite einer Schlüssel- oder
 * Arraydifferenz und ist kein JSON-Wert.
 */
export type JsonValueKind =
  | 'object'
  | 'array'
  | 'string'
  | 'number'
  | 'non-finite-number'
  | 'negative-zero'
  | 'boolean'
  | 'null'
  | 'undefined-absent';

export type JsonGraphDifferenceKind =
  /** Blattwert an gleichem Pfad unterschiedlich (auch Wertartwechsel von Blättern). */
  | 'value-changed'
  /** Objekt ↔ Array ↔ Blatt gewechselt. */
  | 'type-changed'
  /** Schlüssel fehlt in der tatsächlichen Seite. */
  | 'key-missing'
  /** Schlüssel zusätzlich auf der tatsächlichen Seite. */
  | 'key-added'
  /** Gleiche Schlüsselmenge, aber nicht-numerische Einfügereihenfolge geändert. */
  | 'key-order-changed'
  /** Array-Eintrag der erwarteten Seite fehlt. */
  | 'item-missing'
  /** Array-Eintrag zusätzlich auf der tatsächlichen Seite. */
  | 'item-added';

export interface JsonGraphDifference {
  readonly path: string;
  readonly kind: JsonGraphDifferenceKind;
  readonly leftKind: JsonValueKind;
  readonly rightKind: JsonValueKind;
}

function isPlainObject(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/** Klassifiziert einen Wert ohne ihn zu verraten — die Grundlage der Redaction. */
export function classifyJsonValueKind(value: unknown): JsonValueKind {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined-absent';
  if (Array.isArray(value)) return 'array';
  if (isPlainObject(value)) return 'object';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 'non-finite-number';
    if (Object.is(value, -0)) return 'negative-zero';
    return 'number';
  }
  if (typeof value === 'string') return 'string';
  if (typeof value === 'boolean') return 'boolean';
  return 'undefined-absent';
}

function isContainerKind(kind: JsonValueKind): boolean {
  return kind === 'object' || kind === 'array';
}

/**
 * Integer-artige Objektschlüssel ordnet JavaScript beim Parsen numerisch vor
 * die übrigen — das geschieht in `JSON.parse`, nicht im Export, und ist von
 * ADR-2 ausdrücklich ausgenommen. Die kanonische Form stellt beide Seiten auf
 * dieselbe Ordnung, bevor Reihenfolge verglichen wird.
 */
function isIntegerLikeKey(key: string): boolean {
  const numeric = Number(key);
  return Number.isInteger(numeric) && numeric >= 0 && numeric < 4294967295
    && String(numeric) === key;
}

function canonicalKeyOrder(keys: readonly string[]): string[] {
  const integerLike = keys.filter(isIntegerLikeKey).sort((a, b) => Number(a) - Number(b));
  const others = keys.filter((key) => !isIntegerLikeKey(key));
  return [...integerLike, ...others];
}

function walk(
  expected: unknown,
  actual: unknown,
  path: string,
  differences: JsonGraphDifference[],
): void {
  const leftKind = classifyJsonValueKind(expected);
  const rightKind = classifyJsonValueKind(actual);

  if (isContainerKind(leftKind) || isContainerKind(rightKind)) {
    if (leftKind !== rightKind) {
      differences.push({ path, kind: 'type-changed', leftKind, rightKind });
      return;
    }
    if (leftKind === 'object') {
      walkObject(
        expected as Record<string, unknown>,
        actual as Record<string, unknown>,
        path,
        differences,
      );
      return;
    }
    walkArray(expected as unknown[], actual as unknown[], path, differences);
    return;
  }

  if (!Object.is(expected, actual)) {
    differences.push({ path, kind: 'value-changed', leftKind, rightKind });
  }
}

function walkObject(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
  path: string,
  differences: JsonGraphDifference[],
): void {
  const expectedKeys = Object.keys(expected);
  const actualKeys = new Set(Object.keys(actual));

  for (const key of expectedKeys) {
    const childPath = `${path}.${key}`;
    if (!actualKeys.has(key)) {
      differences.push({
        path: childPath,
        kind: 'key-missing',
        leftKind: classifyJsonValueKind(expected[key]),
        rightKind: 'undefined-absent',
      });
      continue;
    }
    walk(expected[key], actual[key], childPath, differences);
  }

  for (const key of Object.keys(actual)) {
    if (!Object.hasOwn(expected, key)) {
      differences.push({
        path: `${path}.${key}`,
        kind: 'key-added',
        leftKind: 'undefined-absent',
        rightKind: classifyJsonValueKind(actual[key]),
      });
    }
  }

  // Reihenfolge nur bei gleicher Schlüsselmenge vergleichen; eine
  // Mengenabweichung ist bereits über key-missing/key-added berichtet.
  if (expectedKeys.length === actualKeys.size
    && expectedKeys.length > 1
    && canonicalKeyOrder(expectedKeys).join('\u0000') !== canonicalKeyOrder([...actualKeys]).join('\u0000')) {
    differences.push({ path, kind: 'key-order-changed', leftKind: 'object', rightKind: 'object' });
  }
}

function walkArray(
  expected: readonly unknown[],
  actual: readonly unknown[],
  path: string,
  differences: JsonGraphDifference[],
): void {
  const sharedLength = Math.min(expected.length, actual.length);
  for (let index = 0; index < sharedLength; index += 1) {
    walk(expected[index], actual[index], `${path}[${index}]`, differences);
  }
  for (let index = sharedLength; index < expected.length; index += 1) {
    differences.push({
      path: `${path}[${index}]`,
      kind: 'item-missing',
      leftKind: classifyJsonValueKind(expected[index]),
      rightKind: 'undefined-absent',
    });
  }
  for (let index = sharedLength; index < actual.length; index += 1) {
    differences.push({
      path: `${path}[${index}]`,
      kind: 'item-added',
      leftKind: 'undefined-absent',
      rightKind: classifyJsonValueKind(actual[index]),
    });
  }
}

/**
 * Vergleicht zwei geparste JSON-Graphen mit `Object.is`-Blattsemantik.
 *
 * Objekte werden als geordnete Maps behandelt: Die nicht-numerische
 * Einfügereihenfolge ist Teil des Vertrags (ADR-2), Integer-artige
 * Schlüssel sind kanonisch geordnet und melden daher keine Umsortierung.
 * Arrays werden elementweise in Quellreihenfolge verglichen.
 *
 * Das Ergebnis ist deterministisch in Traversierungsreihenfolge und enthält
 ** keine Dokumentwerte** — nur Pfade, Unterscheidungsart und Wertarten.
 */
export function compareJsonGraphs(
  expected: unknown,
  actual: unknown,
): readonly JsonGraphDifference[] {
  const differences: JsonGraphDifference[] = [];
  walk(expected, actual, '$', differences);
  return differences;
}
