// =============================================================================
// Typisierter Client für den Klasse-1-Katalog-Parser im Modul-Worker.
// =============================================================================

import type { CatalogDocumentContext } from '@/domain/models';
import type { CatalogParseResult } from '@/state/catalogParsing';

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
    // Der Parser erzwingt für jede Kontrolle einen eindeutigen
    // `alt-identifier` (fail-closed, `oscalAdapter.ts`), dieser Index deckt
    // den Katalog also vollständig ab. Für `controlsById` gilt das nicht:
    // Doppelte `id` sind dort nicht ausgeschlossen, eine Größengleichheit
    // wäre keine Zusage des Parsers, sondern eine Annahme über die Daten —
    // und würde einen solchen Katalog nur auf dem Worker-Pfad abweisen.
    view.controlsByAltIdentifier.size === view.controls.length
  );
}

function createWorker(): Worker {
  return new Worker(new URL('../workers/catalogParser.worker.ts', import.meta.url), {
    type: 'module',
  });
}

// Vorbereitete Worker, die vor ihrem Auftrag einen Fehler gemeldet haben.
const failedPreparedWorkers = new WeakSet<Worker>();

/**
 * Startet den Parser-Worker vor dem Eintreffen der Katalogbytes, damit sein
 * Skript parallel zum Katalog lädt. `null` heißt: kein vorbereiteter Worker,
 * `parseCatalogInWorker` versucht es dann selbst.
 */
export function prepareCatalogParseWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  try {
    const worker = createWorker();
    worker.addEventListener('error', () => failedPreparedWorkers.add(worker), { once: true });
    return worker;
  } catch {
    return null;
  }
}

/**
 * Übergibt den nach der Integritätsprüfung nicht mehr benötigten Buffer ohne
 * Kopie an einen Kurzzeit-Worker. Ein vorbereiteter Worker geht in den Besitz
 * dieses Aufrufs über und wird wie ein eigener beendet. Der Fallback hält Tests
 * und nicht unterstützte Browser funktionsfähig; moderne Produktionsbrowser
 * bleiben vollständig außerhalb des Main Threads.
 */
export function parseCatalogInWorker(
  buffer: ArrayBuffer,
  context: CatalogDocumentContext,
  prepared: Worker | null = null,
): Promise<CatalogParseResult> {
  if (typeof Worker === 'undefined') {
    // Der Parser des Main Threads ist ein eigener Chunk: Der Startpfad lädt ihn nicht.
    return import('@/state/catalogParsing').then(({ parseCatalogBuffer }) =>
      parseCatalogBuffer(buffer, context, { execution: 'main-thread' }),
    );
  }

  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = prepared ?? createWorker();
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
      if (prepared !== null && failedPreparedWorkers.has(prepared)) {
        onWorkerFailure();
        return;
      }
      timeout = setTimeout(onWorkerFailure, CATALOG_PARSE_WORKER_TIMEOUT_MS);
      worker.postMessage({ type: 'parse-catalog', requestId, buffer, context }, [buffer]);
    } catch {
      complete(workerFailure());
    }
  });
}
