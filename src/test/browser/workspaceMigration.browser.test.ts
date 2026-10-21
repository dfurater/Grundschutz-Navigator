import Dexie from 'dexie';
import { afterEach, expect, test, vi } from 'vitest';
import { migrateWorkspaceStorage } from '@/adapters/workspaceMigration';
import { WORKSPACE_SCHEMA, WORKSPACE_SCHEMA_V1 } from '@/adapters/workspaceStore';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { LocalId, VerbundId, WorkspaceBackup } from '@/domain/workspaceModel';
import { normalizeWorkspaceBackup } from '@/adapters/workspaceBackupStructure';

const databases: Dexie[] = [];
const names: string[] = [];
const now = '2026-10-16T10:00:00.000Z';
type V1Backup = Omit<WorkspaceBackup, 'storageSchemaVersion' | 'reviewTrail' | 'reviewBaseline'> & { storageSchemaVersion: 1 };
function fixture(): V1Backup {
  const verbundId = crypto.randomUUID() as VerbundId;
  const documents = [0, 1].map(() => ({
    localId: crypto.randomUUID() as LocalId, verbundId, storageSchemaVersion: 1,
    rootType: 'catalog' as const, oscalVersion: '1.1.3', trustClass: 'class-2-local-user' as const,
    documentState: 'imported' as const, createdAt: now, savedAt: now,
    source: makeSchemaValidOscalDocument('catalog', '1.1.3'),
  }));
  const backup: V1Backup = {
    format: 'gspp-workspace', storageSchemaVersion: 1,
    verbuende: [{ verbundId, name: 'Migration fixture', createdAt: now, savedAt: now }], documents,
    drafts: [{ localId: documents[0].localId, savedAt: now, source: { unfinished: 'Draft' } }],
    bindings: [{ fromLocalId: documents[0].localId, pointer: '/catalog/metadata/title', href: 'reference', target: { kind: 'local', localId: documents[1].localId } }],
    workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 1, createdAt: now, savedAt: now }],
  };
  if (!normalizeWorkspaceBackup(backup)) throw new Error('Invalid migration fixture');
  return backup;
}
async function seed(data: V1Backup) {
  const name = `gspp-migration-test-${crypto.randomUUID()}`;
  names.push(name);
  const db = new Dexie(name);
  databases.push(db);
  db.version(1).stores(WORKSPACE_SCHEMA_V1);
  await db.open();
  for (const table of db.tables) await table.bulkAdd(data[table.name as keyof V1Backup] as object[]);
  db.close();
  return name;
}
function upgrade(name: string, from = 1, to = 2) {
  const db = new Dexie(name);
  databases.push(db);
  db.version(1).stores(WORKSPACE_SCHEMA_V1);
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
  vi.restoreAllMocks();
  databases.splice(0).forEach(db => db.close());
  await Promise.all(names.splice(0).map(name => Dexie.delete(name)));
});

test.each(['request-error', 'synchronous-error', 'continue-error'] as const)('rollt nach einem späteren Cursorfehler vollständig zurück: %s', async kind => {
  const data = fixture();
  const name = await seed(data);
  const before = new Dexie(name);
  databases.push(before);
  await before.open();
  const snapshot = await rows(before);
  before.close();
  const advance = IDBCursor.prototype.continue;
  const update = IDBCursor.prototype.update;
  let writes = 0;
  vi.spyOn(IDBCursor.prototype, 'continue').mockImplementation(function (this: IDBCursor, key?: IDBValidKey) {
    if (kind === 'continue-error' && this.source instanceof IDBObjectStore && this.source.name === 'documents' && writes === 1) {
      throw new Error('PRIVATE_INVALID_VALUE');
    }
    return advance.call(this, key);
  });
  const spy = vi.spyOn(IDBCursor.prototype, 'update').mockImplementation(function (this: IDBCursor, value: unknown) {
    if (this.source instanceof IDBObjectStore && this.source.name === 'documents' && ++writes === 2) {
      if (kind === 'synchronous-error') throw new Error('PRIVATE_INVALID_VALUE');
      // A duplicate primary key causes an actual asynchronous IndexedDB ConstraintError.
      return this.source.add(value);
    }
    return update.call(this, value);
  });
  const db = upgrade(name);
  await expect(db.open()).rejects.toMatchObject({ message: 'WORKSPACE_MIGRATION_INVALID' });
  expect(writes).toBe(kind === 'continue-error' ? 1 : 2);
  spy.mockRestore();
  db.close();
  const reopened = new Dexie(name);
  databases.push(reopened);
  await reopened.open();
  expect(reopened.verno).toBe(1);
  expect(await rows(reopened)).toEqual(snapshot);
});

test('ändert in einer Vorwärtsmigration nur Envelope- und Metaversionen', async () => {
  const data = fixture();
  const name = await seed(data);
  const db = upgrade(name);
  await db.open();
  expect(db.verno).toBe(2);
  const result = await rows(db);
  const expected = { ...data, documents: data.documents.map(row => ({ ...row, storageSchemaVersion: 2 })), workspaceMeta: data.workspaceMeta.map(row => ({ ...row, storageSchemaVersion: 2 })), reviewTrail: [], reviewBaseline: [] };
  for (const table of db.tables) {
    const expectedRows = expected[table.name as keyof WorkspaceBackup] as object[];
    expect(canonical(result[table.name])).toBe(canonical([...expectedRows].sort((a, b) => String((a as Record<string, unknown>)[String(table.schema.primKey.keyPath)]).localeCompare(String((b as Record<string, unknown>)[String(table.schema.primKey.keyPath)])))));
  }
});

test('migriert Quellen per Cursor ohne sammelnde Lese- oder Schreiboperationen', async () => {
  const data = fixture();
  const name = await seed(data);
  const db = upgrade(name);
  let bulkSourceRequests = 0;
  const getAll = IDBObjectStore.prototype.getAll;
  const bulkReadGuard = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args) {
    if (['documents', 'drafts'].includes(this.name)) {
      bulkSourceRequests++;
      throw new Error('Bulk source read exceeds migration memory budget');
    }
    return getAll.apply(this, args);
  });
  db.use({
    stack: 'dbcore',
    name: 'migration-source-budget',
    create: core => ({
      ...core,
      table: tableName => {
        const table = core.table(tableName);
        if (!['documents', 'drafts'].includes(tableName)) return table;
        return {
          ...table,
          query: request => {
            if (request.values !== false) {
              bulkSourceRequests++;
              throw new Error('Bulk source read exceeds migration memory budget');
            }
            return table.query(request);
          },
          getMany: () => {
            bulkSourceRequests++;
            throw new Error('Bulk source read exceeds migration memory budget');
          },
          mutate: request => {
            if (request.type === 'put' && request.values.length > 1) {
              bulkSourceRequests++;
              throw new Error('Bulk source write exceeds migration memory budget');
            }
            return table.mutate(request);
          },
        };
      },
    }),
  });
  await db.open();
  expect(bulkSourceRequests).toBe(0);
  bulkReadGuard.mockRestore();
  // Readback uses a separate connection without the migration-only memory guard.
  db.close();
  const reopened = new Dexie(name);
  databases.push(reopened);
  await reopened.open();
  const result = await rows(reopened);
  expect(result.documents).toEqual([...data.documents]
    .sort((a, b) => a.localId.localeCompare(b.localId))
    .map(row => ({ ...row, storageSchemaVersion: 2 })));
  expect(result.drafts).toEqual(data.drafts);
  expect(result.bindings).toEqual(data.bindings);
  expect(result.verbuende).toEqual(data.verbuende);
  expect(result.reviewTrail).toEqual([]);
  expect(result.reviewBaseline).toEqual([]);
  expect(result.workspaceMeta).toEqual(data.workspaceMeta.map(row => ({ ...row, storageSchemaVersion: 2 })));
});

test.each(['document', 'draft', 'binding', 'cross-verbund-binding', 'verbund', 'meta', 'missing-meta', 'version', 'root', 'source-version', 'direction', 'future-from', 'skipped-target', 'draft-infinity', 'local-root-uuid'] as const)('ungültiger %s bricht atomar und redigiert ab', async kind => {
  const data = fixture();
  if (kind === 'document') data.documents[1] = { ...data.documents[1], localId: 'PRIVATE_INVALID_VALUE' as LocalId };
  if (kind === 'draft-infinity') data.drafts[0] = { ...data.drafts[0], source: { value: Infinity } };
  if (kind === 'local-root-uuid') data.documents[1] = { ...data.documents[1], localId: (data.documents[1].source as { catalog: { uuid: string } }).catalog.uuid as LocalId };
  if (kind === 'draft') data.drafts[0] = { ...data.drafts[0], localId: crypto.randomUUID() as LocalId };
  if (kind === 'binding') data.bindings[0] = { ...data.bindings[0], target: { kind: 'local', localId: crypto.randomUUID() as LocalId } };
  if (kind === 'cross-verbund-binding') {
    const verbund = { ...data.verbuende[0], verbundId: crypto.randomUUID() as VerbundId };
    data.verbuende.push(verbund);
    data.documents[1] = { ...data.documents[1], verbundId: verbund.verbundId };
  }
  if (kind === 'verbund') data.verbuende[0] = { ...data.verbuende[0], savedAt: 'PRIVATE_INVALID_VALUE' };
  if (kind === 'meta') data.workspaceMeta[0] = { ...data.workspaceMeta[0], storageSchemaVersion: 9 };
  if (kind === 'missing-meta') data.workspaceMeta.splice(0);
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
