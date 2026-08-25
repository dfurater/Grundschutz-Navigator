// =============================================================================
// Herkunftsnachweis der Klasse-2-Kette (ADR-8 Festlegung 3)
//
// Die Kette akzeptiert am Objekteinstieg ausschließlich Werte mit belegter
// Herkunft. Diese Einheit ist die einzige Quelle solcher Belege: Sie führt das
// JSON.parse selbst aus und registriert sein Ergebnis in einem modulprivaten
// WeakSet. Es gibt keinen importierbaren Schreibzugriff auf das Register —
// ein Beleg entsteht ausschließlich als Nebenprodukt eines echten Parse-Laufs.
// Die Prüfung ist eine reine Identitätsfrage und findet vor jeder Reflexion
// statt; ein Proxy um ein echtes Ergebnis besitzt eine andere Containeridentität
// und bleibt unbelegt. Der Ableitungsweg erhält sein eigenes, ebenso
// geschlossen verwaltetes Handle-Register mit GSPP-291 Commit B.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { OBJECT_GRAPH_STAGE } from '@/domain/oscalObjectGraph';

/** Code der fehlenden Herkunftsbelegung am Objekteinstieg. */
export const OSCAL_OBJECT_UNPROVENANCED = 'OSCAL_OBJECT_UNPROVENANCED';

/** Modulprivates Register der vom eigenen JSON.parse erzeugten Wurzelwerte. */
const parserProducedRoots = new WeakSet<object>();

/**
 * Führt das JSON.parse des Byte-Eintrittspunkts aus und belegt das Ergebnis
 * als parser-erzeugt. Die Registrierung ist nicht einzeln aufrufbar: Ein Beleg
 * entsteht ausschließlich hier, als Nebenprodukt des eigenen Parse-Laufs.
 */
export function parseAndRegisterOscalJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  // Nur Container sind im WeakSet registrierbar; primitive Wurzeln laufen
  // unverändert in den Root-Dispatch und erhalten dort ihre Diagnose.
  if (parsed !== null && typeof parsed === 'object') {
    parserProducedRoots.add(parsed);
  }
  return parsed;
}

/** Reine Identitätsfrage; kein Feldzugriff, keine Reflexion, nicht fälschbar. */
export function isParserProducedRoot(source: object): boolean {
  return parserProducedRoots.has(source);
}

/** Fail-closed Diagnose für einen Wert ohne Herkunftsbelegung — ohne Inhalt. */
export function createClass2UnprovenancedDiagnostic(): OscalDiagnostic {
  return createOscalDiagnostic({
    code: OSCAL_OBJECT_UNPROVENANCED,
    stage: OBJECT_GRAPH_STAGE,
    validator: { name: 'gspp-class-2-object-pipeline', version: '1' },
    path: '/',
  });
}
