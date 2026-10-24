import { describe, expect, it, vi } from 'vitest';
import { loadAssessmentResults } from '@/features/workspace/assessment/loadAssessmentResults';
import { AR_UUIDS, makeFullAssessmentResults, makeBoundAssessmentPlanSource } from '@/test/fixtures/assessmentResults';
import { makeFullSsp, SSP_FIXTURE_IDS } from '@/test/fixtures/systemSecurityPlans';
import type { LocalId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import type { VerbundView, WorkspaceEdgeView } from '@/state/workspaceVerbundView';

const localId = 'ar' as LocalId;
function fixture() {
  const source = makeFullAssessmentResults();
  source['assessment-results'].results[0].findings[0]['implementation-statement-uuid'] = SSP_FIXTURE_IDS.statement as typeof AR_UUIDS.statement;
  const make = (id: string, rootType: WorkspaceEnvelope['rootType'], source: unknown) => ({
    localId: id as LocalId, verbundId: 'v', rootType, source, trustClass: 'class-2-local-user', savedAt: 'now',
  }) as WorkspaceEnvelope;
  const members = [make('ar', 'assessment-results', source), make('ap', 'assessment-plan', makeBoundAssessmentPlanSource()), make('ssp', 'system-security-plan', makeFullSsp())];
  const edges = new Map<LocalId, WorkspaceEdgeView[]>([
    [localId, [{ kind: 'ar-import-ap', path: '/assessment-results/import-ap/href', href: 'ap.json', state: 'resolved', targetLocalId: 'ap' as LocalId }]],
    ['ap' as LocalId, [{ kind: 'ap-import-ssp', path: '/assessment-plan/import-ssp/href', href: 'ssp.json', state: 'resolved', targetLocalId: 'ssp' as LocalId }]],
  ]);
  const view = { verbund: { verbundId: 'v' }, documents: members, edges } as unknown as VerbundView;
  const getDocument = vi.fn(async (id: LocalId) => ({ ok: true as const, value: members.find(m => m.localId === id) }));
  return { source, members, view, getDocument, edges };
}

describe('Results-Kontext bleibt im lokalen Verbund', () => {
  it('bindet ausschließlich AR→AP→SSP und nutzt Resolverpfade für Urhebernamen', async () => {
    const f = fixture();
    const loaded = await loadAssessmentResults({ getDocument: f.getDocument }, f.view, localId);
    expect(loaded.model.importAp?.status).toBe('bound');
    expect(loaded.model.results[0].findings[0].implementationStatement?.status).toBe('resolved');
    expect(loaded.actorNames.get('/assessment-results/results/0/observations/0/origins/0/actors/0')).toBe('Prüferin');
    expect(loaded.evidenceDescriptions.get('/assessment-results/results/0/observations/0/relevant-evidence/0')).toBe('Protokoll');
    expect(f.getDocument.mock.calls.map(([id]) => id)).toEqual(['ar', 'ap', 'ssp']);
    expect(f.members[0].source).toEqual(f.source);
  });
  it.each(['external', 'error', 'not-evaluable'] as const)('übergibt bei %s keinen beliebigen Plan aus demselben Verbund', async state => {
    const f = fixture();
    f.edges.set(localId, [{ ...f.edges.get(localId)![0], state }]);
    const loaded = await loadAssessmentResults({ getDocument: f.getDocument }, f.view, localId);
    expect(loaded.model.importAp?.status).toBe('not-resolvable-in-context');
    expect(f.getDocument).toHaveBeenCalledTimes(1);
  });
  it('nutzt keine Bindung für einen inzwischen geänderten href', async () => {
    const f = fixture();
    f.source['assessment-results']['import-ap'].href = 'other.json';
    const loaded = await loadAssessmentResults({ getDocument: f.getDocument }, f.view, localId);
    expect(loaded.model.importAp?.status).toBe('not-resolvable-in-context');
    expect(f.getDocument).toHaveBeenCalledTimes(1);
  });
  it('reicht ohne Planbindung auch kein SSP weiter', async () => {
    const f = fixture();
    f.edges.delete(localId);
    const loaded = await loadAssessmentResults({ getDocument: f.getDocument }, f.view, localId);
    expect(loaded.model.results[0].findings[0].implementationStatement?.status).toBe('not-resolvable-in-context');
  });
  it.each(['wrong-root', 'foreign-verbund', 'missing'] as const)('verwirft %s als Plankontext', async kind => {
    const f = fixture();
    if (kind === 'wrong-root') f.members[1] = { ...f.members[1], rootType: 'system-security-plan' };
    if (kind === 'foreign-verbund') f.members[1] = { ...f.members[1], verbundId: 'other' as WorkspaceEnvelope['verbundId'] };
    if (kind === 'missing') f.members.splice(1, 1);
    const loaded = await loadAssessmentResults({ getDocument: f.getDocument }, f.view, localId);
    expect(loaded.model.importAp?.status).toBe('not-resolvable-in-context');
  });
  it('zeigt bei einem Speicherfehler keine vermeintlich vollständige Ansicht', async () => {
    const f = fixture();
    f.getDocument.mockRejectedValueOnce(new Error('private details'));
    await expect(loadAssessmentResults({ getDocument: f.getDocument }, f.view, localId)).rejects.toThrow();
  });
});
