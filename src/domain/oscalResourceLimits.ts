import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
} from '@/domain/oscalImportContract';

type JsonPathSegment = string | number;

interface ValueToVisit {
  readonly value: unknown;
  readonly depth: number;
  readonly path: readonly JsonPathSegment[];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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

function isEmbeddedBase64(path: readonly JsonPathSegment[]): boolean {
  const length = path.length;
  return path[length - 1] === 'base64'
    && typeof path[length - 2] === 'number'
    && path[length - 3] === 'resources'
    && path[length - 4] === 'back-matter';
}

function countBase64Padding(encoded: string): number {
  if (encoded.endsWith('==')) return 2;
  if (encoded.endsWith('=')) return 1;
  return 0;
}

function decodedBase64ByteLength(encoded: string): number {
  return Math.max(0, Math.floor(encoded.length / 4) * 3 - countBase64Padding(encoded));
}

/** Strukturelle Limitprüfung je Knoten; Reihenfolge: Knotenanzahl vor Tiefe. */
function structuralLimitViolation(
  current: ValueToVisit,
  nodeCount: number,
): OscalDiagnostic | null {
  if (nodeCount > CLASS_2_IMPORT_LIMITS.maxNodes) {
    return createClass2ResourceLimitDiagnostic('OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED', {
      limitNodes: CLASS_2_IMPORT_LIMITS.maxNodes,
    });
  }
  if (current.depth > CLASS_2_IMPORT_LIMITS.maxDepth) {
    return createClass2ResourceLimitDiagnostic('OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED', {
      limitDepth: CLASS_2_IMPORT_LIMITS.maxDepth,
    });
  }
  return null;
}

type EmbeddedBase64Accounting =
  | { readonly kind: 'accounted'; readonly totalBytes: number }
  | { readonly kind: 'exceeded'; readonly diagnostic: OscalDiagnostic };

/**
 * Summiert die dekodierte Größe eingebetteter Back-matter-Ressourcen ohne
 * tatsächliche Dekodierung und wacht über das Byte-Limit.
 */
function accountEmbeddedBase64(
  current: ValueToVisit,
  totalBytesSoFar: number,
): EmbeddedBase64Accounting {
  if (
    !isJsonObject(current.value)
    || !isEmbeddedBase64(current.path)
    || typeof current.value.value !== 'string'
  ) {
    return { kind: 'accounted', totalBytes: totalBytesSoFar };
  }

  const totalBytes = totalBytesSoFar + decodedBase64ByteLength(current.value.value);
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

/** Hängt die Kindknoten von Objekten und Arrays in Traversierungsreihenfolge an. */
function appendChildren(pending: ValueToVisit[], current: ValueToVisit): void {
  if (Array.isArray(current.value)) {
    for (const [index, value] of current.value.entries()) {
      pending.push({ value, depth: current.depth + 1, path: [...current.path, index] });
    }
    return;
  }
  if (isJsonObject(current.value)) {
    for (const [key, value] of Object.entries(current.value)) {
      pending.push({ value, depth: current.depth + 1, path: [...current.path, key] });
    }
  }
}

/** Prüft geparste JSON-Werte ohne Rekursion und ohne Base64-Dekodierung. */
export function enforceClass2ResourceLimits(source: unknown): OscalDiagnostic | null {
  const pending: ValueToVisit[] = [{ value: source, depth: 1, path: [] }];
  let nodeCount = 0;
  let decodedBase64Bytes = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodeCount += 1;

    const structuralViolation = structuralLimitViolation(current, nodeCount);
    if (structuralViolation !== null) return structuralViolation;

    const base64 = accountEmbeddedBase64(current, decodedBase64Bytes);
    if (base64.kind === 'exceeded') return base64.diagnostic;
    decodedBase64Bytes = base64.totalBytes;

    appendChildren(pending, current);
  }

  return null;
}
