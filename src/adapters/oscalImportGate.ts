import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_VALIDATOR,
  CLASS_2_IMPORT_WORKER_TIMEOUT_MS,
  createClass2ByteLimitDiagnostic,
} from '@/domain/oscalImportContract';
import type {
  Class2OscalDocumentContext,
  Class2OscalImportResult,
} from '@/domain/oscalClass2Import';
import type {
  OscalImportWorkerResponse,
} from '@/workers/oscalImport.worker';

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
  try {
    transferable = copyForTransfer(bytes);
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
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function complete(result: Class2OscalImportResult): void {
      if (completed) return;
      completed = true;

      if (timeout !== undefined) clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onWorkerFailure);
      worker.removeEventListener('messageerror', onWorkerFailure);
      worker.terminate();
      resolve(result);
    }

    const onMessage = (event: MessageEvent<OscalImportWorkerResponse | null>): void => {
      if (event.data?.type === 'result') complete(event.data.result);
    };
    const onWorkerFailure = (): void => complete(workerFailure());

    try {
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onWorkerFailure);
      worker.addEventListener('messageerror', onWorkerFailure);
      timeout = setTimeout(onWorkerFailure, CLASS_2_IMPORT_WORKER_TIMEOUT_MS);
      worker.postMessage({ type: 'import', bytes: transferable, context }, [transferable]);
    } catch {
      complete(workerFailure());
    }
  });
}
