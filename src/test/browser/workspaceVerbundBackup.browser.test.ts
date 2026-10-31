import { restoreWorkspaceBackup, restoreVerbundBackup } from '@/test/restoreWorkspaceBackup';
import { expect, test, vi } from 'vitest';
import { value, open, document } from '@/test/browser/workspaceStoreFixtures';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';

const bytes = (text: string) => new TextEncoder().encode(text);

test('Verbund-Backup ersetzt oder ergänzt nur den gewählten Verbund in je einer Transaktion', async () => {
  const transaction = vi.spyOn(IDBDatabase.prototype, 'transaction');
  const store = await open();
  const a = value(await store.createVerbund('Selected'));
  const b = value(await store.createVerbund('OTHER_VERBUND_SENTINEL'));
  const one = value(await store.addDocument(a.verbundId, await document('SELECTED')));
  const two = value(await store.addDocument(a.verbundId, await document('TARGET')));
  const other = value(await store.addDocument(b.verbundId, await document('OTHER_DOCUMENT_SENTINEL')));
  value(await store.autosaveDraft(one.localId, one.savedAt, null, { incomplete: 'Selected draft' }));
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'SELECTED', target: { kind: 'local', localId: two.localId } }, value(await store.getDocument(one.localId))!.savedAt));
  const untouched = value(await store.exportVerbundBackup(b.verbundId));
  transaction.mockClear();
  const backup = value(await store.exportVerbundBackup(a.verbundId));
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(JSON.parse(backup)).toMatchObject({ format: 'gspp-workspace-verbund', verbuende: [a] });
  expect(JSON.parse(backup)).not.toHaveProperty('workspaceMeta');
  expect(backup).not.toContain('OTHER_');
  value(await store.renameVerbund(a.verbundId, 'Changed'));
  value(await store.deleteDocument(two.localId));
  transaction.mockClear();
  const preview = value(await store.previewRestoreVerbundBackup(bytes(backup)));
  expect(transaction).toHaveBeenCalledTimes(1);
  transaction.mockClear();
  value(await store.restoreVerbundBackup(preview));
  expect(transaction).toHaveBeenCalledTimes(1);
  const restored = value(await store.listVerbuende()).find(row => row.verbundId === a.verbundId)!;
  expect(restored.savedAt > a.savedAt).toBe(true);
  expect(restored.backupSavedAt).toBe(a.savedAt);
  expect(value(await store.exportVerbundBackup(a.verbundId))).toBe(backup);
  expect(value(await store.exportVerbundBackup(b.verbundId))).toBe(untouched);
  expect(value(await store.getDocument(other.localId))).toEqual(other);
  value(await store.deleteVerbund(a.verbundId));
  value(await restoreVerbundBackup(store, bytes(backup)));
  expect(value(await store.exportVerbundBackup(a.verbundId))).toBe(backup);
  expect(value(await store.exportVerbundBackup(b.verbundId))).toBe(untouched);
});

test('Verbund-Wiederherstellung ersetzt eine vorhandene Prüfspur ohne Schlüsselkollision', async () => {
  const store = await open();
  const a = value(await store.createVerbund('Selected'));
  const one = value(await store.addDocument(a.verbundId, await document()));
  value(await store.appendCheckpoint(one.localId, one.savedAt, null, 0));
  const backup = value(await store.exportVerbundBackup(a.verbundId));
  expect(JSON.parse(backup).reviewTrail).toHaveLength(1);
  value(await restoreVerbundBackup(store, bytes(backup)));
  expect(value(await store.exportVerbundBackup(a.verbundId))).toBe(backup);
});

test('Verbund-Wiederherstellung lehnt Kollisionen, falsche Formate und ungültige Quellen ohne Änderung ab', async () => {
  const store = await open();
  const a = value(await store.createVerbund('Selected'));
  const b = value(await store.createVerbund('Other'));
  const one = value(await store.addDocument(a.verbundId, await document()));
  const other = value(await store.addDocument(b.verbundId, await document('Other')));
  const selected = value(await store.exportVerbundBackup(a.verbundId));
  const before = value(await store.exportBackup());
  const conflict = selected.replaceAll(one.localId, other.localId);
  expect(await restoreVerbundBackup(store, bytes(conflict))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_CONFLICT' } });
  expect(value(await store.exportBackup())).toBe(before);
  expect(await restoreWorkspaceBackup(store, bytes(selected))).toMatchObject({ ok: false });
  const invalid = JSON.parse(selected); invalid.documents[0].source = { catalog: {} };
  const multiple = JSON.parse(selected); multiple.verbuende.push({ ...multiple.verbuende[0], verbundId: b.verbundId });
  const metadata = { ...JSON.parse(selected), workspaceMeta: JSON.parse(before).workspaceMeta };
  for (const input of [bytes(before), bytes(JSON.stringify(invalid)), bytes(JSON.stringify(multiple)), bytes(JSON.stringify(metadata)), bytes(selected.replace('"storageSchemaVersion":3', '"storageSchemaVersion":4')), new Uint8Array(WORKSPACE_BACKUP_MAX_BYTES + 1)]) {
    expect(await restoreVerbundBackup(store, input)).toMatchObject({ ok: false });
    expect(value(await store.exportBackup())).toBe(before);
  }
});

test('ein übergroßer Gesamtbestand bleibt verbundweise verlustfrei sicherbar', async () => {
  const store = await open();
  const verbuende = [value(await store.createVerbund('One')), value(await store.createVerbund('Two'))];
  const imported = await document();
  for (const verbund of verbuende) {
    for (let index = 0; index < 2; index++) {
      const envelope = value(await store.addDocument(verbund.verbundId, imported));
      value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { text: 'x'.repeat(9 * 1024 * 1024) }));
    }
  }
  expect(await store.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_LIMIT_EXCEEDED' } });
  for (const verbund of verbuende) {
    const backup = value(await store.exportVerbundBackup(verbund.verbundId));
    value(await restoreVerbundBackup(store, bytes(backup)));
    expect(value(await store.exportVerbundBackup(verbund.verbundId))).toBe(backup);
  }
}, 30_000);

test('ein fehlgeschlagener Verbund-Restore rollt Löschungen, Bindungen und Metadaten vollständig zurück', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Rollback'));
  const envelope = value(await store.addDocument(verbund.verbundId, await document()));
  value(await store.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'DOCUMENT_SENTINEL', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, value(await store.getDocument(envelope.localId))!.savedAt));
  const backup = value(await store.exportVerbundBackup(verbund.verbundId));
  value(await store.renameVerbund(verbund.verbundId, 'Current'));
  const before = value(await store.exportBackup());
  const original = IDBObjectStore.prototype.add;
  const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
    if (this.name === 'bindings') throw new DOMException('PRIVATE_SENTINEL', 'QuotaExceededError');
    return original.apply(this, args);
  });
  const result = await restoreVerbundBackup(store, bytes(backup));
  add.mockRestore();
  expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_QUOTA_EXCEEDED' } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
  expect(value(await store.exportBackup())).toBe(before);
});
