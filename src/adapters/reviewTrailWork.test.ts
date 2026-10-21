// @vitest-environment node
// One dedicated worker per request, no in-process fallback (GSPP-315).
import { afterEach, expect, it, vi } from 'vitest';
import { reviewTrailInWorker, type ReviewTrailWorkRequest } from './reviewTrailWork';
import { REVIEW_TRAIL_DEADLINE_MS } from '@/domain/reviewTrail';
import type { DocumentDiff } from '@/domain/documentDiff';
import type { DocumentSnapshot } from '@/domain/workspaceModel';

const snapshot: DocumentSnapshot = {
  rootType: 'catalog', uuid: '11111111-1111-4111-8111-111111111111', lastModified: '2026-08-16T00:00:00Z',
  version: '1.0.0', oscalVersion: '1.1.3', contentHash: { version: 1, algorithm: 'sha-256', value: 'a'.repeat(64) },
};
const diff: DocumentDiff = { version: 1, baseSequence: null, entries: [{ path: '/catalog', kind: 'added', valueKind: 'object', marker: false }], truncated: false };
const request: ReviewTrailWorkRequest = { source: { catalog: {} }, rootType: 'catalog', previous: null, baseSequence: null, diff: false };

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

function start(input: ReviewTrailWorkRequest = request) {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('location', { origin: 'https://example.invalid' });
  return { result: reviewTrailInWorker(input), worker: FakeWorker.instances.at(-1)! };
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); FakeWorker.instances = []; });

it('accepts one valid response, passes the request once and terminates the worker', async () => {
  const { result, worker } = start();
  expect(worker.postMessage).toHaveBeenCalledWith(request);
  worker.send({ ok: true, snapshot });
  await expect(result).resolves.toEqual({ ok: true, value: { snapshot } });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('requires the diff exactly when it was requested', async () => {
  const withDiff = start({ ...request, diff: true });
  withDiff.worker.send({ ok: true, snapshot, diff });
  await expect(withDiff.result).resolves.toEqual({ ok: true, value: { snapshot, diff } });
  const missing = start({ ...request, diff: true });
  missing.worker.send({ ok: true, snapshot });
  await expect(missing.result).resolves.toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
  const unexpected = start();
  unexpected.worker.send({ ok: true, snapshot, diff });
  await expect(unexpected.result).resolves.toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
});

it.each([
  null,
  { ok: false },
  { ok: true },
  { ok: true, snapshot: { ...snapshot, rootType: 'unknown' } },
  { ok: true, snapshot: { ...snapshot, uuid: '' } },
  { ok: true, snapshot: { ...snapshot, contentHash: { ...snapshot.contentHash, value: 'NOT-A-HASH' } } },
  { ok: true, snapshot: { ...snapshot, contentHash: { ...snapshot.contentHash, version: 2 } } },
  { ok: true, snapshot, extra: true },
])('fails closed on a malformed response %#', async data => {
  const { result, worker } = start();
  worker.send(data);
  await expect(result).resolves.toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it.each([
  { ...diff, version: 2 },
  { ...diff, baseSequence: 0 },
  { ...diff, entries: [{ path: 'catalog', kind: 'added', valueKind: 'object', marker: false }] },
  { ...diff, entries: [{ path: '/catalog', kind: 'moved', valueKind: 'object', marker: false }] },
  { ...diff, entries: [{ path: '/catalog', kind: 'added', valueKind: 'function', marker: false }] },
])('rejects an invalid structural diff %#', async invalid => {
  const { result, worker } = start({ ...request, diff: true });
  worker.send({ ok: true, snapshot, diff: invalid });
  await expect(result).resolves.toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
});

it('rejects a foreign origin and worker errors without a second response', async () => {
  for (const fail of ['foreign', 'onerror', 'onmessageerror'] as const) {
    const { result, worker } = start();
    if (fail === 'foreign') worker.send({ ok: true, snapshot }, 'https://foreign.invalid');
    else worker[fail]!();
    await expect(result).resolves.toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
    expect(() => worker.send({ ok: true, snapshot })).not.toThrow();
    expect(worker.terminate).toHaveBeenCalledOnce();
  }
});

it('terminates at the deadline and has no in-process fallback', async () => {
  vi.useFakeTimers();
  const { result, worker } = start({ ...request, diff: true });
  await vi.advanceTimersByTimeAsync(REVIEW_TRAIL_DEADLINE_MS);
  await expect(result).resolves.toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('fails closed when the worker cannot be created', async () => {
  vi.stubGlobal('Worker', class { constructor() { throw new Error('PRIVATE_SYNTHETIC'); } });
  vi.stubGlobal('location', { origin: 'https://example.invalid' });
  const result = await reviewTrailInWorker(request);
  expect(result).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC');
});
