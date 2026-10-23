import { describe, expect, it } from 'vitest';
import { deriveStationMetrics } from '@/domain/verbundStationMetrics';
import type { WorkspaceClass1Artifact, WorkspaceGraphEdge, WorkspaceProfileResolution } from '@/domain/workspaceGraphModel';
import type { LocalId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { makeFullPoam } from '@/test/fixtures/poams';

const NOW = new Date('2026-10-22T00:00:00Z');

function member(localId: string, rootType: WorkspaceEnvelope['rootType'], body: unknown): WorkspaceEnvelope {
  return { localId, rootType, source: { [rootType]: body }, trustClass: 'class-2-local-user' } as unknown as WorkspaceEnvelope;
}
const local = (localId: string) => ({ kind: 'local', localId: localId as LocalId }) as const;
const controls = (...ids: string[]) => ({ catalog: { controls: ids.map((id) => ({ id })) } });
function edge(kind: WorkspaceGraphEdge['kind'], from: string, path: string, to?: WorkspaceGraphEdge['to'], state: WorkspaceGraphEdge['state'] = 'resolved'): WorkspaceGraphEdge {
  return { kind, from: { document: local(from), kind: 'artifact', localId: null }, path, state, ...(to ? { to } : {}) };
}
const artifact = (document: WorkspaceGraphEdge['from']['document']) => ({ document, kind: 'artifact' as const, localId: null });
const resolution = (localId: string, source: unknown): WorkspaceProfileResolution => ({
  document: local(localId), status: 'resolved', derived: true, transient: true, specificationStatus: 'work-in-progress', source,
});
const bsi = { artifactKey: 'gspp', lifecycle: 'supported', trustClass: 'class-1-verified-public', rootType: 'catalog', oscalVersion: '1.1.3', source: controls('a', 'b', 'c', 'd') } as WorkspaceClass1Artifact;
const BSI_KEY = { kind: 'class-1', artifactKey: 'gspp', lifecycle: 'supported' } as const;
const requirement = (index: number) => `/system-security-plan/control-implementation/implemented-requirements/${index}/control-id`;

describe('deriveStationMetrics', () => {
  it('zählt aufgenommene, dokumentierte und geprüfte Controls aus Graph und Quellen', () => {
    const members = [
      member('profile', 'profile', {}),
      member('ssp', 'system-security-plan', {}),
      member('ar', 'assessment-results', { results: [{ findings: [
        { target: { status: { state: 'satisfied' } } },
        { target: { status: { state: 'not-satisfied' } } },
        { target: { status: { state: 'not-satisfied' } } },
        { target: {} },
      ] }] }),
    ];
    const edges = [
      edge('profile-import', 'profile', '/profile/imports/0/href', artifact(BSI_KEY)),
      edge('ssp-import-profile', 'ssp', '/system-security-plan/import-profile/href', artifact(local('profile'))),
      edge('ssp-control', 'ssp', requirement(0), { document: local('profile'), kind: 'control', localId: 'a' }),
      edge('ssp-control', 'ssp', requirement(1), { document: local('profile'), kind: 'control', localId: 'a' }),
      edge('ssp-control', 'ssp', requirement(2), undefined, 'error'),
      edge('ssp-statement', 'ssp', `${requirement(0).slice(0, -'/control-id'.length)}/statements/0/statement-id`, { document: local('profile'), kind: 'statement', localId: 'a_smt' }),
    ];
    const metrics = deriveStationMetrics(members, { edges, resolutions: [resolution('profile', controls('a', 'b'))] }, [bsi], NOW);
    expect(metrics.catalogControls).toBe(4);
    expect(metrics.documents.get('profile' as LocalId)).toEqual({ kind: 'profile', included: 2, available: 4 });
    expect(metrics.documents.get('ssp' as LocalId)).toEqual({ kind: 'ssp', documented: 1, baseline: 2 });
    expect(metrics.documents.get('ar' as LocalId)).toEqual({ kind: 'assessment-results', assessed: 3, notSatisfied: 2 });
  });

  it('lässt eine Kennzahl ohne Grundlage weg, statt sie zu schätzen', () => {
    const members = [member('profile', 'profile', {}), member('ssp', 'system-security-plan', {}), member('cd', 'component-definition', {})];
    const edges = [
      edge('profile-import', 'profile', '/profile/imports/0/href', undefined, 'external'),
      edge('ssp-import-profile', 'ssp', '/system-security-plan/import-profile/href', artifact(local('profile'))),
    ];
    const metrics = deriveStationMetrics(members, { edges, resolutions: [] }, [bsi, { ...bsi, artifactKey: 'zweiter' }], NOW);
    expect(metrics.catalogControls).toBeUndefined();
    expect(metrics.documents.size).toBe(0);
  });

  it('zählt offene und überfällige Maßnahmen über die Fristableitung; ein unlesbarer Entwurf hat keine Zahl', () => {
    const members = [member('poam', 'plan-of-action-and-milestones', {})];
    members[0] = { ...members[0], source: makeFullPoam() };
    const broken = member('kaputt', 'plan-of-action-and-milestones', 'kein Objekt');
    const graph = { edges: [], resolutions: [] };
    expect(deriveStationMetrics(members, graph, [], NOW).documents.get('poam' as LocalId)).toEqual({ kind: 'poam', open: 1, overdue: 0 });
    expect(deriveStationMetrics(members, graph, [], new Date('2027-01-01T00:00:00Z')).documents.get('poam' as LocalId)).toEqual({ kind: 'poam', open: 1, overdue: 1 });
    expect(deriveStationMetrics([broken], graph, [], NOW).documents.size).toBe(0);
  });
});
