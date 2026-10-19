import { describe, expect, it, vi } from 'vitest';
import { buildWorkspaceGraph, type WorkspaceGraph, type WorkspaceNodeId } from '@/domain/workspaceGraph';
import { member, body, bind } from '@/test/fixtures/workspaceGraph';

vi.mock('@/domain/sourceRegistry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domain/sourceRegistry')>();
  return { ...actual, SOURCE_REGISTRY: actual.SOURCE_REGISTRY.map(entry => entry.artifactKey === 'profile-gspp' ? { ...entry, lifecycle: 'supported' } : entry) };
});

function nodeIdentity(node: WorkspaceNodeId): string {
  return JSON.stringify([node.document, node.kind, node.localId, node.controlId]);
}
function expectTargetsExist(graph: WorkspaceGraph): void {
  const identities = new Set(graph.nodes.map(nodeIdentity));
  for (const edge of graph.edges) {
    if (edge.state === 'resolved' || edge.state === 'resolved-empty') {
      expect(edge.to).toBeDefined();
      expect(identities.has(nodeIdentity(edge.to!)), `${edge.kind} ${edge.path}`).toBe(true);
    }
  }
}
function sspWithStatements() {
  const ssp = member('system-security-plan', 'ssp');
  body(ssp)['import-profile'] = { href: 'baseline.json' };
  body(ssp)['control-implementation'] = { description: 'Test', 'implemented-requirements': [
    { uuid: '11111111-1111-4111-8111-111111111111', 'control-id': 'a', statements: [{ uuid: '22222222-2222-4222-8222-222222222222', 'statement-id': 'part' }] },
  ] };
  return ssp;
}
function catalogWithParts() {
  const catalog = member('catalog', 'catalog');
  delete body(catalog).groups;
  body(catalog).controls = [{ id: 'a', title: 'A', parts: [{ name: 'guidance', id: 'outer', parts: [{ name: 'item', id: 'part', prose: 'Test' }] }] }];
  return catalog;
}

describe('workspace graph target nodes', () => {
  it('includes every direct catalog target, including nested parts with other names', async () => {
    const catalog = catalogWithParts();
    const ssp = sspWithStatements();
    const graph = await buildWorkspaceGraph({ members: [catalog, ssp], bindings: [bind(ssp, '/system-security-plan/import-profile/href', catalog)] });
    expect(graph.edges.find(edge => edge.kind === 'ssp-statement')).toMatchObject({ state: 'resolved' });
    expectTargetsExist(graph);
    const statements = graph.nodes.filter(node => node.kind === 'statement');
    expect(statements.map(node => [node.localId, node.controlId])).toEqual([['outer', 'a'], ['part', 'a']]);
    expect(new Set(graph.nodes.map(nodeIdentity)).size).toBe(graph.nodes.length);
  });

  it('includes derived catalog controls and statements under their profile document identity', async () => {
    const catalog = catalogWithParts();
    const profile = member('profile', 'profile');
    body(profile).imports = [{ href: 'catalog.json', 'include-all': {} }];
    const ssp = sspWithStatements();
    const graph = await buildWorkspaceGraph({ members: [catalog, profile, ssp], bindings: [
      bind(profile, '/profile/imports/0/href', catalog), bind(ssp, '/system-security-plan/import-profile/href', profile),
    ] });
    expect(graph.resolutions[0].status).toBe('resolved');
    expectTargetsExist(graph);
    expect(graph.nodes.filter(node => node.derived)).toHaveLength(3);
    expect(graph.nodes.filter(node => node.derived).every(node => node.document.kind === 'local' && node.document.localId === profile.localId && node.rootType === 'catalog' && node.trustClass === 'class-2-local-user' && node.oscalVersion === profile.oscalVersion)).toBe(true);
    expect(graph.nodes.filter(node => node.document.kind === 'local' && node.document.localId === profile.localId && node.kind === 'artifact')).toHaveLength(1);
  });

  it('keeps identical statement IDs distinct for different controls', async () => {
    const catalog = catalogWithParts();
    body(catalog).controls = ['a', 'b'].map(id => ({ id, title: id, parts: [{ name: 'statement', id: 'same', prose: 'Test' }] }));
    const ssp = sspWithStatements();
    body(ssp)['control-implementation'] = { description: 'Test', 'implemented-requirements': ['a', 'b'].map((id, index) => ({
      uuid: `11111111-1111-4111-8111-11111111111${index}`, 'control-id': id,
      statements: [{ uuid: `22222222-2222-4222-8222-22222222222${index}`, 'statement-id': 'same' }],
    })) };
    const graph = await buildWorkspaceGraph({ members: [catalog, ssp], bindings: [bind(ssp, '/system-security-plan/import-profile/href', catalog)] });
    expect(graph.edges.filter(edge => edge.kind === 'ssp-statement').map(edge => edge.to?.controlId)).toEqual(['a', 'b']);
    expect(graph.nodes.filter(node => node.kind === 'statement').map(node => [node.localId, node.controlId])).toEqual([['same', 'a'], ['same', 'b']]);
    expectTargetsExist(graph);
    expect(graph.diagnostics).toEqual([]);
  });

  it('emits no partial projection nodes when catalog identity is ambiguous', async () => {
    const catalog = catalogWithParts();
    body(catalog).controls = [{ id: 'a', title: 'A' }, { id: 'a', title: 'Duplicate' }];
    const ssp = sspWithStatements();
    const graph = await buildWorkspaceGraph({ members: [catalog, ssp], bindings: [bind(ssp, '/system-security-plan/import-profile/href', catalog)] });
    expect(graph.nodes.filter(node => node.kind === 'control' || node.kind === 'statement')).toEqual([]);
    expect(graph.diagnostics.length).toBeGreaterThan(0);
    expect(graph.edges.filter(edge => edge.kind === 'ssp-control' || edge.kind === 'ssp-statement').every(edge => edge.state === 'error')).toBe(true);
  });
  it('marks a simulated supported public-profile projection as class-2 derived data', async () => {
    const profile = member('profile', 'public-profile', '1.1.3');
    const catalog = member('catalog', 'public-catalog', '1.1.3');
    body(profile).imports = [{ href: 'catalog.json', 'include-all': {} }];
    const graph = await buildWorkspaceGraph({ members: [], class1Artifacts: [
      { artifactKey: 'profile-gspp', lifecycle: 'supported', trustClass: 'class-1-verified-public', rootType: 'profile', oscalVersion: '1.1.3', source: profile.source,
        bindings: [{ pointer: '/profile/imports/0/href', href: 'catalog.json', artifactKey: 'catalog-gspp' }] },
      { artifactKey: 'catalog-gspp', lifecycle: 'supported', trustClass: 'class-1-verified-public', rootType: 'catalog', oscalVersion: '1.1.3', source: catalog.source },
    ] });
    expect(graph.resolutions[0].status).toBe('resolved');
    const derived = graph.nodes.filter(node => node.derived);
    expect(derived.length).toBeGreaterThan(0);
    expect(derived.every(node => node.trustClass === 'class-2-local-user' && node.rootType === 'catalog' && node.oscalVersion === '1.1.3')).toBe(true);
    expect(derived.every(node => node.document.kind === 'class-1' && node.document.artifactKey === 'profile-gspp')).toBe(true);
    expectTargetsExist(graph);
  });

  it('keeps duplicate statement diagnostics within a control', async () => {
    const catalog = catalogWithParts();
    body(catalog).controls = [{ id: 'a', title: 'A', parts: [
      { name: 'statement', id: 'same', prose: 'First' }, { name: 'statement', id: 'same', prose: 'Second' },
    ] }];
    const graph = await buildWorkspaceGraph({ members: [catalog] });
    expect(graph.diagnostics.some(diagnostic => diagnostic.code === 'OSCAL_WORKSPACE_CATALOG_STATEMENT_AMBIGUOUS')).toBe(true);
    expect(graph.nodes.some(node => node.kind === 'statement')).toBe(false);
  });

  it.each(['group', 'resource', 'component'] as const)('keeps legacy %s collision diagnostics', async kind => {
    const document = member(kind === 'component' ? 'component-definition' : 'catalog', 'collision');
    if (kind === 'group') body(document).groups = [{ id: 'same', title: 'A' }, { id: 'same', title: 'B' }];
    if (kind === 'resource') body(document)['back-matter'] = { resources: [
      { uuid: 'abcdefab-cdef-4abc-8def-abcdefabcdef' }, { uuid: 'abcdefab-cdef-4abc-8def-abcdefabcdef' },
    ] };
    if (kind === 'component') {
      const components = body(document).components as unknown[];
      components.push(structuredClone(components[0]));
    }
    const graph = await buildWorkspaceGraph({ members: [document] });
    expect(graph.diagnostics.some(diagnostic => diagnostic.code === 'OSCAL_GRAPH_DUPLICATE_NODE_ID')).toBe(true);
  });

});
