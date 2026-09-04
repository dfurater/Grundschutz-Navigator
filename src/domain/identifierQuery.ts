/**
 * Query-Vertrag für Kennungssuchen.
 *
 * Die Syntax ist an OSCAL 1.1.3 gepinnt: `UUIDDatatype` akzeptiert exakt
 * UUID v4 und v5. Damit ist "vollständig und wohlgeformt" ohne
 * Implementationsspielraum festgelegt und eine unvollständige Eingabe fällt
 * nicht versehentlich in die Kennungsauflösung.
 *
 * @see https://github.com/usnistgov/OSCAL/releases/download/v1.1.3/oscal_catalog_schema.json
 */
const UUID_PATTERN =
  /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[45][0-9A-Fa-f]{3}-[89ABab][0-9A-Fa-f]{3}-[0-9A-Fa-f]{12}$/;

/**
 * Prüft, ob die Eingabe als Kennung aufzulösen ist. Nur eine vollständige,
 * wohlgeformte UUID zählt — kein Präfix-, Teil- oder Tokenmatch.
 */
export function isIdentifierQuery(query: string): boolean {
  return UUID_PATTERN.test(query.trim());
}
