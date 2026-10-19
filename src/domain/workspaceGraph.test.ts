import { describe, expect, it, vi, afterEach } from 'vitest';
import { buildWorkspaceGraph } from '@/domain/workspaceGraph';
import type { VerbundId } from '@/domain/workspaceModel';
import type { OscalRootKey, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { member, body, bind } from '@/test/fixtures/workspaceGraph';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';

afterEach(() => vi.unstubAllGlobals());

describe('Verbundgraph', () => {
  it('führt sieben lokale Root-Modelle mit lokaler Identität und eigener Version', async () => {
    const roots: OscalRootKey[] = ['catalog', 'profile', 'component-definition', 'system-security-plan', 'assessment-plan', 'assessment-results', 'plan-of-action-and-milestones'];
    const members = roots.map((root, index) => member(root, `m-${index}`, ['1.1.2', '1.1.3', '1.2.1', '1.2.2'][index % 4] as PinnedOscalVersion));
    const graph = await buildWorkspaceGraph({ members, bindings: [], class1Artifacts: [] });
    expect(graph.members.map(m => m.localId)).toEqual(members.map(m => m.localId));
    expect(graph.members.map(m => m.oscalVersion)).toEqual(members.map(m => m.oscalVersion));
    expect(graph.members.every(m => m.trustClass === 'class-2-local-user')).toBe(true);
    expect(graph.nodes.filter(n => n.kind === 'artifact')).toHaveLength(7);
  });

  it('bindet gleiche href-Werte je Quelldokument und Pointer', async () => {
    const a = member('profile', 'a');
    const b = member('profile', 'b');
    const x = member('catalog', 'x');
    const y = member('catalog', 'y');
    const pointer = '/profile/imports/0/href';
    const graph = await buildWorkspaceGraph({ members: [a, b, x, y], bindings: [bind(a, pointer, x), bind(b, pointer, y)] });
    expect(graph.edges.filter(e => e.kind === 'profile-import').map(e => e.to?.document)).toEqual([
      { kind: 'local', localId: 'x' },
      { kind: 'local', localId: 'y' },
    ]);
    expect(graph.resolutions.every(r => r.status === 'resolved')).toBe(true);
  });

  it('folgt keinen rlinks und löst externe URIs selbst mit Bindung nicht auf', async () => {
    const a = member('profile', 'a');
    const x = member('catalog', 'x');
    body(a).imports = [{ href: '#11111111-1111-4111-8111-111111111111', 'include-all': {} }];
    body(a)['back-matter'] = { resources: [{ uuid: '11111111-1111-4111-8111-111111111111', rlinks: [{ href: 'x.json' }] }] };
    const fetch = vi.fn();
    const xhr = vi.fn();
    const worker = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('XMLHttpRequest', xhr);
    vi.stubGlobal('Worker', worker);
    const unbound = await buildWorkspaceGraph({ members: [a, x], bindings: [] });
    expect(unbound.edges.find(e => e.kind === 'profile-import')).toMatchObject({ state: 'not-evaluable' });
    body(a).imports = [{ href: 'https://example.invalid/private', 'include-all': {} }];
    const external = await buildWorkspaceGraph({ members: [a, x], bindings: [bind(a, '/profile/imports/0/href', x)] });
    expect(external.edges.find(e => e.kind === 'profile-import')).toMatchObject({ state: 'external' });
    expect(fetch).not.toHaveBeenCalled();
    expect(xhr).not.toHaveBeenCalled();
    expect(worker).not.toHaveBeenCalled();
  });

  it('unterscheidet fehlenden Quellbezug, falschen Root und eine veraltete Bindung', async () => {
    const a = member('profile', 'a');
    const s = member('system-security-plan', 's');
    body(a).imports = [{ 'include-all': {} }];
    const missing = await buildWorkspaceGraph({ members: [a] });
    expect(missing.edges[0]).toMatchObject({ state: 'missing-source', diagnostic: { code: 'OSCAL_GRAPH_IMPORT_SOURCE_MISSING', stage: 'oscal-constraint' } });
    body(a).imports = [{ href: 'source.json', 'include-all': {} }];
    const binding = bind(a, '/profile/imports/0/href', s);
    const mismatch = await buildWorkspaceGraph({ members: [a, s], bindings: [binding] });
    expect(mismatch.edges[0]).toMatchObject({ state: 'error', diagnostic: { code: 'OSCAL_GRAPH_ROOT_TYPE_MISMATCH' } });
    const stale = await buildWorkspaceGraph({ members: [a, s], bindings: [{ ...binding, href: 'old.json' }] });
    expect(stale.edges[0]).toMatchObject({ state: 'error', diagnostic: { code: 'OSCAL_WORKSPACE_BINDING_STALE', path: '/profile/imports/0/href' } });
    expect(JSON.stringify(stale.diagnostics)).not.toContain('old.json');
    const unbound = await buildWorkspaceGraph({ members: [a, s], bindings: [] });
    expect(unbound.edges[0]).toEqual({ kind: 'profile-import', from: expect.anything(), path: '/profile/imports/0/href', state: 'not-evaluable' });
  });

  it('meldet eine veraltete Baseline-Bindung als Fehler statt als fehlenden Kontext', async () => {
    const profile = member('profile', 'p');
    const catalog = member('catalog', 'c');
    const binding = bind(profile, '/profile/imports/0/href', catalog);
    const graph = await buildWorkspaceGraph({ members: [profile, catalog], bindings: [{ ...binding, href: 'before-edit.json' }] });
    expect(graph.resolutions[0]).toMatchObject({ status: 'error', diagnostic: { code: 'OSCAL_WORKSPACE_BINDING_STALE' } });
  });

  it.each(['profile', 'component-definition', 'system-security-plan'] as const)('markiert deterministische %s-Zyklen', async root => {
    const a = member(root, 'a');
    const b = member(root, 'b');
    let pointer: string;
    if (root === 'profile') {
      pointer = '/profile/imports/0/href';
    } else if (root === 'component-definition') {
      pointer = '/component-definition/import-component-definitions/0/href';
      body(a)['import-component-definitions'] = [{ href: 'b.json' }];
      body(b)['import-component-definitions'] = [{ href: 'a.json' }];
    } else {
      pointer = '/system-security-plan/system-implementation/leveraged-authorizations/0/links/0/href';
      for (const document of [a, b]) {
        (body(document)['system-implementation'] as Record<string, unknown>)['leveraged-authorizations'] = [
          { links: [{ rel: 'system-security-plan', href: 'other.json' }] },
        ];
      }
    }
    const bindings = [bind(a, pointer, b), bind(b, pointer, a)];
    const graph = await buildWorkspaceGraph({ members: [b, a], bindings });
    const cycles = graph.edges.filter(e => e.diagnostic?.code === 'OSCAL_GRAPH_IMPORT_CYCLE');
    expect(cycles).toHaveLength(1);
    expect(cycles[0].from.document).toEqual({ kind: 'local', localId: 'b' });
    if (root === 'profile') {
      expect(graph.resolutions.every(r => r.status !== 'resolved' && r.diagnostic?.code === 'PROFILE_RESOLUTION_CYCLE')).toBe(true);
    }
  });

  it('weist gemischte Verbünde und mapping-collection ab', async () => {
    const a = member('catalog', 'a');
    const b = { ...member('catalog', 'b'), verbundId: 'other' as VerbundId };
    expect((await buildWorkspaceGraph({ members: [a, b] })).diagnostics[0].code).toBe('OSCAL_WORKSPACE_VERBUND_MISMATCH');
    expect((await buildWorkspaceGraph({ members: [member('mapping-collection', 'm')] })).diagnostics[0].code).toBe('OSCAL_WORKSPACE_ROOT_NOT_ALLOWED');
  });

  it('erhält source nach Graph und Resolution im Round-trip', async () => {
    const a = member('profile', 'a');
    const c = member('catalog', 'c');
    const before = JSON.stringify([a, c]);
    const graph = await buildWorkspaceGraph({ members: [a, c], bindings: [bind(a, '/profile/imports/0/href', c)] });
    expect(graph.resolutions[0]).toMatchObject({ status: 'resolved', derived: true, transient: true, specificationStatus: 'work-in-progress' });
    expect(JSON.stringify([a, c])).toBe(before);
    for (const m of [a, c]) {
      expect((await runNoOpRoundTrip({ fixtureText: JSON.stringify(m.source) })).graph.status).toBe('passed');
    }
  });
});
