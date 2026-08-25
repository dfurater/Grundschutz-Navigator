// =============================================================================
// Herkunftsbelegung der Klasse-2-Kette (ADR-8 Festlegung 3)
//
// Diese Einheit exponiert ausschließlich die Identitätsfrage und die
// fail-closed Diagnose. Das Register lebt als modulprivater, nicht
// exportierter Zustand im Byte-Eintrittspunkt (oscalImportProcessing.ts):
// Nur dort — nach bestandener vollständiger Byte- und Textpolitik — entsteht
// ein Beleg; ein importierbarer Schreibzugriff existiert nirgends. Die
// Identitätsfrage wird von dort als nur-lesender Export unverändert
// weitergeführt.
//
// Die Registrierung erfasst jeden Container des Parse-Produkts — iterativ
// mit explizitem Stack, Visited-Menge gegen nachträglich in Kreise
// eingehängte Container und über Property-Deskriptoren, sodass Accessor-
// Getter niemals ausgeführt werden.
//
// Der Ableitungsweg erhält sein eigenes, ebenso geschlossen verwaltetes
// Handle-Register mit GSPP-291 Commit B.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { OBJECT_GRAPH_STAGE } from '@/domain/oscalObjectGraph';

/**
 * Reine Identitätsfrage über das Register des Byte-Eintrittspunkts; kein
 * Feldzugriff, keine Reflexion, nicht fälschbar. Die einzige Quelle von
 * Belegen bleibt der vollständige Bytepolitik-Weg in oscalImportProcessing.ts.
 */
export { isParserProducedRoot } from '@/domain/oscalImportProcessing';

/** Code der fehlenden Herkunftsbelegung am Objekteinstieg. */
export const OSCAL_OBJECT_UNPROVENANCED = 'OSCAL_OBJECT_UNPROVENANCED';

/** Fail-closed Diagnose für einen Wert ohne Herkunftsbelegung — ohne Inhalt. */
export function createClass2UnprovenancedDiagnostic(): OscalDiagnostic {
  return createOscalDiagnostic({
    code: OSCAL_OBJECT_UNPROVENANCED,
    stage: OBJECT_GRAPH_STAGE,
    validator: { name: 'gspp-class-2-object-pipeline', version: '1' },
    path: '/',
  });
}
