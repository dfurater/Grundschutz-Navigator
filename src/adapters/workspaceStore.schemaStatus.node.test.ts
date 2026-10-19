// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME, WORKSPACE_SCHEMA } from './workspaceStore';
import { STORAGE_SCHEMA_VERSION, type WorkspaceResult } from '@/domain/workspaceModel';

/*
 * `schemaStatus()` entscheidet beim Öffnen des Bereichs Informationsverbünde
 * über die Schreibsperre (docs/PERSISTENCE.md §10). Geprüft am echten Adapter
 * gegen eine Testdatenbank: aktuelle Version, höhere Datenbankversion, höhere
 * Metaversion und ein scheiternder Metadatenzugriff.
 */

const connections: WorkspaceStore[] = [];

async function open(): Promise<WorkspaceStore> {
  const opened = await WorkspaceStore.open();
  if (!opened.ok) throw new Error(opened.diagnostic.code);
  connections.push(opened.value);
  return opened.value;
}

function status(result: WorkspaceResult<'current' | 'newer'>) {
  return result.ok ? result.value : result.diagnostic.code;
}

afterEach(async () => {
  vi.restoreAllMocks();
  connections.splice(0).forEach((connection) => connection.close());
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});

it('meldet eine frisch angelegte Datenbank als aktuell', async () => {
  expect(status(await (await open()).schemaStatus())).toBe('current');
});

it('meldet eine höhere Datenbankversion als neuer, ohne die Metazeile zu lesen', async () => {
  const newer = new Dexie(WORKSPACE_DATABASE_NAME);
  newer.version(STORAGE_SCHEMA_VERSION + 1).stores({ ...WORKSPACE_SCHEMA, futureStore: 'id' });
  await newer.open();
  newer.close();
  expect(status(await (await open()).schemaStatus())).toBe('newer');
});

it('meldet eine höhere storageSchemaVersion der Metazeile als neuer', async () => {
  (await open()).close();
  const raw = new Dexie(WORKSPACE_DATABASE_NAME);
  await raw.open();
  await raw.table('workspaceMeta').update('workspace', { storageSchemaVersion: STORAGE_SCHEMA_VERSION + 1 });
  raw.close();
  expect(status(await (await open()).schemaStatus())).toBe('newer');
});

it('gibt einen scheiternden Metadatenzugriff als redigierte Diagnose zurück', async () => {
  const store = await open();
  vi.spyOn(Dexie.prototype, 'transaction').mockImplementation(() => { throw new Error('PRIVATE_NATIVE_ERROR'); });
  const result = await store.schemaStatus();
  expect(status(result)).toBe('WORKSPACE_STORAGE_FAILED');
  expect(JSON.stringify(result)).not.toContain('PRIVATE_NATIVE_ERROR');
});
