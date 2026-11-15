import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import { seedWorkspace } from '@/test/workspaceAreaFixture';

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

it('persists explicit membership across a reopen and invalidates old scope snapshots', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Synthetischer Bereich'));
  const a = value(await store.createVerbund('A'));
  const b = value(await store.createVerbund('B'));
  const c = value(await store.createVerbund('C'));
  value(await store.assignVerbuende(scope.scopeId, { scopeSavedAt: scope.savedAt, verbuende: [a, b] }));
  expect(await store.renameScope(scope.scopeId, 'Veraltet', scope.savedAt)).toMatchObject(conflict);

  store.close();
  store = value(await WorkspaceStore.open());
  const [current] = value(await store.listScopes());
  expect(current).toMatchObject({ scopeId: scope.scopeId, name: scope.name });
  const members = value(await store.listVerbuende());
  expect(members.filter(row => row.scopeId === scope.scopeId).map(row => row.verbundId).sort()).toEqual([a.verbundId, b.verbundId].sort());
  expect(value(await store.renameVerbund(c.verbundId, 'Unzugeordnet'))).not.toHaveProperty('scopeId');
});

it('restores scope membership with live stamps and keeps target identity', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Synthetischer Bereich'));
  const member = value(await store.createVerbund('Mitglied', scope));
  const file = value(await store.exportBackup());
  const original = JSON.parse(file);
  expect(original.methodikScopes).toHaveLength(1);
  expect(JSON.parse(value(await store.exportVerbundBackup(member.verbundId))).verbuende[0].scopeId).toBe(scope.scopeId);
  store.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);

  store = value(await WorkspaceStore.open());
  const preview = value(await store.previewRestoreBackup(bytes(file)));
  expect(preview.counts.methodikScopes).toEqual({ file: 1, target: 0 });
  value(await store.restoreBackup(preview));
  const [restored] = value(await store.listScopes());
  expect(restored.savedAt > original.methodikScopes[0].savedAt).toBe(true);
  const exported = JSON.parse(value(await store.exportBackup()));
  expect(exported.methodikScopes).toEqual(original.methodikScopes);
  expect(exported.verbuende).toEqual(original.verbuende);
  expect(exported.workspaceMeta[0].databaseId).toBe(preview.target.databaseId);
  expect(exported.workspaceMeta[0].databaseId).not.toBe(original.workspaceMeta[0].databaseId);

  const stale = value(await store.previewRestoreBackup(bytes(file)));
  value(await store.renameScope(restored.scopeId, 'Geändert', restored.savedAt));
  const before = value(await store.exportBackup());
  expect(await store.restoreBackup(stale)).toMatchObject(conflict);
  expect(value(await store.exportBackup())).toBe(before);
  value(await store.restoreBackup(value(await store.previewRestoreBackup(bytes(file)))));
  expect(JSON.parse(value(await store.exportBackup())).methodikScopes).toEqual(original.methodikScopes);
});

it('compares all involved rows before assigning, moving, or deleting a member', async () => {
  store = value(await WorkspaceStore.open());
  const a = value(await store.createScope('Bereich A'));
  const b = value(await store.createScope('Bereich B'));
  const one = value(await store.createVerbund('Eins', a));
  const two = value(await store.createVerbund('Zwei'));
  const three = value(await store.createVerbund('Drei'));
  const [currentA] = value(await store.listScopes()).filter(row => row.scopeId === a.scopeId);
  value(await store.renameVerbund(three.verbundId, 'Neuer Name'));
  const before = value(await store.exportBackup());
  const failures = [
    await store.assignVerbuende(a.scopeId, { scopeSavedAt: currentA.savedAt, verbuende: [two, three] }),
    await store.assignVerbuende(b.scopeId, { scopeSavedAt: b.savedAt, verbuende: [one] }),
    await store.changeVerbundScope(one.verbundId, null, b, one.savedAt),
    await store.changeVerbundScope(one.verbundId, a, b, one.savedAt),
    await store.changeVerbundScope(one.verbundId, currentA, { ...b, savedAt: a.savedAt }, one.savedAt),
    await store.createVerbund('Veraltet', a),
    await store.deleteVerbund(one.verbundId, { savedAt: one.savedAt, scope: a }),
  ];
  for (const result of failures) expect(result).toMatchObject(conflict);
  const unknown = { ...b, scopeId: crypto.randomUUID() as typeof b.scopeId };
  const rejected = await store.changeVerbundScope(one.verbundId, currentA, unknown, one.savedAt);
  expect(rejected).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCOPE_NOT_FOUND' } });
  expect(JSON.stringify(rejected)).not.toContain(unknown.scopeId);
  expect(JSON.stringify(rejected)).not.toContain(unknown.name);
  expect(value(await store.exportBackup())).toBe(before);

  const moved = value(await store.changeVerbundScope(one.verbundId, currentA, b, one.savedAt));
  expect(moved.scopeId).toBe(b.scopeId);
  expect(await store.renameScope(a.scopeId, 'Veraltet', currentA.savedAt)).toMatchObject(conflict);
  expect(await store.renameScope(b.scopeId, 'Veraltet', b.savedAt)).toMatchObject(conflict);
  const currentB = { ...b, savedAt: moved.savedAt };
  const unassigned = value(await store.changeVerbundScope(moved.verbundId, currentB, null, moved.savedAt));
  expect(unassigned).not.toHaveProperty('scopeId');
  const reassigned = value(await store.changeVerbundScope(unassigned.verbundId, null, { ...currentB, savedAt: unassigned.savedAt }, unassigned.savedAt));
  const expected = { savedAt: reassigned.savedAt, scope: { ...b, savedAt: reassigned.savedAt } };
  const renamed = value(await store.renameVerbund(reassigned.verbundId, 'Neuer Name', expected));
  value(await store.deleteVerbund(renamed.verbundId, { ...expected, savedAt: renamed.savedAt }));
  expect(await store.renameScope(b.scopeId, 'Veraltet', reassigned.savedAt)).toMatchObject(conflict);
  expect(value(await store.listScopes()).find(row => row.scopeId === b.scopeId)?.name).toBe(b.name);
});

it('deletes a scope and detaches its members while preserving their stored contents across reopen', async () => {
  const seeded = await seedWorkspace();
  store = value(await WorkspaceStore.open());
  value(await store.autosaveDraft(seeded.ssp.localId, seeded.ssp.savedAt, null, { text: 'Entwurf' }));
  value(await store.appendCheckpoint(seeded.component.localId, seeded.component.savedAt, null, 0));
  const scope = value(await store.createScope('Bereich'));
  const otherScope = value(await store.createScope('Anderer Bereich'));
  value(await store.assignVerbuende(scope.scopeId, { scopeSavedAt: scope.savedAt, verbuende: value(await store.listVerbuende()) }));
  const current = value(await store.listScopes()).find(row => row.scopeId === scope.scopeId)!;
  const members = value(await store.listVerbuende());
  const file = value(await store.exportBackup());
  const before = JSON.parse(file);
  const partition = JSON.parse(value(await store.exportVerbundBackup(seeded.verbundId)));
  value(await store.deleteScope(scope.scopeId, { scopeSavedAt: current.savedAt, verbuende: members }, 'delete-scope'));

  store.close();
  store = value(await WorkspaceStore.open());
  expect(value(await store.listScopes())).toEqual([otherScope]);
  const remaining = value(await store.listVerbuende());
  const after = JSON.parse(value(await store.exportBackup()));
  const stamp = after.workspaceMeta[0].savedAt;
  expect(stamp > before.workspaceMeta[0].savedAt).toBe(true);
  expect(remaining).toEqual(members.map(({ verbundId, name, createdAt }) => ({ verbundId, name, createdAt, savedAt: stamp })));
  expect(after.methodikScopes).toEqual([otherScope]);
  for (const key of ['documents', 'drafts', 'bindings', 'reviewTrail', 'reviewBaseline']) {
    expect(before[key].length).toBeGreaterThan(0);
    expect(JSON.stringify(after[key]), key).toBe(JSON.stringify(before[key]));
  }
  const exported = JSON.parse(value(await store.exportVerbundBackup(seeded.verbundId)));
  expect(partition.methodikScopes).toEqual([current]);
  expect(exported).toEqual({ ...partition, methodikScopes: [], verbuende: remaining.filter(row => row.verbundId === seeded.verbundId) });
  expect(JSON.parse(file).methodikScopes).toContainEqual(current);
});

it('rejects wrong confirmation, stale scope and added, removed or changed member snapshots without writing', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Bereich'));
  const a = value(await store.createVerbund('A', scope));
  const b = value(await store.createVerbund('B', { ...scope, savedAt: a.savedAt }));
  const current = { ...scope, savedAt: b.savedAt };
  const renamed = value(await store.renameVerbund(b.verbundId, 'B neu', { scope: current, savedAt: b.savedAt }));
  const expected = { scopeSavedAt: current.savedAt, verbuende: [a, renamed] };
  const before = value(await store.exportBackup());
  expect(await store.deleteScope(scope.scopeId, expected, '' as 'delete-scope')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
  const c = { ...a, verbundId: crypto.randomUUID() as typeof a.verbundId };
  for (const stale of [
    { ...expected, scopeSavedAt: scope.savedAt },
    { ...expected, verbuende: [a] },
    { ...expected, verbuende: [a, renamed, c] },
    { ...expected, verbuende: [a, a] },
    { ...expected, verbuende: [a, b] },
  ]) {
    expect(await store.deleteScope(scope.scopeId, stale, 'delete-scope')).toMatchObject(conflict);
    expect(value(await store.exportBackup())).toBe(before);
  }

  const otherTab = value(await WorkspaceStore.open());
  try {
    value(await otherTab.createVerbund('C', current));
    const withNewMember = value(await store.exportBackup());
    expect(await store.deleteScope(scope.scopeId, expected, 'delete-scope')).toMatchObject(conflict);
    expect(value(await store.exportBackup())).toBe(withNewMember);
  } finally { otherTab.close(); }
});

it.each([2, 3])('restores v%i without inventing a scope', async version => {
  store = value(await WorkspaceStore.open());
  const member = value(await store.createVerbund('Altbestand'));
  const legacy = JSON.parse(value(await store.exportBackup()));
  delete legacy.methodikScopes;
  legacy.storageSchemaVersion = version;
  legacy.workspaceMeta[0].storageSchemaVersion = version;
  if (version === 2) delete legacy.workspaceMeta[0].databaseId;
  const scope = value(await store.createScope('Zielinhalt'));
  value(await store.createVerbund('Zielverbund', scope));
  value(await store.restoreBackup(value(await store.previewRestoreBackup(bytes(JSON.stringify(legacy))))));
  expect(value(await store.listScopes())).toEqual([]);
  expect(value(await store.listVerbuende())).toEqual([{ ...member, savedAt: expect.any(String), backupSavedAt: member.savedAt }]);
});

it('rejects invalid scope payloads and leaves the target unchanged', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Synthetischer Bereich'));
  const member = value(await store.createVerbund('Mitglied', scope));
  const before = value(await store.exportBackup());
  const file = JSON.parse(before);
  const row = file.methodikScopes[0];
  for (const methodikScopes of [[], [row, row], [{ ...row, items: [{}] }], [{ ...row, evidence: [{}] }], [{ ...row, name: '   ' }], [{ ...row, savedAt: 'invalid' }], [{ ...row, extra: 1 }]]) {
    const result = await store.previewRestoreBackup(bytes(JSON.stringify({ ...file, methodikScopes })));
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });
    expect(JSON.stringify(result)).not.toContain(scope.scopeId);
  }
  const partition = JSON.parse(value(await store.exportVerbundBackup(member.verbundId)));
  const unassigned = { ...partition, verbuende: [{ ...partition.verbuende[0], scopeId: undefined }] };
  for (const invalid of [
    { ...partition, methodikScopes: undefined },
    { ...partition, methodikScopes: [] },
    { ...partition, methodikScopes: [{ ...row, scopeId: crypto.randomUUID() }] },
    { ...partition, methodikScopes: [row, { ...row, scopeId: crypto.randomUUID() }] },
    { ...unassigned, methodikScopes: [row] },
    { ...unassigned, methodikScopes: null },
    { ...partition, storageSchemaVersion: 3 },
  ]) {
    const result = await store.previewRestoreVerbundBackup(bytes(JSON.stringify(invalid)));
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });
    expect(JSON.stringify(result)).not.toContain(scope.scopeId);
  }
  const withoutMembers = { ...file, verbuende: file.verbuende.map((entry: object) => ({ ...entry, scopeId: undefined })), methodikScopes: null };
  expect(await store.previewRestoreBackup(bytes(JSON.stringify(withoutMembers)))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });
  expect(value(await store.exportBackup())).toBe(before);
  value(await store.deleteAll('delete-workspace'));
  store = value(await WorkspaceStore.open());
  expect(value(await store.listScopes())).toEqual([]);
});
