// @vitest-environment node
// Run the identical transaction contract against real Chromium and the
// deterministic IndexedDB implementation, keeping failure oracles shared.
import 'fake-indexeddb/auto';
import { vi } from 'vitest';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/workspaceBackup', async () => {
  const { processWorkspaceBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes };
});

await import('@/test/browser/workspaceStore.browser.test');
await import('@/test/browser/workspaceMigration.browser.test');
