import { describe, expect, it, vi } from 'vitest';
import * as budgetModule from '@/domain/profileResolutionBudget';
import * as pipeline from '@/domain/oscalObjectPipeline';
import { getSchemaPin } from '@/domain/oscalVersionMatrix';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
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


it('accepts only the common $schema root exception without changing source', async () => {
  const p = profile();
  const withDirective = { ...p, source: { ...(p.source as object), $schema: getSchemaPin('profile', '1.1.3')!.schemaId } };
  const before = structuredClone(withDirective);
  expect(await resolveWorkspaceProfiles([withDirective, catalog()], [edge()])).toMatchObject([{ status: 'resolved' }]);
  expect(withDirective).toEqual(before);
  expect(await resolveWorkspaceProfiles([{ ...p, source: { ...(p.source as object), unknown: {} } }, catalog()], [edge()])).toMatchObject([{ status: 'error' }]);
});

it('compares canonical pinned versions for local documents and preserves class-1 strictness', async () => {
  const p = document('p', 'profile', { imports: [{ href: './catalog', 'include-all': {} }] }, 'v1.2.2');
  const c = catalog('c', 'a', '1.2.2');
  const before = structuredClone([p, c]);
  expect(await resolveWorkspaceProfiles([p, c], [edge()])).toMatchObject([{ status: 'resolved', source: { catalog: { metadata: { 'oscal-version': '1.2.2' } } } }]);
  expect([p, c]).toEqual(before);
  expect(await resolveWorkspaceProfiles([{ ...p, trustClass: 'class-1-verified-public' }, c], [edge()])).toMatchObject([{ status: 'error' }]);
});

it('propagates reference errors with redacted causes through dependent profiles', async () => {
  const cause = createOscalDiagnostic({ code: 'OSCAL_GRAPH_ROOT_TYPE_MISMATCH', path: '/profile/imports/0/href', stage: 'reference',
    validator: { name: 'test', version: '1' }, artifact: { key: 'SECRET-local-key' } });
  const results = await resolveWorkspaceProfiles([profile('p'), profile('q'), catalog()], [edge('p', 'q'), { ...edge('q'), state: 'error', diagnostic: cause }]);
  expect(results).toMatchObject([
    { status: 'error', diagnostic: { code: cause.code, artifact: { key: null } } },
    { status: 'error', diagnostic: { code: cause.code, artifact: { key: null } } },
  ]);
  expect(JSON.stringify(results)).not.toContain('SECRET');
});

it('builds each intermediate profile once per graph invocation and recomputes on the next invocation', async () => {
  const spy = vi.spyOn(pipeline, 'processClass2OscalValue');
  const budgetSpy = vi.spyOn(budgetModule, 'createProfileResolutionBudget');
  try {
    const profiles = Array.from({ length: 100 }, (_, index) => profile(`p${index}`));
    const edges = profiles.map((_, index) => edge(`p${index}`, index === 99 ? 'c' : `p${index + 1}`));
    const first = await resolveWorkspaceProfiles([...profiles, catalog()], edges);
    expect(first.every((result) => result.status === 'resolved')).toBe(true);
    expect(spy).toHaveBeenCalledTimes(100);
    expect(budgetSpy).toHaveBeenCalledTimes(1);
    const second = await resolveWorkspaceProfiles([...profiles, catalog('c', 'changed')], edges);
    expect(second[0]).toMatchObject({ status: 'resolved', source: { catalog: { controls: [{ id: 'changed' }] } } });
    expect(spy).toHaveBeenCalledTimes(200);
    expect(budgetSpy).toHaveBeenCalledTimes(2);
  } finally { spy.mockRestore(); budgetSpy.mockRestore(); }
});


it('leaves a missing-source edge not evaluable without promoting it to a reference error', async () => {
  expect(await resolveWorkspaceProfiles([profile()], [{ ...edge(), state: 'missing-source' }])).toMatchObject([{ status: 'not-evaluable' }]);
});


it('checks versions before consuming an already cached dependency', async () => {
  const q = document('q', 'profile', { imports: [{ href: './catalog', 'include-all': {} }] }, '1.2.2');
  const results = await resolveWorkspaceProfiles([profile(), q, catalog()], [edge(), edge('q')]);
  expect(results).toMatchObject([
    { status: 'resolved' },
    { status: 'error', diagnostic: { code: 'PROFILE_RESOLUTION_VERSION_MISMATCH' } },
  ]);
});
