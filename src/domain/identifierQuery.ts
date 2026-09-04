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

/**
 * Kopfblock-Anker: acht Hexziffern, ein Bindestrich, danach beliebige Zeichen
 * ohne Leerraum.
 *
 * Bewusst ohne Zeichenvorrat: Wer eine Kennung tippt oder einfügt, trifft den
 * Kopfblock, und was dahinter schiefgeht — ein falsches Zeichen, ein Zeichen
 * zu viel, ein abgeschnittenes Ende — ändert nichts an der Absicht. Eine
 * Prüfung auf zulässige Zeichen hätte je nach gewähltem Vorrat immer eine
 * Lücke: erst fielen Nicht-Hex-Zeichen durch, dann Unterstriche und
 * Satzzeichen. Leerraum grenzt ab, weil er aus der Eingabe eine Wortfolge
 * macht.
 */
const IDENTIFIER_HEAD_PATTERN = /^[0-9A-Fa-f]{8}-\S*$/;

export type QueryKind = 'identifier' | 'malformed-identifier' | 'text';

/**
 * Raster-Anker: das vollständige Fünf-Segment-Muster 8-4-4-4-12. Er fängt die
 * Fälle ab, in denen schon der Kopfblock verfälscht ist und der Kopfblock-Anker
 * deshalb nicht greift. Auch hier zählt allein die Form; nur Leerraum schließt
 * ein Segment aus.
 */
function matchesFullSegmentGrid(segments: string[]): boolean {
  if (segments.length !== UUID_SEGMENT_LENGTHS.length) {
    return false;
  }

  return segments.every(
    (segment, index) =>
      segment.length === UUID_SEGMENT_LENGTHS[index] && !/\s/.test(segment),
  );
}

/**
 * Erkennt, ob eine Eingabe als Kennung *gemeint* ist — unabhängig davon, ob
 * sie gültig ist. Ohne diese Unterscheidung liefe eine unvollständige oder
 * syntaktisch abweichende Kennung in die Volltextsuche und träfe dort jede
 * Control, in deren Text sie vorkommt, statt der geforderten null Treffer.
 *
 * Einer der beiden Anker muss greifen. Beide sind nötig und keiner reicht
 * allein: Ohne den Kopfblock-Anker bliebe jede Kennung mit verrutschter
 * Segmentlänge Text, und ohne den Raster-Anker jede, deren Kopfblock selbst
 * verfälscht ist.
 *
 * Greift keiner, ist die Eingabe nicht von einem Suchbegriff zu unterscheiden
 * — `Taxonomy-L4` etwa trifft das Segmentraster zufällig, trägt aber weder
 * einen hexadezimalen Kopfblock noch fünf Segmente und wird deshalb weiterhin
 * über den Volltext gesucht.
 */
function hasIdentifierShape(query: string): boolean {
  if (IDENTIFIER_HEAD_PATTERN.test(query)) {
    return true;
  }

  return matchesFullSegmentGrid(query.split('-'));
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
