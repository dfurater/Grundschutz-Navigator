import { processClass2OscalBytes, type Class2OscalDocumentContext } from '@/domain/oscalClass2Import';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportProcessing';
import type { Class2OscalImportResult } from '@/domain/oscalClass2Import';

export interface OscalImportWorkerRequest {
  readonly type: 'import';
  readonly bytes: ArrayBuffer;
  readonly context: Class2OscalDocumentContext;
}

export interface OscalImportWorkerResponse {
  readonly type: 'result';
  readonly result: Class2OscalImportResult;
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

self.addEventListener('message', (event: MessageEvent<OscalImportWorkerRequest>) => {
  if (event.data.type !== 'import') return;

  let result: Class2OscalImportResult;
  try {
    result = processClass2OscalBytes(new Uint8Array(event.data.bytes), event.data.context);
  } catch {
    result = internalFailure();
  }

  const response: OscalImportWorkerResponse = { type: 'result', result };
  self.postMessage(response);
});
