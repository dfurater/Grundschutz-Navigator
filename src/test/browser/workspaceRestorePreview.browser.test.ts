import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME, WORKSPACE_SCHEMA } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
const bytes = (text: string) => new TextEncoder().encode(text);
let store: WorkspaceStore;
let verbund: WorkspaceVerbund;
beforeEach(async () => {
  store = value(await WorkspaceStore.open());
  verbund = value(await store.createVerbund('Preview'));
});
afterEach(async () => { vi.restoreAllMocks(); store?.close(); await Dexie.delete(WORKSPACE_DATABASE_NAME); });

it('binds an immutable read-only preview to its issuing store and validated file', async () => {
  const before = value(await store.exportBackup());
  const input = bytes(before);
  const preview = value(await store.previewRestoreBackup(input));
  expect(value(await store.exportBackup())).toBe(before);
  expect(preview).toMatchObject({ kind: 'workspace', counts: { verbuende: { file: 1, target: 1 }, documents: { file: 0, target: 0 } } });
  expect(Object.isFrozen(preview.backup.verbuende[0])).toBe(true);
  expect(() => Object.assign(preview.backup.verbuende[0], { name: 'Changed' })).toThrow();
  const other = value(await WorkspaceStore.open());
  try {
    expect(await other.restoreBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
    expect(await store.restoreBackup({ ...preview })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
    expect(await store.restoreBackup(undefined as never)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
    expect(value(await store.exportBackup())).toBe(before);
    input.fill(0);
    value(await store.restoreBackup(preview));
    expect(value(await store.listVerbuende())[0].name).toBe('Preview');
  } finally { other.close(); }
});

it.each(['rename', 'create', 'delete'] as const)('rejects a persisted %s after preview without clearing data', async change => {
  const preview = value(await store.previewRestoreBackup(bytes(value(await store.exportBackup()))));
  const other = value(await WorkspaceStore.open());
  try {
    if (change === 'rename') value(await other.renameVerbund(verbund.verbundId, 'Newer'));
    if (change === 'create') value(await other.createVerbund('Newer'));
    if (change === 'delete') value(await other.deleteVerbund(verbund.verbundId));
    const before = value(await store.exportBackup());
    expect(await store.restoreBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(value(await store.exportBackup())).toBe(before);
  } finally { other.close(); }
});

it('keeps the target database identity and exports the new timestamp after rename in both formats', async () => {
  const file = JSON.parse(value(await store.exportBackup()));
  const targetId = file.workspaceMeta[0].databaseId;
  file.workspaceMeta[0].databaseId = crypto.randomUUID();
  const preview = value(await store.previewRestoreBackup(bytes(JSON.stringify(file))));
  value(await store.restoreBackup(preview));
  const restored = value(await store.listVerbuende())[0];
  expect(restored.savedAt > verbund.savedAt).toBe(true);
  expect(restored.backupSavedAt).toBe(verbund.savedAt);
  expect(JSON.parse(value(await store.exportBackup())).workspaceMeta[0].databaseId).toBe(targetId);
  expect(JSON.parse(value(await store.exportVerbundBackup(verbund.verbundId))).verbuende[0].savedAt).toBe(verbund.savedAt);
  const renamed = value(await store.renameVerbund(verbund.verbundId, 'Renamed'));
  expect(renamed).not.toHaveProperty('backupSavedAt');
  for (const exported of [value(await store.exportBackup()), value(await store.exportVerbundBackup(verbund.verbundId))]) {
    expect(JSON.parse(exported).verbuende[0]).toEqual(renamed);
  }
});

it.each(['recreate', 'migration'] as const)('invalidates a preview after database %s even with matching timestamps', async change => {
  const before = JSON.parse(value(await store.exportBackup()));
  const preview = value(await store.previewRestoreBackup(bytes(JSON.stringify(before))));
  if (change === 'recreate') {
    // Native deletion closes the existing connection through versionchange.
    await Dexie.delete(WORKSPACE_DATABASE_NAME);
    const replacement = value(await WorkspaceStore.open());
    replacement.close();
  } else {
    const upgraded = new Dexie(WORKSPACE_DATABASE_NAME);
    upgraded.version(4).stores({ ...WORKSPACE_SCHEMA, future: 'id' });
    await upgraded.open();
    upgraded.close();
  }
  const raw = new Dexie(WORKSPACE_DATABASE_NAME);
  await raw.open();
  try {
    await raw.table('workspaceMeta').update('workspace', { savedAt: before.workspaceMeta[0].savedAt, createdAt: before.workspaceMeta[0].createdAt });
    const snapshot = await raw.table('workspaceMeta').toArray();
    expect(await store.restoreBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(await raw.table('workspaceMeta').toArray()).toEqual(snapshot);
  } finally { raw.close(); }
});

async function addDocument() {
  const imported = await importClass2OscalDocument(bytes(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))), { trustClass: 'class-2-local-user' });
  if (!imported.ok) throw new Error(imported.diagnostic.code);
  return { imported: imported.document, envelope: value(await store.addDocument(verbund.verbundId, imported.document)) };
}

it.each(['save', 'draft', 'binding', 'checkpoint', 'decision', 'delete-document', 'add-document'] as const)('detects a %s after preview across all stores', async change => {
  const { envelope, imported } = await addDocument();
  const preview = value(await store.previewRestoreBackup(bytes(value(await store.exportBackup()))));
  if (change === 'save') value(await store.saveDocument(envelope.localId, envelope.savedAt, null, imported));
  if (change === 'draft') value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { pending: true }));
  if (change === 'binding') value(await store.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'Minimalbeispiel', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, envelope.savedAt));
  if (change === 'checkpoint') value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
  if (change === 'decision') value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 0 }));
  if (change === 'delete-document') value(await store.deleteDocument(envelope.localId));
  if (change === 'add-document') await addDocument();
  const before = value(await store.exportBackup());
  expect(await store.restoreBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await store.exportBackup())).toBe(before);
});

it('restores all seven stores atomically including trail and baseline', async () => {
  const { envelope } = await addDocument();
  value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
  value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 1 }));
  value(await store.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'Minimalbeispiel', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, envelope.savedAt));
  const loaded = value(await store.getDocument(envelope.localId))!;
  value(await store.autosaveDraft(envelope.localId, loaded.savedAt, null, { pending: true }));
  const backup = JSON.parse(value(await store.exportBackup()));
  const id = backup.workspaceMeta[0].databaseId;
  value(await store.deleteVerbund(verbund.verbundId));
  const preview = value(await store.previewRestoreBackup(bytes(JSON.stringify(backup))));
  expect(preview.counts.reviewTrail).toEqual({ file: 2, target: 0 });
  expect(preview.counts.reviewBaseline).toEqual({ file: 1, target: 0 });
  expect(preview.counts.workspaceMeta).toEqual({ file: 1, target: 1 });
  value(await store.restoreBackup(preview));
  const result = JSON.parse(value(await store.exportBackup()));
  expect(result.workspaceMeta[0].databaseId).toBe(id);
  for (const name of ['verbuende', 'drafts', 'bindings', 'reviewTrail', 'reviewBaseline']) expect(result[name]).toEqual(backup[name]);
  expect(result.documents).toEqual(backup.documents);
  expect(await store.restoreBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
});

it.each(['quota', 'request-error'] as const)('rolls back every store after a %s during confirmed restore', async kind => {
  await addDocument();
  const file = value(await store.exportBackup());
  value(await store.renameVerbund(verbund.verbundId, 'Retain current data'));
  const preview = value(await store.previewRestoreBackup(bytes(file)));
  const before = value(await store.exportBackup());
  const add = IDBObjectStore.prototype.add;
  const spy = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
    if (this.name === 'documents') {
      if (kind === 'quota') throw new DOMException('PRIVATE_QUOTA', 'QuotaExceededError');
      // The verbund has already been inserted: add its primary key again for a native request failure.
      return add.call(this.transaction.objectStore('verbuende'), preview.backup.verbuende[0]);
    }
    return add.apply(this, args);
  });
  const result = await store.restoreBackup(preview);
  spy.mockRestore();
  expect(result).toMatchObject({ ok: false, diagnostic: { code: kind === 'quota' ? 'WORKSPACE_QUOTA_EXCEEDED' : 'WORKSPACE_STORAGE_FAILED' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_');
  expect(value(await store.exportBackup())).toBe(before);
});

it('reports a changed metadata schema as a preview conflict before any clear', async () => {
  const preview = value(await store.previewRestoreBackup(bytes(value(await store.exportBackup()))));
  const raw = new Dexie(WORKSPACE_DATABASE_NAME);
  await raw.open();
  try {
    await raw.table('workspaceMeta').update('workspace', { storageSchemaVersion: 4 });
    const before = await raw.table('workspaceMeta').toArray();
    expect(await store.restoreBackup(preview)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(await raw.table('workspaceMeta').toArray()).toEqual(before);
  } finally { raw.close(); }
});
