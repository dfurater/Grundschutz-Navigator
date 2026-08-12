import { createOscalDiagnostic, type OscalDiagnostic } from '@/domain/oscalDiagnostics';

export const CLASS_2_IMPORT_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxDepth: 64,
  maxNodes: 1_000_000,
  maxDecodedBase64Bytes: 10 * 1024 * 1024,
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
