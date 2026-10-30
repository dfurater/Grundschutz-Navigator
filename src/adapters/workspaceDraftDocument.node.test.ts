// @vitest-environment node
import { restoreWorkspaceBackup } from '@/test/restoreWorkspaceBackup';
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
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from './workspaceStore';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { DocumentState, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
function code(result: WorkspaceResult<unknown>): string | undefined { return result.ok ? undefined : result.diagnostic.code; }
function local(source: Record<string, unknown>, rootType = 'profile'): Class2OscalImportedDocument {
  return { source, context: { trustClass: 'class-2-local-user' }, rootType, oscalVersion: '1.1.3' } as Class2OscalImportedDocument;
}
function profile(imports: unknown[]): Record<string, unknown> {
  const source = makeSchemaValidOscalDocument('profile', '1.1.3');
  return { profile: { ...(source.profile as Record<string, unknown>), imports } };
}
// An OSCAL profile requires at least one import (oscal_profile_metaschema.xml @ v1.2.2, min-occurs="1").
const incomplete = () => local(profile([]));
const complete = () => local(makeSchemaValidOscalDocument('profile', '1.1.3'));

let store: WorkspaceStore;
let verbund: WorkspaceVerbund;
beforeEach(async () => {
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  store = value(await WorkspaceStore.open());
  verbund = value(await store.createVerbund('Entwurf'));
});
afterEach(async () => { store.close(); await Dexie.delete(WORKSPACE_DATABASE_NAME); });

it('admits an incomplete profile only in state draft', async () => {
  const envelope = value(await store.addDocument(verbund.verbundId, incomplete(), 'draft'));
  expect(value(await store.getDocument(envelope.localId))).toMatchObject({ documentState: 'draft', source: profile([]) });
  for (const state of ['imported', 'export-ready'] as const) {
    expect(code(await store.addDocument(verbund.verbundId, incomplete(), state))).toBe('WORKSPACE_DOCUMENT_INVALID');
  }
});

it.each([
  ['an unknown root', local({ unknown: (profile([]).profile) })],
  ['a missing oscal-version', local({ profile: { ...(profile([]).profile as Record<string, unknown>), metadata: { title: 'Ohne Version' } } })],
  ['a root type other than the envelope', local(profile([]), 'catalog')],
  ['a source beyond the depth limit', local({ profile: { ...(profile([]).profile as Record<string, unknown>), deep: Array.from({ length: 70 }).reduce<unknown>(inner => [inner], 'x') } })],
])('rejects a draft with %s', async (_case, document) => {
  expect(code(await store.addDocument(verbund.verbundId, document, 'draft'))).toBe('WORKSPACE_DOCUMENT_INVALID');
});

it('saves incomplete content only while the document stays a draft', async () => {
  const draft = value(await store.addDocument(verbund.verbundId, complete(), 'draft'));
  const saved = value(await store.saveDocument(draft.localId, draft.savedAt, null, incomplete()));
  expect(saved).toMatchObject({ documentState: 'draft', source: profile([]) });
  const before = value(await store.exportBackup());
  for (const state of ['imported', 'export-ready'] as const) {
    expect(code(await store.saveDocument(saved.localId, saved.savedAt, null, incomplete(), undefined, state))).toBe('WORKSPACE_DOCUMENT_INVALID');
  }
  expect(value(await store.exportBackup())).toBe(before);
  expect(value(await store.saveDocument(saved.localId, saved.savedAt, null, complete(), undefined, 'export-ready'))).toMatchObject({ documentState: 'export-ready' });
  const imported = value(await store.addDocument(verbund.verbundId, complete()));
  expect(code(await store.saveDocument(imported.localId, imported.savedAt, null, incomplete()))).toBe('WORKSPACE_DOCUMENT_INVALID');
  expect(code(await store.replaceDocument(imported.localId, imported.savedAt, null, incomplete()))).toBe('WORKSPACE_DOCUMENT_INVALID');
});

it.each(['workspace', 'verbund'] as const)('restores an incomplete draft profile from a %s backup', async scope => {
  const envelope = value(await store.addDocument(verbund.verbundId, incomplete(), 'draft'));
  const backup = value(scope === 'workspace' ? await store.exportBackup() : await store.exportVerbundBackup(verbund.verbundId));
  value(await store.deleteDocument(envelope.localId));
  const bytes = new TextEncoder().encode(backup);
  value(scope === 'workspace' ? await restoreWorkspaceBackup(store, bytes) : await store.restoreVerbundBackup(bytes, 'replace-verbund'));
  expect(value(await store.getDocument(envelope.localId))).toMatchObject({ documentState: 'draft', source: profile([]) });
});

it.each<DocumentState>(['imported', 'export-ready'])('rejects a bundle that carries the incomplete profile as %s', async state => {
  value(await store.addDocument(verbund.verbundId, incomplete(), 'draft'));
  const bundle = JSON.parse(value(await store.exportBackup())) as { documents: { documentState: DocumentState }[] };
  bundle.documents[0].documentState = state;
  const result = await restoreWorkspaceBackup(store, new TextEncoder().encode(JSON.stringify(bundle)));
  expect(code(result)).toBe('WORKSPACE_BACKUP_DOCUMENT_REJECTED');
});

// A root type the source does not carry already fails the bundle structure (WORKSPACE_BACKUP_INVALID); these rows reach the draft binding check.
it.each([
  ['an envelope oscalVersion other than the source', (row: Record<string, unknown>) => { row.oscalVersion = '1.1.2'; }],
  ['a source without oscal-version', (row: Record<string, unknown>) => { delete ((row.source as { profile: { metadata: Record<string, unknown> } }).profile.metadata)['oscal-version']; }],
])('rejects a bundle whose draft row has %s', async (_case, manipulate) => {
  value(await store.addDocument(verbund.verbundId, incomplete(), 'draft'));
  const before = value(await store.exportBackup());
  const bundle = JSON.parse(before) as { documents: Record<string, unknown>[] };
  manipulate(bundle.documents[0]);
  const result = await restoreWorkspaceBackup(store, new TextEncoder().encode(JSON.stringify(bundle)));
  expect(code(result)).toBe('WORKSPACE_BACKUP_DOCUMENT_REJECTED');
  expect(value(await store.exportBackup())).toBe(before);
});
