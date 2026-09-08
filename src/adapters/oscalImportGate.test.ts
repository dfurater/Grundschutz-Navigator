import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { importClass2OscalDocument } from './oscalImportGate';
import {
  CLASS_2_IMPORT_LIMITS,
  CLASS_2_IMPORT_WORKER_TIMEOUT_MS,
} from '@/domain/oscalImportContract';

type WorkerListener = (event: Event) => void;

class FakeWorker {
  private readonly listeners = new Map<string, WorkerListener[]>();

  private readonly onPostMessage: (worker: FakeWorker) => void;
  constructor(onPostMessage: (worker: FakeWorker) => void = () => {}) {
    this.onPostMessage = onPostMessage;
  }

  readonly terminate = vi.fn();
  readonly addEventListener = vi.fn((type: string, listener: WorkerListener) => {
    const registered = this.listeners.get(type) ?? [];
    registered.push(listener);
    this.listeners.set(type, registered);
  });
  readonly removeEventListener = vi.fn((type: string, listener: WorkerListener) => {
    const registered = this.listeners.get(type) ?? [];
    this.listeners.set(type, registered.filter(entry => entry !== listener));
  });
  readonly postMessage = vi.fn(() => this.onPostMessage(this));

  emitEvent(type: string): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(new Event(type));
  }

  emitMessage(data: unknown): void {
    for (const listener of [...(this.listeners.get('message') ?? [])]) listener({ data } as MessageEvent);
  }
}

function installWorker(worker: FakeWorker): void {
  vi.stubGlobal('Worker', class {
    constructor() {
      return worker as unknown as Worker;
    }
  });
}

function beginImport(): { worker: FakeWorker; pending: ReturnType<typeof importClass2OscalDocument> } {
  const worker = new FakeWorker();
  installWorker(worker);
  return { worker, pending: importClass2OscalDocument(new Uint8Array(), { trustClass: 'class-2-local-user' }) };
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

  it('weist eine unerwartete Worker-Nachricht geschlossen ab', async () => {
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
    expect(settled).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
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

it('quittiert ein Fragment und gibt den Baum erst nach done frei', async () => {
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  worker.emitMessage({ type: 'chunk', sequence: 0, operations: [['object'], ['end']] });
  expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'ack', sequence: 0 });
  worker.emitMessage({ type: 'done', sequence: 1 });
  expect(await pending).toMatchObject({ ok: true, document: { source: {}, rootType: 'catalog' } });
});

it.each([
  { type: 'done', sequence: 0 }, { type: 'chunk', sequence: 0, operations: [['object'], ['end']] },
  { type: 'start', rootType: 'catalog', oscalVersion: 'invalid' },
  { type: 'start', rootType: 'catalog', oscalVersion: '1.1.3', extra: true },
  { type: 'rejected', diagnostic: { code: 'SECRET' } },
])('rejects malformed frame %#', async frame => {
  const { worker, pending } = beginImport();
  worker.emitMessage(frame);
  expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
});
it.each([1, -1, 0.5, NaN])('rejects wrong sequence %s', async sequence => {
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  worker.emitMessage({ type: 'chunk', sequence, operations: [['object'], ['end']] });
  expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
});

it.each(['error', 'messageerror'])('cleans up after %s mid-stream', async type => {
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  worker.emitMessage({ type: 'chunk', sequence: 0, operations: [['object']] });
  worker.emitEvent(type);
  expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.removeEventListener).toHaveBeenCalledTimes(3);
});
it('retains the absolute timeout while chunks arrive', async () => {
  vi.useFakeTimers();
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  await vi.advanceTimersByTimeAsync(CLASS_2_IMPORT_WORKER_TIMEOUT_MS - 1);
  worker.emitMessage({ type: 'chunk', sequence: 0, operations: [['object']] });
  await vi.advanceTimersByTimeAsync(1);
  expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('preserves a complete pipeline diagnostic', async () => {
  const diagnostic = createOscalDiagnostic({ code: 'OSCAL_JSON_SYNTAX_INVALID', stage: 'json-syntax', validator: { name: 'test', version: '1' }, path: '/' });
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'rejected', diagnostic });
  expect(await pending).toEqual({ ok: false, diagnostic });
});
it('keeps two concurrent streams and their contexts separate', async () => {
  const a = new FakeWorker();
  installWorker(a);
  const context = { trustClass: 'class-2-local-user' } as const;
  const first = importClass2OscalDocument(new Uint8Array(), context);
  const b = new FakeWorker();
  installWorker(b);
  const second = importClass2OscalDocument(new Uint8Array(), context);
  for (const worker of [a, b]) worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  b.emitMessage({ type: 'chunk', sequence: 0, operations: [['array'], ['value', 2], ['end']] });
  a.emitMessage({ type: 'chunk', sequence: 0, operations: [['array'], ['value', 1], ['end']] });
  a.emitMessage({ type: 'done', sequence: 1 });
  b.emitMessage({ type: 'done', sequence: 1 });
  expect(await first).toMatchObject({ ok: true, document: { source: [1], context } });
  expect(await second).toMatchObject({ ok: true, document: { source: [2], context } });
});
it('redacts a postMessage failure while acknowledging', async () => {
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  worker.postMessage.mockImplementationOnce(() => { throw new Error('SECRET'); });
  worker.emitMessage({ type: 'chunk', sequence: 0, operations: [['object'], ['end']] });
  expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
});

it('preserves BASE64 resource diagnostics', async () => {
  const diagnostic = createOscalDiagnostic({
    code: 'OSCAL_BASE64_LIMIT_EXCEEDED', stage: 'resource-limit',
    validator: { name: 'test', version: '1' }, path: '/',
  });
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'rejected', diagnostic });
  expect(await pending).toEqual({ ok: false, diagnostic });
});

it('snapshots the invocation context before asynchronous worker delivery', async () => {
  const worker = new FakeWorker();
  installWorker(worker);
  const context = { trustClass: 'class-2-local-user' as const, upstreamPath: 'before' };
  const pending = importClass2OscalDocument(new Uint8Array(), context);
  context.upstreamPath = 'after';
  worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  worker.emitMessage({ type: 'chunk', sequence: 0, operations: [['object'], ['end']] });
  worker.emitMessage({ type: 'done', sequence: 1 });
  expect(await pending).toMatchObject({ ok: true, document: { context: { upstreamPath: 'before' } } });
});

it.each([
  { name: 'duplicate start', frames: [{ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' }] },
  {
    name: 'duplicate chunk', frames: [
      { type: 'chunk', sequence: 0, operations: [['object']] },
      { type: 'chunk', sequence: 0, operations: [['end']] },
    ]
  },
  {
    name: 'missing chunk', frames: [
      { type: 'chunk', sequence: 0, operations: [['object']] },
      { type: 'chunk', sequence: 2, operations: [['end']] },
    ]
  },
  {
    name: 'truncated container', frames: [
      { type: 'chunk', sequence: 0, operations: [['object']] },
      { type: 'done', sequence: 1 },
    ]
  },
  {
    name: 'truncated string', frames: [
      { type: 'chunk', sequence: 0, operations: [['string', 'a', false]] },
      { type: 'done', sequence: 1 },
    ]
  },
  { name: 'absent source', frames: [{ type: 'done', sequence: 0 }] },
  {
    name: 'wrong done sequence', frames: [
      { type: 'chunk', sequence: 0, operations: [['object'], ['end']] },
      { type: 'done', sequence: 0 },
    ]
  },
])('rejects $name and discards the partial stream', async ({ frames }) => {
  const { worker, pending } = beginImport();
  worker.emitMessage({ type: 'start', rootType: 'catalog', oscalVersion: '1.1.3' });
  for (const frame of frames) worker.emitMessage(frame);
  expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'OSCAL_IMPORT_WORKER_FAILURE' } });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(worker.removeEventListener).toHaveBeenCalledTimes(3);
});
