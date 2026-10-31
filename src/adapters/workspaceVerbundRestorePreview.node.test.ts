// @vitest-environment node
import 'fake-indexeddb/auto';
import { vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/reviewTrailFixtures')).importGateMock());
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/reviewTrailFixtures')).reviewTrailWorkMock());
vi.mock('@/adapters/workspaceBackup', async () => (await import('@/test/workspaceNodeWorkers')).inProcessBackupParser());
import { verbundRestorePreviewContract } from '@/test/verbundRestorePreviewContract';
verbundRestorePreviewContract();
