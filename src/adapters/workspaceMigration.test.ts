// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it } from 'vitest';
import { migrateWorkspaceStorage } from './workspaceMigration';
import { WORKSPACE_SCHEMA } from './workspaceStore';
import { createWorkspaceStructureValidator } from './workspaceBackupStructure';

await import('@/test/browser/workspaceMigration.browser.test');

it('requires exactly one valid metadata row during incremental validation', () => {
  const validate = createWorkspaceStructureValidator();
  const metadata = { id: 'workspace' as const, storageSchemaVersion: 1, createdAt: '2026-10-16T12:00:00.000Z', savedAt: '2026-10-16T12:00:00.000Z' };
  expect(validate.hasWorkspaceMeta).toBe(false);
  expect(validate.workspaceMeta({ ...metadata, storageSchemaVersion: 9 })).toBe(false);
  expect(validate.hasWorkspaceMeta).toBe(false);
  expect(validate.workspaceMeta(metadata)).toBe(true);
  expect(validate.hasWorkspaceMeta).toBe(true);
  expect(validate.workspaceMeta(metadata)).toBe(false);
});

it.each(['added', 'removed', 'renamed'] as const)('rolls back an upgrade with a %s store', async change => {
  const name = `migration-stores-${crypto.randomUUID()}`;
  const seed = new Dexie(name);
  seed.version(1).stores(WORKSPACE_SCHEMA);
  await seed.open();
  const metadata = { id: 'workspace', storageSchemaVersion: 1, createdAt: '2026-10-16T12:00:00.000Z', savedAt: '2026-10-16T12:00:00.000Z' };
  await seed.table('workspaceMeta').add(metadata);
  seed.close();
  const next = new Dexie(name);
  next.version(1).stores(WORKSPACE_SCHEMA);
  const schema: Record<string, string | null> = { ...WORKSPACE_SCHEMA };
  if (change !== 'added') schema.drafts = null;
  if (change !== 'removed') schema.extra = 'id';
  next.version(2).stores(schema).upgrade(tx => migrateWorkspaceStorage(tx, 1, 2));
  const reopened = new Dexie(name);
  try {
    await expect(next.open()).rejects.toMatchObject({ message: 'WORKSPACE_MIGRATION_INVALID' });
    next.close();
    await reopened.open();
    expect(reopened.verno).toBe(1);
    expect(reopened.tables.map(table => table.name).sort()).toEqual(Object.keys(WORKSPACE_SCHEMA).sort());
    expect(await reopened.table('workspaceMeta').toArray()).toEqual([metadata]);
  } finally {
    seed.close(); next.close(); reopened.close();
    await Dexie.delete(name);
  }
});
