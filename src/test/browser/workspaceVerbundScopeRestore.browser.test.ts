// Restoreregel R2: Ein Verbund-Restore übernimmt, behält oder verweigert den gemeinsamen Anwendungsbereich.
import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import { document } from '@/test/browser/workspaceStoreFixtures';

function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

const bytes = (value: string) => new TextEncoder().encode(value);
const conflict = { ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } };
let store: WorkspaceStore;

afterEach(async () => {
  store?.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});

const backupConflict = { ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_CONFLICT' } };
const scopeRow = async (scopeId: string) => value(await store.listScopes()).find(row => row.scopeId === scopeId);

it('carries only the own scope row and keeps an existing target scope unchanged on restore (R2 a)', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Bereich in der Datei'));
  const member = value(await store.createVerbund('VA', scope));
  value(await store.createVerbund('OTHER_MEMBER_SENTINEL', { ...scope, savedAt: member.savedAt }));
  const file = value(await store.exportVerbundBackup(member.verbundId));
  const parsed = JSON.parse(file);
  expect(parsed.methodikScopes).toEqual([await scopeRow(scope.scopeId)]);
  expect(file).not.toContain('OTHER_MEMBER_SENTINEL');
  const fileScope = parsed.methodikScopes[0];

  const renamed = value(await store.renameScope(scope.scopeId, 'Bereich heute', fileScope.savedAt));
  value(await store.renameVerbund(member.verbundId, 'VA geändert', { savedAt: member.savedAt, scope: renamed }));
  const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
  expect(preview.scope).toEqual({ kind: 'kept', current: renamed, file: fileScope, assigns: false });
  value(await store.restoreVerbundBackup(preview));
  expect(await scopeRow(scope.scopeId)).toEqual(renamed);
  expect(value(await store.listVerbuende()).find(row => row.verbundId === member.verbundId)).toMatchObject({ name: 'VA', scopeId: scope.scopeId });
});

it('creates a missing scope with its id, assigns into an existing one and reports unassigned files (R2 b)', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Bereich'));
  const member = value(await store.createVerbund('VA', scope));
  const other = value(await store.createVerbund('VB', { ...scope, savedAt: member.savedAt }));
  value(await store.addDocument(member.verbundId, await document('VA_DOCUMENT')));
  value(await store.addDocument(other.verbundId, await document('OTHER_DOCUMENT_SENTINEL')));
  const file = value(await store.exportVerbundBackup(member.verbundId));
  const fileScope = JSON.parse(file).methodikScopes[0];
  const unassigned = value(await store.exportVerbundBackup(value(await store.createVerbund('Ohne Zuordnung')).verbundId));

  value(await store.deleteVerbund(member.verbundId, { savedAt: member.savedAt, scope: { scopeId: scope.scopeId, savedAt: other.savedAt } }));
  const before = await scopeRow(scope.scopeId);
  const joining = value(await store.previewRestoreVerbundBackup(bytes(file)));
  expect(joining.scope).toEqual({ kind: 'kept', current: before, file: fileScope, assigns: true });
  value(await store.restoreVerbundBackup(joining));
  const joined = (await scopeRow(scope.scopeId))!;
  expect(joined).toEqual({ ...before, savedAt: expect.any(String) });
  expect(joined.savedAt > before!.savedAt).toBe(true);
  expect(joined.savedAt).toBe(value(await store.listVerbuende()).find(row => row.verbundId === member.verbundId)?.savedAt);
  expect(value(await store.previewRestoreVerbundBackup(bytes(unassigned))).scope).toEqual({ kind: 'none' });

  value(await store.deleteAll('delete-workspace'));
  store = value(await WorkspaceStore.open());
  const creating = value(await store.previewRestoreVerbundBackup(bytes(file)));
  expect(creating.scope).toEqual({ kind: 'created', file: fileScope });
  value(await store.restoreVerbundBackup(creating));
  const [created] = value(await store.listScopes());
  expect(created).toEqual({ ...fileScope, savedAt: expect.any(String), backupSavedAt: fileScope.savedAt });
  expect(value(await store.listVerbuende())).toEqual([expect.objectContaining({ verbundId: member.verbundId, scopeId: scope.scopeId })]);
  expect(value(await store.listDocuments()).map(row => row.verbundId)).toEqual([member.verbundId]);
  expect(value(await store.exportVerbundBackup(member.verbundId))).toBe(file);
});

it('rejects a differing assignment as a whole before any change (R2 c)', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Bereich'));
  const target = value(await store.createScope('Anderer Bereich'));
  const assigned = value(await store.createVerbund('Zugeordnet', scope));
  const loose = value(await store.createVerbund('Unzugeordnet'));
  const assignedFile = value(await store.exportVerbundBackup(assigned.verbundId));
  const looseFile = JSON.parse(value(await store.exportVerbundBackup(loose.verbundId)));
  const legacy = { ...looseFile, storageSchemaVersion: 3 };
  delete legacy.methodikScopes;

  const moved = value(await store.changeVerbundScope(assigned.verbundId, { scopeId: scope.scopeId, savedAt: assigned.savedAt }, null, assigned.savedAt));
  const currentTarget = (await scopeRow(target.scopeId))!;
  value(await store.assignVerbuende(target.scopeId, { scopeSavedAt: currentTarget.savedAt, verbuende: [loose] }));
  const cases = [
    [assignedFile, null, scope.scopeId],
    [JSON.stringify(looseFile), target.scopeId, null],
    [JSON.stringify(legacy), target.scopeId, null],
  ] as const;
  for (const [file, current, inFile] of cases) {
    const before = value(await store.exportBackup());
    const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
    expect(preview.scope).toMatchObject({ kind: 'conflict', current: current && { scopeId: current }, file: inFile && { scopeId: inFile } });
    expect(await store.restoreVerbundBackup(preview)).toMatchObject(backupConflict);
    expect(value(await store.exportBackup())).toBe(before);
  }
  value(await store.changeVerbundScope(assigned.verbundId, null, { scopeId: target.scopeId, savedAt: (await scopeRow(target.scopeId))!.savedAt }, moved.savedAt));
  const before = value(await store.exportBackup());
  const preview = value(await store.previewRestoreVerbundBackup(bytes(assignedFile)));
  expect(preview.scope).toMatchObject({ kind: 'conflict', current: { scopeId: target.scopeId }, file: { scopeId: scope.scopeId } });
  expect(await store.restoreVerbundBackup(preview)).toMatchObject(backupConflict);
  expect(value(await store.exportBackup())).toBe(before);
});

it('invalidates the preview when a scope row or its membership changes before confirmation (R2 d)', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Bereich'));
  const member = value(await store.createVerbund('VA', scope));
  const file = value(await store.exportVerbundBackup(member.verbundId));
  const changes: (() => Promise<unknown>)[] = [
    async () => value(await store.renameScope(scope.scopeId, `Neu ${crypto.randomUUID()}`, (await scopeRow(scope.scopeId))!.savedAt)),
    async () => value(await store.createVerbund('Neues Mitglied', (await scopeRow(scope.scopeId))!)),
  ];
  for (const change of changes) {
    const preview = value(await store.previewRestoreVerbundBackup(bytes(file)));
    await change();
    const before = value(await store.exportBackup());
    expect(await store.restoreVerbundBackup(preview)).toMatchObject(conflict);
    expect(value(await store.exportBackup())).toBe(before);
  }
});
