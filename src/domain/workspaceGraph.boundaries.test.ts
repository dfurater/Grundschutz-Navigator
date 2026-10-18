import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildWorkspaceGraph } from '@/domain/workspaceGraph';
import { bind, body, member } from '@/test/fixtures/workspaceGraph';
import type { WorkspaceClass1Artifact } from '@/domain/workspaceGraphModel';
import type { WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { runNoOpRoundTrip } from '@/test/oscalRoundTrip';

afterEach(() => vi.restoreAllMocks());

const class1 = (): WorkspaceClass1Artifact => ({
  artifactKey: 'catalog-gspp',
  lifecycle: 'supported',
  trustClass: 'class-1-verified-public',
  rootType: 'catalog',
  oscalVersion: '1.1.3',
  source: makeSchemaValidOscalDocument('catalog', '1.1.3'),
});

describe('Verbundgraph: Grenzen und Orakel', () => {
  it('bildet die acht Dokumentkanten ohne Phantomkanten', async () => {
    const c = member('catalog', 'c');
    const p = member('profile', 'p');
    const s = member('system-security-plan', 's');
    const cd = member('component-definition', 'cd');
    const second = member('component-definition', 'second');
    const leveraged = member('system-security-plan', 'leveraged');
    const ap = member('assessment-plan', 'ap');
    const ar = member('assessment-results', 'ar');
    const poam = member('plan-of-action-and-milestones', 'poam');
    body(cd)['import-component-definitions'] = [{ href: 'second.json' }];
    (body(cd).components as Record<string, unknown>[])[0]['control-implementations'] = [{
      uuid: '11111111-1111-4111-8111-111111111112',
      source: 'catalog.json',
      description: 'Synthetic',
      'implemented-requirements': [{ uuid: '11111111-1111-4111-8111-111111111113', 'control-id': 'ac-1', description: 'Synthetic' }],
    }];
    (body(s)['system-implementation'] as Record<string, unknown>)['leveraged-authorizations'] = [
      { links: [{ rel: 'system-security-plan', href: 'leveraged.json' }, { rel: 'other', href: 'ignored' }] },
    ];
    body(poam)['import-ssp'] = { href: 'ssp.json' };
    const bindings = [
      bind(p, '/profile/imports/0/href', c),
      bind(s, '/system-security-plan/import-profile/href', p),
      bind(s, '/system-security-plan/system-implementation/leveraged-authorizations/0/links/0/href', leveraged),
      bind(cd, '/component-definition/components/0/control-implementations/0/source', c),
      bind(cd, '/component-definition/import-component-definitions/0/href', second),
      bind(ap, '/assessment-plan/import-ssp/href', s),
      bind(ar, '/assessment-results/import-ap/href', ap),
      bind(poam, '/plan-of-action-and-milestones/import-ssp/href', s),
    ];
    const members = [c, p, s, cd, second, leveraged, ap, ar, poam];
    const before = JSON.stringify(members);
    const graph = await buildWorkspaceGraph({ members, bindings });
    const kinds = ['profile-import', 'ssp-import-profile', 'ssp-leveraged-authorization', 'component-source', 'component-import', 'ap-import-ssp', 'ar-import-ap', 'poam-import-ssp'];
    const resolvedKinds = new Set(graph.edges.filter(e => kinds.includes(e.kind) && e.state === 'resolved').map(e => e.kind));
    expect([...resolvedKinds].sort()).toEqual(kinds.sort());
    expect(graph.edges.some(e => e.path.includes('import-ar'))).toBe(false);
    expect(graph.edges.filter(e => e.kind === 'ssp-leveraged-authorization')).toHaveLength(1);
    expect(JSON.stringify(members)).toBe(before);
    for (const m of members) {
      expect((await runNoOpRoundTrip({ fixtureText: JSON.stringify(m.source) })).graph.status).toBe('passed');
    }
  });

  it('hält Klasse-1-Bytes außerhalb von Mitgliedern und Bindungen', async () => {
    const p = member('profile', 'p', '1.1.3');
    const artifact = class1();
    ((artifact.source as Record<string, Record<string, unknown>>).catalog.metadata as Record<string, unknown>).title = 'CLASS_ONE_SENTINEL';
    const binding: WorkspaceBinding = {
      fromLocalId: p.localId,
      pointer: '/profile/imports/0/href',
      href: (body(p).imports as { href: string }[])[0].href,
      target: { kind: 'class-1', artifactKey: 'catalog-gspp' },
    };
    const before = JSON.stringify({ members: [p], bindings: [binding] });
    const graph = await buildWorkspaceGraph({ members: [p], bindings: [binding], class1Artifacts: [artifact] });
    expect(graph.resolutions[0].status).toBe('resolved');
    expect(JSON.stringify({ members: [p], bindings: [binding] })).toBe(before);
    expect(before).not.toContain('CLASS_ONE_SENTINEL');
    expect(graph.members).toHaveLength(1);
  });

  it('löst leere Ressourcen auf und erhält resource-fragment und Provenienz', async () => {
    const c = member('catalog', 'c');
    body(c)['back-matter'] = { resources: [{ uuid: '11111111-1111-4111-8111-111111111111' }] };
    const metadata = body(c).metadata as Record<string, unknown>;
    metadata.links = [
      { href: '#11111111-1111-4111-8111-111111111111', 'resource-fragment': 'private-fragment' },
      { rel: 'source-profile', href: 'private-provenance' },
    ];
    const before = JSON.stringify(c.source);
    const graph = await buildWorkspaceGraph({ members: [c] });
    expect(graph.edges).toHaveLength(1);
    expect(graph.edges[0].state).toBe('resolved-empty');
    expect(JSON.stringify(c.source)).toBe(before);
  });

  it('unterscheidet fehlende und mehrdeutige interne Ressourcen', async () => {
    const c = member('catalog', 'c');
    (body(c).metadata as Record<string, unknown>).links = [{ href: '#11111111-1111-4111-8111-111111111111' }];
    expect((await buildWorkspaceGraph({ members: [c] })).edges[0].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_NOT_FOUND');
    body(c)['back-matter'] = { resources: [{ uuid: '11111111-1111-4111-8111-111111111111' }, { uuid: '11111111-1111-4111-8111-111111111111' }] };
    expect((await buildWorkspaceGraph({ members: [c] })).edges[0].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_AMBIGUOUS');
  });

  it('lehnt widersprüchliche und fehlende Bindungsziele ab', async () => {
    const p = member('profile', 'p');
    const c = member('catalog', 'c');
    const binding = bind(p, '/profile/imports/0/href', c);
    expect((await buildWorkspaceGraph({ members: [p], bindings: [binding] })).edges[0].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_NOT_FOUND');
    expect((await buildWorkspaceGraph({ members: [p, c], bindings: [binding, binding] })).edges[0].diagnostic?.code).toBe('OSCAL_WORKSPACE_BINDING_AMBIGUOUS');
  });

  it('verwendet group/@id nicht als dokumentübergreifenden Schlüssel', async () => {
    const left = member('catalog', 'left');
    const right = member('catalog', 'right');
    delete body(left).controls;
    delete body(right).controls;
    body(left).groups = [{ id: 'same', title: 'Left', controls: [{ id: 'left-control', title: 'Left' }] }];
    body(right).groups = [{ id: 'same', title: 'Right', controls: [{ id: 'right-control', title: 'Right' }] }];
    const ssp = member('system-security-plan', 'ssp');
    body(ssp)['import-profile'] = { href: 'left.json' };
    body(ssp)['control-implementation'] = { description: 'Synthetic', 'implemented-requirements': [
      { uuid: '11111111-1111-4111-8111-111111111111', 'control-id': 'right-control' },
    ] };
    const graph = await buildWorkspaceGraph({ members: [left, right, ssp], bindings: [bind(ssp, '/system-security-plan/import-profile/href', left)] });
    const groups = graph.nodes.filter(node => node.kind === 'group' && node.localId === 'same');
    expect(groups.map(node => node.document)).toEqual([{ kind: 'local', localId: 'left' }, { kind: 'local', localId: 'right' }]);
    expect(graph.diagnostics.filter(diagnostic => diagnostic.code === 'OSCAL_GRAPH_DUPLICATE_NODE_ID')).toEqual([]);
    expect(graph.edges.find(edge => edge.kind === 'ssp-control')).toMatchObject({ state: 'error', diagnostic: { code: 'OSCAL_GRAPH_TARGET_NOT_FOUND' } });
  });

  it('gibt keine Dokumentwerte in Diagnosen oder Konsolenausgaben aus', async () => {
    const p = member('profile', 'p');
    const s = member('system-security-plan', 's');
    body(p).imports = [{ href: 'PRIVATE_SENTINEL', 'include-all': {} }];
    const meta = body(p).metadata as Record<string, unknown>;
    meta.title = 'PRIVATE_SENTINEL';
    meta.parties = [{ uuid: '11111111-1111-4111-8111-111111111111', name: 'PRIVATE_SENTINEL' }];
    const log = vi.spyOn(console, 'log');
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const graph = await buildWorkspaceGraph({ members: [p, s], bindings: [bind(p, '/profile/imports/0/href', s)] });
    expect(graph.diagnostics.length).toBeGreaterThan(0);
    expect(JSON.stringify(graph.diagnostics)).not.toContain('PRIVATE_SENTINEL');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    (m: WorkspaceEnvelope) => ({ ...m, trustClass: 'class-1-verified-public' } as unknown as WorkspaceEnvelope),
    (m: WorkspaceEnvelope) => ({ ...m, oscalVersion: '1.1.3' }),
    (m: WorkspaceEnvelope) => ({ ...m, source: { catalog: { metadata: { 'oscal-version': 'PRIVATE_SENTINEL' } } } }),
  ])('verwirft inkonsistente Eingänge redigiert', async mutate => {
    const graph = await buildWorkspaceGraph({ members: [mutate(member('catalog', 'c'))] });
    expect(graph.members).toHaveLength(0);
    expect(graph.diagnostics).not.toHaveLength(0);
    expect(JSON.stringify(graph.diagnostics)).not.toContain('PRIVATE_SENTINEL');
  });

  it('verwirft doppelte lokale Identität und nicht unterstützte Klasse-1-Quellen', async () => {
    const c = member('catalog', 'c');
    expect((await buildWorkspaceGraph({ members: [c, c] })).diagnostics[0].code).toBe('OSCAL_WORKSPACE_DOCUMENT_DUPLICATE');
    const artifact = class1();
    expect((await buildWorkspaceGraph({ members: [], class1Artifacts: [{ ...artifact, artifactKey: 'unknown' }] })).diagnostics[0].code).toBe('OSCAL_WORKSPACE_ARTIFACT_UNSUPPORTED');
    const unverified = { ...artifact, trustClass: 'class-1-unverified-public' } as unknown as WorkspaceClass1Artifact;
    expect((await buildWorkspaceGraph({ members: [], class1Artifacts: [unverified] })).diagnostics[0].code).toBe('OSCAL_WORKSPACE_ARTIFACT_UNSUPPORTED');
  });
});
