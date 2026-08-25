// =============================================================================
// Objektgraph-Invariante der Klasse-2-Kette (ADR-8 Festlegung 3)
//
// Positivdefinition statt Verbotsliste; Details und Normbezug:
// docs/OSCAL_VALIDATION.md, „Die gemeinsame objektorientierte Prüfkette“.
// Strukturinvariante und Ressourcenlimits laufen in EINEM terminierenden
// Baumdurchlauf mit einer Identitätsmenge über den ganzen Lauf — Zyklen und
// geteilte Containeridentität werden fail-closed abgelehnt, was den Durchlauf
// zugleich terminierend macht. Weder JSON.stringify noch structuredClone
// werden als Prüfmittel verwendet.
// =============================================================================

import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_LIMITS, CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportContract';

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

function createObjectGraphDiagnostic(code: string): OscalDiagnostic {
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

/**
 * Pfadfenster für die Base64-Erkennung. Das Ressourcenlimit erkennt die
 * Payload über die Adjazenz `'back-matter' → 'resources' → <Index> → 'base64'`;
 * das Fenster bildet genau diese Kante ohne volle Pfadarrays ab.
 */
type PathWindow =
  | 'none'
  | 'after-back-matter-key'
  | 'in-resources-array'
  | 'in-resource-element';

function windowForKey(window: PathWindow, key: string): PathWindow | 'base64-payload' {
  if (key === 'back-matter') return 'after-back-matter-key';
  if (key === 'resources' && window === 'after-back-matter-key') return 'in-resources-array';
  if (key === 'base64' && window === 'in-resource-element') return 'base64-payload';
  return 'none';
}

/** Fenster eines Arrayelements: nur Elemente des `resources`-Arrays tragen weiter. */
function windowForElement(window: PathWindow): PathWindow {
  return window === 'in-resources-array' ? 'in-resource-element' : 'none';
}

function countBase64Padding(encoded: string): number {
  if (encoded.endsWith('==')) return 2;
  if (encoded.endsWith('=')) return 1;
  return 0;
}

function decodedBase64ByteLength(encoded: string): number {
  return Math.max(0, Math.floor(encoded.length / 4) * 3 - countBase64Padding(encoded));
}

type EmbeddedBase64Accounting =
  | { readonly kind: 'accounted'; readonly totalBytes: number }
  | { readonly kind: 'exceeded'; readonly diagnostic: OscalDiagnostic };

/**
 * Summiert die dekodierte Größe eingebetteter Back-matter-Ressourcen ohne
 * tatsächliche Dekodierung und wacht über das Byte-Limit.
 */
function accountEmbeddedBase64(
  payload: Record<string, unknown>,
  totalBytesSoFar: number,
): EmbeddedBase64Accounting {
  const encoded = payload['value'];
  if (typeof encoded !== 'string') {
    return { kind: 'accounted', totalBytes: totalBytesSoFar };
  }

  const totalBytes = totalBytesSoFar + decodedBase64ByteLength(encoded);
  if (totalBytes > CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes) {
    return {
      kind: 'exceeded',
      diagnostic: createClass2ResourceLimitDiagnostic('OSCAL_RESOURCE_BASE64_LIMIT_EXCEEDED', {
        limitDecodedBase64Bytes: CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes,
      }),
    };
  }
  return { kind: 'accounted', totalBytes };
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
 * `length` als normale Data-Property, jede Elementposition voll
 * schreibbar, aufzählbar und konfigurierbar.
 */
function isArrayFormAllowed(array: unknown[]): boolean {
  if (Object.getPrototypeOf(array) !== Array.prototype) return false;

  const length = array.length;
  // Genau die Indizes plus `length`; ein Symbol- oder Fremdschlüssel würde die
  // Anzahl überschreiten und fällt damit ohne Einzelaufzählung heraus.
  if (Reflect.ownKeys(array).length !== length + 1) return false;

  for (let index = 0; index < length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(array, index)) return false;
    if (!isPlainDataDescriptor(Object.getOwnPropertyDescriptor(array, index))) return false;
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(array, 'length');
  return (
    lengthDescriptor !== undefined
    && lengthDescriptor.writable === true
    && lengthDescriptor.enumerable === false
    && lengthDescriptor.configurable === false
  );
}

/**
 * Positivdefinition der Objektform: keine Symbol-Schlüssel, jede eigene
 * Property eine voll schreibbare, aufzählbare, konfigurierbare Data-Property.
 * Geerbte Member sind hier unsichtbar und scheitern am Prototypvergleich bzw.
 * als unzulässiger Wertetyp.
 */
function isObjectFormAllowed(record: Record<string, unknown>): boolean {
  const ownKeys = Reflect.ownKeys(record);
  if (ownKeys.some((key) => typeof key === 'symbol')) return false;
  return ownKeys.every((key) =>
    isPlainDataDescriptor(Object.getOwnPropertyDescriptor(record, key)),
  );
}

/**
 * EIN terminierender Baumdurchlauf für Strukturinvariante und Ressourcenlimits.
 * Reihenfolge je Knoten: Knotenzahl vor Tiefe, dann Form, dann Buchhaltung,
 * dann Kinder.
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

  if (typeof value !== 'object') {
    if (typeof value === 'number') {
      // ±Infinity bleibt zulässig, weil JSON.parse("1e400") es erzeugt.
      return Number.isNaN(value)
        ? createObjectGraphDiagnostic(OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED)
        : null;
    }
    if (typeof value === 'boolean' || typeof value === 'string') return null;
    // undefined, Funktion, BigInt und Symbol als Wert haben keine
    // JSON.parse-Entsprechung.
    return createObjectGraphDiagnostic(OBJECT_GRAPH_DIAGNOSTIC_CODES.VALUE_TYPE_REJECTED);
  }

  const container = value as object;
  if (state.seenContainers.has(container)) {
    // Derselbe Container an zweiter Stelle: Zyklus oder geteilte Identität —
    // beides fail-closed, auch wenn der Graph azyklisch wäre.
    return createObjectGraphDiagnostic(OBJECT_GRAPH_DIAGNOSTIC_CODES.IDENTITY_REJECTED);
  }

  if (Array.isArray(container)) {
    if (!isArrayFormAllowed(container)) {
      return createObjectGraphDiagnostic(OBJECT_GRAPH_DIAGNOSTIC_CODES.ARRAY_SHAPE_REJECTED);
    }
    state.seenContainers.add(container);
    const elementWindow = windowForElement(window);
    for (let index = 0; index < container.length; index += 1) {
      const failure = walkObjectGraph(container[index], depth + 1, state, elementWindow);
      if (failure !== null) return failure;
    }
    return null;
  }

  if (Object.getPrototypeOf(container) !== Object.prototype) {
    // Date, Map, Klasseninstanzen, Null-Prototyp und jeder Custom-Prototyp.
    return createObjectGraphDiagnostic(OBJECT_GRAPH_DIAGNOSTIC_CODES.PROTOTYPE_REJECTED);
  }
  const record = container as Record<string, unknown>;
  if (Reflect.ownKeys(record).some((key) => typeof key === 'symbol')) {
    return createObjectGraphDiagnostic(OBJECT_GRAPH_DIAGNOSTIC_CODES.SYMBOL_KEY_REJECTED);
  }
  if (!isObjectFormAllowed(record)) {
    return createObjectGraphDiagnostic(OBJECT_GRAPH_DIAGNOSTIC_CODES.DESCRIPTOR_REJECTED);
  }
  state.seenContainers.add(container);

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
 * Führt Strukturinvariante und Ressourcenlimits in einem Durchlauf aus.
 * Rückgabe ist `null` bei Erfolg, sonst die erste fail-closed Diagnose.
 */
export function enforceClass2ObjectGraphInvariants(source: unknown): OscalDiagnostic | null {
  return walkObjectGraph(source, 1, { seenContainers: new Set(), nodeCount: 0, decodedBase64Bytes: 0 }, 'none');
}
