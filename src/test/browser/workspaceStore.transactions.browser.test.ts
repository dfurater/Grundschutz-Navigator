import { restoreWorkspaceBackup } from '@/test/restoreWorkspaceBackup';
import Dexie from 'dexie';
import { expect, test, vi } from 'vitest';
import { WorkspaceStore, WORKSPACE_SCHEMA, WORKSPACE_DATABASE_NAME, WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS, WORKSPACE_OPEN_TIMEOUT_MS } from '@/adapters/workspaceStore';
import type { LocalId, WorkspaceResult } from '@/domain/workspaceModel';
import { value, open, document } from '@/test/browser/workspaceStoreFixtures';

test('öffnet ein tatsächlich neueres Schema und exportiert zusätzliche Stores unverändert', async () => {
  const store = await open();
  store.close();
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(3).stores(WORKSPACE_SCHEMA);
  next.version(4).stores({ ...WORKSPACE_SCHEMA, futureStore: 'id' }).upgrade(async tx => {
    await tx.table('workspaceMeta').update('workspace', { storageSchemaVersion: 4, unknown: ['FUTURE_META'] });
    await tx.table('futureStore').add({ id: 'new', value: 'FUTURE_STORE' });
  });
  await next.open();
  next.close();
  const older = await open();
  expect(await older.createVerbund('No write')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
  expect(JSON.parse(value(await older.exportBackup()))).toMatchObject({ storageSchemaVersion: 4, futureStore: [{ id: 'new', value: 'FUTURE_STORE' }], workspaceMeta: [{ unknown: ['FUTURE_META'] }] });
});

test('öffnet ein neueres Schema ohne bekannten Store und hält den Gesamtexport erreichbar', async () => {
  const store = await open();
  store.close();
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(3).stores(WORKSPACE_SCHEMA);
  next.version(4).stores({ ...WORKSPACE_SCHEMA, drafts: null, draftsNext: 'localId' }).upgrade(async tx => {
    await tx.table('workspaceMeta').update('workspace', { storageSchemaVersion: 4 });
    await tx.table('draftsNext').add({ localId: 'next', value: 'FUTURE_DRAFT' });
  });
  await next.open();
  next.close();
  // Fehlschlag, wenn der Store alle bekannten Stores beim Öffnen bindet und open() am fehlenden `drafts` scheitert.
  const older = await open();
  const backup = JSON.parse(value(await older.exportBackup()));
  expect(backup).toMatchObject({ storageSchemaVersion: 4, draftsNext: [{ localId: 'next', value: 'FUTURE_DRAFT' }] });
  expect(backup).not.toHaveProperty('drafts');
  expect(value(await older.listVerbuende())).toEqual([]);
  for (const result of [await older.getDraft('next' as LocalId), await older.createVerbund('No write'), await older.exportVerbundBackup('missing' as Parameters<typeof older.exportVerbundBackup>[0])]) {
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
  }
});

test('meldet einen fehlenden bekannten Store im aktuellen Schema als ungültig', async () => {
  const store = await open();
  store.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  const current = new Dexie(WORKSPACE_DATABASE_NAME);
  current.version(3).stores({ ...WORKSPACE_SCHEMA, drafts: null });
  await current.open();
  current.close();
  // Fehlschlag, wenn ein fehlender Store im aktuellen Schema als neueres Schema gilt oder als unklassifizierter Speicherfehler endet.
  const reopened = await open();
  expect(await reopened.getDraft('missing' as LocalId)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_INVALID' } });
});

test.each([4, 3])('exportiert ohne workspaceMeta nur ein neueres Schema (Version %i)', async version => {
  const store = await open();
  store.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(version).stores({ ...WORKSPACE_SCHEMA, workspaceMeta: null, workspaceMetaNext: 'id' });
  await next.open();
  await next.table('workspaceMetaNext').add({ id: 'workspace', value: 'FUTURE_META' });
  next.close();
  // Fehlschlag, wenn der Gesamtexport `workspaceMeta` ohne Existenzprüfung liest und ein neueres Schema ohne diesen Store nicht sichert.
  const older = await open();
  if (version === 3) {
    expect(await older.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_INVALID' } });
    return;
  }
  const backup = JSON.parse(value(await older.exportBackup()));
  expect(backup).toMatchObject({ format: 'gspp-workspace', storageSchemaVersion: 4, workspaceMetaNext: [{ id: 'workspace', value: 'FUTURE_META' }] });
  expect(backup).not.toHaveProperty('workspaceMeta');
  expect(await older.createVerbund('No write')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
});

test('abgebrochener Save rollt documents, Bindungen und Entwurf gemeinsam zurück', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Rollback'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  const draft = value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { text: 'DRAFT_SENTINEL' }));
  const binding = { fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  value(await store.setBinding(binding, value(await store.getDocument(binding.fromLocalId))!.savedAt));
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
  await db.table('workspaceMeta').update('workspace', { storageSchemaVersion: 4, future: { sentinel: 'FUTURE_FIELD' } });
  await db.table('documents').update(envelope.localId, { storageSchemaVersion: 4, future: 'FUTURE_DOC' });
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
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, value(await store.getDocument(one.localId))!.savedAt));
  const before = value(await store.exportBackup());
  value(await store.deleteVerbund(a.verbundId));
  value(await restoreWorkspaceBackup(store, new TextEncoder().encode(before)));
  const restored = value(await store.exportBackup());
  const expected = JSON.parse(before);
  const meta = JSON.parse(restored).workspaceMeta[0];
  // Im Re-Export unterscheidet sich nur der fortgeschriebene Metazeitstempel.
  expect(Date.parse(meta.savedAt)).toBeGreaterThan(Date.parse(expected.workspaceMeta[0].savedAt));
  expected.workspaceMeta[0].savedAt = meta.savedAt;
  expect(JSON.parse(restored)).toEqual(expected);
  expect(await restoreWorkspaceBackup(store, new TextEncoder().encode(before.replace('"storageSchemaVersion":3', '"storageSchemaVersion":99')))).toMatchObject({ ok: false });
  expect(value(await store.exportBackup())).toBe(restored);
});

test('blockierte Gesamtlöschung meldet nach fester Frist eine ausstehende Löschung, begrenzt ein Öffnen dahinter und wird nach dem Schließen der Blockade ohne neue Datenbank abgeschlossen', async () => {
  const store = await open();
  const blocker = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(WORKSPACE_DATABASE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const exists = vi.spyOn(Dexie, 'exists');
  const connections = vi.spyOn(Dexie.prototype, 'open');
  try {
    let lateCheck: Promise<boolean>;
    let opened: number;
    try {
      const started = performance.now();
      expect(await store.deleteAll('delete-workspace')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DELETE_PENDING' } });
      expect(performance.now() - started).toBeGreaterThanOrEqual(WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS - 30);
      expect((await indexedDB.databases()).map(database => database.name)).toContain(WORKSPACE_DATABASE_NAME);
      const opening = performance.now();
      expect(await WorkspaceStore.open()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_OPEN_TIMEOUT' } });
      expect(performance.now() - opening).toBeGreaterThanOrEqual(WORKSPACE_OPEN_TIMEOUT_MS - 30);
      expect(exists).toHaveBeenCalledTimes(1);
      lateCheck = exists.mock.results[0].value as Promise<boolean>;
      opened = connections.mock.calls.length;
    } finally { blocker.close(); }
    // The abandoned open resumes once the deletion completes; its continuation runs before this await returns and must stop before opening a connection.
    expect(await lateCheck).toBe(false);
    expect(connections).toHaveBeenCalledTimes(opened);
    await expect.poll(async () => (await indexedDB.databases()).map(database => database.name)).not.toContain(WORKSPACE_DATABASE_NAME);
  } finally { exists.mockRestore(); connections.mockRestore(); }
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
  await one(() => store.setBinding(binding, doc.savedAt));
  const bound = value(await store.getDocument(doc.localId))!;
  await one(() => store.removeBinding(doc.localId, binding.pointer, bound.savedAt));
  const loaded = value(await store.getDocument(doc.localId))!;
  const saved = await one(() => store.saveDocument(doc.localId, loaded.savedAt, draft.savedAt, imported, [binding]));
  await one(() => store.replaceDocument(doc.localId, saved.savedAt, null, imported));
  const backup = await one(() => store.exportBackup());
  const preview = await one(() => store.previewRestoreBackup(new TextEncoder().encode(backup)));
  await one(() => store.restoreBackup(preview));
  await one(() => store.deleteDocument(doc.localId));
  await one(() => store.deleteVerbund(a.verbundId));
});

test('veraltete Bindungsänderungen erhalten das neuere Ziel und den gesamten Speicherstand', async () => {
  const first = await open();
  const second = await open();
  const verbund = value(await first.createVerbund('Binding CAS'));
  const envelope = value(await first.addDocument(verbund.verbundId, await document()));
  const target = value(await first.addDocument(verbund.verbundId, await document('TARGET')));
  const binding = { fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  value(await first.setBinding(binding, envelope.savedAt));
  const loaded = value(await first.getDocument(envelope.localId))!;
  const changed = { ...binding, target: { kind: 'local' as const, localId: target.localId } };
  value(await second.setBinding(changed, loaded.savedAt));
  const before = JSON.parse(value(await second.exportBackup()));
  for (const stale of [loaded.savedAt, undefined as unknown as string]) {
    expect(await first.setBinding(binding, stale)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(await first.removeBinding(envelope.localId, binding.pointer, stale)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(JSON.parse(value(await first.exportBackup()))).toEqual(before);
  }
  expect(value(await first.listBindings())).toEqual([changed]);
  const current = value(await first.getDocument(envelope.localId))!;
  value(await first.removeBinding(envelope.localId, binding.pointer, current.savedAt));
  const removed = value(await first.exportBackup());
  // A stale remove still conflicts when the binding has already disappeared.
  expect(await second.removeBinding(envelope.localId, binding.pointer, current.savedAt)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(await second.setBinding(binding, current.savedAt)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await first.exportBackup())).toBe(removed);
  const fresh = value(await first.getDocument(envelope.localId))!;
  value(await first.removeBinding(envelope.localId, binding.pointer, fresh.savedAt));
  expect(value(await first.getDocument(envelope.localId))).toEqual(fresh);
  value(await first.setBinding(binding, fresh.savedAt));
  expect(value(await first.listBindings())).toEqual([binding]);
  expect(value(await first.getDocument(envelope.localId))?.source).toEqual(envelope.source);
});

test.each([
  { key: 'next', rows: [{ next: 'workspace-next', version: 2 }] },
  { key: 'id', rows: [{ id: 'workspace', version: 2 }] },
  { key: 'id', rows: [] },
  { key: 'id', rows: [{ id: 'workspace', storageSchemaVersion: 1, backupSavedAt: 'OPAQUE_FILE_STAMP' }] },
])('sichert neuere Datenbankmetadaten ohne Interpretation ($key, $rows)', async ({ key, rows }) => {
  const store = await open();
  store.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(4).stores({ workspaceMeta: key, futureStore: '' });
  await next.open();
  try {
    await next.table('workspaceMeta').bulkAdd(rows);
    await next.table('futureStore').add({ source: { unknown: true }, backupSavedAt: 'FUTURE_FIELD' }, 'separate-key');
    const older = await open();
    const before = await next.table('workspaceMeta').toArray();
    expect(JSON.parse(value(await older.exportBackup()))).toEqual({
      format: 'gspp-workspace', storageSchemaVersion: 4,
      workspaceMeta: rows,
      futureStore: [{ source: { unknown: true }, backupSavedAt: 'FUTURE_FIELD' }],
      outOfLineKeys: { futureStore: ['separate-key'] },
    });
    expect(await next.table('workspaceMeta').toArray()).toEqual(before);
    expect(await older.createVerbund('No write')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
    expect(await older.exportVerbundBackup('missing' as Parameters<typeof older.exportVerbundBackup>[0])).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
  } finally { next.close(); }
});
