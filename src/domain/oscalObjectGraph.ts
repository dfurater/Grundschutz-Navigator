// =============================================================================
// Objektgraph-Invariante der Klasse-2-Kette (ADR-8 Festlegung 3)
//
// Positivdefinition statt Verbotsliste; Details: docs/OSCAL_VALIDATION.md,
// „Die gemeinsame objektorientierte Prüfkette“. Strukturinvariante und
// Ressourcenlimits laufen in EINEM terminierenden Baumdurchlauf mit globaler
// Identitätsmenge (Zyklen und geteilte Containeridentität fail-closed). Weder
// JSON.stringify noch structuredClone als Prüfmittel. Die Einheit ist die
// Postcondition gegen Builderfehler: Der Byteweg kann die geprüften Formen
// sprachlich nicht erzeugen, der Ableitungsweg (Commit B) schon — sein
// Herkunftsnachweis liegt in oscalObjectProvenance.ts.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_LIMITS, CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportContract';
import {
  accountEmbeddedBase64,
  windowForElement,
  windowForKey,
  type PathWindow,
} from '@/domain/oscalBackMatterBase64';

/** Eigene Prüfstufe der Objektgraph-Invariante in der Diagnose-Signatur. */
export const OBJECT_GRAPH_STAGE = 'object-structure' as const;

const OBJECT_GRAPH_VALIDATOR = Object.freeze({
  name: 'gspp-class-2-object-pipeline',
  version: '1',
});

/** Stabile, redigierte Codes der Objektgraph-Invariante. */
export const OBJECT_GRAPH_DIAGNOSTIC_CODES = Object.freeze({
  /** Containeridentität wiederholt sich im Graphen (Zyklus oder geteilter Teilbaum). */
  IDENTITY_REJECTED: 'OSCAL_OBJECT_IDENTITY_REJECTED',
  /** Arrayform verletzt die Positivdefinition (Prototyp, Lücken, Fremd- oder Symbolschlüssel, Deskriptor). */
  ARRAY_SHAPE_REJECTED: 'OSCAL_OBJECT_ARRAY_SHAPE_REJECTED',
  /** Prototyp eines Objekts ist nicht exakt `Object.prototype`. */
  PROTOTYPE_REJECTED: 'OSCAL_OBJECT_PROTOTYPE_REJECTED',
  /** Eigene Property ist keine voll schreibbare, aufzählbare, konfigurierbare Data-Property. */
  DESCRIPTOR_REJECTED: 'OSCAL_OBJECT_DESCRIPTOR_REJECTED',
  /** Symbol-Schlüssel in einem Objekt. */
  SYMBOL_KEY_REJECTED: 'OSCAL_OBJECT_SYMBOL_KEY_REJECTED',
  /** Werttyp außerhalb der zulässigen Primitive — einschließlich `NaN`. */
  VALUE_TYPE_REJECTED: 'OSCAL_OBJECT_VALUE_TYPE_REJECTED',
});

/** Ressourcenlimit-Diagnose mit den freigegebenen Zahlenparametern. */
export function createClass2ResourceLimitDiagnostic(
  code: string,
  params: Readonly<Record<string, number>>,
): OscalDiagnostic {
  return createOscalDiagnostic({
    code,
    stage: 'resource-limit',
    validator: CLASS_2_IMPORT_VALIDATOR,
    path: '/',
    params,
  });
}

function reject(code: string): OscalDiagnostic {
  return createOscalDiagnostic({
    code,
    stage: OBJECT_GRAPH_STAGE,
    validator: OBJECT_GRAPH_VALIDATOR,
    path: '/',
  });
}

interface WalkState {
  /** Identitätsmenge über den GESAMTEN Lauf, nicht nur den aktiven Pfad. */
  readonly seenContainers: Set<object>;
  nodeCount: number;
  /** Summe der arithmetisch bestimmten, dekodierten Back-matter-base64-Größen. */
  decodedBase64Bytes: number;
}

function isPlainDataDescriptor(descriptor: PropertyDescriptor | undefined): boolean {
  return (
    descriptor !== undefined
    && descriptor.get === undefined
    && descriptor.set === undefined
    && descriptor.writable === true
    && descriptor.enumerable === true
    && descriptor.configurable === true
  );
}

/**
 * Positivdefinition der Arrayform: eigener Schlüsselbestand genau die Indizes
 * `0..length-1` plus `length`, keine Lücken, keine Symbol- oder Fremdschlüssel,
 * `length` als normale Data-Property, jede Elementposition voll schreibbar,
 * aufzählbar und konfigurierbar.
 */
function isArrayFormAllowed(array: unknown[]): boolean {
  if (Object.getPrototypeOf(array) !== Array.prototype) return false;

  // Genau die Indizes plus `length`; ein Symbol- oder Fremdschlüssel würde die
  // Anzahl überschreiten und fällt damit ohne Einzelaufzählung heraus.
  if (Reflect.ownKeys(array).length !== array.length + 1) return false;

  for (let index = 0; index < array.length; index += 1) {
    if (!Object.hasOwn(array, index)) return false;
    if (!isPlainDataDescriptor(Object.getOwnPropertyDescriptor(array, index))) return false;
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(array, 'length');
  return (
    lengthDescriptor?.writable === true
    && lengthDescriptor.enumerable === false
    && lengthDescriptor.configurable === false
  );
}

/**
 * Objektform: keine Symbol-Schlüssel, jede eigene Property voll schreibbar,
 * aufzählbar und konfigurierbar; Geerbtes scheitert am Prototypvergleich.
 */
function isObjectFormAllowed(record: Record<string, unknown>): boolean {
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key === 'symbol')) return false;
  return ownKeys.every((key) =>
    isPlainDataDescriptor(Object.getOwnPropertyDescriptor(record, key)),
  );
}

/** Primitivwerte: zulässig sind null, Boolean, String und Number außer NaN. */
function visitPrimitive(value: Exclude<unknown, object | null>): OscalDiagnostic | null {
  if (typeof value === 'number') {
    // ±Infinity bleibt zulässig, weil JSON.parse("1e400") es erzeugt.
    return Number.isNaN(value)
      ? reject(OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED)
      : null;
  }
  if (typeof value === 'boolean' || typeof value === 'string') return null;
  // undefined, Funktion, BigInt und Symbol als Wert haben keine
  // JSON.parse-Entsprechung.
  return reject(OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED);
}

/** Arrayform prüfen, registrieren und Elemente im selben Durchlauf besuchen. */
function visitArray(
  array: unknown[],
  depth: number,
  state: WalkState,
  window: PathWindow,
): OscalDiagnostic | null {
  if (!isArrayFormAllowed(array)) {
    return reject(OBJECT_GRAPH_DIAGNOSTIC_CODES.ARRAY_SHAPE_REJECTED);
  }
  state.seenContainers.add(array);
  const elementWindow = windowForElement(window);
  for (const element of array) {
    const failure = walkObjectGraph(element, depth + 1, state, elementWindow);
    if (failure !== null) return failure;
  }
  return null;
}

/** Objektform prüfen, registrieren, Base64-Buchhaltung führen und Kinder besuchen. */
function visitRecord(
  record: Record<string, unknown>,
  depth: number,
  state: WalkState,
  window: PathWindow,
): OscalDiagnostic | null {
  if (Reflect.ownKeys(record).some((key) => typeof key === 'symbol')) {
    return reject(OBJECT_GRAPH_DIAGNOSTIC_CODES.SYMBOL_KEY_REJECTED);
  }
  if (!isObjectFormAllowed(record)) {
    return reject(OBJECT_GRAPH_DIAGNOSTIC_CODES.DESCRIPTOR_REJECTED);
  }
  state.seenContainers.add(record);

  for (const [key, propertyValue] of Object.entries(record)) {
    const childWindow = windowForKey(window, key);

    // Base64-Buchhaltung an genau der alten Adjazenz, ohne Dekodierung.
    if (
      childWindow === 'base64-payload'
      && typeof propertyValue === 'object'
      && propertyValue !== null
      && !Array.isArray(propertyValue)
      && Object.getPrototypeOf(propertyValue) === Object.prototype
    ) {
      const accounting = accountEmbeddedBase64(
        propertyValue as Record<string, unknown>,
        state.decodedBase64Bytes,
      );
      if (accounting.kind === 'exceeded') return accounting.diagnostic;
      state.decodedBase64Bytes = accounting.totalBytes;
    }

    const failure = walkObjectGraph(
      propertyValue,
      depth + 1,
      state,
      childWindow === 'base64-payload' ? 'none' : childWindow,
    );
    if (failure !== null) return failure;
  }
  return null;
}

/**
 * EIN terminierender Baumdurchlauf: Knotenzahl vor Tiefe, dann Form, dann
 * Buchhaltung, dann Kinder.
 */
function walkObjectGraph(
  value: unknown,
  depth: number,
  state: WalkState,
  window: PathWindow,
): OscalDiagnostic | null {
  state.nodeCount += 1;
  if (state.nodeCount > CLASS_2_IMPORT_LIMITS.maxNodes) {
    return createClass2ResourceLimitDiagnostic('OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED', {
      limitNodes: CLASS_2_IMPORT_LIMITS.maxNodes,
    });
  }
  if (depth > CLASS_2_IMPORT_LIMITS.maxDepth) {
    return createClass2ResourceLimitDiagnostic('OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED', {
      limitDepth: CLASS_2_IMPORT_LIMITS.maxDepth,
    });
  }

  if (value === null) return null;
  if (typeof value !== 'object') return visitPrimitive(value);

  const container = value as object;
  if (state.seenContainers.has(container)) {
    // Derselbe Container an zweiter Stelle: Zyklus oder geteilte Identität —
    // beides fail-closed, auch wenn der Graph azyklisch wäre.
    return reject(OBJECT_GRAPH_DIAGNOSTIC_CODES.IDENTITY_REJECTED);
  }

  if (Array.isArray(container)) {
    return visitArray(container, depth, state, window);
  }
  if (Object.getPrototypeOf(container) !== Object.prototype) {
    // Date, Map, Klasseninstanzen, Null-Prototyp und jeder Custom-Prototyp.
    return reject(OBJECT_GRAPH_DIAGNOSTIC_CODES.PROTOTYPE_REJECTED);
  }
  return visitRecord(container as Record<string, unknown>, depth, state, window);
}

/**
 * Führt Strukturinvariante und Ressourcenlimits in einem Durchlauf aus.
 * Rückgabe ist `null` bei Erfolg, sonst die erste fail-closed Diagnose.
 */
export function enforceClass2ObjectGraphInvariants(source: unknown): OscalDiagnostic | null {
  return walkObjectGraph(
    source,
    1,
    { seenContainers: new Set(), nodeCount: 0, decodedBase64Bytes: 0 },
    'none',
  );
}
