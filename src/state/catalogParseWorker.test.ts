import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCatalogInWorker } from './catalogParseWorker';
import type { CatalogParseResult } from './catalogParsing';
import { CATALOG_LOAD_MEASURES } from './catalogMeasurements';
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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseCatalogInWorker', () => {
  it('records actual, non-overlapping parse intervals in the forced main-thread fallback', async () => {
    vi.stubGlobal('Worker', undefined);
    const measure = vi.spyOn(performance, 'measure').mockImplementation(
      () => ({}) as PerformanceMeasure,
    );
    const buffer = new TextEncoder().encode(
      JSON.stringify(createStartupCatalogSource('catalog-fallback-timing')),
    ).buffer;

    const result = await parseCatalogInWorker(buffer, {
      catalogKey: 'gspp',
      trustClass: 'class-1-verified-public',
    });

    const jsonParse = measure.mock.calls.find(
      ([name]) => name === CATALOG_LOAD_MEASURES.jsonParse,
    )?.[1] as PerformanceMeasureOptions | undefined;
    const domainParse = measure.mock.calls.find(
      ([name]) => name === CATALOG_LOAD_MEASURES.domainParse,
    )?.[1] as PerformanceMeasureOptions | undefined;

    expect(jsonParse).toMatchObject({ start: expect.any(Number), end: expect.any(Number) });
    expect(domainParse).toMatchObject({ start: expect.any(Number), end: expect.any(Number) });
    expect(jsonParse?.end).toBeLessThanOrEqual(domainParse?.start as number);
    expect(result.execution).toBe('main-thread');
  });

  it('accepts only the matching, catalog-scoped parse response', async () => {
    const expected = {
      catalogDocument: {
        context: {
          catalogKey: 'wlan',
          trustClass: 'class-1-verified-public',
        },
      },
      timings: { jsonParseMs: 10, domainParseMs: 20 },
      execution: 'worker',
    } as unknown as CatalogParseResult;
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
    const foreignResult = {
      catalogDocument: {
        context: {
          catalogKey: 'wlan',
          trustClass: 'class-1-verified-public',
        },
      },
      timings: { jsonParseMs: 10, domainParseMs: 20 },
      execution: 'worker',
    } as unknown as CatalogParseResult;
    const worker = new FakeWorker((fakeWorker, message) => {
      const request = message as { requestId: number };
      fakeWorker.emitMessage({ type: 'parsed', requestId: request.requestId, result: foreignResult });
    });
    installWorker(worker);

    await expect(
      parseCatalogInWorker(new TextEncoder().encode('{"catalog":{}}').buffer, {
        catalogKey: 'gspp',
        trustClass: 'class-1-verified-public',
      }),
    ).rejects.toThrow('Katalog konnte nicht im Hintergrund verarbeitet werden.');
  });
});
