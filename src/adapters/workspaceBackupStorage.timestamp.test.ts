// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
vi.mock('@/adapters/workspaceBackup', async () => (await import('@/test/workspaceNodeWorkers')).inProcessBackupParser());
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
const bytes = (text: string) => new TextEncoder().encode(text);
let store: WorkspaceStore;
let verbund: WorkspaceVerbund;

beforeEach(async () => {
  store = value(await WorkspaceStore.open());
  verbund = value(await store.createVerbund('Selected'));
  const imported = await importClass2OscalDocument(bytes(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))), { trustClass: 'class-2-local-user' });
  if (!imported.ok) throw new Error(imported.diagnostic.code);
  value(await store.addDocument(verbund.verbundId, imported.document));
});
afterEach(async () => { store?.close(); await Dexie.delete(WORKSPACE_DATABASE_NAME); });

it('keeps every stamp within four-digit years and every exported bundle restorable', async () => {
  const parsed = JSON.parse(value(await store.exportVerbundBackup(verbund.verbundId)));
  const restoreAt = (savedAt: string) => {
    parsed.documents[0].savedAt = savedAt;
    return store.restoreVerbundBackup(bytes(JSON.stringify(parsed)), 'replace-verbund');
  };
  const before = value(await store.exportBackup());
  expect(await restoreAt('9999-12-31T23:59:59.999Z')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });
  expect(value(await store.exportBackup())).toBe(before);
  value(await restoreAt('9999-12-31T23:59:59.997Z'));
  const restored = value(await store.exportBackup());
  // Fehlschlag, wenn ein Schreibstempel die letzte Millisekunde belegt, die der Wiederherstellungsstempel braucht.
  expect(await store.createVerbund('After the mark')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_TIMESTAMP_EXHAUSTED' } });
  expect(value(await store.exportBackup())).toBe(restored);
  value(await restoreAt('9999-12-31T23:59:59.998Z'));
  const exported = value(await store.exportBackup());
  expect(JSON.parse(exported).workspaceMeta[0].savedAt).toBe('9999-12-31T23:59:59.999Z');
  store.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  store = value(await WorkspaceStore.open());
  // Fehlschlag, wenn die Gesamtsicherung mit dem Grenzstempel in der Metazeile in einer frischen Datenbank nicht wiederherstellbar ist.
  value(await store.restoreBackup(bytes(exported), 'replace-workspace'));
  expect(value(await store.exportBackup())).toBe(exported);
});
