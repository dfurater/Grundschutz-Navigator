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

/**
 * Das Grundraster einer Kennung: acht Hexziffern, ein Bindestrich, danach nur
 * noch Hexziffern und Bindestriche.
 *
 * Es entscheidet, ob eine Eingabe überhaupt als Kennung *gemeint* ist. Ohne
 * diese Unterscheidung liefe eine unvollständige oder syntaktisch abweichende
 * Kennung in die Volltextsuche und träfe dort jede Control, in deren Text das
 * Fragment vorkommt — statt der geforderten null Treffer.
 *
 * Das Raster ist bewusst eng: Ein achtstelliger Hexblock mit folgendem
 * Bindestrich ist als fachlicher Suchbegriff nicht zu erwarten, während jedes
 * Präfix einer echten Kennung ihn erfüllt.
 */
const IDENTIFIER_SHAPE_PATTERN = /^[0-9A-Fa-f]{8}-[0-9A-Fa-f-]*$/;

export type QueryKind = 'identifier' | 'malformed-identifier' | 'text';

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

  return IDENTIFIER_SHAPE_PATTERN.test(trimmed) ? 'malformed-identifier' : 'text';
}

/**
 * Prüft, ob die Eingabe als Kennung aufzulösen ist. Nur eine vollständige,
 * wohlgeformte UUID zählt — kein Präfix-, Teil- oder Tokenmatch.
 */
export function isIdentifierQuery(query: string): boolean {
  return classifyQuery(query) === 'identifier';
}
