/**
 * Ressourcengrenzen des Klasse-2-Eingangspfads (GSPP-382).
 *
 * Einzige Quelle der Wahrheit dieser vier Werte. Sie stehen bewusst in einem
 * reinen ESM-Modul und nicht in `oscalImportContract.ts`: Neben der App
 * braucht der Messapparat (`scripts/measure-class2-budget.mjs` und die von ihm
 * geladenen Fixtures) dieselben Zahlen in einer nackten Node-Laufzeit ohne
 * Aliasauflösung und ohne TypeScript. Eine zweite Wertetabelle für den
 * Messapparat hieße, an einer Grenze zu messen, die die Anwendung womöglich
 * gar nicht mehr zieht. Gleiches Muster wie `oscalVersionMatrix.mjs` und
 * `sourceRegistry.mjs`.
 *
 * Herleitung, Messprotokoll und Budget: `docs/OSCAL_VALIDATION.md`, Abschnitt
 * „Klasse-2-Grenzwerte". Die Werte sind kostenbasiert belegt (GSPP-382) — sie
 * folgen dem gemessenen Ressourcenabdruck eines Dokuments EXAKT AN DER GRENZE,
 * nicht dem Kopfraum über dem realen BSI-Katalog.
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
