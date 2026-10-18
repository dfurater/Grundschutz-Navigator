import { describe, expect, it } from 'vitest';
import type { LocalId } from '@/domain/workspaceModel';
import { resolveWorkspaceProfiles } from '@/domain/workspaceProfileResolution';
import type { WorkspaceGraphDocument, WorkspaceGraphEdge } from '@/domain/workspaceGraphModel';

function document(id: string, rootType: 'profile' | 'catalog', body: Record<string, unknown>, version = '1.1.3'): WorkspaceGraphDocument {
  return { key: { kind: 'local', localId: id as LocalId }, rootType, oscalVersion: version,
    trustClass: 'class-2-local-user', savedAt: '2026-10-18T00:00:00Z',
    source: { [rootType]: { uuid: '11111111-1111-4111-8111-111111111111',
      metadata: { title: 'Synthetic', version: '1', 'last-modified': '2026-10-18T00:00:00Z', 'oscal-version': version }, ...body } } };
}
function profile(id = 'p', hrefs = ['./catalog']) {
  return document(id, 'profile', { imports: hrefs.map((href) => ({ href, 'include-all': {} })) });
}
function catalog(id = 'c', controlId = 'a', version = '1.1.3') {
  return document(id, 'catalog', { controls: [{ id: controlId, title: 'Synthetic control' }] }, version);
}
function edge(from = 'p', to = 'c', index = 0): WorkspaceGraphEdge {
  return { kind: 'profile-import', from: { document: { kind: 'local', localId: from as LocalId }, kind: 'artifact', localId: null },
    to: { document: { kind: 'local', localId: to as LocalId }, kind: 'artifact', localId: null },
    path: `/profile/imports/${index}/href`, state: 'resolved' };
}

describe('resolveWorkspaceProfiles', () => {
  it('requires a resolved explicit binding for every import', async () => {
    expect(await resolveWorkspaceProfiles([profile(), catalog()], [])).toMatchObject([{ status: 'not-evaluable' }]);
    expect(await resolveWorkspaceProfiles([profile(), catalog()], [{ ...edge(), state: 'external' }])).toMatchObject([{ status: 'not-evaluable' }]);
  });
  it('rejects cycles and mixed versions with existing redacted codes', async () => {
    expect(await resolveWorkspaceProfiles([profile('p'), profile('q')], [edge('p', 'q'), edge('q', 'p')])).toMatchObject([
      { status: 'error', diagnostic: { code: 'PROFILE_RESOLUTION_CYCLE', artifact: { key: null } } },
      { status: 'error', diagnostic: { code: 'PROFILE_RESOLUTION_CYCLE', artifact: { key: null } } },
    ]);
    expect(await resolveWorkspaceProfiles([profile(), catalog('c', 'a', '1.2.2')], [edge()])).toMatchObject([
      { status: 'error', diagnostic: { code: 'PROFILE_RESOLUTION_VERSION_MISMATCH' } },
    ]);
  });
  it('resolves equal href values through independently bound import pointers', async () => {
    const documents = [profile('p', ['./same', './same']), catalog('c', 'a'), catalog('d', 'b')];
    const before = structuredClone(documents);
    expect(await resolveWorkspaceProfiles(documents, [edge(), edge('p', 'd', 1)])).toMatchObject([
      { status: 'resolved', source: { catalog: { controls: [{ id: 'a' }, { id: 'b' }] } } },
    ]);
    expect(documents).toEqual(before);
  });
  it('resolves through the real engine and recomputes updated bindings and sources', async () => {
    const p = profile(); const c = catalog(); const before = structuredClone([p, c]);
    const first = await resolveWorkspaceProfiles([p, c], [edge()]);
    expect(first).toMatchObject([{ status: 'resolved', derived: true, transient: true, specificationStatus: 'work-in-progress',
      source: { catalog: { controls: [{ id: 'a' }], metadata: { props: expect.arrayContaining([{ name: 'resolution-tool', value: expect.any(String) }]), links: expect.arrayContaining([{ rel: 'source-profile', href: expect.any(String) }]) } } } }]);
    expect([p, c]).toEqual(before);
    expect(await resolveWorkspaceProfiles([p, catalog('c', 'b')], [edge()])).toMatchObject([{ status: 'resolved', source: { catalog: { controls: [{ id: 'b' }] } } }]);
    expect(await resolveWorkspaceProfiles([profile('p', ['./different']), catalog('d', 'd')], [edge('p', 'd')])).toMatchObject([{ status: 'resolved', source: { catalog: { controls: [{ id: 'd' }] } } }]);
  });
  it('propagates missing dependencies through the profile chain', async () => {
    expect(await resolveWorkspaceProfiles([profile('p'), profile('q')], [edge('p', 'q')])).toMatchObject([
      { status: 'not-evaluable' }, { status: 'not-evaluable' },
    ]);
  });
});

it('keeps same href independently scoped in different profiles', async () => {
  const results = await resolveWorkspaceProfiles([profile('p'), profile('q'), catalog('c', 'a'), catalog('d', 'b')], [edge(), edge('q', 'd')]);
  expect(results).toMatchObject([
    { status: 'resolved', source: { catalog: { controls: [{ id: 'a' }] } } },
    { status: 'resolved', source: { catalog: { controls: [{ id: 'b' }] } } },
  ]);
});

it('redacts engine diagnostics and handles an already marked closing cycle edge', async () => {
  const bad = document('SECRET-profile', 'profile', { uuid: undefined, imports: [{ href: './SECRET', 'include-controls': [{ 'with-ids': ['missing'] }] }] });
  const results = await resolveWorkspaceProfiles([bad, catalog()], [edge('SECRET-profile')]);
  expect(results).toMatchObject([{ status: 'error', diagnostic: { artifact: { key: null } } }]);
  expect(JSON.stringify(results.map((result) => result.status !== 'resolved' && result.diagnostic))).not.toContain('SECRET');
  expect(await resolveWorkspaceProfiles([profile()], [{ ...edge(), state: 'error', diagnostic: {
    code: 'OSCAL_GRAPH_IMPORT_CYCLE', severity: 'error', stage: 'reference', artifact: { key: null, rootType: null, oscalVersion: null },
    path: '/', validator: { name: 'test', version: '1' }, signature: '', messageKey: '', params: {},
  } }])).toMatchObject([{ status: 'error', diagnostic: { code: 'PROFILE_RESOLUTION_CYCLE' } }]);
});
