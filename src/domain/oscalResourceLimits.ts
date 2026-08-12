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

function resourceLimitDiagnostic(
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

function decodedBase64ByteLength(encoded: string): number {
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor(encoded.length / 4) * 3 - padding);
}

/** Prüft geparste JSON-Werte ohne Rekursion und ohne Base64-Dekodierung. */
export function enforceClass2ResourceLimits(source: unknown): OscalDiagnostic | null {
  const pending: ValueToVisit[] = [{ value: source, depth: 1, path: [] }];
  let nodeCount = 0;
  let decodedBase64Bytes = 0;

  while (pending.length > 0) {
    const current = pending.pop()!;
    nodeCount += 1;
    if (nodeCount > CLASS_2_IMPORT_LIMITS.maxNodes) {
      return resourceLimitDiagnostic('OSCAL_RESOURCE_NODE_LIMIT_EXCEEDED', {
        limitNodes: CLASS_2_IMPORT_LIMITS.maxNodes,
      });
    }
    if (current.depth > CLASS_2_IMPORT_LIMITS.maxDepth) {
      return resourceLimitDiagnostic('OSCAL_RESOURCE_DEPTH_LIMIT_EXCEEDED', {
        limitDepth: CLASS_2_IMPORT_LIMITS.maxDepth,
      });
    }

    if (isJsonObject(current.value)) {
      if (isEmbeddedBase64(current.path) && typeof current.value.value === 'string') {
        decodedBase64Bytes += decodedBase64ByteLength(current.value.value);
        if (decodedBase64Bytes > CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes) {
          return resourceLimitDiagnostic('OSCAL_RESOURCE_BASE64_LIMIT_EXCEEDED', {
            limitDecodedBase64Bytes: CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes,
          });
        }
      }

      for (const [key, value] of Object.entries(current.value)) {
        pending.push({ value, depth: current.depth + 1, path: [...current.path, key] });
      }
      continue;
    }

    if (Array.isArray(current.value)) {
      for (const [index, value] of current.value.entries()) {
        pending.push({ value, depth: current.depth + 1, path: [...current.path, index] });
      }
    }
  }

  return null;
}
