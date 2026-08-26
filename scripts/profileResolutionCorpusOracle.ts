// =============================================================================
// Vergleichsorakel-Helfer des Bauzeitlaufs (GSPP-291, Commit B)
//
// Zweigeteilter Referenznachweis, Seite 1: Die Resolver-Ergebnisse werden
// nach Entfernung ausschließlich dokumentierter volatiler Felder semantisch
// gegen die BSI-resolved_catalog-Dokumente verglichen. Bekannte
// Quelldifferenzen sind die Provenienzträger — die BSI-Artefakte tragen sie
// nicht, unsere Ergebnisse schon; beide Seiten werden symmetrisch
// herausgerechnet und getrennt geprüft.
//
// Volatile Felder (dokumentiert): metadata/uuid und metadata/last-modified
// sind werkzeug­spezifisch; prop[@name='resolution-tool'] und
// link[@rel='source-profile'] sind unsere Träger. Alles andere zählt.
// =============================================================================

type JsonValue = unknown;
interface JsonObjectLike {
  [key: string]: JsonValue;
}

const VOLATILE_METADATA_FIELDS = ['uuid', 'last-modified'] as const;

function isJsonObject(value: JsonValue): value is JsonObjectLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tiefe Kopie ohne die dokumentierten volatilen Metadatenfelder. */
export function stripVolatileFields(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!isJsonObject(value)) return value;

  const copy: JsonObjectLike = {};
  for (const key of Object.keys(value)) {
    copy[key] = stripVolatileFields(value[key]);
  }

  // Dokument-UUIDs am Körper sind werkzeuggeneriert (die BSI-resolved_
  // catalogs tragen dort Instanz-UUIDs ohne erkennbare Ableitung) und
  // werden symmetrisch auf beiden Seiten herausgerechnet — dieselbe Klasse
  // dokumentierter Volatilität wie metadata/last-modified.
  if ('metadata' in copy && 'uuid' in copy) {
    delete copy['uuid'];
  }

  const metadata = copy['metadata'];
  if (isJsonObject(metadata)) {
    for (const field of VOLATILE_METADATA_FIELDS) delete metadata[field];
    const props = metadata['props'];
    if (Array.isArray(props)) {
      metadata['props'] = props.filter(
        (entry) => !(isJsonObject(entry) && entry['name'] === 'resolution-tool'),
      );
      if ((metadata['props'] as unknown[]).length === 0) delete metadata['props'];
    }
    const links = metadata['links'];
    if (Array.isArray(links)) {
      metadata['links'] = links.filter(
        (entry) => !(isJsonObject(entry) && entry['rel'] === 'source-profile'),
      );
      if ((metadata['links'] as unknown[]).length === 0) delete metadata['links'];
    }
    if (Object.keys(metadata).length === 0) delete copy['metadata'];
  }
  return copy;
}

/** Kanonische Form mit sortierten Schlüsseln — Arrayordnung bleibt Bedeutung. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isJsonObject(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Erste semantische Divergenz als Pfadangabe für die Fehlermeldung. */
export function firstDivergence(actual: JsonValue, expected: JsonValue, path = '$'): string | null {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return path;
    if (actual.length !== expected.length) return `${path} (Länge ${actual.length} ≠ ${expected.length})`;
    for (let index = 0; index < actual.length; index += 1) {
      const found = firstDivergence(actual[index], expected[index], `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  if (isJsonObject(actual) || isJsonObject(expected)) {
    if (!isJsonObject(actual) || !isJsonObject(expected)) return path;
    for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
      if (!(key in actual) || !(key in expected)) return `${path}/${key}`;
      const found = firstDivergence(actual[key], expected[key], `${path}/${key}`);
      if (found !== null) return found;
    }
    return null;
  }
  return actual === expected ? null : `${path} (${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)})`;
}
