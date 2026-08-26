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
// sind werkzeugspezifisch; die Dokument-UUID am Körper wird vom erzeugenden
// Werkzeug gemint und ist nicht ableitbar; prop[@name='resolution-tool']
// und link[@rel='source-profile'] sind unsere Träger. Alles andere zählt.
// =============================================================================

interface JsonObjectLike {
  [key: string]: unknown;
}

function isJsonObject(value: unknown): value is JsonObjectLike {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function byCodeUnit(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Filtert eine Trägerliste heraus; ohne Array passiert nichts, nach dem
 * Filter verschwindet ein leerer Rest samt Mitglied — es entstehen keine
 * Phantom-Schlüssel.
 */
function stripCarrierList(
  metadata: JsonObjectLike,
  key: string,
  matches: (entry: JsonObjectLike) => boolean,
): void {
  const value = metadata[key];
  if (!Array.isArray(value)) return;
  const kept = value.filter((entry) => !(isJsonObject(entry) && matches(entry)));
  if (kept.length === 0) delete metadata[key];
  else metadata[key] = kept;
}

/** Entfernt die volatilen Mitglieder eines Metadatenknotens in-place. */
function stripMetadataVolatiles(metadata: JsonObjectLike): void {
  delete metadata['uuid'];
  delete metadata['last-modified'];
  stripCarrierList(metadata, 'props', (entry) => entry['name'] === 'resolution-tool');
  stripCarrierList(metadata, 'links', (entry) => entry['rel'] === 'source-profile');
}

/** Tiefe Kopie ohne die dokumentierten volatilen Felder. */
export function stripVolatileFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatileFields);
  if (!isJsonObject(value)) return value;

  const copy: JsonObjectLike = {};
  for (const key of Object.keys(value)) {
    copy[key] = stripVolatileFields(value[key]);
  }
  if ('metadata' in copy) {
    const metadata = copy['metadata'];
    if (isJsonObject(metadata)) stripMetadataVolatiles(metadata);
  }
  if ('uuid' in copy && 'metadata' in copy) {
    // Dokument-UUID am Körper: werkzeuggeneriert, symmetrisch entfernt.
    delete copy['uuid'];
  }
  return copy;
}

/** Kanonische Form mit sortierten Schlüsseln — Arrayordnung bleibt Bedeutung. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isJsonObject(value)) {
    const members = Object.keys(value)
      .sort(byCodeUnit)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function firstArrayDivergence(
  actual: readonly unknown[],
  expected: readonly unknown[],
  path: string,
): string | null {
  if (actual.length !== expected.length) {
    return `${path} (Länge ${actual.length} ≠ ${expected.length})`;
  }
  for (let index = 0; index < actual.length; index += 1) {
    const found = firstDivergence(actual[index], expected[index], `${path}[${index}]`);
    if (found !== null) return found;
  }
  return null;
}

function firstObjectDivergence(
  actual: JsonObjectLike,
  expected: JsonObjectLike,
  path: string,
): string | null {
  for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
    if (!(key in actual)) return `${path}/${key}`;
    if (!(key in expected)) return `${path}/${key}`;
    const found = firstDivergence(actual[key], expected[key], `${path}/${key}`);
    if (found !== null) return found;
  }
  return null;
}

/** Erste semantische Divergenz als Pfadangabe für die Fehlermeldung. */
export function firstDivergence(actual: unknown, expected: unknown, path = '$'): string | null {
  if (Array.isArray(actual) || Array.isArray(expected)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) return path;
    return firstArrayDivergence(actual, expected, path);
  }
  if (isJsonObject(actual) || isJsonObject(expected)) {
    if (!isJsonObject(actual) || !isJsonObject(expected)) return path;
    return firstObjectDivergence(actual, expected, path);
  }
  return actual === expected ? null : `${path} (${JSON.stringify(actual)} ≠ ${JSON.stringify(expected)})`;
}
