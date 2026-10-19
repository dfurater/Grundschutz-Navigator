// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { processClass2OscalBytes, type Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { checkWorkspaceMembership } from '@/domain/workspaceMembership';
import { buildWorkspaceGraph } from '@/domain/workspaceGraph';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceEnvelope, WorkspaceResult } from '@/domain/workspaceModel';

function value<T>(result: WorkspaceResult<T>): T {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}
async function imported(source: unknown): Promise<Class2OscalImportedDocument> {
  const result = await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}
function body(source: Record<string, unknown>, root: string): Record<string, unknown> { return source[root] as Record<string, unknown>; }
let store: WorkspaceStore;
beforeEach(async () => {
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  store = value(await WorkspaceStore.open());
});
afterEach(async () => {
  vi.restoreAllMocks();
  store?.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});
async function members(): Promise<WorkspaceEnvelope[]> {
  const summaries = value(await store.listDocuments());
  return Promise.all(summaries.map(async summary => {
    const document = value(await store.getDocument(summary.localId));
    if (!document) throw new Error('Missing fixture member');
    return document;
  }));
}
const profilePointer = '/profile/imports/0/href';
const sspPointer = '/system-security-plan/import-profile/href';

describe('workspace graph storage integration', () => {
  it('replaces a duplicate profile, preserves both binding directions and uses its new source', async () => {
    const verbund = value(await store.createVerbund('Graph'));
    const catalogSource = makeSchemaValidOscalDocument('catalog', '1.2.2');
    body(catalogSource, 'catalog').controls = [{ id: 'new-control', title: 'New control' }];
    const catalog = value(await store.addDocument(verbund.verbundId, await imported(catalogSource)));
    const profileSource = makeSchemaValidOscalDocument('profile', '1.2.2');
    body(profileSource, 'profile').imports = [{ href: 'catalog.json', 'include-controls': [{ 'with-ids': ['ac-1'] }] }];
    let profile = value(await store.addDocument(verbund.verbundId, await imported(profileSource)));
    const sspSource = makeSchemaValidOscalDocument('system-security-plan', '1.2.2');
    body(sspSource, 'system-security-plan')['import-profile'] = { href: 'profile.json' };
    const implementation = body(sspSource, 'system-security-plan')['control-implementation'] as { 'implemented-requirements': Record<string, unknown>[] };
    implementation['implemented-requirements'][0]['control-id'] = 'new-control';
    const ssp = value(await store.addDocument(verbund.verbundId, await imported(sspSource)));
    value(await store.setBinding({ fromLocalId: profile.localId, pointer: profilePointer, href: 'catalog.json', target: { kind: 'local', localId: catalog.localId } }, profile.savedAt));
    value(await store.setBinding({ fromLocalId: ssp.localId, pointer: sspPointer, href: 'profile.json', target: { kind: 'local', localId: profile.localId } }, ssp.savedAt));
    const bindingsBefore = value(await store.listBindings());
    const graphBefore = await buildWorkspaceGraph({ members: await members(), bindings: bindingsBefore });
    expect(graphBefore.edges.find(edge => edge.kind === 'ssp-control')?.state).toBe('error');
    body(profileSource, 'profile').imports = [{ href: 'catalog.json', 'include-all': {} }];
    const replacement = await imported(profileSource);
    const currentMembers = await members();
    expect(await checkWorkspaceMembership({ document: replacement, members: currentMembers, verbundId: verbund.verbundId })).toMatchObject({ ok: false, existingLocalId: profile.localId, action: 'replace' });
    expect(await checkWorkspaceMembership({ document: replacement, members: currentMembers, verbundId: verbund.verbundId, replacingLocalId: profile.localId })).toEqual({ ok: true });
    profile = value(await store.getDocument(profile.localId))!;
    const replaced = value(await store.replaceDocument(profile.localId, profile.savedAt, null, replacement));
    expect(replaced.localId).toBe(profile.localId);
    expect(replaced.createdAt).toBe(profile.createdAt);
    expect(value(await store.listBindings())).toEqual(bindingsBefore);
    const writeSpy = vi.spyOn(store as unknown as { write: (...args: unknown[]) => unknown }, 'write');
    const snapshot = value(await store.exportBackup());
    const graph = await buildWorkspaceGraph({ members: await members(), bindings: value(await store.listBindings()) });
    expect(graph.diagnostics).toEqual([]);
    expect(graph.resolutions[0]).toMatchObject({ status: 'resolved', transient: true, derived: true });
    expect(graph.edges.find(edge => edge.kind === 'ssp-control')).toMatchObject({ state: 'resolved', to: { localId: 'new-control' } });
    expect(writeSpy).not.toHaveBeenCalled();
    expect(value(await store.exportBackup())).toBe(snapshot);
    expect(value(await store.listDocuments())).toHaveLength(3);
    expect(snapshot).not.toContain('resolution-tool');
    writeSpy.mockRestore();
    body(profileSource, 'profile').uuid = '99999999-9999-4999-8999-999999999999';
    const authored = value(await store.saveDocument(replaced.localId, replaced.savedAt, null, await imported(profileSource)));
    expect(authored.localId).toBe(replaced.localId);
    expect(value(await store.listBindings())).toEqual(bindingsBefore);
    const savedGraph = await buildWorkspaceGraph({ members: await members(), bindings: value(await store.listBindings()) });
    expect(savedGraph.edges.find(edge => edge.kind === 'ssp-control')?.state).toBe('resolved');
  });

  it('resolves a class-1 target without persisting its bytes or generated catalog', async () => {
    const verbund = value(await store.createVerbund('Class-1 target'));
    const source = makeSchemaValidOscalDocument('profile', '1.1.3');
    body(source, 'profile').imports = [{ href: 'catalog.json', 'include-all': {} }];
    const profile = value(await store.addDocument(verbund.verbundId, await imported(source)));
    value(await store.setBinding({ fromLocalId: profile.localId, pointer: profilePointer, href: 'catalog.json', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, profile.savedAt));
    const catalogSource = makeSchemaValidOscalDocument('catalog', '1.1.3');
    body(catalogSource, 'catalog').controls = [{ id: 'sentinel-control', title: 'CLASS1_BYTES_SENTINEL' }];
    const before = value(await store.exportBackup());
    const writeSpy = vi.spyOn(store as unknown as { write: (...args: unknown[]) => unknown }, 'write');
    const graph = await buildWorkspaceGraph({ members: await members(), bindings: value(await store.listBindings()), class1Artifacts: [{ artifactKey: 'catalog-gspp', lifecycle: 'supported', trustClass: 'class-1-verified-public', rootType: 'catalog', oscalVersion: '1.1.3', source: catalogSource }] });
    expect(graph.diagnostics).toEqual([]);
    expect(graph.resolutions[0]).toMatchObject({ status: 'resolved', transient: true, derived: true });
    expect(JSON.stringify(graph.resolutions)).toContain('CLASS1_BYTES_SENTINEL');
    expect(writeSpy).not.toHaveBeenCalled();
    const after = value(await store.exportBackup());
    expect(after).toBe(before);
    expect(after).not.toContain('CLASS1_BYTES_SENTINEL');
    expect(after).not.toContain('resolution-tool');
    expect(value(await store.listDocuments())).toHaveLength(1);
    expect(value(await store.listBindings())[0].target).toEqual({ kind: 'class-1', artifactKey: 'catalog-gspp' });
  });
});
