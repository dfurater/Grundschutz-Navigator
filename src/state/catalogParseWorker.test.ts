import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCatalogInWorker } from './catalogParseWorker';
import { parseCatalogBuffer, type CatalogParseResult } from './catalogParsing';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { createStartupCatalogSource } from '@/test/fixtures/startupCatalog';

type WorkerListener = (event: Event) => void;

class FakeWorker {
  private readonly listeners = new Map<string, WorkerListener[]>();
  private readonly onPostMessage: (worker: FakeWorker, message: unknown) => void;

  constructor(onPostMessage: (worker: FakeWorker, message: unknown) => void) {
    this.onPostMessage = onPostMessage;
  }

  readonly terminate = vi.fn();

  readonly addEventListener = vi.fn((type: string, listener: WorkerListener) => {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  });

  readonly removeEventListener = vi.fn((type: string, listener: WorkerListener) => {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((entry) => entry !== listener));
  });

  readonly postMessage = vi.fn((message: unknown) => {
    this.onPostMessage(this, message);
  });

  emitMessage(data: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data } as MessageEvent);
    }
  }
}

function installWorker(worker: FakeWorker): void {
  vi.stubGlobal('Worker', class {
    constructor() {
      return worker as unknown as Worker;
    }
  });
}

/** Erzeugt genau das, was der echte Worker zurückgibt — kein Attrappenobjekt. */
function createWorkerResult(catalogKey: CatalogKey, uuid: string): CatalogParseResult {
  const bytes = new TextEncoder().encode(JSON.stringify(createStartupCatalogSource(uuid)));
  return parseCatalogBuffer(
    bytes.buffer,
    { catalogKey, trustClass: 'class-1-verified-public' },
    { execution: 'worker' },
  );
}

function withReplacedView(result: CatalogParseResult, view: unknown): CatalogParseResult {
  return {
    ...result,
    catalogDocument: { ...result.catalogDocument, view },
  } as unknown as CatalogParseResult;
}

function respondWith(result: CatalogParseResult): FakeWorker {
  return new FakeWorker((fakeWorker, message) => {
    const request = message as { requestId: number };
    fakeWorker.emitMessage({ type: 'parsed', requestId: request.requestId, result });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseCatalogInWorker', () => {
  it('parst ohne Worker-API im Main Thread weiter', async () => {
    vi.stubGlobal('Worker', undefined);
    const buffer = new TextEncoder().encode(
      JSON.stringify(createStartupCatalogSource('catalog-fallback')),
    ).buffer;

    const result = await parseCatalogInWorker(buffer, {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });

    expect(result.execution).toBe('main-thread');
    expect(result.catalogDocument.view.controlsById.get('G.1')?.title).toBe('Kontrolle');
  });

  it('accepts only the matching, catalog-scoped parse response', async () => {
    const expected = createWorkerResult('wlan', 'catalog-worker-match');
    const worker = new FakeWorker((fakeWorker, message) => {
      const request = message as { requestId: number };
      fakeWorker.emitMessage({ type: 'parsed', requestId: request.requestId + 1, result: expected });
      fakeWorker.emitMessage({ type: 'parsed', requestId: request.requestId, result: expected });
    });
    installWorker(worker);
    const buffer = new TextEncoder().encode('{"catalog":{}}').buffer;

    const result = await parseCatalogInWorker(buffer, {
      catalogKey: 'wlan',
      trustClass: 'class-1-verified-public',
    });

    expect(result).toBe(expected);
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'parse-catalog',
        buffer,
        context: { catalogKey: 'wlan', trustClass: 'class-1-verified-public' },
      }),
      [buffer],
    );
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it('rejects a response that carries another catalog context', async () => {
    installWorker(respondWith(createWorkerResult('wlan', 'catalog-worker-foreign')));

    await expect(
      parseCatalogInWorker(new TextEncoder().encode('{"catalog":{}}').buffer, {
        catalogKey: 'gspp',
        trustClass: 'class-1-verified-public',
      }),
    ).rejects.toThrow('Katalog konnte nicht im Hintergrund verarbeitet werden.');
  });

  it('weist eine unvollständige Worker-Antwort zum richtigen Katalog ab', async () => {
    const complete = createWorkerResult('gspp', 'catalog-worker-incomplete');
    const incompleteResponses: CatalogParseResult[] = [
      // Projektion fehlt vollständig — der Katalogzustand wäre nicht befüllbar.
      withReplacedView(complete, undefined),
      // Projektion vorhanden, aber ihre Indizes decken die Kontrollen nicht ab.
      withReplacedView(complete, { ...complete.catalogDocument.view, controlsById: new Map() }),
      withReplacedView(complete, {
        ...complete.catalogDocument.view,
        controlsByAltIdentifier: new Map(),
      }),
      // Fremde Antwortform ohne die tragenden Felder der Projektion.
      withReplacedView(complete, { catalogKey: 'gspp' }),
    ];

    for (const response of incompleteResponses) {
      installWorker(respondWith(response));

      await expect(
        parseCatalogInWorker(new TextEncoder().encode('{"catalog":{}}').buffer, {
          catalogKey: 'gspp',
          trustClass: 'class-1-verified-public',
        }),
      ).rejects.toThrow('Katalog konnte nicht im Hintergrund verarbeitet werden.');
    }
  });
});
