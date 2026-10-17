// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/workspaceBackup', async () => {
  const { processWorkspaceBackupBytes, processVerbundBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes, parseVerbundBackup: processVerbundBackupBytes };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { exportWorkspaceBackupSnapshot } from '@/adapters/workspaceBackupStorage';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceEnvelope, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
const bytes = (text: string) => new TextEncoder().encode(text);
let store: WorkspaceStore;
let db: Dexie;
let a: WorkspaceVerbund;
let b: WorkspaceVerbund;
let one: WorkspaceEnvelope;
let other: WorkspaceEnvelope;
let imported: Class2OscalImportedDocument;
beforeEach(async () => {
  store = value(await WorkspaceStore.open());
  a = value(await store.createVerbund('Selected'));
  b = value(await store.createVerbund('OTHER_VERBUND_SENTINEL'));
  async function document(title: string) {
    const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
    (source.catalog as { metadata: { title: string } }).metadata.title = title;
    const result = await importClass2OscalDocument(bytes(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
    if (!result.ok) throw new Error(result.diagnostic.code);
    return result.document;
  }
  imported = await document('Selected');
  one = value(await store.addDocument(a.verbundId, imported));
  other = value(await store.addDocument(b.verbundId, await document('OTHER_DOCUMENT_SENTINEL')));
  value(await store.autosaveDraft(one.localId, one.savedAt, null, { incomplete: true }));
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'Selected', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }));
  db = new Dexie(WORKSPACE_DATABASE_NAME); await db.open();
});
afterEach(async () => { vi.restoreAllMocks(); db?.close(); store?.close(); await Dexie.delete(WORKSPACE_DATABASE_NAME); });

it('exports exactly one verbund and restores it without changing another verbund', async () => {
  const backup = value(await store.exportVerbundBackup(a.verbundId));
  const parsed = JSON.parse(backup);
  expect(parsed).toMatchObject({ format: 'gspp-workspace-verbund', verbuende: [a], documents: [{ localId: one.localId }], drafts: [{ localId: one.localId }], bindings: [{ fromLocalId: one.localId }] });
  expect(parsed).not.toHaveProperty('workspaceMeta');
  expect(backup).not.toContain('OTHER_');
  value(await store.renameVerbund(a.verbundId, 'Changed'));
  const added = value(await store.addDocument(a.verbundId, imported));
  value(await store.restoreVerbundBackup(bytes(backup), 'replace-verbund'));
  expect(value(await store.exportVerbundBackup(a.verbundId))).toBe(backup);
  expect(value(await store.getDocument(added.localId))).toBeUndefined();
  expect(value(await store.getDocument(other.localId))).toEqual(other);
  value(await store.deleteVerbund(a.verbundId));
  value(await store.restoreVerbundBackup(bytes(backup), 'replace-verbund'));
  expect(value(await store.exportVerbundBackup(a.verbundId))).toBe(backup);
});

it('rejects foreign localId collisions atomically', async () => {
  const selected = JSON.parse(value(await store.exportVerbundBackup(a.verbundId)));
  const oldId = selected.documents[0].localId;
  const text = JSON.stringify(selected).replaceAll(oldId, other.localId);
  const before = value(await store.exportBackup());
  expect(await store.restoreVerbundBackup(bytes(text), 'replace-verbund')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_CONFLICT' } });
  expect(value(await store.exportBackup())).toBe(before);
});

it('restores an empty verbund without admitting foreign drafts or retaining stale selected rows', async () => {
  const empty = value(await store.createVerbund('Empty'));
  const parsed = JSON.parse(value(await store.exportVerbundBackup(empty.verbundId)));
  expect(parsed.documents).toHaveLength(0);
  expect(parsed.drafts).toHaveLength(0);
  expect(parsed.bindings).toHaveLength(0);
  parsed.verbuende[0].verbundId = a.verbundId;
  value(await store.restoreVerbundBackup(bytes(JSON.stringify(parsed)), 'replace-verbund'));
  expect(value(await store.listDocuments(a.verbundId))).toHaveLength(0);
  expect(value(await store.getDraft(one.localId))).toBeUndefined();
  expect(value(await store.listBindings())).toHaveLength(0);
  expect(value(await store.getDocument(other.localId))).toEqual(other);
});

it('rejects crossed formats, invalid sources, newer schemas and oversized bytes without mutation', async () => {
  const total = value(await store.exportBackup());
  const selected = value(await store.exportVerbundBackup(a.verbundId));
  expect(await store.restoreBackup(bytes(selected), 'replace-workspace')).toMatchObject({ ok: false });
  const invalid = JSON.parse(selected); invalid.documents[0].source = { catalog: {} };
  for (const input of [bytes(total), bytes(JSON.stringify(invalid)), bytes(selected.replace('"storageSchemaVersion":1', '"storageSchemaVersion":2')), new Uint8Array(WORKSPACE_BACKUP_MAX_BYTES + 1)]) {
    expect(await store.restoreVerbundBackup(input, 'replace-verbund')).toMatchObject({ ok: false });
    expect(value(await store.exportBackup())).toBe(total);
  }
  expect(await store.exportVerbundBackup('missing' as typeof a.verbundId)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_VERBUND_NOT_FOUND' } });
  expect(await store.restoreVerbundBackup(bytes(selected), '' as 'replace-verbund')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
});

it('keeps each verbund restorable when the aggregate workspace exceeds the byte cap', async () => {
  for (const row of [one, other]) value(await store.autosaveDraft(row.localId, value(await store.getDocument(row.localId))!.savedAt, value(await store.getDraft(row.localId))?.savedAt ?? null, { text: 'x'.repeat(9 * 1024 * 1024) }));
  for (const row of [one, other]) {
    const added = value(await store.addDocument(row.verbundId, imported));
    value(await store.autosaveDraft(added.localId, added.savedAt, null, { text: 'x'.repeat(9 * 1024 * 1024) }));
  }
  expect(await store.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_LIMIT_EXCEEDED' } });
  for (const verbund of [a, b]) {
    const backup = value(await store.exportVerbundBackup(verbund.verbundId));
    value(await store.restoreVerbundBackup(bytes(backup), 'replace-verbund'));
    expect(value(await store.exportVerbundBackup(verbund.verbundId))).toBe(backup);
  }
}, 30_000);

it('preserves unknown future data through the global export path', async () => {
  await db.table('workspaceMeta').update('workspace', { storageSchemaVersion: 2, future: 'FUTURE_METADATA' });
  const backup = await db.transaction('r', db.tables, () => exportWorkspaceBackupSnapshot(db));
  expect(JSON.parse(backup)).toMatchObject({ storageSchemaVersion: 2, workspaceMeta: [{ future: 'FUTURE_METADATA' }] });
  expect(await store.exportVerbundBackup(a.verbundId)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
});
