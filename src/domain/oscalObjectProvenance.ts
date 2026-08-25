// =============================================================================
// Herkunftsnachweis der Klasse-2-Kette (ADR-8 Festlegung 3)
//
// Die Kette akzeptiert am Objekteinstieg ausschließlich Werte mit belegter
// Herkunft. Der Byte-Eintrittspunkt registriert hier das unmittelbare Ergebnis
// seines eigenen JSON.parse in einer modulprivaten WeakSet; die Prüfung ist
// eine reine Identitätsfrage und findet vor jeder Reflexion statt. Ein Proxy
// um ein echtes Ergebnis besitzt eine andere Containeridentität und bleibt
// unbelegt. Es gibt keinen öffentlichen Weg, ein fremdes Objekt als „geparst“
// zu markieren. Der Ableitungsweg erhält sein eigenes Handle-Register mit
// GSPP-291 Commit B.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { OBJECT_GRAPH_STAGE } from '@/domain/oscalObjectGraph';

/** Code der fehlenden Herkunftsbelegung am Objekteinstieg. */
export const OSCAL_OBJECT_UNPROVENANCED = 'OSCAL_OBJECT_UNPROVENANCED';

/** Modulprivates Register der vom eigenen JSON.parse erzeugten Wurzelwerte. */
const parserProducedRoots = new WeakSet<object>();

/**
 * Belegt einen Wurzelwert als Produkt des eigenen JSON.parse. Ausschließlich
 * für den Byte-Eintrittspunkt (`parseClass2OscalInput`) bestimmt.
 */
export function registerParserProducedRoot(source: object): void {
  parserProducedRoots.add(source);
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
