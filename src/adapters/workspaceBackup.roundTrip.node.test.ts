// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceResult } from '@/domain/workspaceModel';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/workspaceBackup', async () => {
  const { processWorkspaceBackupBytes, processVerbundBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes, parseVerbundBackup: processVerbundBackupBytes };
});
await import('@/test/browser/workspaceBackup.browser.test');

it('rolls back all restored stores when quota fails after existing rows were cleared', async () => {
  function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Rollback'));
    const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
    const imported = await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
    if (!imported.ok) throw new Error(imported.diagnostic.code);
    const envelope = value(await store.addDocument(verbund.verbundId, imported.document));
    value(await store.setBinding({ fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'Minimalbeispiel', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, value(await store.getDocument(envelope.localId))!.savedAt));
    const backup = value(await store.exportBackup());
    value(await store.renameVerbund(verbund.verbundId, 'Current data'));
    const before = value(await store.exportBackup());
    const original = IDBObjectStore.prototype.add;
    const add = vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'bindings') throw new DOMException('PRIVATE_SENTINEL', 'QuotaExceededError');
      return original.apply(this, args);
    });
    const result = await store.restoreBackup(new TextEncoder().encode(backup), 'replace-workspace');
    add.mockRestore();
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_QUOTA_EXCEEDED' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
    expect(value(await store.exportBackup())).toBe(before);
  } finally { store.close(); }
});
