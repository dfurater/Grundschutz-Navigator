import Dexie from 'dexie';
import { beforeEach, expect, it, vi } from 'vitest';
import { WORKSPACE_DATABASE_NAME, WORKSPACE_SCHEMA } from '@/adapters/workspaceStore';
import { open, document, value, storedValuesAndIndexKeys } from '@/test/browser/workspaceStoreFixtures';
import { restoreWorkspaceBackup } from '@/test/restoreWorkspaceBackup';

const bytes = (text: string) => new TextEncoder().encode(text);

/** The same contract runs against fake-indexeddb and native Chromium with real workers. */
export function verbundRestorePreviewContract() {
  let store: Awaited<ReturnType<typeof open>>;
  let selected: import('@/domain/workspaceModel').WorkspaceVerbund;
  let envelope: import('@/domain/workspaceModel').WorkspaceEnvelope;
  let imported: Awaited<ReturnType<typeof document>>;
  let file: string;
  beforeEach(async () => {
    store = await open();
    selected = value(await store.createVerbund('Selected'));
    imported = await document();
    envelope = value(await store.addDocument(selected.verbundId, imported));
    file = value(await store.exportVerbundBackup(selected.verbundId));
  });

  it('binds a read-only deeply frozen file, target and restore kind to its issuing instance', async () => {
    const before = await storedValuesAndIndexKeys();
    const input = bytes(file);
    const transaction = vi.spyOn(Dexie.prototype, 'transaction');
    const preview = value(await store.previewRestoreVerbundBackup(input));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(preview).toMatchObject({ kind: 'verbund', verbundId: selected.verbundId, name: selected.name, existingVerbund: selected, counts: { verbuende: { file: 1, target: 1 }, documents: { file: 1, target: 1 } } });
    expect(preview.target).not.toHaveProperty('savedAt');
    for (const row of [preview, preview.target, preview.target.documents, preview.backup.documents[0].source]) expect(Object.isFrozen(row)).toBe(true);
    expect(() => Object.assign(preview.backup.verbuende[0], { name: 'Changed' })).toThrow();
    const other = await open();
    const whole = value(await store.previewRestoreBackup(bytes(value(await store.exportBackup()))));
    transaction.mockClear();
    for (const invalid of [undefined, { ...preview }, whole]) expect(await store.restoreVerbundBackup(invalid as never)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
    expect(await other.restoreVerbundBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
    expect(await store.restoreBackup(preview as never)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
    expect(transaction).not.toHaveBeenCalled();
    expect(await storedValuesAndIndexKeys()).toBe(before);
    input.fill(0);
    transaction.mockClear();
    value(await store.restoreVerbundBackup(preview));
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(value(await store.exportVerbundBackup(selected.verbundId))).toBe(file);
  });

  it('previews and replaces a target without aggregating document sources', async () => {
    value(await store.addDocument(selected.verbundId, imported));
    const originalStore = IDBObjectStore.prototype.getAll;
    const originalIndex = IDBIndex.prototype.getAll;
    const storeRead = vi.spyOn(IDBObjectStore.prototype, 'getAll').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['getAll']>) {
      if (this.name === 'documents') throw new Error('Aggregated target document sources');
      return originalStore.apply(this, args);
    });
    const indexRead = vi.spyOn(IDBIndex.prototype, 'getAll').mockImplementation(function (this: IDBIndex, ...args: Parameters<IDBIndex['getAll']>) {
      if (this.objectStore.name === 'documents') throw new Error('Aggregated target document sources');
      return originalIndex.apply(this, args);
    });
    try {
      const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
      expect(preview.target.documents).toHaveLength(2);
      expect(preview.counts.documents).toEqual({ file: 1, target: 2 });
      value(await store.restoreVerbundBackup(preview));
    } finally { storeRead.mockRestore(); indexRead.mockRestore(); }
    expect(value(await store.listDocuments(selected.verbundId))).toHaveLength(1);
  });

  it.each(['save', 'draft', 'binding', 'checkpoint', 'decision', 'add', 'delete', 'rename', 'delete-verbund'] as const)('rejects a target %s before writing', async change => {
    const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
    const other = await open();
    if (change === 'save') value(await other.saveDocument(envelope.localId, envelope.savedAt, null, imported));
    if (change === 'draft') value(await other.autosaveDraft(envelope.localId, envelope.savedAt, null, { pending: true }));
    if (change === 'binding') value(await other.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, envelope.savedAt));
    if (change === 'checkpoint') value(await other.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    if (change === 'decision') value(await other.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 0 }));
    if (change === 'add') value(await other.addDocument(selected.verbundId, imported));
    if (change === 'delete') value(await other.deleteDocument(envelope.localId));
    if (change === 'rename') value(await other.renameVerbund(selected.verbundId, 'Newer'));
    if (change === 'delete-verbund') value(await other.deleteVerbund(selected.verbundId));
    const before = await storedValuesAndIndexKeys();
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    const remove = vi.spyOn(IDBObjectStore.prototype, 'delete');
    expect(await store.restoreVerbundBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(await storedValuesAndIndexKeys()).toBe(before);
  });

  it('compares trail and baseline independently without a document stamp change', async () => {
    const read = async () => value(await store.previewRestoreVerbundBackup(bytes(file)));
    const zero = await read();
    expect(zero.target.documents[0]).toMatchObject({ trailSequence: null, baselineSequence: null });
    value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    const one = await read();
    expect(one.target.documents[0]).toMatchObject({ savedAt: envelope.savedAt, trailSequence: 1, baselineSequence: 1 });
    value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 1 }));
    const two = await read();
    expect(two.target.documents[0]).toMatchObject({ savedAt: envelope.savedAt, trailSequence: 2, baselineSequence: 1 });
    for (const stale of [zero, one]) expect(await store.restoreVerbundBackup(stale)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    const raw = new Dexie(WORKSPACE_DATABASE_NAME); await raw.open();
    try { await raw.table('reviewBaseline').delete(envelope.localId); } finally { raw.close(); }
    expect(await store.restoreVerbundBackup(two)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  });

  it('binds missing targets and documents that the file would remove', async () => {
    const added = value(await store.addDocument(selected.verbundId, imported));
    const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
    expect(preview.target.documents).toHaveLength(2);
    value(await store.autosaveDraft(added.localId, added.savedAt, null, { pending: true }));
    expect(await store.restoreVerbundBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    value(await store.deleteVerbund(selected.verbundId));
    const absent = value(await store.previewRestoreVerbundBackup(bytes(file)));
    expect(absent).toMatchObject({ existingVerbund: null, target: { verbundSavedAt: null, documents: [] }, counts: { verbuende: { target: 0 } } });
    const another = value(await store.previewRestoreVerbundBackup(bytes(file)));
    value(await store.restoreVerbundBackup(another));
    expect(await store.restoreVerbundBackup(absent)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  });

  it('allows unrelated autosave, review changes and restore and preserves every foreign row', async () => {
    const other = await open();
    const b = value(await other.createVerbund('Other'));
    const doc = value(await other.addDocument(b.verbundId, imported));
    const draft = value(await other.addDocument(b.verbundId, imported));
    const foreignFile = value(await other.exportVerbundBackup(b.verbundId));
    const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
    value(await other.restoreVerbundBackup(value(await other.previewRestoreVerbundBackup(bytes(foreignFile)))));
    const loaded = value(await other.getDocument(doc.localId))!;
    value(await other.appendCheckpoint(doc.localId, loaded.savedAt, null, 0));
    value(await other.appendDecision(doc.localId, loaded.savedAt, null, { decision: 'reviewed', expectedSequence: 1 }));
    const pending = value(await other.getDocument(draft.localId))!;
    value(await other.autosaveDraft(draft.localId, pending.savedAt, null, { pending: true }));
    const before = JSON.parse(await storedValuesAndIndexKeys());
    const exported = value(await other.exportVerbundBackup(b.verbundId));
    value(await store.restoreVerbundBackup(preview));
    expect(value(await store.exportVerbundBackup(b.verbundId))).toBe(exported);
    const raw = new Dexie(WORKSPACE_DATABASE_NAME); await raw.open();
    try {
      for (const name of ['documents', 'drafts', 'reviewTrail', 'reviewBaseline']) {
        const rows = await raw.table(name).filter(row => row.localId === doc.localId || row.localId === draft.localId).toArray();
        for (const row of rows) expect(before).toContainEqual(row);
      }
    } finally { raw.close(); }
  });

  it.each(['verbund', 'workspace'] as const)('invalidates old previews after another %s restore with equal trail sequences', async scope => {
    value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    const preview = value(await store.previewRestoreVerbundBackup(bytes(value(await store.exportVerbundBackup(selected.verbundId)))));
    if (scope === 'workspace') value(await restoreWorkspaceBackup(store, bytes(value(await store.exportBackup()))));
    else value(await store.restoreVerbundBackup(value(await store.previewRestoreVerbundBackup(bytes(JSON.stringify(preview.backup))))));
    const before = await storedValuesAndIndexKeys();
    expect(await store.restoreVerbundBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(await storedValuesAndIndexKeys()).toBe(before);
  });

  it('checks new foreign collisions again inside the writer', async () => {
    value(await store.deleteVerbund(selected.verbundId));
    const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
    const b = value(await store.createVerbund('Foreign'));
    const raw = new Dexie(WORKSPACE_DATABASE_NAME); await raw.open();
    try { await raw.table('documents').add({ ...envelope, verbundId: b.verbundId }); } finally { raw.close(); }
    const before = await storedValuesAndIndexKeys();
    expect(await store.previewRestoreVerbundBackup(bytes(file))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_CONFLICT' } });
    expect(await store.restoreVerbundBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_CONFLICT' } });
    expect(await storedValuesAndIndexKeys()).toBe(before);
  });

  it.each(['recreate', 'native-version', 'meta-version', 'identity'] as const)('rejects changed database %s', async change => {
    const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
    if (change === 'recreate') { await Dexie.delete(WORKSPACE_DATABASE_NAME); await open(); }
    if (change === 'native-version') {
      const upgraded = new Dexie(WORKSPACE_DATABASE_NAME);
      upgraded.version(4).stores({ ...WORKSPACE_SCHEMA, future: 'id' });
      await upgraded.open(); upgraded.close();
    }
    const raw = new Dexie(WORKSPACE_DATABASE_NAME); await raw.open();
    try {
      if (change === 'meta-version') await raw.table('workspaceMeta').update('workspace', { storageSchemaVersion: 4 });
      if (change === 'identity') await raw.table('workspaceMeta').update('workspace', { databaseId: crypto.randomUUID() });
      const before = await raw.table('workspaceMeta').toArray();
      expect(await store.restoreVerbundBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
      expect(await raw.table('workspaceMeta').toArray()).toEqual(before);
    } finally { raw.close(); }
  });

  it.each(['quota', 'request-error'] as const)('rolls back all native rows and keys after %s', async kind => {
    value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    const preview = value(await store.previewRestoreVerbundBackup(bytes(value(await store.exportVerbundBackup(selected.verbundId)))));
    const before = await storedValuesAndIndexKeys();
    const add = IDBObjectStore.prototype.add;
    const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'reviewTrail') {
        if (kind === 'quota') throw new DOMException('PRIVATE_SENTINEL', 'QuotaExceededError');
        return add.call(this.transaction.objectStore('documents'), preview.backup.documents[0]);
      }
      return add.apply(this, args);
    });
    const result = await store.restoreVerbundBackup(preview);
    spy.mockRestore();
    expect(result).toMatchObject({ ok: false, diagnostic: { code: kind === 'quota' ? 'WORKSPACE_QUOTA_EXCEEDED' : 'WORKSPACE_STORAGE_FAILED' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_');
    expect(await storedValuesAndIndexKeys()).toBe(before);
  });
}
