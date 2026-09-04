import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';

/**
 * Ressourcengrenzen des Klasse-2-Eingangspfads.
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

export const CLASS_2_IMPORT_VALIDATOR = Object.freeze({
  name: 'gspp-class-2-import',
  version: '1',
});

/** Verhindert einen dauerhaft hängenden Klasse-2-Import im Main-Thread. */
export const CLASS_2_IMPORT_WORKER_TIMEOUT_MS = 30_000;

export function createClass2ByteLimitDiagnostic(): OscalDiagnostic {
  return createOscalDiagnostic({
    code: 'OSCAL_BYTE_LIMIT_EXCEEDED',
    stage: 'resource-limit',
    validator: CLASS_2_IMPORT_VALIDATOR,
    path: '/',
    params: { limitBytes: CLASS_2_IMPORT_LIMITS.maxBytes },
  });
}
