// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/workspaceBackup', async () => {
  const { processWorkspaceBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from './workspaceStore';
import { processClass2OscalBytes, type Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/class2ImportLimits.mjs';
import { SOURCE_REGISTRY } from '@/domain/sourceRegistry';
import type { DocumentState, WorkspaceBinding, WorkspaceEnvelope, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
function value<T>(result: WorkspaceResult<T>): T { expect(result.ok).toBe(true); if (!result.ok) throw new Error('fixture'); return result.value; }
function rejected(result: WorkspaceResult<unknown>, code: string): void {
  expect(result).toMatchObject({ ok: false, diagnostic: { code, stage: 'domain', path: '/', validator: { name: 'gspp-workspace', version: '1' } } });
  expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
}
let store: WorkspaceStore;
const external: Dexie[] = [];
let document: Class2OscalImportedDocument;
let verbund: WorkspaceVerbund;
let envelope: WorkspaceEnvelope;
beforeEach(async () => {
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  store = value(await WorkspaceStore.open());
  document = valueImported(await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))), { trustClass: 'class-2-local-user' }));
  verbund = value(await store.createVerbund('Boundary'));
  envelope = value(await store.addDocument(verbund.verbundId, document));
});
function valueImported(result: Awaited<ReturnType<typeof processClass2OscalBytes>>): Class2OscalImportedDocument { if (!result.ok) throw new Error('fixture'); return result.document; }
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  store?.close();
  external.forEach(db => db.close()); external.length = 0;
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});
async function raw(): Promise<Dexie> { const db = new Dexie(WORKSPACE_DATABASE_NAME); external.push(db); await db.open(); return db; }
describe('storage boundary failures', () => {
  it('redacts native IndexedDB opening failures', async () => {
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw new Error('PRIVATE_SENTINEL'); });
    rejected(await WorkspaceStore.open(), 'WORKSPACE_STORAGE_FAILED');
  });
  it.each([undefined, 0, 1.5])('blocks writes when workspace metadata is missing or corrupt %#', async schema => {
    const db = await raw();
    if (schema === undefined) await db.table('workspaceMeta').delete('workspace');
    else { const metadata = await db.table('workspaceMeta').get('workspace'); await db.table('workspaceMeta').put({ ...metadata, storageSchemaVersion: schema }); }
    rejected(await store.createVerbund('Never stored'), 'WORKSPACE_SCHEMA_INVALID');
    rejected(await store.exportBackup(), 'WORKSPACE_SCHEMA_INVALID');
  });
  it('redacts read and write failures after explicit close', async () => {
    store.close();
    rejected(await store.listVerbuende(), 'WORKSPACE_STORAGE_FAILED');
    rejected(await store.createVerbund('Closed'), 'WORKSPACE_STORAGE_FAILED');
  });
  it.each([{}, { storage: {} }])('allows unavailable advisory storage estimates %#', async navigator => {
    vi.stubGlobal('navigator', navigator);
    expect(await store.estimate()).toEqual({ ok: true, value: undefined });
  });
  it('returns storage estimates without persisting them', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 7, quota: 99 }) } });
    expect(await store.estimate()).toEqual({ ok: true, value: { usage: 7, quota: 99 } });
  });
  it('redacts a storage-estimate failure', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => { throw new Error('PRIVATE_SENTINEL'); } } });
    rejected(await store.estimate(), 'WORKSPACE_STORAGE_FAILED');
  });
  it.each(['', '  ', null, 42])('rejects invalid verbund names on create and rename %#', async name => {
    rejected(await store.createVerbund(name as string), 'WORKSPACE_VERBUND_INVALID');
    rejected(await store.renameVerbund(verbund.verbundId, name as string), 'WORKSPACE_VERBUND_INVALID');
  });
  it('reports missing verbund and document references', async () => {
    rejected(await store.renameVerbund('missing', 'Name'), 'WORKSPACE_VERBUND_NOT_FOUND');
    rejected(await store.addDocument('missing', document), 'WORKSPACE_VERBUND_NOT_FOUND');
    rejected(await store.saveDocument('missing', envelope.savedAt, document), 'WORKSPACE_DOCUMENT_NOT_FOUND');
    rejected(await store.autosaveDraft('missing', envelope.savedAt, {}), 'WORKSPACE_DOCUMENT_NOT_FOUND');
    rejected(await store.removeBinding('missing', '/catalog'), 'WORKSPACE_DOCUMENT_NOT_FOUND');
  });
  it('requires explicit destructive confirmations before parsing or deletion', async () => {
    rejected(await store.restoreBackup(new Uint8Array(), '' as 'replace-workspace'), 'WORKSPACE_CONFIRMATION_REQUIRED');
    rejected(await store.deleteAll('' as 'delete-workspace'), 'WORKSPACE_CONFIRMATION_REQUIRED');
    expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
  });
  it('does not replace existing rows after a rejected backup', async () => {
    rejected(await store.restoreBackup(new Uint8Array([255]), 'replace-workspace'), 'WORKSPACE_BACKUP_INPUT_REJECTED');
    expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
  });
});
describe('document and draft admission', () => {
  it('rejects a forged trusted-public import context', async () => {
    rejected(await store.addDocument(verbund.verbundId, { ...document, context: { trustClass: 'class-1-verified-public' } } as unknown as Class2OscalImportedDocument), 'WORKSPACE_TRUST_CLASS_REJECTED');
  });
  it.each([
    (input: Class2OscalImportedDocument) => ({ ...input, source: { value: undefined } }),
    (input: Class2OscalImportedDocument) => ({ ...input, source: {} }),
    (input: Class2OscalImportedDocument) => ({ ...input, rootType: 'profile' }),
    (input: Class2OscalImportedDocument) => ({ ...input, oscalVersion: '1.2.2' }),
    (input: Class2OscalImportedDocument) => ({ ...input, source: { catalog: { metadata: { 'oscal-version': '1.1.3' } } } }),
    (input: Class2OscalImportedDocument) => ({ ...input, source: { text: 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes) } }),
  ])('rejects invalid document sources and envelope mismatches %#', async mutate => {
    rejected(await store.addDocument(verbund.verbundId, mutate(document) as Class2OscalImportedDocument), 'WORKSPACE_DOCUMENT_INVALID');
  });
  it('rejects invalid document states on add and save', async () => {
    rejected(await store.addDocument(verbund.verbundId, document, 'unknown' as DocumentState), 'WORKSPACE_DOCUMENT_INVALID');
    rejected(await store.saveDocument(envelope.localId, envelope.savedAt, document, undefined, 'unknown' as DocumentState), 'WORKSPACE_DOCUMENT_INVALID');
  });
  it('rejects sources whose root UUID collides with the local storage key', async () => {
    const source = structuredClone(document.source) as { catalog: { uuid: string } };
    source.catalog.uuid = envelope.localId;
    rejected(await store.saveDocument(envelope.localId, envelope.savedAt, { ...document, source }), 'WORKSPACE_DOCUMENT_INVALID');
  });
  it.each([{ value: undefined }, { text: 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes) }])('rejects drafts outside graph or source-size bounds %#', async source => {
    rejected(await store.autosaveDraft(envelope.localId, envelope.savedAt, source), 'WORKSPACE_DRAFT_INVALID');
  });
});
describe('explicit binding admission', () => {
  function binding(): WorkspaceBinding {
    const source = document.source as { catalog: { metadata: { title: string } } };
    return { fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: source.catalog.metadata.title, target: { kind: 'class-1', artifactKey: SOURCE_REGISTRY.find(entry => entry.lifecycle === 'supported')!.artifactKey } };
  }
  it.each([
    (row: WorkspaceBinding) => ({ ...row, pointer: 'catalog' }),
    (row: WorkspaceBinding) => ({ ...row, pointer: '/missing' }),
    (row: WorkspaceBinding) => ({ ...row, pointer: '/catalog/metadata/~invalid' }),
    (row: WorkspaceBinding) => ({ ...row, pointer: 5 }),
    (row: WorkspaceBinding) => ({ ...row, href: 5 }),
    (row: WorkspaceBinding) => ({ ...row, href: 'mismatch' }),
    (row: WorkspaceBinding) => ({ ...row, target: null }),
    (row: WorkspaceBinding) => ({ ...row, target: { kind: 'unknown' } }),
  ])('rejects invalid pointer, href and target inputs %#', async mutate => {
    rejected(await store.setBinding(mutate(binding()) as WorkspaceBinding), 'WORKSPACE_BINDING_INVALID');
  });
  it('rejects unsupported class-1 artifact references', async () => {
    rejected(await store.setBinding({ ...binding(), target: { kind: 'class-1', artifactKey: 'PRIVATE_SENTINEL' } }), 'WORKSPACE_ARTIFACT_UNSUPPORTED');
  });
  it('rejects bindings whose local target is missing', async () => {
    rejected(await store.setBinding({ ...binding(), target: { kind: 'local', localId: 'missing' } }), 'WORKSPACE_DOCUMENT_NOT_FOUND');
  });
  it('rejects outgoing replacements belonging to another document and rolls back save', async () => {
    rejected(await store.saveDocument(envelope.localId, envelope.savedAt, document, [{ ...binding(), fromLocalId: 'foreign' }]), 'WORKSPACE_BINDING_INVALID');
    expect(value(await store.getDocument(envelope.localId))).toEqual(envelope);
  });
});
describe('aggregate backup export bounds', () => {
  it('rejects aggregate depth although the stored draft fits its source-depth policy', async () => {
    let source: unknown = null;
    for (let depth = 0; depth < 61; depth++) source = { child: source };
    value(await store.autosaveDraft(envelope.localId, envelope.savedAt, source));
    rejected(await store.exportBackup(), 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
    expect(value(await store.getDraft(envelope.localId))?.source).toEqual(source);
  });
  it('rejects aggregate node counts without discarding individually bounded drafts', async () => {
    const other = value(await store.addDocument(verbund.verbundId, document));
    value(await store.autosaveDraft(envelope.localId, envelope.savedAt, Array(600_000).fill(null)));
    value(await store.autosaveDraft(other.localId, other.savedAt, Array(600_000).fill(null)));
    rejected(await store.exportBackup(), 'WORKSPACE_BACKUP_LIMIT_EXCEEDED');
    expect(value(await store.getDraft(envelope.localId))?.source as unknown[]).toHaveLength(600_000);
    expect(value(await store.getDraft(other.localId))?.source as unknown[]).toHaveLength(600_000);
  });
});
it('redacts uncloneable binding inputs before touching persisted rows', async () => {
  const malformed = { fromLocalId: envelope.localId, pointer: '/catalog', href: 'PRIVATE_SENTINEL', target: { kind: 'local', localId: envelope.localId }, extra: () => 'PRIVATE_SENTINEL' };
  rejected(await store.setBinding(malformed as WorkspaceBinding), 'WORKSPACE_STORAGE_FAILED');
  expect(value(await store.listBindings())).toEqual([]);
});
it('rejects a generated local ID equal to the imported document root UUID', async () => {
  const rootUuid = (document.source as { catalog: { uuid: `${string}-${string}-${string}-${string}-${string}` } }).catalog.uuid;
  const generate = vi.spyOn(crypto, 'randomUUID').mockReturnValue(rootUuid);
  try {
    rejected(await store.addDocument(verbund.verbundId, document), 'WORKSPACE_DOCUMENT_INVALID');
    expect(value(await store.listDocuments())).toMatchObject([{ localId: envelope.localId }]);
  } finally { generate.mockRestore(); }
});
