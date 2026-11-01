// @vitest-environment node
import 'fake-indexeddb/auto';
import { vi } from 'vitest';
vi.mock('@/adapters/workspaceBackup', async () => (await import('@/test/workspaceNodeWorkers')).inProcessBackupParser());
vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/workspaceNodeWorkers')).inProcessReviewTrailWork());
await import('@/test/browser/workspaceRestorePreview.browser.test');
