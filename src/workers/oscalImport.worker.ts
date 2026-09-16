import { processClass2OscalBytes, type Class2OscalDocumentContext, type Class2OscalImportResult } from '@/domain/oscalClass2Import';
import { encodeOscalSource } from '@/domain/oscalImportTransport';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportProcessing';

export interface OscalImportWorkerRequest {
  readonly type: 'import';
  readonly bytes: ArrayBuffer;
  readonly context: Class2OscalDocumentContext;
}

function internalFailure(): Class2OscalImportResult {
  return {
    ok: false,
    diagnostic: createOscalDiagnostic({
      code: 'OSCAL_IMPORT_INTERNAL_ERROR',
      stage: 'domain',
      validator: CLASS_2_IMPORT_VALIDATOR,
      path: '/',
    }),
  };
}

let started = false;
let failed = false;
let stream: ReturnType<typeof encodeOscalSource> | undefined;
let sequence = 0;
let awaitingAck = false;

function next(): void {
  if (!stream) throw new Error('Missing stream');
  const fragment = stream.next();
  if (fragment.done) {
    stream = undefined;
    globalThis.postMessage({ type: 'done', sequence });
  } else {
    awaitingAck = true;
    globalThis.postMessage({ type: 'chunk', sequence, operations: fragment.value });
  }
}

globalThis.addEventListener('message', (event: MessageEvent) => {
  const request = event.data;
  if (failed) return;
  if (request?.type === 'ack' && Object.keys(request).length === 2 && awaitingAck && request.sequence === sequence) {
    awaitingAck = false;
    sequence++;
    try { next(); } catch { globalThis.postMessage({ type: 'failure' }); }
    return;
  }
  if (started || request?.type !== 'import' || !(request.bytes instanceof ArrayBuffer)) {
    failed = true;
    stream = undefined;
    globalThis.postMessage({ type: 'failure' });
    return;
  }
  started = true;
  void processClass2OscalBytes(new Uint8Array(request.bytes), request.context)
    .catch(() => internalFailure())
    .then((result: Class2OscalImportResult) => {
      if (failed) return;
      if (!result.ok) {
        globalThis.postMessage({ type: 'rejected', diagnostic: result.diagnostic });
        return;
      }
      stream = encodeOscalSource(result.document.source);
      globalThis.postMessage({ type: 'start', rootType: result.document.rootType, oscalVersion: result.document.oscalVersion });
      next();
    }).catch(() => globalThis.postMessage({ type: 'failure' }));
});
