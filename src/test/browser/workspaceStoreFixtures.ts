import Dexie from 'dexie';
import { afterEach, vi } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceResult } from '@/domain/workspaceModel';

export function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}
const connections: WorkspaceStore[] = [];
export async function open() {
  const store = value(await WorkspaceStore.open());
  connections.push(store);
  return store;
}
export async function document(title = 'DOCUMENT_SENTINEL') {
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  (source.catalog as { metadata: { title: string } }).metadata.title = title;
  const result = await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}
export async function storedValuesAndIndexKeys(): Promise<string> {
  const db = new Dexie(WORKSPACE_DATABASE_NAME);
  await db.open();
  try {
    const values: unknown[] = [];
    for (const table of db.tables) {
      await table.each(row => { values.push(row); });
      for (const index of table.schema.indexes) values.push(await table.orderBy(index.name).keys());
    }
    return JSON.stringify(values);
  } finally { db.close(); }
}
afterEach(async () => {
  vi.restoreAllMocks();
  connections.splice(0).forEach(connection => connection.close());
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});
