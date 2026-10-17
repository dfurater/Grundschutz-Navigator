/**
 * Typdeklarationen für die Klasse-2-Ressourcengrenzen (GSPP-382).
 * Muss mit `class2ImportLimits.mjs` übereinstimmen.
 */

export interface Class2ImportLimits {
  /** Obergrenze der Dokumentgröße in UTF-8-Bytes. */
  readonly maxBytes: number;
  /** Größte zulässige Schachtelungstiefe des JSON-Werts. */
  readonly maxDepth: number;
  /** Obergrenze der Knoten im JSON-Wert. */
  readonly maxNodes: number;
  /** Obergrenze der dekodierten Größe eines base64-Werts im Back-Matter. */
  readonly maxDecodedBase64Bytes: number;
}

export const CLASS_2_IMPORT_LIMITS: Class2ImportLimits;

/** Aggregate UTF-8 byte cap for user-triggered workspace restore. */
export const WORKSPACE_BACKUP_MAX_BYTES: number;
/** Bundle root -> store array -> row -> source adds three levels. */
export const WORKSPACE_BACKUP_FRAME_DEPTH: number;
