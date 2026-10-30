import { restoreWorkspaceBackup } from '@/test/restoreWorkspaceBackup';
import Dexie from 'dexie';
import { expect, test, vi } from 'vitest';
import { WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';
import { parseCatalogInWorker } from '@/state/catalogParseWorker';
import { value, open, document, storedValuesAndIndexKeys } from '@/test/browser/workspaceStoreFixtures';
import { createStartupCatalogSource } from '@/test/fixtures/startupCatalog';

test('legt die sieben aktuellen Stores mit ausschließlich strukturellen Indizes an', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('VERBUND_SENTINEL'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  expect(envelope.localId).not.toBe((imported.source as { catalog: { uuid: string } }).catalog.uuid);
  expect(envelope.verbundId).not.toBe(envelope.localId);
  const db = new Dexie(WORKSPACE_DATABASE_NAME);
  await db.open();
  try {
    expect(db.tables.map(table => table.name).sort()).toEqual(['bindings', 'documents', 'drafts', 'reviewBaseline', 'reviewTrail', 'verbuende', 'workspaceMeta']);
    expect(db.table('documents').schema.primKey.keyPath).toBe('localId');
    expect(db.table('bindings').schema.primKey.keyPath).toEqual(['fromLocalId', 'pointer']);
    expect(db.table('reviewTrail').schema.primKey.keyPath).toEqual(['localId', 'sequence']);
    expect(db.table('reviewBaseline').schema.primKey.keyPath).toBe('localId');
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
  const saved = value(await store.saveDocument(envelope.localId, envelope.savedAt, null, imported));
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
    expect(await operation(envelope.localId, envelope.savedAt, null, replacement)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DOCUMENT_INVALID' } });
    expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
  }
  delete (replacement.source as { catalog: { uuid?: string } }).catalog.uuid;
  expect(await store.saveDocument(envelope.localId, envelope.savedAt, null, replacement)).toMatchObject({ ok: false });
  expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
});

test('geladene Klasse-1-Katalogbytes gelangen auch bei einer Bindung nicht in die Datenbank', async () => {
  const source = createStartupCatalogSource('CLASS_ONE_CATALOG_SENTINEL');
  const loaded = await parseCatalogInWorker(new TextEncoder().encode(JSON.stringify(source)).buffer, { catalogKey: 'gspp', trustClass: 'class-1-verified-public' });
  expect(loaded.catalogDocument.source).toEqual(source);
  const store = await open();
  const verbund = value(await store.createVerbund('Test'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document()));
  value(await store.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, value(await store.getDocument(envelope.localId))!.savedAt));
  expect(await storedValuesAndIndexKeys()).not.toContain('CLASS_ONE_CATALOG_SENTINEL');
});

test('Backup-Export lehnt einen übergroßen Gesamtbestand ab und speichert ihn nicht als Sicherung', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Capacity'));
  for (let index = 0; index < 4; index++) {
    const envelope = value(await store.addDocument(verbund.verbundId, await document()));
    value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { text: 'x'.repeat(9 * 1024 * 1024) }));
  }
  expect(await store.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_LIMIT_EXCEEDED' } });
  expect(value(await store.listDocuments())).toHaveLength(4);
});

test('Autosave lehnt nicht als JSON erhaltbare Zahlen ohne Datenverlust ab', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Numbers'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document()));
  const draft = value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { value: 2 }));
  expect(await store.autosaveDraft(envelope.localId, envelope.savedAt, draft.savedAt, { value: Infinity })).toMatchObject({ ok: false });
  expect(value(await store.getDraft(envelope.localId))).toEqual(draft);
});

test('CAS hält den ersten Stand bei konkurrierenden Verbindungen', async () => {
  const first = await open();
  const second = await open();
  const verbund = value(await first.createVerbund('Test'));
  const envelope = value(await first.addDocument(verbund.verbundId, await document()));
  const current = value(await first.saveDocument(envelope.localId, envelope.savedAt, null, await document('FIRST')));
  expect(await second.saveDocument(envelope.localId, envelope.savedAt, null, await document('SECOND'))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await second.getDocument(envelope.localId))).toEqual(current);
});

test('Entwurfs-CAS hält den ersten Autosave bei konkurrierenden Verbindungen', async () => {
  const first = await open();
  const second = await open();
  const verbund = value(await first.createVerbund('Drafts'));
  const envelope = value(await first.addDocument(verbund.verbundId, await document()));
  const read = value(await first.autosaveDraft(envelope.localId, envelope.savedAt, null, { text: 'READ' }));
  const kept = value(await first.autosaveDraft(envelope.localId, envelope.savedAt, read.savedAt, { text: 'FIRST' }));
  // Fehlschlag, wenn der zweite Autosave mit dem veralteten Entwurfsstand den ersten ersetzt.
  expect(await second.autosaveDraft(envelope.localId, envelope.savedAt, read.savedAt, { text: 'SECOND' })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(await second.autosaveDraft(envelope.localId, envelope.savedAt, null, { text: 'SECOND' })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await second.getDraft(envelope.localId))).toEqual(kept);
  value(await first.deleteDocument(envelope.localId));
  const fresh = value(await first.addDocument(verbund.verbundId, await document()));
  // Fehlschlag, wenn ein erwarteter, aber nicht vorhandener Entwurf als Neuanlage durchgeht.
  expect(await second.autosaveDraft(fresh.localId, fresh.savedAt, kept.savedAt, { text: 'SECOND' })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await second.getDraft(fresh.localId))).toBeUndefined();
});

test('Save und Ersetzen verwerfen keinen Entwurf einer anderen Verbindung', async () => {
  const first = await open();
  const second = await open();
  const verbund = value(await first.createVerbund('Draft save'));
  const imported = await document();
  const envelope = value(await first.addDocument(verbund.verbundId, imported));
  const foreign = value(await second.autosaveDraft(envelope.localId, envelope.savedAt, null, { text: 'SECOND' }));
  // Fehlschlag, wenn der Save ohne Kenntnis des fremden Entwurfs diesen löscht.
  for (const operation of [first.saveDocument.bind(first), first.replaceDocument.bind(first)]) {
    expect(await operation(envelope.localId, envelope.savedAt, null, imported)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(value(await first.getDraft(envelope.localId))).toEqual(foreign);
    expect(value(await first.getDocument(envelope.localId))).toEqual(envelope);
  }
  value(await first.saveDocument(envelope.localId, envelope.savedAt, foreign.savedAt, imported));
  expect(value(await first.getDraft(envelope.localId))).toBeUndefined();
});

test('Bindungsänderungen schützen ihren Stand vor einem veralteten Save', async () => {
  const first = await open();
  const second = await open();
  const verbund = value(await first.createVerbund('Bindings'));
  const imported = await document();
  const envelope = value(await first.addDocument(verbund.verbundId, imported));
  const binding = { fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  value(await second.setBinding(binding, value(await second.getDocument(binding.fromLocalId))!.savedAt));
  expect(await first.saveDocument(envelope.localId, envelope.savedAt, null, imported, [])).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await first.listBindings())).toEqual([binding]);
  const loaded = value(await first.getDocument(envelope.localId))!;
  value(await second.removeBinding(envelope.localId, binding.pointer, loaded.savedAt));
  expect(await first.saveDocument(envelope.localId, loaded.savedAt, null, imported, [binding])).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await first.listBindings())).toEqual([]);
});

test('Dokumentlisten liefern Metadaten ohne alle Quellgraphen zu halten', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('List'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document('LARGE_SOURCE_SENTINEL')));
  const list = value(await store.listDocuments(verbund.verbundId));
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ localId: envelope.localId, verbundId: verbund.verbundId });
  expect(list[0]).not.toHaveProperty('source');
  expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
});

test('Backup erhält negative Null in einem eigenen Dokument und Entwurf', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Numbers'));
  const source = makeSchemaValidOscalDocument('component-definition', '1.1.3');
  const component = (source['component-definition'] as { components: Record<string, unknown>[] }).components[0];
  component.protocols = [{ uuid: crypto.randomUUID(), name: 'test', 'port-ranges': [{ start: -0, end: 1, transport: 'TCP' }] }];
  const raw = JSON.stringify(source).replace('"start":0', '"start":-0');
  const imported = await importClass2OscalDocument(new TextEncoder().encode(raw), { trustClass: 'class-2-local-user' });
  expect(imported.ok).toBe(true);
  if (!imported.ok) return;
  const envelope = value(await store.addDocument(verbund.verbundId, imported.document));
  value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { value: -0 }));
  const backup = value(await store.exportBackup());
  expect(backup).toContain('"start":-0');
  value(await restoreWorkspaceBackup(store, new TextEncoder().encode(backup)));
  const restored = value(await store.getDraft(envelope.localId))!.source as { value: number };
  expect(Object.is(restored.value, -0)).toBe(true);
  const loaded = value(await store.getDocument(envelope.localId))!.source as typeof source;
  expect(loaded).toEqual(source);
});

test('Backup erhält gespeicherte Artefaktverweise auch nach einer Registersperrung', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Lifecycle'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document()));
  const db = new Dexie(WORKSPACE_DATABASE_NAME);
  await db.open();
  const target = { kind: 'class-1', artifactKey: 'catalog-formerly-supported' };
  await db.table('bindings').add({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target });
  await db.table('documents').update(envelope.localId, { derivedFrom: { artifactKey: target.artifactKey, contentSha256: 'a'.repeat(64), snapshotCommit: 'b'.repeat(40) } });
  db.close();
  const backup = value(await store.exportBackup());
  expect(JSON.parse(backup).bindings[0].target).toEqual(target);
  value(await restoreWorkspaceBackup(store, new TextEncoder().encode(backup)));
  expect(value(await store.listBindings())[0].target).toEqual(target);
  expect(await store.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: target as never }, value(await store.getDocument(envelope.localId))!.savedAt)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_ARTIFACT_UNSUPPORTED' } });
});

test('Quota beim nativen Transaktionsabbruch wird redigiert erkannt und rollt zurück', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('PRIVATE_QUOTA'));
  const imported = await document();
  const envelope = value(await store.addDocument(verbund.verbundId, imported));
  const before = value(await store.exportBackup());
  const original = IDBObjectStore.prototype.put;
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    const request = original.apply(this, args);
    if (this.name === 'workspaceMeta') request.addEventListener('success', () => {
      Object.defineProperty(this.transaction, 'error', { value: new DOMException('PRIVATE_QUOTA', 'QuotaExceededError') });
      this.transaction.abort();
    });
    return request;
  });
  const rejected = await store.saveDocument(envelope.localId, envelope.savedAt, null, imported);
  put.mockRestore();
  expect(rejected).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_QUOTA_EXCEEDED' } });
  expect(JSON.stringify(rejected)).not.toContain('PRIVATE_QUOTA');
  expect(value(await store.exportBackup())).toBe(before);
});

test('ersetzt Dokumente mit stabiler Identität und erhält beide Bindungsrichtungen', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Test'));
  const a = value(await store.addDocument(verbund.verbundId, await document('A')));
  const b = value(await store.addDocument(verbund.verbundId, await document('B')));
  const binding = { fromLocalId: a.localId, pointer: '/catalog/metadata/title', href: 'A', target: { kind: 'local' as const, localId: b.localId } };
  value(await store.setBinding(binding, value(await store.getDocument(binding.fromLocalId))!.savedAt));
  value(await store.setBinding({ fromLocalId: b.localId, pointer: '/catalog/metadata/title', href: 'B', target: { kind: 'local', localId: a.localId } }, value(await store.getDocument(b.localId))!.savedAt));
  const replacement = value(await store.replaceDocument(a.localId, value(await store.getDocument(a.localId))!.savedAt, null, await document('REPLACED')));
  expect(replacement).toMatchObject({ localId: a.localId, verbundId: a.verbundId, source: (await document('REPLACED')).source });
  expect(value(await store.listBindings())).toHaveLength(2);
  const other = value(await store.createVerbund('Other'));
  const foreign = value(await store.addDocument(other.verbundId, await document()));
  expect(await store.setBinding({ ...binding, href: 'REPLACED', target: { kind: 'local', localId: foreign.localId } }, value(await store.getDocument(binding.fromLocalId))!.savedAt)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BINDING_CROSS_VERBUND' } });
});

test('Dokument- und Verbundlöschung entfernen beide Richtungen und Entwürfe', async () => {
  const store = await open();
  const one = value(await store.createVerbund('One'));
  const two = value(await store.createVerbund('Two'));
  const a = value(await store.addDocument(one.verbundId, await document('DELETE_SENTINEL')));
  const b = value(await store.addDocument(one.verbundId, await document('B')));
  const control = value(await store.addDocument(two.verbundId, await document('CONTROL')));
  value(await store.autosaveDraft(a.localId, a.savedAt, null, { text: 'DELETE_SENTINEL' }));
  value(await store.setBinding({ fromLocalId: b.localId, pointer: '/catalog/metadata/title', href: 'B', target: { kind: 'local', localId: a.localId } }, value(await store.getDocument(b.localId))!.savedAt));
  value(await store.setBinding({ fromLocalId: a.localId, pointer: '/catalog/metadata/title', href: 'DELETE_SENTINEL', target: { kind: 'local', localId: b.localId } }, value(await store.getDocument(a.localId))!.savedAt));
  value(await store.deleteDocument(a.localId));
  expect(await storedValuesAndIndexKeys()).not.toContain('DELETE_SENTINEL');
  expect(value(await store.listBindings())).toEqual([]);
  expect(value(await store.getDocument(control.localId))).toEqual(control);
  const kept = { fromLocalId: control.localId, pointer: '/catalog/metadata/title', href: 'CONTROL', target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  value(await store.setBinding(kept, control.savedAt));
  value(await store.setBinding({ ...kept, fromLocalId: b.localId, href: 'B' }, value(await store.getDocument(b.localId))!.savedAt));
  value(await store.deleteVerbund(one.verbundId));
  expect(value(await store.listBindings())).toEqual([kept]);
  expect(value(await store.listDocuments())).toMatchObject([{ localId: control.localId }]);
  value(await store.deleteAll('delete-workspace'));
  expect(await Dexie.exists(WORKSPACE_DATABASE_NAME)).toBe(false);
});
