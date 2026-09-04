/**
 * Query-Vertrag für Kennungssuchen.
 *
 * Die Syntax ist an OSCAL 1.1.3 gepinnt: `UUIDDatatype` akzeptiert exakt
 * UUID v4 und v5. Damit ist "vollständig und wohlgeformt" ohne
 * Implementationsspielraum festgelegt.
 *
 * @see https://github.com/usnistgov/OSCAL/releases/download/v1.1.3/oscal_catalog_schema.json
 */
const UUID_PATTERN =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[45][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/;

/** Segmentlängen einer UUID: 8-4-4-4-12. */
const UUID_SEGMENT_LENGTHS = [8, 4, 4, 4, 12] as const;

/** Ein vollständig hexadezimaler Achterblock — der Kopf jeder Kennung. */
const HEX_HEAD_SEGMENT = /^[0-9A-Fa-f]{8}$/;

export type QueryKind = 'identifier' | 'malformed-identifier' | 'text';

/**
 * Erkennt, ob eine Eingabe als Kennung *gemeint* ist — unabhängig davon, ob
 * sie gültig ist. Ohne diese Unterscheidung liefe eine unvollständige oder
 * syntaktisch abweichende Kennung in die Volltextsuche und träfe dort jede
 * Control, in deren Text sie vorkommt, statt der geforderten null Treffer.
 *
 * Geprüft wird zuerst das Segmentraster 8-4-4-4-12. Das letzte Segment darf
 * kürzer sein, damit ein abgeschnittenes Präfix erkannt wird.
 *
 * Das Raster allein genügt nicht: `Taxonomy-L4` erfüllt es zufällig, ist aber
 * ein fachlicher Suchbegriff. Deshalb muss zusätzlich einer von zwei Ankern
 * greifen — ein vollständig hexadezimaler Kopfblock (jemand tippt oder kopiert
 * eine Kennung) oder das vollständige Fünf-Segment-Raster (eine Kennung, in
 * der ein Zeichen verfälscht ist). Ein Fachbegriff erfüllt weder das eine noch
 * das andere.
 */
function hasIdentifierShape(query: string): boolean {
  const segments = query.split('-');

  if (segments.length < 2 || segments.length > UUID_SEGMENT_LENGTHS.length) {
    return false;
  }

  const matchesSegmentLengths = segments.every((segment, index) => {
    const expectedLength = UUID_SEGMENT_LENGTHS[index];
    const isLastSegment = index === segments.length - 1;

    return isLastSegment
      ? segment.length <= expectedLength
      : segment.length === expectedLength;
  });

  if (!matchesSegmentLengths) {
    return false;
  }

  return (
    HEX_HEAD_SEGMENT.test(segments[0]) ||
    segments.length === UUID_SEGMENT_LENGTHS.length
  );
}

/**
 * Ordnet eine Suchanfrage einem der drei Auswertungspfade zu.
 *
 * - `identifier`: exakte Auflösung über den Kennungsindex
 * - `malformed-identifier`: als Kennung gemeint, aber nicht wohlgeformt — kein
 *   Ergebnis, und kein Rückfall auf die Volltextsuche
 * - `text`: normale Volltextsuche
 */
export function classifyQuery(query: string): QueryKind {
  const trimmed = query.trim();

  if (UUID_PATTERN.test(trimmed)) {
    return 'identifier';
  }

  return hasIdentifierShape(trimmed) ? 'malformed-identifier' : 'text';
}

/**
 * Prüft, ob die Eingabe als Kennung aufzulösen ist. Nur eine vollständige,
 * wohlgeformte UUID zählt — kein Präfix-, Teil- oder Tokenmatch.
 */
export function isIdentifierQuery(query: string): boolean {
  return classifyQuery(query) === 'identifier';
}
