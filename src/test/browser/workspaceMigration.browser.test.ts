import Dexie from 'dexie';
import { afterEach, expect, test } from 'vitest';
import { migrateWorkspaceStorage } from '@/adapters/workspaceMigration';
import { WORKSPACE_SCHEMA } from '@/adapters/workspaceStore';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceBackup } from '@/domain/workspaceModel';

const databases: Dexie[] = [];
const names: string[] = [];
const now = '2026-10-16T10:00:00.000Z';
function fixture(): WorkspaceBackup {
  const verbundId = crypto.randomUUID();
  const documents = [0, 1].map(() => ({
    localId: crypto.randomUUID(), verbundId, storageSchemaVersion: 1,
    rootType: 'catalog' as const, oscalVersion: '1.1.3', trustClass: 'class-2-local-user' as const,
    documentState: 'imported' as const, createdAt: now, savedAt: now,
    source: makeSchemaValidOscalDocument('catalog', '1.1.3'),
  }));
  return {
    format: 'gspp-workspace', storageSchemaVersion: 1,
    verbuende: [{ verbundId, name: 'Migration fixture', createdAt: now, savedAt: now }], documents,
    drafts: [{ localId: documents[0].localId, savedAt: now, source: { unfinished: 'Draft' } }],
    bindings: [{ fromLocalId: documents[0].localId, pointer: '/catalog/metadata/title', href: 'reference', target: { kind: 'local', localId: documents[1].localId } }],
    workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 1, createdAt: now, savedAt: now }],
  };
}
async function seed(data: WorkspaceBackup) {
  const name = `gspp-migration-test-${crypto.randomUUID()}`;
  names.push(name);
  const db = new Dexie(name);
  databases.push(db);
  db.version(1).stores(WORKSPACE_SCHEMA);
  await db.open();
  for (const table of db.tables) await table.bulkAdd(data[table.name as keyof WorkspaceBackup] as object[]);
  db.close();
  return name;
}
function upgrade(name: string, from = 1, to = 2) {
  const db = new Dexie(name);
  databases.push(db);
  db.version(1).stores(WORKSPACE_SCHEMA);
  db.version(2).stores(WORKSPACE_SCHEMA).upgrade(tx => migrateWorkspaceStorage(tx, from, to));
  return db;
}
async function rows(db: Dexie) {
  return Object.fromEntries(await Promise.all(db.tables.map(async table => [table.name, await table.toArray()])));
}
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, child) => child && typeof child === 'object' && !Array.isArray(child)
    ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a.localeCompare(b))) : child);
}
afterEach(async () => {
  databases.splice(0).forEach(db => db.close());
  await Promise.all(names.splice(0).map(name => Dexie.delete(name)));
});

test('ändert in einer Vorwärtsmigration nur Envelope- und Metaversionen', async () => {
  const data = fixture();
  const name = await seed(data);
  const db = upgrade(name);
  await db.open();
  expect(db.verno).toBe(2);
  const result = await rows(db);
  const expected = { ...data, documents: data.documents.map(row => ({ ...row, storageSchemaVersion: 2 })), workspaceMeta: data.workspaceMeta.map(row => ({ ...row, storageSchemaVersion: 2 })) };
  for (const table of db.tables) {
    const expectedRows = expected[table.name as keyof WorkspaceBackup] as object[];
    expect(canonical(result[table.name])).toBe(canonical([...expectedRows].sort((a, b) => String((a as Record<string, unknown>)[String(table.schema.primKey.keyPath)]).localeCompare(String((b as Record<string, unknown>)[String(table.schema.primKey.keyPath)])))));
  }
});

test.each(['document', 'draft', 'binding', 'verbund', 'meta', 'version', 'root', 'source-version', 'direction', 'future-from', 'skipped-target', 'draft-infinity', 'local-root-uuid'] as const)('ungültiger %s bricht atomar und redigiert ab', async kind => {
  const data = fixture();
  if (kind === 'document') data.documents[1] = { ...data.documents[1], localId: 'PRIVATE_INVALID_VALUE' };
  if (kind === 'draft-infinity') data.drafts[0] = { ...data.drafts[0], source: { value: Infinity } };
  if (kind === 'local-root-uuid') data.documents[1] = { ...data.documents[1], localId: (data.documents[1].source as { catalog: { uuid: string } }).catalog.uuid };
  if (kind === 'draft') data.drafts[0] = { ...data.drafts[0], localId: crypto.randomUUID() };
  if (kind === 'binding') data.bindings[0] = { ...data.bindings[0], target: { kind: 'local', localId: crypto.randomUUID() } };
  if (kind === 'verbund') data.verbuende[0] = { ...data.verbuende[0], savedAt: 'PRIVATE_INVALID_VALUE' };
  if (kind === 'meta') data.workspaceMeta[0] = { ...data.workspaceMeta[0], storageSchemaVersion: 9 };
  if (kind === 'version') data.documents[1] = { ...data.documents[1], oscalVersion: '9.9.9' };
  if (kind === 'root') data.documents[1] = { ...data.documents[1], rootType: 'profile' };
  if (kind === 'source-version') (data.documents[1].source as { catalog: { metadata: Record<string, unknown> } }).catalog.metadata['oscal-version'] = '9.9.9';
  const name = await seed(data);
  const before = new Dexie(name);
  databases.push(before);
  await before.open();
  const snapshot = await rows(before);
  before.close();
  const db = upgrade(name, kind === 'future-from' ? 2 : 1, kind === 'direction' ? 1 : kind === 'skipped-target' ? 3 : 2);
  await expect(db.open()).rejects.toMatchObject({ message: 'WORKSPACE_MIGRATION_INVALID' });
  db.close();
  const reopened = new Dexie(name);
  databases.push(reopened);
  await reopened.open();
  expect(reopened.verno).toBe(1);
  expect(await rows(reopened)).toEqual(snapshot);
});


test('verweigert Migration in einer gewöhnlichen Schreibtransaktion', async () => {
  const name = await seed(fixture());
  const db = new Dexie(name);
  databases.push(db);
  await db.open();
  const before = await rows(db);
  await expect(db.transaction('rw', db.tables, tx => migrateWorkspaceStorage(tx, 1, 2)))
    .rejects.toMatchObject({ message: 'WORKSPACE_MIGRATION_INVALID' });
  expect(await rows(db)).toEqual(before);
});
