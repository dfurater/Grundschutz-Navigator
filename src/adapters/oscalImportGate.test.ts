import { afterEach, describe, expect, it, vi } from 'vitest';
import { importClass2OscalDocument } from './oscalImportGate';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_WORKER_TIMEOUT_MS,
} from '@/domain/oscalImportContract';

type WorkerListener = (event: Event) => void;

interface RegisteredWorkerListener {
  readonly listener: WorkerListener;
  readonly once: boolean;
}

class FakeWorker {
  private readonly listeners = new Map<string, RegisteredWorkerListener[]>();

  private readonly onPostMessage: (worker: FakeWorker) => void;

  constructor(onPostMessage: (worker: FakeWorker) => void = () => {}) {
    this.onPostMessage = onPostMessage;
  }

  readonly terminate = vi.fn();

  readonly addEventListener = vi.fn((
    type: string,
    listener: WorkerListener,
    options?: boolean | AddEventListenerOptions,
  ) => {
    const registered = this.listeners.get(type) ?? [];
    registered.push({
      listener,
      once: typeof options === 'object' && options.once === true,
    });
    this.listeners.set(type, registered);
  });

  readonly removeEventListener = vi.fn((type: string, listener: WorkerListener) => {
    const registered = this.listeners.get(type) ?? [];
    this.listeners.set(type, registered.filter((entry) => entry.listener !== listener));
  });

  readonly postMessage = vi.fn(() => {
    this.onPostMessage(this);
  });

  emitMessage(data: unknown): void {
    const registered = [...(this.listeners.get('message') ?? [])];
    for (const entry of registered) {
      entry.listener({ data } as MessageEvent);
      if (entry.once) this.removeEventListener('message', entry.listener);
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('importClass2OscalDocument', () => {
  it('weist übergroße Bytes vor Worker-Erzeugung und Kopie ab', async () => {
    const workerConstructor = vi.fn();
    vi.stubGlobal('Worker', workerConstructor);

    const result = await importClass2OscalDocument(
      new Uint8Array(CLASS_2_IMPORT_LIMITS.maxBytes + 1),
      { trustClass: 'class-2-local-user' },
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_BYTE_LIMIT_EXCEEDED',
        stage: 'resource-limit',
        path: '/',
      },
    });
    expect(workerConstructor).not.toHaveBeenCalled();
  });

  it('redigiert eine unerwartete Worker-Erzeugung ohne Dokumentinhalt', async () => {
    const secret = 'UNERWARTETER-IMPORTFEHLER-SECRET';
    const consoleError = vi.spyOn(console, 'error');
    const consoleLog = vi.spyOn(console, 'log');
    const consoleWarn = vi.spyOn(console, 'warn');
    vi.stubGlobal('Worker', class {
      constructor() {
        throw new Error(secret);
      }
    });

    const result = await importClass2OscalDocument(
      new TextEncoder().encode(`{"catalog":{"remarks":"${secret}"}}`),
      { trustClass: 'class-2-local-user' },
    );

    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_IMPORT_WORKER_FAILURE',
        stage: 'domain',
        path: '/',
      },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(window.location.href).not.toContain(secret);
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleLog).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('wartet nach einer unerwarteten Worker-Nachricht weiter auf das Ergebnis', async () => {
    const expected = {
      ok: false,
      diagnostic: {
        code: 'OSCAL_IMPORT_CONTEXT_INVALID',
        stage: 'domain',
        path: '/',
      },
    };
    const worker = new FakeWorker((fakeWorker) => {
      fakeWorker.emitMessage(null);
      fakeWorker.emitMessage({ type: 'result', result: expected });
    });
    installWorker(worker);

    let settled: unknown;
    void importClass2OscalDocument(new Uint8Array(), { trustClass: 'class-2-local-user' })
      .then((result) => {
        settled = result;
      });

    await Promise.resolve();

    expect(settled).toEqual(expected);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(worker.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(worker.removeEventListener).toHaveBeenCalledWith('messageerror', expect.any(Function));
  });

  it('terminiert einen Worker ohne Ergebnis nach der zulässigen Wartezeit', async () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    installWorker(worker);

    const pending = importClass2OscalDocument(
      new Uint8Array(),
      { trustClass: 'class-2-local-user' },
    );
    const assertion = expect(pending).resolves.toMatchObject({
      ok: false,
      diagnostic: {
        code: 'OSCAL_IMPORT_WORKER_FAILURE',
        stage: 'domain',
        path: '/',
      },
    });

    await vi.advanceTimersByTimeAsync(CLASS_2_IMPORT_WORKER_TIMEOUT_MS);
    await assertion;

    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.removeEventListener).toHaveBeenCalledWith('message', expect.any(Function));
    expect(worker.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(worker.removeEventListener).toHaveBeenCalledWith('messageerror', expect.any(Function));
  });
});
