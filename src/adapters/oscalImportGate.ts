import { createOscalDiagnostic, OSCAL_DIAGNOSTIC_STAGES, toDiagnosticSignature, toDiagnosticMessageKey } from '@/domain/oscalDiagnostics';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
  CLASS_2_IMPORT_WORKER_TIMEOUT_MS,
  createClass2ByteLimitDiagnostic,
} from '@/domain/oscalImportContract';
import type {
  Class2OscalDocumentContext,
  Class2OscalImportResult,
  Class2OscalImportedDocument,
} from '@/domain/oscalClass2Import';
import { OscalSourceDecoder } from '@/domain/oscalImportTransport';
import { isKnownOscalRootKey, isPinnedOscalVersion, resolveSchemaBinding } from '@/domain/oscalVersionMatrix';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';

function hasKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

const diagnosticStages: readonly unknown[] = OSCAL_DIAGNOSTIC_STAGES;

function isDiagnostic(value: unknown): value is OscalDiagnostic {
  if (!hasKeys(value, ['code', 'severity', 'stage', 'artifact', 'path', 'validator', 'signature', 'messageKey', 'params'])) return false;
  if (typeof value.code !== 'string' || !/^OSCAL_[A-Z0-9_]+$/.test(value.code) || value.severity !== 'error'
    || !diagnosticStages.includes(value.stage)
    || typeof value.path !== 'string' || !value.path.startsWith('/')
    || !hasKeys(value.validator, ['name', 'version']) || typeof value.validator.name !== 'string' || typeof value.validator.version !== 'string'
    || !hasKeys(value.artifact, ['key', 'rootType', 'oscalVersion'])
    || ![value.artifact.key, value.artifact.rootType, value.artifact.oscalVersion].every(field => field === null || typeof field === 'string')
    || value.params === null || typeof value.params !== 'object' || Array.isArray(value.params)) return false;
  if (!Object.values(value.params).every(param => typeof param === 'string' || (typeof param === 'number' && Number.isFinite(param)))) return false;
  const diagnostic = value as unknown as OscalDiagnostic;
  return diagnostic.signature === toDiagnosticSignature(diagnostic.validator, diagnostic.code, diagnostic.path)
    && diagnostic.messageKey === toDiagnosticMessageKey(diagnostic.stage, diagnostic.code);
}

function workerFailure(): Class2OscalImportResult {
  return {
    ok: false,
    diagnostic: createOscalDiagnostic({
      code: 'OSCAL_IMPORT_WORKER_FAILURE',
      stage: 'domain',
      validator: CLASS_2_IMPORT_VALIDATOR,
      path: '/',
    }),
  };
}

function copyForTransfer(bytes: ArrayBuffer | Uint8Array): ArrayBuffer {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new ArrayBuffer(source.byteLength);
  new Uint8Array(copy).set(source);
  return copy;
}

/**
 * Der einzige Anwendungseinstieg für unvertraute Klasse-2-Bytes. Der
 * Main-Thread überträgt sie unverändert an den Modul-Worker und führt weder
 * Dekodierung noch JSON- oder OSCAL-Interpretation selbst aus.
 */
export function importClass2OscalDocument(
  bytes: ArrayBuffer | Uint8Array,
  context: Class2OscalDocumentContext,
): Promise<Class2OscalImportResult> {
  if (bytes.byteLength > CLASS_2_IMPORT_LIMITS.maxBytes) {
    return Promise.resolve({ ok: false, diagnostic: createClass2ByteLimitDiagnostic() });
  }

  let transferable: ArrayBuffer;
  let invocationContext: Class2OscalDocumentContext;
  try {
    transferable = copyForTransfer(bytes);
    // All declared context fields are scalar; retain the call-time values.
    invocationContext = { ...context };
  } catch {
    return Promise.resolve(workerFailure());
  }

  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/oscalImport.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      resolve(workerFailure());
      return;
    }

    let completed = false;
    let decoder: OscalSourceDecoder | undefined;
    let metadata: Pick<Class2OscalImportedDocument, 'rootType' | 'oscalVersion'> | undefined;
    let sequence = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function complete(result: Class2OscalImportResult): void {
      if (completed) return;
      completed = true;
      decoder?.dispose();
      decoder = undefined;
      metadata = undefined;

      if (timeout !== undefined) clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onWorkerFailure);
      worker.removeEventListener('messageerror', onWorkerFailure);
      worker.terminate();
      resolve(result);
    }

    const onMessage = (event: MessageEvent): void => {
      if (completed) return;
      try {
        const frame = event.data;
        if (!frame || typeof frame !== 'object') throw new Error('Invalid frame');
        if (frame.type === 'start' && hasKeys(frame, ['type', 'rootType', 'oscalVersion']) && !decoder && typeof frame.rootType === 'string' && typeof frame.oscalVersion === 'string' && isKnownOscalRootKey(frame.rootType) && isPinnedOscalVersion(frame.oscalVersion) && resolveSchemaBinding({ rootType: frame.rootType, oscalVersion: frame.oscalVersion }).ok) {
          metadata = { rootType: frame.rootType, oscalVersion: frame.oscalVersion };
          decoder = new OscalSourceDecoder();
        } else if (frame.type === 'chunk' && hasKeys(frame, ['type', 'sequence', 'operations']) && decoder && frame.sequence === sequence) {
          decoder.accept(frame.operations);
          worker.postMessage({ type: 'ack', sequence: sequence++ });
        } else if (frame.type === 'done' && hasKeys(frame, ['type', 'sequence']) && decoder && metadata && frame.sequence === sequence) {
          complete({ ok: true, document: { source: decoder.finish(), context: invocationContext, ...metadata } });
        } else if (frame.type === 'rejected' && hasKeys(frame, ['type', 'diagnostic']) && !decoder && isDiagnostic(frame.diagnostic)) {
          complete({ ok: false, diagnostic: frame.diagnostic as OscalDiagnostic });
        } else throw new Error('Invalid frame');
      } catch { complete(workerFailure()); }
    };
    const onWorkerFailure = (): void => complete(workerFailure());

    try {
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onWorkerFailure);
      worker.addEventListener('messageerror', onWorkerFailure);
      timeout = setTimeout(onWorkerFailure, CLASS_2_IMPORT_WORKER_TIMEOUT_MS);
      worker.postMessage({ type: 'import', bytes: transferable, context: invocationContext }, [transferable]);
    } catch {
      complete(workerFailure());
    }
  });
}
