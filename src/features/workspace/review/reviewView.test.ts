import { describe, expect, it } from 'vitest';
import { REVIEW_ACTIONS_SYSTEM } from '@/domain/reviewTrail';
import type {
  DocumentSnapshot,
  LocalId,
  ReviewCheckpoint,
  ReviewDecision,
  ReviewDecisionKind,
  ReviewTrailRow,
} from '@/domain/workspaceModel';
import { buildReviewView } from '@/features/workspace/review/reviewView';

function snapshot(hash: string): DocumentSnapshot {
  return {
    rootType: 'catalog',
    uuid: 'doc-1',
    lastModified: '2026-10-20T10:00:00Z',
    version: '1.0',
    oscalVersion: '1.1.3',
    contentHash: { version: 1, algorithm: 'sha-256', value: hash },
  };
}

function checkpoint(sequence = 1): ReviewCheckpoint {
  return {
    localId: `checkpoint-${sequence}` as LocalId,
    sequence,
    kind: 'checkpoint',
    createdAt: '2026-10-20T10:00:00Z',
    documentState: 'export-ready',
    stand: snapshot('baseline'),
    diff: { version: 1, baseSequence: null, entries: [], truncated: false },
  };
}

function decision(sequence: number, kind: ReviewDecisionKind, overrides: Partial<ReviewDecision> = {}): ReviewDecision {
  return {
    localId: `decision-${sequence}` as LocalId,
    sequence,
    kind: 'decision',
    createdAt: '2026-10-20T11:00:00Z',
    decision: kind,
    stand: snapshot('stand'),
    ...overrides,
  };
}

function view(trail: readonly ReviewTrailRow[], extra: { readonly metadata?: unknown; readonly nativeActionUuids?: readonly string[]; readonly editorDirty?: boolean } = {}) {
  return buildReviewView({
    trail,
    stand: snapshot('stand'),
    editorDirty: extra.editorDirty ?? false,
    metadata: extra.metadata ?? {},
    nativeActionUuids: extra.nativeActionUuids ?? [],
  });
}

describe('buildReviewView', () => {
  it('zeigt ohne Zeilen den Zustand none', () => {
    const result = view([]);
    expect(result.badge).toBe('none');
    expect(result.latestCheckpoint).toBeUndefined();
    expect(result.latestDecision).toBeUndefined();
    expect(result.findings).toEqual([]);
  });

  it('meldet eine native Freigabe ohne lokale Zeile als unverified', () => {
    const result = view([], {
      metadata: { actions: [{ uuid: 'action-1', system: REVIEW_ACTIONS_SYSTEM }] },
      nativeActionUuids: ['action-1'],
    });
    expect(result.badge).toBe('unverified');
    expect(result.derived.state).toBe('none');
  });

  it('zeigt eine Freigabe mit passendem Stand als approved', () => {
    const result = view([checkpoint(), decision(2, 'approved', { actionUuid: 'action-1' })]);
    expect(result.badge).toBe('approved');
    expect(result.latestDecision?.actionUuid).toBe('action-1');
  });

  it('markiert eine Freigabe mit abweichendem Inhalt als stale', () => {
    const result = buildReviewView({
      trail: [decision(1, 'approved', { actionUuid: 'action-1' })],
      stand: snapshot('anderer-inhalt'),
      editorDirty: false,
      metadata: {},
      nativeActionUuids: [],
    });
    expect(result.badge).toBe('stale');
    expect(result.derived.state).toBe('approved');
  });

  it('markiert ungespeicherte Eingaben als stale', () => {
    const result = view([decision(1, 'approved', { actionUuid: 'action-1' })], { editorDirty: true });
    expect(result.badge).toBe('stale');
  });

  it('löst eine Freigabe durch Änderungswünsche ab', () => {
    const result = view([decision(1, 'approved', { actionUuid: 'action-1' }), decision(2, 'changes-requested')]);
    expect(result.badge).toBe('changes-requested');
    expect(result.derived.actionUuid).toBeUndefined();
  });

  it('zeigt eine zurückgenommene Freigabe als withdrawn', () => {
    const result = view([
      decision(1, 'approved', { actionUuid: 'action-1' }),
      decision(2, 'withdrawn', { withdraws: { sequence: 1, actionUuid: 'action-1' }, reason: 'Zurückgezogen.' }),
    ]);
    expect(result.badge).toBe('withdrawn');
    expect(result.latestDecision?.decision).toBe('withdrawn');
    expect(result.reason).toBe('Zurückgezogen.');
  });

  it('meldet fehlende Parteien der aktuellen Aktion', () => {
    const result = view([decision(1, 'approved', { actionUuid: 'action-1' })], {
      metadata: {
        actions: [{
          uuid: 'action-1',
          system: REVIEW_ACTIONS_SYSTEM,
          'responsible-parties': [{ 'role-id': 'role-1', 'party-uuids': ['party-1'] }],
        }],
        roles: [{ id: 'role-1', title: 'Freigabe' }],
        parties: [],
      },
    });
    expect(result.findings).toEqual([{ code: 'REVIEW_PARTY_MISSING', partyUuid: 'party-1' }]);
  });
});
