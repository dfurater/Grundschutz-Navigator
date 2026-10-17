/**
 * Ressourcengrenzen des Klasse-2-Eingangspfads (GSPP-382).
 *
 * Einzige Quelle der Wahrheit dieser vier Werte, als reines ESM-Modul wie
 * `oscalVersionMatrix.mjs` und `sourceRegistry.mjs`. Der Anwendungspfad liest
 * sie über `oscalImportContract.ts`.
 *
 * Grenzwerte, Schutzzweck und prüfende Tests: `docs/OSCAL_VALIDATION.md`,
 * Abschnitt „Klasse-2-Grenzwerte".
 */
export const CLASS_2_IMPORT_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
  /**
   * Die Grenze muss unter der Byte-Obergrenze ERREICHBAR bleiben: Ein
   * base64-Wert steht als Text im Dokument, seine dekodierte Größe ist also
   * höchstens drei Viertel von `maxBytes`. Ein auf `maxBytes` gesetzter Wert
   * konnte deshalb nie auslösen und war keine Kontrolle, sondern toter Code
   * (GSPP-382). `class2ImportLimits.invariants.test.ts` hält die
   * Erreichbarkeit dauerhaft fest.
   */
  maxDecodedBase64Bytes: 4 * 1024 * 1024,
});

/** Aggregate UTF-8 byte cap for user-triggered workspace restore. */
export const WORKSPACE_BACKUP_MAX_BYTES = 32 * 1024 * 1024;
