import { afterEach, expect, it, vi } from 'vitest';
import { failure, reject, timestamp } from '@/adapters/workspaceStorageFailure';

afterEach(() => vi.restoreAllMocks());
it.each([0, 1, -1000])('advances timestamps even when the clock stays still or moves back (%s)', offset => {
  const previous = '2026-10-17T12:00:00.000Z';
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse(previous) + offset);
  expect(timestamp(previous)).toBe('2026-10-17T12:00:00.001Z');
});
it('uses the wall clock once it is ahead of the saved timestamp', () => {
  vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-17T12:00:05Z'));
  expect(timestamp('2026-10-17T12:00:00.000Z')).toBe('2026-10-17T12:00:05.000Z');
  expect(timestamp()).toBe('2026-10-17T12:00:05.000Z');
});
it('redacts cyclic native errors and preserves only stable storage and nested quota codes', () => {
  const cycle = { name: 'PRIVATE_SENTINEL', inner: null as unknown }; cycle.inner = cycle;
  const quota = { name: 'AbortError', inner: new DOMException('PRIVATE_SENTINEL', 'QuotaExceededError') };
  expect(failure(cycle)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_STORAGE_FAILED' } });
  expect(failure(quota)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_QUOTA_EXCEEDED' } });
  try { reject('WORKSPACE_SAVE_CONFLICT'); }
  catch (error) { expect(failure(error)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } }); }
  expect(JSON.stringify([failure(cycle), failure(quota)])).not.toContain('PRIVATE_SENTINEL');
});
