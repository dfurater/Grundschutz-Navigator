// =============================================================================
// Typwächter und Leser für JSON-Werte aus unvertrauenswürdigen Dokumenten
//
// Adapter, Referenzgraph und Profilauflösung lesen dieselben Rohwerte. Die
// Leser koerzieren nichts: Ein Wert der falschen Form wird zu `undefined` oder
// zu einer leeren Liste, nie zu einer scheinbaren Angabe.
// =============================================================================

export type JsonObject = Record<string, unknown>;

/** Ein JSON-Objekt im engen Sinn: kein `null`, kein Array. */
export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Ein JSON-Container: Objekt **oder** Array. Die Profilauflösung kopiert und
 * durchläuft beide Formen über dieselben Eigenschaftszugriffe.
 */
export function isJsonContainer(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object';
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/** Liefert ein Array unverändert; jede andere Form wird zur leeren Liste. */
export function readArray<T = unknown>(value: unknown): readonly T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Liest einen Zeichenkettenwert per JSON Pointer; jeder andere Fund ergibt `undefined`. */
export function pointerString(source: unknown, pointer: string): string | undefined {
  let value: unknown = source;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!isJsonContainer(value) || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return typeof value === 'string' ? value : undefined;
}
