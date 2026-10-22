// @vitest-environment node
import type Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { exportNewerWorkspaceBackup } from '@/adapters/workspaceRecoveryStorage';

it.each([
  { error: null, code: 'WORKSPACE_STORAGE_FAILED' },
  { error: new DOMException('SYNTHETIC_NATIVE_MESSAGE', 'QuotaExceededError'), code: 'WORKSPACE_QUOTA_EXCEEDED' },
])('redacts a native transaction abort as $code', async ({ error, code }) => {
  let aborted = false;
  const transaction = {
    error,
    onabort: undefined as (() => void) | undefined,
    objectStore: vi.fn(() => ({ keyPath: 'id', openCursor: () => ({}) })),
  };
  const native = {
    objectStoreNames: ['futureStore'],
    transaction: vi.fn(() => {
      queueMicrotask(() => {
        if (!transaction.onabort) throw new Error('Abort handler missing');
        transaction.onabort();
        aborted = true;
      });
      return transaction;
    }),
  };
  const db = { verno: 3, backendDB: () => native } as unknown as Dexie;

  const result = await exportNewerWorkspaceBackup(db);

  expect(aborted).toBe(true);
  expect(native.transaction).toHaveBeenCalledWith(['futureStore'], 'readonly');
  expect(transaction.objectStore).toHaveBeenCalledWith('futureStore');
  expect(result).toMatchObject({ ok: false, diagnostic: { code } });
  expect(result).not.toHaveProperty('value');
  expect(JSON.stringify(result)).not.toContain('SYNTHETIC_NATIVE_MESSAGE');
});
