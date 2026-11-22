import Dexie from 'dexie';
import { afterEach, expect, it } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { scopeBoundaryInput, type ScopeBoundaryInput } from '@/domain/scopeBoundary';
import type { WorkspaceResult } from '@/domain/workspaceModel';

function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}

const bytes = (text: string) => new TextEncoder().encode(text);
const INPUT: ScopeBoundaryInput = {
  ...scopeBoundaryInput(undefined),
  organization: ' Verwaltung und Betrieb ', processCoverage: 'Netzbetrieb', infrastructure: 'Standort Nord',
  externalParties: 'keine', interfaces: 'Dienstleister-Portal', exclusions: 'Messstellenbetrieb',
  sourceLabel: 'Abgrenzung v2', sourceIssuedAt: '2026-10-22', role: 'ISB', party: 'Sicherheitsorganisation',
};
let store: WorkspaceStore;

afterEach(async () => {
  store?.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});

it('speichert die Abgrenzung unter CAS, hält die itemId stabil und lehnt ein ungültiges Datum ab', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Netzbetrieb'));
  const first = value(await store.saveScopeBoundary(scope.scopeId, scope.savedAt, INPUT));
  expect(first.items[0]).toMatchObject({ category: 'scope', details: { organization: 'Verwaltung und Betrieb' }, source: { label: 'Abgrenzung v2', issuedAt: '2026-10-22' } });
  expect(await store.saveScopeBoundary(scope.scopeId, scope.savedAt, INPUT)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(await store.saveScopeBoundary(scope.scopeId, first.savedAt, { ...INPUT, sourceIssuedAt: '2026-02-30' })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCOPE_INVALID' } });
  const second = value(await store.saveScopeBoundary(scope.scopeId, first.savedAt, { ...INPUT, interfaces: '' }));
  expect(second.items).toHaveLength(1);
  expect(second.items[0]?.itemId).toBe(first.items[0]?.itemId);
  // Umbenennen erhält den Eintrag.
  const renamed = value(await store.renameScope(scope.scopeId, 'Netz', second.savedAt));
  expect(renamed.items).toEqual(second.items);
});

it('transportiert die Abgrenzung im Gesamt- und Verbundbackup', async () => {
  store = value(await WorkspaceStore.open());
  const scope = value(await store.createScope('Netzbetrieb'));
  const member = value(await store.createVerbund('Mitglied', scope));
  const [current] = value(await store.listScopes());
  const saved = value(await store.saveScopeBoundary(scope.scopeId, current.savedAt, INPUT));
  const whole = value(await store.exportBackup());
  const partition = value(await store.exportVerbundBackup(member.verbundId));
  expect(JSON.parse(whole).methodikScopes[0].items).toEqual(saved.items);
  expect(JSON.parse(partition).methodikScopes[0].items).toEqual(saved.items);

  store.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  store = value(await WorkspaceStore.open());
  value(await store.restoreVerbundBackup(value(await store.previewRestoreVerbundBackup(bytes(partition)))));
  expect(value(await store.listScopes())[0].items).toEqual(saved.items);
  value(await store.restoreBackup(value(await store.previewRestoreBackup(bytes(whole)))));
  expect(value(await store.listScopes())[0].items).toEqual(saved.items);
});
