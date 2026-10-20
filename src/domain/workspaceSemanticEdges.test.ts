import { describe, expect, it, vi } from 'vitest';
import * as catalogProjection from '@/domain/workspaceCatalog';
import { deriveWorkspaceSemanticEdges } from '@/domain/workspaceSemanticEdges';
import type { WorkspaceGraphDocument, WorkspaceGraphEdge } from '@/domain/workspaceGraphModel';
import type { LocalId } from '@/domain/workspaceModel';

function doc(id: string, rootType: WorkspaceGraphDocument['rootType'], body: unknown): WorkspaceGraphDocument {
  return { key: { kind: 'local', localId: id as LocalId }, rootType, source: { [rootType]: body }, oscalVersion: '1.1.3', trustClass: 'class-2-local-user' };
}
function binding(from: WorkspaceGraphDocument, to: WorkspaceGraphDocument, kind: WorkspaceGraphEdge['kind'], path: string): WorkspaceGraphEdge {
  return { kind, from: { document: from.key, kind: 'artifact', localId: null }, to: { document: to.key, kind: 'artifact', localId: null }, path, state: 'resolved' };
}
const ssp = (id: string) => doc(id, 'system-security-plan', { 'control-implementation': { 'implemented-requirements': [{ 'control-id': 'same', statements: [{ 'statement-id': 'statement' }] }] } });

describe('deriveWorkspaceSemanticEdges', () => {
  it('matches component UUID casing while retaining original target and source values', () => {
    const uuid = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA';
    const component = doc('component', 'component-definition', { components: [{ uuid }], capabilities: [{ 'incorporates-components': [{ 'component-uuid': uuid.toLowerCase() }] }] });
    const before = structuredClone(component.source);
    const resolved = deriveWorkspaceSemanticEdges([component], [], []);
    expect(resolved[0]).toMatchObject({ state: 'resolved', to: { localId: uuid } });
    expect(component.source).toEqual(before);
    (component.source as { 'component-definition': { components: { uuid: string }[] } })['component-definition'].components.push({ uuid: uuid.toLowerCase() });
    expect(deriveWorkspaceSemanticEdges([component], [], [])[0].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_AMBIGUOUS');
  });
  it('indexes statement IDs once per graph instead of rescanning arrays for each reference', () => {
    const statementIds = ['statement'];
    const includes = vi.spyOn(statementIds, 'includes');
    const iterator = vi.spyOn(statementIds, Symbol.iterator);
    const projection = vi.spyOn(catalogProjection, 'buildWorkspaceCatalog').mockReturnValue({ status: 'success', catalog: { controlsById: new Map([['same', { id: 'same', statementIds }]]) } });
    try {
      const catalog = doc('catalog', 'catalog', {});
      const x = doc('x', 'system-security-plan', { 'control-implementation': { 'implemented-requirements': [{ 'control-id': 'same', statements: Array.from({ length: 100 }, () => ({ 'statement-id': 'statement' })) }] } });
      const result = deriveWorkspaceSemanticEdges([x, catalog], [binding(x, catalog, 'ssp-import-profile', '/system-security-plan/import-profile/href')], []);
      expect(result.every(edge => edge.state === 'resolved')).toBe(true);
      expect(includes).not.toHaveBeenCalled();
      expect(iterator).toHaveBeenCalledTimes(1);
    } finally { projection.mockRestore(); iterator.mockRestore(); includes.mockRestore(); }
  });
  it('propagates bound context errors to dependent control and statement edges', () => {
    const x = ssp('x'); const catalog = doc('catalog', 'catalog', {});
    const context: WorkspaceGraphEdge = { ...binding(x, catalog, 'ssp-import-profile', '/system-security-plan/import-profile/href'), state: 'error' };
    expect(deriveWorkspaceSemanticEdges([x, catalog], [context], []).map(edge => edge.state)).toEqual(['error', 'error']);
  });
  it('projects a shared baseline once per invocation and recomputes after source changes', () => {
    const projection = vi.spyOn(catalogProjection, 'buildWorkspaceCatalog');
    try {
      const catalog = doc('catalog', 'catalog', { controls: [{ id: 'same' }] });
      const implementations = Array.from({ length: 100 }, () => ({ source: 'catalog', 'implemented-requirements': [{ 'control-id': 'same' }] }));
      const component = doc('component', 'component-definition', { components: [{ 'control-implementations': implementations }] });
      const bindings = implementations.map((_, index) => binding(component, catalog, 'component-source', `/component-definition/components/0/control-implementations/${index}/source`));
      const first = deriveWorkspaceSemanticEdges([component, catalog], bindings, []);
      expect(first).toHaveLength(100);
      expect(first.every(edge => edge.state === 'resolved')).toBe(true);
      expect(projection).toHaveBeenCalledTimes(1);
      (catalog.source as { catalog: { controls: unknown[] } }).catalog.controls = [];
      const second = deriveWorkspaceSemanticEdges([component, catalog], bindings, []);
      expect(second.every(edge => edge.state === 'error')).toBe(true);
      expect(projection).toHaveBeenCalledTimes(2);
    } finally {
      projection.mockRestore();
    }
  });
  it('scopes colliding control IDs and statements to each explicitly bound catalog', () => {
    const a = doc('a', 'catalog', { controls: [{ id: 'same', parts: [{ id: 'statement' }] }] });
    const b = doc('b', 'catalog', { controls: [{ id: 'same' }] });
    const x = ssp('x'); const y = ssp('y');
    const edges = deriveWorkspaceSemanticEdges([a, b, x, y], [binding(x, a, 'ssp-import-profile', '/system-security-plan/import-profile/href'), binding(y, b, 'ssp-import-profile', '/system-security-plan/import-profile/href')], []);
    expect(edges.map(edge => edge.state)).toEqual(['resolved', 'resolved', 'resolved', 'error']);
    expect(edges[0].to?.document).toEqual(a.key);
    expect(edges[2].to?.document).toEqual(b.key);
    expect(edges[3].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_NOT_FOUND');
  });
  it('keeps unbound control and statement references not evaluable', () => {
    expect(deriveWorkspaceSemanticEdges([ssp('x')], [], []).map(edge => edge.state)).toEqual(['not-evaluable', 'not-evaluable']);
  });
  it('fails closed when the bound catalog contains ambiguous statements', () => {
    const catalog = doc('c', 'catalog', { controls: [{ id: 'same', parts: [{ id: 'statement' }, { id: 'statement' }] }] });
    const x = ssp('x');
    const edges = deriveWorkspaceSemanticEdges([x, catalog], [binding(x, catalog, 'ssp-import-profile', '/system-security-plan/import-profile/href')], []);
    expect(edges[1].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_AMBIGUOUS');
    expect(JSON.stringify(edges[1].diagnostic)).not.toContain('statement"');
  });
  it('diagnoses ambiguous controls without leaking IDs and ignores statements in another control', () => {
    const x = ssp('x');
    const duplicate = doc('duplicate', 'catalog', { controls: [{ id: 'same' }, { id: 'same' }] });
    const duplicateEdges = deriveWorkspaceSemanticEdges([x, duplicate], [binding(x, duplicate, 'ssp-import-profile', '/system-security-plan/import-profile/href')], []);
    expect(duplicateEdges[0].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_AMBIGUOUS');
    expect(duplicateEdges[0].diagnostic?.artifact.key).toBeNull();
    const scoped = doc('scoped', 'catalog', { controls: [{ id: 'same' }, { id: 'other', parts: [{ id: 'statement' }] }] });
    const scopedEdges = deriveWorkspaceSemanticEdges([x, scoped], [binding(x, scoped, 'ssp-import-profile', '/system-security-plan/import-profile/href')], []);
    expect(scopedEdges.map(edge => edge.state)).toEqual(['resolved', 'error']);
  });
  it('uses transient profile catalogs with the profile document identity', () => {
    const profile = doc('p', 'profile', {}); const x = ssp('x');
    const edges = deriveWorkspaceSemanticEdges([x, profile], [binding(x, profile, 'ssp-import-profile', '/system-security-plan/import-profile/href')], [{ document: profile.key, status: 'resolved', derived: true, transient: true, specificationStatus: 'work-in-progress', source: { catalog: { controls: [{ id: 'same', parts: [{ id: 'statement' }] }] } } }]);
    expect(edges.map(edge => edge.state)).toEqual(['resolved', 'resolved']);
    expect(edges[0].to?.document).toEqual(profile.key);
  });
  it('uses component implementation source pointers and explicit component import closures', () => {
    const c = doc('c', 'catalog', { controls: [{ id: 'same' }] });
    const a = doc('a', 'component-definition', { components: [{ uuid: 'own', 'control-implementations': [{ source: 'catalog', 'implemented-requirements': [{ 'control-id': 'same' }] }] }], capabilities: [{ 'incorporates-components': [{ 'component-uuid': 'remote' }] }], 'import-component-definitions': [{ href: 'remote' }] });
    const b = doc('b', 'component-definition', { components: [{ uuid: 'remote' }] });
    const source = binding(a, c, 'component-source', '/component-definition/components/0/control-implementations/0/source');
    expect(deriveWorkspaceSemanticEdges([a, b, c], [source], []).map(edge => edge.state)).toEqual(['resolved', 'not-evaluable']);
    const imported = binding(a, b, 'component-import', '/component-definition/import-component-definitions/0/href');
    expect(deriveWorkspaceSemanticEdges([a, b, c], [source, imported], []).map(edge => edge.state)).toEqual(['resolved', 'resolved']);
    const missing = doc('missing', 'component-definition', { capabilities: [{ 'incorporates-components': [{ 'component-uuid': 'absent' }] }] });
    expect(deriveWorkspaceSemanticEdges([missing], [], [])[0].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_NOT_FOUND');
  });
  it('terminates cyclic component imports and diagnoses duplicate reachable components', () => {
    const a = doc('a', 'component-definition', { components: [{ uuid: 'duplicate' }], capabilities: [{ 'incorporates-components': [{ 'component-uuid': 'duplicate' }] }], 'import-component-definitions': [{ href: 'b' }] });
    const b = doc('b', 'component-definition', { components: [{ uuid: 'duplicate' }], 'import-component-definitions': [{ href: 'a' }] });
    const imports = [binding(a, b, 'component-import', '/component-definition/import-component-definitions/0/href'), binding(b, a, 'component-import', '/component-definition/import-component-definitions/0/href')];
    const before = structuredClone([a, b]);
    const edges = deriveWorkspaceSemanticEdges([a, b], imports, []);
    expect(edges[0].diagnostic?.code).toBe('OSCAL_GRAPH_TARGET_AMBIGUOUS');
    expect([a, b]).toEqual(before);
  });
});
