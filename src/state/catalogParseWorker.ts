// =============================================================================
// Typisierter Client für den Klasse-1-Katalog-Parser im Modul-Worker.
// =============================================================================

import type { CatalogDocumentContext } from '@/domain/models';
import { parseCatalogBuffer, type CatalogParseResult } from '@/state/catalogParsing';

export interface CatalogParseWorkerRequest {
  readonly type: 'parse-catalog';
  readonly requestId: number;
  readonly buffer: ArrayBuffer;
  readonly context: CatalogDocumentContext;
}

export type CatalogParseWorkerResponse =
  | {
      readonly type: 'parsed';
      readonly requestId: number;
      readonly result: CatalogParseResult;
    }
  | {
      readonly type: 'parse-error';
      readonly requestId: number;
      readonly message: string;
    };

const CATALOG_PARSE_WORKER_TIMEOUT_MS = 30_000;
let nextRequestId = 0;

function workerFailure(): Error {
  return new Error('Katalog konnte nicht im Hintergrund verarbeitet werden.');
}

/**
 * Prüft die Worker-Antwort gegen den angeforderten Katalog **und** gegen die
 * fachlich tragenden Felder des Parseergebnisses. Geprüft wird damit nicht nur,
 * ob eine Antwort zum richtigen Katalog gehört, sondern auch, ob sie ein
 * vollständiges Parseergebnis ist: Eine fremde, abgeschnittene oder nur
 * teilweise strukturgeklonte Antwort kann keinen Katalogzustand
 * vervollständigen.
 */
function matchesRequestedCatalog(
  value: unknown,
  context: CatalogDocumentContext,
): value is CatalogParseResult {
  if (typeof value !== 'object' || value === null) return false;

  const result = value as Partial<CatalogParseResult>;
  const documentContext = result.catalogDocument?.context;
  const view = result.catalogDocument?.view;
  return (
    documentContext?.catalogKey === context.catalogKey &&
    documentContext.trustClass === context.trustClass &&
    result.execution === 'worker' &&
    view?.catalogKey === context.catalogKey &&
    Array.isArray(view.controls) &&
    Array.isArray(view.practices) &&
    view.controlsById instanceof Map &&
    view.controlsByAltIdentifier instanceof Map &&
    // Beide Indizes decken jede Kontrolle ab (siehe `Catalog`); eine
    // unvollständige Antwort verletzt diese Zusage.
    view.controlsById.size === view.controls.length &&
    view.controlsByAltIdentifier.size === view.controls.length
  );
}

/**
 * Übergibt den nach der Integritätsprüfung nicht mehr benötigten Buffer ohne
 * Kopie an einen Kurzzeit-Worker. Der Fallback hält Tests und nicht unterstützte
 * Browser funktionsfähig; moderne Produktionsbrowser bleiben vollständig
 * außerhalb des Main Threads.
 */
export function parseCatalogInWorker(
  buffer: ArrayBuffer,
  context: CatalogDocumentContext,
): Promise<CatalogParseResult> {
  if (typeof Worker === 'undefined') {
    return Promise.resolve().then(() =>
      parseCatalogBuffer(buffer, context, { execution: 'main-thread' }),
    );
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/catalogParser.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      reject(workerFailure());
      return;
    }

    const requestId = ++nextRequestId;
    let completed = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    function complete(result: CatalogParseResult | Error): void {
      if (completed) return;
      completed = true;
      if (timeout !== undefined) clearTimeout(timeout);
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onWorkerFailure);
      worker.removeEventListener('messageerror', onWorkerFailure);
      worker.terminate();
      if (result instanceof Error) {
        reject(result);
      } else {
        resolve(result);
      }
    }

    function onMessage(event: MessageEvent<CatalogParseWorkerResponse | null>): void {
      const response = event.data;
      if (response?.requestId !== requestId) return;
      if (response.type === 'parsed') {
        complete(
          matchesRequestedCatalog(response.result, context)
            ? response.result
            : workerFailure(),
        );
      } else if (response.type === 'parse-error') {
        complete(
          typeof response.message === 'string' && response.message.length > 0
            ? new Error(response.message)
            : workerFailure(),
        );
      }
    }

    function onWorkerFailure(): void {
      complete(workerFailure());
    }

    try {
      worker.addEventListener('message', onMessage);
      worker.addEventListener('error', onWorkerFailure);
      worker.addEventListener('messageerror', onWorkerFailure);
      timeout = setTimeout(onWorkerFailure, CATALOG_PARSE_WORKER_TIMEOUT_MS);
      worker.postMessage({ type: 'parse-catalog', requestId, buffer, context }, [buffer]);
    } catch {
      complete(workerFailure());
    }
  });
}
