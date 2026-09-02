import { parseCatalogBuffer } from '@/state/catalogParsing';
import type {
  CatalogParseWorkerRequest,
  CatalogParseWorkerResponse,
} from '@/state/catalogParseWorker';

function readableParseError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Katalog konnte nicht verarbeitet werden.';
}

self.addEventListener('message', (event: MessageEvent<CatalogParseWorkerRequest>) => {
  // Dedicated-Worker-Nachrichten stammen ausschließlich vom erzeugenden
  // Dokument. Chromium liefert dafür in einigen Ausführungskontexten einen
  // leeren Origin; jeder explizite fremde Origin bleibt ausgeschlossen.
  if (event.origin !== '' && event.origin !== self.location.origin) return;

  const request = event.data;
  if (request?.type !== 'parse-catalog') return;

  let response: CatalogParseWorkerResponse;
  try {
    response = {
      type: 'parsed',
      requestId: request.requestId,
      result: parseCatalogBuffer(request.buffer, request.context, { execution: 'worker' }),
    };
  } catch (error) {
    response = {
      type: 'parse-error',
      requestId: request.requestId,
      message: readableParseError(error),
    };
  }
  self.postMessage(response);
});
