import Dexie from 'dexie';
import { afterEach, expect, test, vi } from 'vitest';
import { WorkspaceStore, WORKSPACE_SCHEMA, WORKSPACE_DATABASE_NAME, WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';
import { parseCatalogInWorker } from '@/state/catalogParseWorker';
import { createStartupCatalogSource } from '@/test/fixtures/startupCatalog';

function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}
const connections: WorkspaceStore[] = [];
async function open() {
  const store = value(await WorkspaceStore.open());
  connections.push(store);
  return store;
}
async function document(title = 'DOCUMENT_SENTINEL') {
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  (source.catalog as { metadata: { title: string } }).metadata.title = title;
  const result = await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}
async function storedValuesAndIndexKeys(): Promise<string> {
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

test('legt genau fünf Stores mit ausschließlich strukturellen Indizes an', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('VERBUND_SENTINEL'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  expect(envelope.localId).not.toBe((imported.source as { catalog: { uuid: string } }).catalog.uuid);
  expect(envelope.verbundId).not.toBe(envelope.localId);
  const db = new Dexie(WORKSPACE_DATABASE_NAME);
  await db.open();
  try {
    expect(db.tables.map(table => table.name).sort()).toEqual(['bindings', 'documents', 'drafts', 'verbuende', 'workspaceMeta']);
    expect(db.table('documents').schema.primKey.keyPath).toBe('localId');
    expect(db.table('bindings').schema.primKey.keyPath).toEqual(['fromLocalId', 'pointer']);
    expect(db.table('documents').schema.indexes.map(index => index.name).sort()).toEqual(['oscalVersion', 'rootType', 'savedAt', 'verbundId']);
    for (const table of db.tables) {
      for (const index of table.schema.indexes) {
        const keys = await table.orderBy(index.name).keys();
        expect(JSON.stringify(keys)).not.toMatch(/DOCUMENT_SENTINEL|VERBUND_SENTINEL/);
      }
    }
  } finally { db.close(); }
});

test('speichert source unverändert und lehnt eine andere Vertrauensklasse ab', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Test'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  const saved = value(await store.saveDocument(envelope.localId, envelope.savedAt, imported));
  expect(saved.savedAt).not.toBe(envelope.savedAt);
  const valueSource = value(await store.getDocument(envelope.localId))?.source;
  expect(valueSource).toEqual(imported.source);
  const roundTrip = await runNoOpRoundTrip({ fixtureText: JSON.stringify(imported.source), exportDocument: () => valueSource });
  expect(roundTrip.serialization.status).toBe('passed');
  expect(roundTrip.graph.status).toBe('passed');
  expect(roundTrip.identities.status).toBe('passed');
  expect(await store.addDocument(verbund.verbundId, { ...imported, context: { trustClass: 'class-1-verified-public' } } as never)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_TRUST_CLASS_REJECTED' } });
});

test('mutierte Importobjekte erreichen weder Speicher noch Exportfreigabe', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Invalid source'));
  const imported = await document();
  delete (imported.source as { catalog: { uuid?: string } }).catalog.uuid;
  expect(await store.addDocument(verbund.verbundId, imported, 'export-ready')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DOCUMENT_INVALID' } });
  expect(value(await store.listDocuments())).toEqual([]);
});

test('Save und Ersetzen lehnen Root-UUID gleich localId ab und erhalten den Vorzustand', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Identity'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  const replacement = await document();
  (replacement.source as { catalog: { uuid: string } }).catalog.uuid = envelope.localId;
  for (const operation of [store.saveDocument.bind(store), store.replaceDocument.bind(store)]) {
    expect(await operation(envelope.localId, envelope.savedAt, replacement)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DOCUMENT_INVALID' } });
    expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
  }
  delete (replacement.source as { catalog: { uuid?: string } }).catalog.uuid;
  expect(await store.saveDocument(envelope.localId, envelope.savedAt, replacement)).toMatchObject({ ok: false });
  expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
});

test('geladene Klasse-1-Katalogbytes gelangen auch bei einer Bindung nicht in die Datenbank', async () => {
  const source = createStartupCatalogSource('CLASS_ONE_CATALOG_SENTINEL');
  const loaded = await parseCatalogInWorker(new TextEncoder().encode(JSON.stringify(source)).buffer, { catalogKey: 'gspp', trustClass: 'class-1-verified-public' });
  expect(loaded.catalogDocument.source).toEqual(source);
  const store = await open();
  const verbund = value(await store.createVerbund('Test'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document()));
  value(await store.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }));
  expect(await storedValuesAndIndexKeys()).not.toContain('CLASS_ONE_CATALOG_SENTINEL');
});

test('Backup-Export lehnt einen übergroßen Gesamtbestand ab und speichert ihn nicht als Sicherung', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Capacity'));
  for (let index = 0; index < 4; index++) {
    const envelope = value(await store.addDocument(verbund.verbundId, await document()));
    value(await store.autosaveDraft(envelope.localId, envelope.savedAt, { text: 'x'.repeat(9 * 1024 * 1024) }));
  }
  expect(await store.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_LIMIT_EXCEEDED' } });
  expect(value(await store.listDocuments())).toHaveLength(4);
});

test('Autosave lehnt nicht als JSON erhaltbare Zahlen ohne Datenverlust ab', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Numbers'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document()));
  const draft = value(await store.autosaveDraft(envelope.localId, envelope.savedAt, { value: 2 }));
  expect(await store.autosaveDraft(envelope.localId, envelope.savedAt, { value: Infinity })).toMatchObject({ ok: false });
  expect(value(await store.getDraft(envelope.localId))).toEqual(draft);
});

test('CAS hält den ersten Stand bei konkurrierenden Verbindungen', async () => {
  const first = await open();
  const second = await open();
  const verbund = value(await first.createVerbund('Test'));
  const envelope = value(await first.addDocument(verbund.verbundId, await document()));
  const current = value(await first.saveDocument(envelope.localId, envelope.savedAt, await document('FIRST')));
  expect(await second.saveDocument(envelope.localId, envelope.savedAt, await document('SECOND'))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await second.getDocument(envelope.localId))).toEqual(current);
});

test('ersetzt Dokumente mit stabiler Identität und erhält beide Bindungsrichtungen', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Test'));
  const a = value(await store.addDocument(verbund.verbundId, await document('A')));
  const b = value(await store.addDocument(verbund.verbundId, await document('B')));
  const binding = { fromLocalId: a.localId, pointer: '/catalog/metadata/title', href: 'A', target: { kind: 'local' as const, localId: b.localId } };
  value(await store.setBinding(binding));
  value(await store.setBinding({ fromLocalId: b.localId, pointer: '/catalog/metadata/title', href: 'B', target: { kind: 'local', localId: a.localId } }));
  const replacement = value(await store.replaceDocument(a.localId, a.savedAt, await document('REPLACED')));
  expect(replacement).toMatchObject({ localId: a.localId, verbundId: a.verbundId, source: (await document('REPLACED')).source });
  expect(value(await store.listBindings())).toHaveLength(2);
  const other = value(await store.createVerbund('Other'));
  const foreign = value(await store.addDocument(other.verbundId, await document()));
  expect(await store.setBinding({ ...binding, href: 'REPLACED', target: { kind: 'local', localId: foreign.localId } })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BINDING_CROSS_VERBUND' } });
});

test('Dokument- und Verbundlöschung entfernen beide Richtungen und Entwürfe', async () => {
  const store = await open();
  const one = value(await store.createVerbund('One'));
  const two = value(await store.createVerbund('Two'));
  const a = value(await store.addDocument(one.verbundId, await document('DELETE_SENTINEL')));
  const b = value(await store.addDocument(one.verbundId, await document('B')));
  const control = value(await store.addDocument(two.verbundId, await document('CONTROL')));
  value(await store.autosaveDraft(a.localId, a.savedAt, { text: 'DELETE_SENTINEL' }));
  value(await store.setBinding({ fromLocalId: b.localId, pointer: '/catalog/metadata/title', href: 'B', target: { kind: 'local', localId: a.localId } }));
  value(await store.setBinding({ fromLocalId: a.localId, pointer: '/catalog/metadata/title', href: 'DELETE_SENTINEL', target: { kind: 'local', localId: b.localId } }));
  value(await store.deleteDocument(a.localId));
  expect(await storedValuesAndIndexKeys()).not.toContain('DELETE_SENTINEL');
  expect(value(await store.listBindings())).toEqual([]);
  expect(value(await store.getDocument(control.localId))).toEqual(control);
  value(await store.deleteVerbund(one.verbundId));
  expect(value(await store.listDocuments())).toEqual([control]);
  value(await store.deleteAll('delete-workspace'));
  expect(await Dexie.exists(WORKSPACE_DATABASE_NAME)).toBe(false);
});

test('öffnet ein tatsächlich neueres Schema und exportiert zusätzliche Stores unverändert', async () => {
  const store = await open();
  store.close();
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ ...WORKSPACE_SCHEMA, futureStore: 'id' }).upgrade(async tx => {
    await tx.table('workspaceMeta').update('workspace', { storageSchemaVersion: 2, unknown: ['FUTURE_META'] });
    await tx.table('futureStore').add({ id: 'new', value: 'FUTURE_STORE' });
  });
  await next.open();
  next.close();
  const older = await open();
  expect(await older.createVerbund('No write')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
  expect(JSON.parse(value(await older.exportBackup()))).toMatchObject({ storageSchemaVersion: 2, futureStore: [{ id: 'new', value: 'FUTURE_STORE' }], workspaceMeta: [{ unknown: ['FUTURE_META'] }] });
});

test('abgebrochener Save rollt documents, Bindungen und Entwurf gemeinsam zurück', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Rollback'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  value(await store.autosaveDraft(envelope.localId, envelope.savedAt, { text: 'DRAFT_SENTINEL' }));
  const binding = { fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  value(await store.setBinding(binding));
  const before = value(await store.exportBackup());
  const rejected = await store.saveDocument(envelope.localId, envelope.savedAt, imported, [{ ...binding, target: { kind: 'local', localId: crypto.randomUUID() } }]);
  expect(rejected).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DOCUMENT_NOT_FOUND' } });
  expect(value(await store.exportBackup())).toBe(before);
});

test('Quota-Fehler nach Dokumentput rollt zurück und gibt ausschließlich einen stabilen Code aus', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('SECRET_VERBUND'));
  const imported = await document('SECRET_SOURCE');
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  const before = value(await store.exportBackup());
  const original = IDBObjectStore.prototype.put;
  const log = vi.spyOn(console, 'log');
  const error = vi.spyOn(console, 'error');
  const warn = vi.spyOn(console, 'warn');
  const info = vi.spyOn(console, 'info');
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'workspaceMeta') throw new DOMException('SECRET_SOURCE SECRET_VERBUND', 'QuotaExceededError');
    return original.apply(this, args);
  });
  const result = await store.saveDocument(envelope.localId, envelope.savedAt, imported);
  put.mockRestore();
  expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_QUOTA_EXCEEDED' } });
  expect(JSON.stringify(result)).not.toMatch(/SECRET/);
  expect([log, error, warn, info].flatMap(spy => spy.mock.calls)).toEqual([]);
  expect(value(await store.exportBackup())).toBe(before);
});

test('neuere Schema-Version sperrt Schreiben und erhält unbekannte Felder beim Export', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Future'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document()));
  const db = new Dexie(WORKSPACE_DATABASE_NAME);
  await db.open();
  await db.table('workspaceMeta').update('workspace', { storageSchemaVersion: 2, future: { sentinel: 'FUTURE_FIELD' } });
  await db.table('documents').update(envelope.localId, { storageSchemaVersion: 2, future: 'FUTURE_DOC' });
  db.close();
  expect(await store.renameVerbund(verbund.verbundId, 'No')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
  store.close();
  const olderTab = await open();
  expect(value(await olderTab.getDocument(envelope.localId))).toMatchObject({ future: 'FUTURE_DOC' });
  const backup = value(await olderTab.exportBackup());
  expect(backup).toContain('FUTURE_FIELD');
  expect(backup).toContain('FUTURE_DOC');
});

test('Backup stellt zwei Verbünde mit Dokumenten, Entwürfen und Bindungen verlustfrei wieder her', async () => {
  const store = await open();
  const a = value(await store.createVerbund('One'));
  const b = value(await store.createVerbund('Two'));
  const one = value(await store.addDocument(a.verbundId, await document()));
  value(await store.addDocument(b.verbundId, await document('OTHER')));
  value(await store.autosaveDraft(one.localId, one.savedAt, { incomplete: 'DRAFT' }));
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }));
  const before = value(await store.exportBackup());
  value(await store.deleteVerbund(a.verbundId));
  value(await store.restoreBackup(new TextEncoder().encode(before), 'replace-workspace'));
  expect(JSON.parse(value(await store.exportBackup()))).toEqual(JSON.parse(before));
  expect(await store.restoreBackup(new TextEncoder().encode(before.replace('"storageSchemaVersion":1', '"storageSchemaVersion":99')), 'replace-workspace')).toMatchObject({ ok: false });
  expect(value(await store.exportBackup())).toBe(before);
});

test('blockierte Gesamtlöschung liefert nach fester Frist eine Diagnose', async () => {
  const store = await open();
  const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    const started = performance.now();
    expect(await store.deleteAll('delete-workspace')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DELETE_BLOCKED' } });
    expect(performance.now() - started).toBeGreaterThanOrEqual(WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS - 30);
  } finally { blocker.close(); }
});

test('jede Speicheroperation verwendet genau eine native Transaktion', async () => {
  // Dexie binds the native transaction method while opening the connection.
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const store = await open();
  const imported = await document();
  async function one<T>(operation: () => Promise<WorkspaceResult<T>>) {
    transaction.mockClear();
    const result = value(await operation());
    expect(transaction).toHaveBeenCalledTimes(1);
    return result;
  }
  const a = await one(() => store.createVerbund('One'));
  await one(() => store.renameVerbund(a.verbundId, 'Renamed'));
  const doc = await one(() => store.addDocument(a.verbundId, imported));
  await one(() => store.autosaveDraft(doc.localId, doc.savedAt, { incomplete: true }));
  const binding = { fromLocalId: doc.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  await one(() => store.setBinding(binding));
  await one(() => store.removeBinding(doc.localId, binding.pointer));
  const saved = await one(() => store.saveDocument(doc.localId, doc.savedAt, imported, [binding]));
  await one(() => store.replaceDocument(doc.localId, saved.savedAt, imported));
  const backup = await one(() => store.exportBackup());
  await one(() => store.restoreBackup(new TextEncoder().encode(backup), 'replace-workspace'));
  await one(() => store.deleteDocument(doc.localId));
  await one(() => store.deleteVerbund(a.verbundId));
});
