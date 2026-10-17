import Dexie from 'dexie';
import { expect, test, vi } from 'vitest';
import { WORKSPACE_SCHEMA, WORKSPACE_DATABASE_NAME, WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS } from '@/adapters/workspaceStore';
import type { LocalId, WorkspaceResult } from '@/domain/workspaceModel';
import { value, open, document } from '@/test/browser/workspaceStoreFixtures';

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

test('öffnet ein neueres Schema ohne bekannten Store und hält den Gesamtexport erreichbar', async () => {
  const store = await open();
  store.close();
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ ...WORKSPACE_SCHEMA, drafts: null, draftsNext: 'localId' }).upgrade(async tx => {
    await tx.table('workspaceMeta').update('workspace', { storageSchemaVersion: 2 });
    await tx.table('draftsNext').add({ localId: 'next', value: 'FUTURE_DRAFT' });
  });
  await next.open();
  next.close();
  // Fehlschlag, wenn der Store alle bekannten Stores beim Öffnen bindet und open() am fehlenden `drafts` scheitert.
  const older = await open();
  const backup = JSON.parse(value(await older.exportBackup()));
  expect(backup).toMatchObject({ storageSchemaVersion: 2, draftsNext: [{ localId: 'next', value: 'FUTURE_DRAFT' }] });
  expect(backup).not.toHaveProperty('drafts');
  expect(value(await older.listVerbuende())).toEqual([]);
  for (const result of [await older.getDraft('next' as LocalId), await older.createVerbund('No write'), await older.exportVerbundBackup('missing' as Parameters<typeof older.exportVerbundBackup>[0])]) {
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
  }
});

test('abgebrochener Save rollt documents, Bindungen und Entwurf gemeinsam zurück', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Rollback'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  const draft = value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { text: 'DRAFT_SENTINEL' }));
  const binding = { fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  value(await store.setBinding(binding));
  const before = value(await store.exportBackup());
  const rejected = await store.saveDocument(envelope.localId, value(await store.getDocument(envelope.localId))!.savedAt, draft.savedAt, imported, [{ ...binding, target: { kind: 'local', localId: crypto.randomUUID() as LocalId } }]);
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
  const result = await store.saveDocument(envelope.localId, envelope.savedAt, null, imported);
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
  value(await store.autosaveDraft(one.localId, one.savedAt, null, { incomplete: 'DRAFT' }));
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }));
  const before = value(await store.exportBackup());
  value(await store.deleteVerbund(a.verbundId));
  value(await store.restoreBackup(new TextEncoder().encode(before), 'replace-workspace'));
  const restored = value(await store.exportBackup());
  const expected = JSON.parse(before);
  const meta = JSON.parse(restored).workspaceMeta[0];
  // Im Re-Export unterscheidet sich nur der fortgeschriebene Metazeitstempel.
  expect(Date.parse(meta.savedAt)).toBeGreaterThan(Date.parse(expected.workspaceMeta[0].savedAt));
  expected.workspaceMeta[0].savedAt = meta.savedAt;
  expect(JSON.parse(restored)).toEqual(expected);
  expect(await store.restoreBackup(new TextEncoder().encode(before.replace('"storageSchemaVersion":1', '"storageSchemaVersion":99')), 'replace-workspace')).toMatchObject({ ok: false });
  expect(value(await store.exportBackup())).toBe(restored);
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
  const draft = await one(() => store.autosaveDraft(doc.localId, doc.savedAt, null, { incomplete: true }));
  const binding = { fromLocalId: doc.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  await one(() => store.setBinding(binding));
  await one(() => store.removeBinding(doc.localId, binding.pointer));
  const loaded = value(await store.getDocument(doc.localId))!;
  const saved = await one(() => store.saveDocument(doc.localId, loaded.savedAt, draft.savedAt, imported, [binding]));
  await one(() => store.replaceDocument(doc.localId, saved.savedAt, null, imported));
  const backup = await one(() => store.exportBackup());
  await one(() => store.restoreBackup(new TextEncoder().encode(backup), 'replace-workspace'));
  await one(() => store.deleteDocument(doc.localId));
  await one(() => store.deleteVerbund(a.verbundId));
});
