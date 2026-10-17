// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { parseWorkspaceBackup } from './workspaceBackup';
import { WORKSPACE_BACKUP_WORKER_TIMEOUT_MS } from './workspaceBackupContract';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
const fixture = { format: 'gspp-workspace', storageSchemaVersion: 1, verbuende: [], documents: [], drafts: [], bindings: [], workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 1, createdAt: '2026-10-16T12:00:00.000Z', savedAt: '2026-10-16T12:00:00.000Z' }] };
class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage?: (event: { data: unknown; origin: string }) => void;
  onerror?: () => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
}
function start() {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('location', { origin: 'https://example.invalid' });
  const result = parseWorkspaceBackup(new Uint8Array([123, 125]));
  return { result, worker: FakeWorker.instances.at(-1)! };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; });
it('returns closed valid backup from its dedicated worker and terminates it', async () => {
  const { result, worker } = start();
  worker.onmessage!({ data: { ok: true, value: fixture }, origin: '' });
  expect(await result).toEqual({ ok: true, value: fixture });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it.each([null, { ok: true }, { ok: true, value: {} }, { ok: true, value: { ...fixture, extra: true } }, { ok: true, value: { ...fixture, documents: [{}] } }, { ok: false, diagnostic: { code: 'secret' } }])('fails closed on malformed worker frames %#', async data => {
  const { result, worker } = start();
  worker.onmessage!({ data, origin: '' });
  expect(await result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_WORKER_FAILURE' } });
});
it('preserves only allowlisted diagnostic codes while rebuilding all fields', async () => {
  const { result, worker } = start();
  worker.onmessage!({ data: { ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_DOCUMENT_REJECTED', path: '/secret' } }, origin: '' });
  const rejected = await result;
  expect(rejected).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_DOCUMENT_REJECTED', path: '/' } });
  expect(JSON.stringify(rejected)).not.toContain('secret');
});
it('rejects a foreign worker message origin', async () => {
  const { result, worker } = start();
  worker.onmessage!({ data: { ok: true, value: fixture }, origin: 'https://foreign.invalid' });
  expect(await result).toMatchObject({ ok: false });
});
it.each(['onerror', 'onmessageerror'] as const)('handles worker %s', async type => {
  const { result, worker } = start();
  worker[type]!();
  expect(await result).toMatchObject({ ok: false });
});
it('bounds the dedicated worker lifetime', async () => {
  vi.useFakeTimers();
  const { result, worker } = start();
  await vi.advanceTimersByTimeAsync(WORKSPACE_BACKUP_WORKER_TIMEOUT_MS);
  expect(await result).toMatchObject({ ok: false });
  expect(worker.terminate).toHaveBeenCalledOnce();
});
it('rejects oversized input before creating a worker and unavailable workers', async () => {
  vi.stubGlobal('Worker', undefined);
  expect(await parseWorkspaceBackup(new Uint8Array(WORKSPACE_BACKUP_MAX_BYTES + 1))).toMatchObject({ ok: false });
  expect(await parseWorkspaceBackup(new Uint8Array())).toMatchObject({ ok: false });
});
