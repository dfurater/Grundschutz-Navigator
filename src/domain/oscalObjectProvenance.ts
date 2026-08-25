// =============================================================================
// Herkunftsnachweis der Klasse-2-Kette (ADR-8 Festlegung 3)
//
// Die Kette akzeptiert am Objekteinstieg ausschließlich Werte mit belegter
// Herkunft — für die Wurzel UND jeden Container des Graphen. Diese Einheit ist
// die einzige Quelle solcher Belege: Sie führt das JSON.parse selbst aus und
// registriert jeden Container des Parse-Produkts in einem modulprivaten
// WeakSet. Es gibt keinen importierbaren Schreibzugriff auf das Register — ein
// Beleg entsteht ausschließlich als Nebenprodukt eines echten Parse-Laufs.
// Weil jeder Container einzeln belegt ist, fällt eine Nach-Parse-Manipulation
// (Eintausch eines Teilbaums oder Proxy-Einschub) am fehlenden Beleg des
// Ersatzcontainers auf. Die Prüfung ist eine reine Identitätsfrage und findet
// vor jeder Reflexion statt; ein Proxy um einen echten Container besitzt eine
// andere Identität und bleibt unbelegt. Der Ableitungsweg erhält sein eigenes,
// ebenso geschlossen verwaltetes Handle-Register mit GSPP-291 Commit B.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { OBJECT_GRAPH_STAGE } from '@/domain/oscalObjectGraph';

/** Code der fehlenden Herkunftsbelegung am Objekteinstieg. */
export const OSCAL_OBJECT_UNPROVENANCED = 'OSCAL_OBJECT_UNPROVENANCED';

/** Modulprivates Register aller Container, die das eigene JSON.parse erzeugte. */
const parserProducedContainers = new WeakSet<object>();

function registerTree(value: unknown): void {
  if (value === null || typeof value !== 'object') return;
  parserProducedContainers.add(value);
  if (Array.isArray(value)) {
    for (const element of value) registerTree(element);
    return;
  }
  for (const propertyValue of Object.values(value)) registerTree(propertyValue);
}

/**
 * Führt das JSON.parse des Byte-Eintrittspunkts aus und belegt die Wurzel
 * samt jedes Containers ihres Baums als parser-erzeugt. Die Registrierung
 * ist nicht einzeln aufrufbar: Ein Beleg entsteht ausschließlich hier, als
 * Nebenprodukt des eigenen Parse-Laufs.
 */
export function parseAndRegisterOscalJson(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  registerTree(parsed);
  return parsed;
}

/** Reine Identitätsfrage; kein Feldzugriff, keine Reflexion, nicht fälschbar. */
export function isParserProducedRoot(source: object): boolean {
  return parserProducedContainers.has(source);
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
