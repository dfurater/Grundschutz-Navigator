// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { parseWorkspaceBackup, parseVerbundBackup } from './workspaceBackup';
import { WORKSPACE_BACKUP_WORKER_TIMEOUT_MS } from './workspaceBackupContract';
import { CLASS_2_IMPORT_LIMITS, WORKSPACE_BACKUP_FRAME_DEPTH, WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { encodeOscalSource } from '@/domain/oscalImportTransport';
import type { WorkspaceResult } from '@/domain/workspaceModel';
const fixture = { format: 'gspp-workspace', storageSchemaVersion: 2, verbuende: [], documents: [], drafts: [], bindings: [], reviewTrail: [], reviewBaseline: [], workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 2, createdAt: '2026-10-16T12:00:00.000Z', savedAt: '2026-10-16T12:00:00.000Z' }] };
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown; origin: string }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  send(data: unknown, origin = '') { this.onmessage!({ data, origin }); }
}
function start(parse: (bytes: Uint8Array) => Promise<WorkspaceResult<unknown>> = parseWorkspaceBackup) {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('location', { origin: 'https://example.invalid' });
  const result = parse(new Uint8Array([123, 125]));
  return { result, worker: FakeWorker.instances.at(-1)! };
}
/** Streams a value as the worker does: `start`, one `chunk` per fragment, `done`. */
function stream(worker: FakeWorker, value: unknown) {
  worker.send({ type: 'start' });
  let sequence = 0;
  for (const operations of encodeOscalSource(value)) worker.send({ type: 'chunk', sequence: sequence++, operations });
  worker.send({ type: 'done', sequence });
  return sequence;
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; });
it('rebuilds the closed valid backup from acknowledged fragments and terminates the worker', async () => {
  const { result, worker } = start();
  const chunks = stream(worker, fixture);
  expect(await result).toEqual({ ok: true, value: fixture });
  expect(worker.postMessage.mock.calls.slice(1).map(([message]) => message)).toEqual(Array.from({ length: chunks }, (_, sequence) => ({ type: 'ack', sequence })));
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('accepts a bundle at the bundle depth limit beyond the class-2 source depth', async () => {
  let source: unknown = null;
  for (let depth = 1; depth < CLASS_2_IMPORT_LIMITS.maxDepth + WORKSPACE_BACKUP_FRAME_DEPTH; depth++) source = [source];
  const decoded = start();
  stream(decoded.worker, source);
  // Die Form lehnt danach validStructure() ab; die Quittung belegt, dass der Decoder die Bündeltiefe angenommen hat.
  expect(await decoded.result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
  // Fehlschlag, wenn der Decoder mit den Klasse-2-Grenzen statt den Bündelgrenzen arbeitet.
  expect(decoded.worker.postMessage).toHaveBeenCalledWith({ type: 'ack', sequence: 0 });
  const deeper = start();
  deeper.worker.send({ type: 'start' });
  deeper.worker.send({ type: 'chunk', sequence: 0, operations: [...encodeOscalSource([source])][0] });
  expect(await deeper.result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
  expect(deeper.worker.postMessage).not.toHaveBeenCalledWith({ type: 'ack', sequence: 0 });
});
it.each([
  [null],
  [{ type: 'chunk', sequence: 0, operations: [['value', 1]] }],
  [{ type: 'done', sequence: 0 }],
  [{ type: 'start', extra: true }],
  [{ type: 'start' }, { type: 'start' }],
  [{ type: 'start' }, { type: 'chunk', sequence: 1, operations: [['value', 1]] }],
  [{ type: 'start' }, { type: 'chunk', sequence: 0, operations: [['value', 1]], extra: true }],
  [{ type: 'start' }, { type: 'chunk', sequence: 0, operations: [['value', 1]] }, { type: 'done', sequence: 0 }],
  [{ type: 'start' }, { type: 'rejected', diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } }],
  [{ type: 'start' }, { type: 'done', sequence: 0 }],
  [{ ok: true, value: fixture }],
  [{ type: 'failure' }],
])('fails closed on malformed worker frames %#', async (...frames) => {
  const { result, worker } = start();
  for (const frame of frames) worker.send(frame);
  expect(await result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it.each([{ ...fixture, extra: true }, { ...fixture, documents: [{}] }, {}])('rejects a decoded value outside the closed bundle form %#', async value => {
  const { result, worker } = start();
  stream(worker, value);
  expect(await result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
});
it('preserves only allowlisted diagnostic codes while rebuilding all fields', async () => {
  const { result, worker } = start();
  worker.send({ type: 'rejected', diagnostic: { code: 'WORKSPACE_BACKUP_DOCUMENT_REJECTED', path: '/secret' } });
  const rejected = await result;
  expect(rejected).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_DOCUMENT_REJECTED', path: '/' } });
  expect(JSON.stringify(rejected)).not.toContain('secret');
  const unknown = start();
  unknown.worker.send({ type: 'rejected', diagnostic: { code: 'secret' } });
  expect(await unknown.result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
});
it('rejects a foreign worker message origin', async () => {
  const { result, worker } = start();
  worker.send({ type: 'start' }, 'https://foreign.invalid');
  expect(await result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
});
it.each(['onerror', 'onmessageerror'] as const)('handles worker %s', async type => {
  const { result, worker } = start();
  worker[type]!();
  expect(await result).toMatchObject({ ok: false });
});
it('bounds the dedicated worker lifetime', async () => {
  vi.useFakeTimers();
  const { result, worker } = start();
  worker.send({ type: 'start' });
  await vi.advanceTimersByTimeAsync(WORKSPACE_BACKUP_WORKER_TIMEOUT_MS);
  expect(await result).toMatchObject({ ok: false });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('rejects oversized input before creating a worker and unavailable workers', async () => {
  vi.stubGlobal('Worker', undefined);
  expect(await parseWorkspaceBackup(new Uint8Array(WORKSPACE_BACKUP_MAX_BYTES + 1))).toMatchObject({ ok: false });
  expect(await parseWorkspaceBackup(new Uint8Array())).toMatchObject({ ok: false });
});
it('tags verbund requests and rejects workspace frames on that restore path', async () => {
  const { result, worker } = start(parseVerbundBackup);
  expect(worker.postMessage).toHaveBeenCalledWith({ scope: 'verbund', buffer: expect.any(ArrayBuffer) }, [expect.any(ArrayBuffer)]);
  stream(worker, fixture);
  expect(await result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
});
it('adopts only the closed verbund form from the dedicated worker', async () => {
  const now = '2026-10-17T12:00:00.000Z';
  const backup = { format: 'gspp-workspace-verbund', storageSchemaVersion: 2, verbuende: [{ verbundId: crypto.randomUUID(), name: 'Synthetic', createdAt: now, savedAt: now }], documents: [], drafts: [], bindings: [], reviewTrail: [], reviewBaseline: [] };
  const { result, worker } = start(parseVerbundBackup);
  stream(worker, backup);
  expect(await result).toEqual({ ok: true, value: backup });
});
