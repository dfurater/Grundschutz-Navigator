import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseCatalogInWorker } from './catalogParseWorker';
import type { CatalogParseResult } from './catalogParsing';

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
  it('accepts only the matching, catalog-scoped parse response', async () => {
    const expected = {
      catalogDocument: {
        context: {
          catalogKey: 'wlan',
          trustClass: 'class-1-verified-public',
        },
      },
      timings: { jsonParseMs: 10, domainParseMs: 20 },
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
