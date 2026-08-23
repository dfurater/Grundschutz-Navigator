import { processClass2OscalBytes, type Class2OscalDocumentContext, type Class2OscalImportResult } from '@/domain/oscalClass2Import';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { CLASS_2_IMPORT_VALIDATOR } from '@/domain/oscalImportProcessing';

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

  // Stufe 3 lädt das Schema der gewählten Zelle nach; die Pipeline ist deshalb
  // asynchron. Ein Fehler aus dem Ladeweg darf den Worker nicht antwortlos
  // lassen — er wird wie jeder andere zur redigierten internen Diagnose.
  void processClass2OscalBytes(new Uint8Array(event.data.bytes), event.data.context)
    .catch(() => internalFailure())
    .then((result: Class2OscalImportResult) => {
      const response: OscalImportWorkerResponse = { type: 'result', result };
      self.postMessage(response);
    });
});
