// @vitest-environment node
// Run the identical transaction contract against real Chromium and the
// deterministic IndexedDB implementation, keeping failure oracles shared.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';
import { WorkspaceStore } from './workspaceStore';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/workspaceBackup', async () => {
  const { processWorkspaceBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes };
});

await import('@/test/browser/workspaceStore.browser.test');
it('classifies nested quota causes and terminates on cyclic error chains', async () => {
  const opened = await WorkspaceStore.open();
  expect(opened.ok).toBe(true);
  if (!opened.ok) return;
  const store = opened.value;
  const cycle = Object.assign(new Error('PRIVATE_NATIVE_ERROR'), { inner: null as unknown });
  cycle.inner = cycle;
  const quota = new Dexie.AbortError(new DOMException('PRIVATE_NATIVE_ERROR', 'QuotaExceededError'));
  try {
    for (const [error, code] of [[cycle, 'WORKSPACE_STORAGE_FAILED'], [new Dexie.AbortError(quota), 'WORKSPACE_QUOTA_EXCEEDED']] as const) {
      const transaction = vi.spyOn(Dexie.prototype, 'transaction').mockImplementation(() => { throw error; });
      const result = await store.listVerbuende();
      transaction.mockRestore();
      expect(result).toMatchObject({ ok: false, diagnostic: { code } });
      expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE_ERROR');
    }
  } finally { store.close(); }
});
