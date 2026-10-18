import { describe, expect, it, vi } from 'vitest';
import { buildWorkspaceGraph, type WorkspaceClass1Artifact } from '@/domain/workspaceGraph';
import { member, body } from '@/test/fixtures/workspaceGraph';

vi.mock('@/domain/sourceRegistry', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domain/sourceRegistry')>();
  return { ...actual, SOURCE_REGISTRY: actual.SOURCE_REGISTRY.map(entry => entry.artifactKey === 'profile-gspp' ? { ...entry, lifecycle: 'supported' } : entry) };
});

function artifacts(): [WorkspaceClass1Artifact, WorkspaceClass1Artifact] {
  const catalog = member('catalog', 'catalog', '1.1.3');
  const profile = member('profile', 'profile', '1.1.3');
  body(profile).imports = [{ href: 'catalog.json', 'include-all': {} }];
  return [
    { artifactKey: 'profile-gspp', lifecycle: 'supported', trustClass: 'class-1-verified-public', rootType: 'profile', oscalVersion: '1.1.3', source: profile.source, bindings: [{ pointer: '/profile/imports/0/href', href: 'catalog.json', artifactKey: 'catalog-gspp' }] },
    { artifactKey: 'catalog-gspp', lifecycle: 'supported', trustClass: 'class-1-verified-public', rootType: 'catalog', oscalVersion: '1.1.3', source: catalog.source },
  ];
}

describe('preloaded class-1 profile dependency bindings', () => {
  it('resolves local and preloaded class-1 profiles unter simuliertem supported-Registereintrag without source mutation', async () => {
    const [profile, catalog] = artifacts();
    const local = member('profile', 'local', '1.1.3');
    body(local).imports = [{ href: 'public-profile.json', 'include-all': {} }];
    const before = structuredClone([local.source, profile.source, catalog.source]);
    const graph = await buildWorkspaceGraph({ members: [local], class1Artifacts: [profile, catalog], bindings: [{ fromLocalId: local.localId, pointer: '/profile/imports/0/href', href: 'public-profile.json', target: { kind: 'class-1', artifactKey: 'profile-gspp' } }] });
    expect(graph.edges.filter(edge => edge.kind === 'profile-import').map(edge => edge.state)).toEqual(['resolved', 'resolved']);
    expect(graph.resolutions.map(resolution => resolution.status)).toEqual(['resolved', 'resolved']);
    expect([local.source, profile.source, catalog.source]).toEqual(before);
  });
  it('leaves unbound class-1 imports not evaluable', async () => {
    const [profile, catalog] = artifacts();
    const graph = await buildWorkspaceGraph({ members: [], class1Artifacts: [{ ...profile, bindings: undefined }, catalog] });
    expect(graph.edges.find(edge => edge.kind === 'profile-import')?.state).toBe('not-evaluable');
    expect(graph.resolutions[0].status).toBe('not-evaluable');
  });
  it('reports stale class-1 dependency bindings as reference errors', async () => {
    const [profile, catalog] = artifacts();
    const bindings = [{ pointer: '/profile/imports/0/href', href: 'stale.json', artifactKey: 'catalog-gspp' }];
    const graph = await buildWorkspaceGraph({ members: [], class1Artifacts: [{ ...profile, bindings }, catalog] });
    expect(graph.edges.find(edge => edge.kind === 'profile-import')).toMatchObject({ state: 'error', diagnostic: { code: 'OSCAL_WORKSPACE_BINDING_STALE' } });
    expect(graph.resolutions[0]).toMatchObject({ status: 'error', diagnostic: { code: 'OSCAL_WORKSPACE_BINDING_STALE' } });
  });
  it('does not fall back from an absent class-1 target to a local member', async () => {
    const [profile] = artifacts();
    const local = member('catalog', 'catalog-gspp', '1.1.3');
    const graph = await buildWorkspaceGraph({ members: [local], class1Artifacts: [profile] });
    expect(graph.edges.find(edge => edge.kind === 'profile-import')).toMatchObject({ state: 'error', diagnostic: { code: 'OSCAL_GRAPH_TARGET_NOT_FOUND' } });
  });
  it('rejects class-1 versions that differ from their registry pin', async () => {
    const [profile] = artifacts();
    const wrong = member('profile', 'wrong', '1.2.2');
    const graph = await buildWorkspaceGraph({ members: [], class1Artifacts: [{ ...profile, oscalVersion: '1.2.2', source: wrong.source }] });
    expect(graph.diagnostics[0].code).toBe('OSCAL_WORKSPACE_ARTIFACT_UNSUPPORTED');
    expect(graph.nodes).toEqual([]);
  });
  it('rejects the real preview profile-wlan registry entry', async () => {
    const [profile] = artifacts();
    const graph = await buildWorkspaceGraph({ members: [], class1Artifacts: [{ ...profile, artifactKey: 'profile-wlan' }] });
    expect(graph.diagnostics[0].code).toBe('OSCAL_WORKSPACE_ARTIFACT_UNSUPPORTED');
    expect(graph.nodes).toEqual([]);
  });
});
