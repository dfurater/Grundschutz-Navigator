// =============================================================================
// Strukturorakel — Zählregeln A und B aus dem Dokumentmodell-Vertrag (ADR-0002)
//
// Testwerkzeug, keine Produktionsschnittstelle. Es beantwortet genau eine
// Frage: Verliert ein Verarbeitungsweg Inhalt gegenüber dem Original?
//
// Ein Feld-für-Feld-Vergleich ist belastbarer als jede Aufzählung erwarteter
// Felder — er kennt auch die Felder, an die beim Schreiben des Tests niemand
// gedacht hat.
//
// GSPP-298 hebt diese Regeln in den modellübergreifenden Round-trip-Harnisch;
// hier tragen sie nur die No-op-Vorstufe für den Katalogpfad.
// =============================================================================

function isPlainObject(node: unknown): node is Record<string, unknown> {
  return typeof node === 'object' && node !== null && !Array.isArray(node);
}

/**
 * Zählregel A — skalare Blätter.
 *
 * Rekursiver Abstieg; bei einem Nicht-Objekt/Nicht-Array wird der Pfad
 * ausgegeben. Arrays **mit** Index. Das Ergebnis ist eine Liste, kein Set.
 *
 * Kompatibel zu `jq '[paths(scalars)] | length'`.
 */
export function scalarLeafPaths(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => scalarLeafPaths(entry, `${path}[${index}]`));
  }
  if (isPlainObject(node)) {
    return Object.keys(node).flatMap((key) => scalarLeafPaths(node[key], `${path}.${key}`));
  }
  return [path];
}

/**
 * Zählregel B — Inhalts-Multiset.
 *
 * Rekursiver Abstieg; Ausgabe ist `<Pfad>=<JSON-Wert>`. Arrays **ohne** Index,
 * damit Positionsänderungen nicht als Inhaltsverlust zählen — die Reihenfolge
 * prüft `arrayOrderSignature`.
 *
 * Leere Objekte ergeben `<Pfad>={}`, leere Arrays `<Pfad>[]=empty`. Ohne diese
 * Marker wäre ein bedeutungstragendes `"include-all": {}` unsichtbar.
 *
 * Das Ergebnis ist ein **Multiset**: identische (Pfad, Wert)-Paare bleiben
 * mehrfach enthalten, sonst verschwände der Verlust von drei von vier
 * gleichlautenden `hashes[].algorithm`-Einträgen aus dem Vergleich.
 */
export function contentMultiset(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) {
    if (node.length === 0) {
      return [`${path}[]=empty`];
    }
    return node.flatMap((entry) => contentMultiset(entry, `${path}[]`));
  }
  if (isPlainObject(node)) {
    const keys = Object.keys(node);
    if (keys.length === 0) {
      return [`${path}={}`];
    }
    return keys.flatMap((key) => contentMultiset(node[key], `${path}.${key}`));
  }
  return [`${path}=${JSON.stringify(node)}`];
}

/**
 * Multiset-Differenz mit Vielfachheit: was in `expected` steht und in `actual`
 * fehlt. Ein leeres Ergebnis bedeutet Verlustfreiheit in dieser Richtung.
 */
export function missingFromMultiset(expected: string[], actual: string[]): string[] {
  const remaining = new Map<string, number>();
  for (const entry of actual) {
    remaining.set(entry, (remaining.get(entry) ?? 0) + 1);
  }

  const missing: string[] = [];
  for (const entry of expected) {
    const count = remaining.get(entry) ?? 0;
    if (count === 0) {
      missing.push(entry);
      continue;
    }
    remaining.set(entry, count - 1);
  }
  return missing;
}

/**
 * Reihenfolgesignatur aller Arrays im Dokument.
 *
 * Zählregel B ist positionsblind. Die Ordnungsanforderung der
 * Profile-Resolution-Spezifikation verlangt aber, dass die Quellreihenfolge
 * erhalten bleibt — diese Signatur macht sie vergleichbar.
 */
export function arrayOrderSignature(node: unknown, path = '$'): string[] {
  if (Array.isArray(node)) {
    const own = `${path}=[${node
      .map((entry) => (isPlainObject(entry) || Array.isArray(entry) ? '#' : JSON.stringify(entry)))
      .join(',')}]`;
    return [
      own,
      ...node.flatMap((entry, index) => arrayOrderSignature(entry, `${path}[${index}]`)),
    ];
  }
  if (isPlainObject(node)) {
    return Object.keys(node).flatMap((key) => arrayOrderSignature(node[key], `${path}.${key}`));
  }
  return [];
}

/**
 * Zählt `remarks` auf OSCAL-`props` im gesamten Dokument.
 *
 * `prop.remarks` ist ein reguläres OSCAL-Feld, das das Domänenmodell nicht
 * kennt. Der Zähler belegt, dass der Prüfkorpus die Struktur überhaupt enthält
 * — sonst liefe der Erhaltungsnachweis leer durch.
 */
export function countPropRemarks(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce<number>((sum, entry) => sum + countPropRemarks(entry), 0);
  }
  if (!isPlainObject(node)) {
    return 0;
  }

  let count = 0;
  const props = node.props;
  if (Array.isArray(props)) {
    for (const prop of props) {
      if (isPlainObject(prop) && prop.remarks !== undefined) {
        count += 1;
      }
    }
  }
  for (const key of Object.keys(node)) {
    count += countPropRemarks(node[key]);
  }
  return count;
}

/** Zählt Container-Knoten (Objekte und Arrays) im Dokument. */
export function countContainers(node: unknown): {
  objects: number;
  arrays: number;
  total: number;
} {
  let objects = 0;
  let arrays = 0;

  const walk = (current: unknown): void => {
    if (Array.isArray(current)) {
      arrays += 1;
      for (const entry of current) walk(entry);
      return;
    }
    if (isPlainObject(current)) {
      objects += 1;
      for (const key of Object.keys(current)) walk(current[key]);
    }
  };

  walk(node);
  return { objects, arrays, total: objects + arrays };
}

/** Friert einen Objektgraphen rekursiv ein. Schreibzugriffe werfen dann im Strict Mode. */
export function deepFreeze<T>(node: T): T {
  if (Array.isArray(node)) {
    for (const entry of node) deepFreeze(entry);
    return Object.freeze(node);
  }
  if (isPlainObject(node)) {
    for (const key of Object.keys(node)) deepFreeze(node[key]);
    return Object.freeze(node);
  }
  return node;
}
