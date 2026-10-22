import { describe, expect, it } from 'vitest';
import type { DocumentSnapshot, ReviewTrailRow } from './workspaceModel';
import {
  appendDecisionError, approvalAction, canonicalDocumentContent, deriveReviewState, documentSnapshot,
  projectRevisions, resolveActionReferences, REVIEW_ACTIONS_SYSTEM, REVIEW_CAPABILITIES, sameStand,
} from './reviewTrail';

const source = (overrides: Record<string, unknown> = {}) => ({
  profile: {
    uuid: 'u-1',
    metadata: { title: 'Titel', version: '1', 'last-modified': '2026-01-01T00:00:00Z', 'oscal-version': '1.1.3' },
    ...overrides,
  },
});

const snapshot = async (value: unknown) => {
  const result = await documentSnapshot(value, 'profile');
  if (!result) throw new Error('snapshot missing');
  return result;
};

let sequence = 0;
const decision = (kind: 'reviewed' | 'changes-requested' | 'approved' | 'withdrawn', extra: Record<string, unknown> = {}): ReviewTrailRow => {
  sequence += 1;
  const stand = { rootType: 'profile', uuid: 'u-1', lastModified: '2026-01-01T00:00:00Z', version: '1', oscalVersion: '1.1.3', contentHash: { version: 1, algorithm: 'sha-256', value: 'h' } } as DocumentSnapshot;
  return { localId: 'l-1', sequence, kind: 'decision', createdAt: '2026-01-01T00:00:00Z', decision: kind, stand, ...extra } as ReviewTrailRow;
};

describe('content hash contract', () => {
  it('is independent of object key order', async () => {
    const reordered = { profile: { metadata: { 'oscal-version': '1.1.3', 'last-modified': '2026-01-01T00:00:00Z', version: '1', title: 'Titel' }, uuid: 'u-1' } };
    expect(canonicalDocumentContent(source(), 'profile')).toBe(canonicalDocumentContent(reordered, 'profile'));
    expect((await snapshot(source())).contentHash).toEqual((await snapshot(reordered)).contentHash);
  });

  it('excludes only root uuid and last-modified from the hash', async () => {
    const other = { profile: { uuid: 'u-2', metadata: { title: 'Titel', version: '1', 'last-modified': '2026-02-02T00:00:00Z', 'oscal-version': '1.1.3' } } };
    expect((await snapshot(other)).contentHash).toEqual((await snapshot(source())).contentHash);
    expect((await snapshot(other)).uuid).toBe('u-2');
    expect(sameStand(await snapshot(other), await snapshot(source()))).toBe(false);
  });

  it('changes with content at an unchanged timestamp', async () => {
    const edited = source({ metadata: { title: 'Anders', version: '1', 'last-modified': '2026-01-01T00:00:00Z', 'oscal-version': '1.1.3' } });
    expect((await snapshot(edited)).contentHash.value).not.toBe((await snapshot(source())).contentHash.value);
  });

  it('keeps negative zero distinct in the canonical form and the hash', async () => {
    expect(canonicalDocumentContent(source({ values: [-0] }), 'profile')).toContain('-0');
    expect((await snapshot(source({ values: [-0] }))).contentHash.value).not.toBe((await snapshot(source({ values: [0] }))).contentHash.value);
  });

  it('rejects documents without a complete stamp', async () => {
    expect(await documentSnapshot({ profile: { uuid: 'u-1', metadata: {} } }, 'profile')).toBeUndefined();
    expect(await documentSnapshot({ catalog: source() }, 'profile')).toBeUndefined();
  });
});

describe('deriveReviewState', () => {
  it('lets a later approval supersede an earlier one', () => {
    const rows = [decision('approved', { actionUuid: 'A' }), decision('approved', { actionUuid: 'B' })];
    expect(deriveReviewState(rows)).toEqual({ state: 'approved', actionUuid: 'B', supersededActionUuids: ['A'], withdrawnActionUuids: [] });
  });

  it('withdraws only the targeted approval and keeps the newer one', () => {
    const rows = [decision('approved', { actionUuid: 'A' }), decision('approved', { actionUuid: 'B' }), decision('withdrawn', { withdraws: { sequence: 1, actionUuid: 'A' } })];
    expect(deriveReviewState(rows)).toMatchObject({ state: 'approved', actionUuid: 'B', withdrawnActionUuids: ['A'] });
  });

  it('reports a withdrawn approval when the target was current', () => {
    const rows = [decision('approved', { actionUuid: 'A' }), decision('withdrawn', { withdraws: { sequence: 1, actionUuid: 'A' } })];
    expect(deriveReviewState(rows)).toMatchObject({ state: 'withdrawn', actionUuid: undefined, withdrawnActionUuids: ['A'] });
  });

  it('does not resurrect a superseded approval when the newer one is withdrawn', () => {
    const rows = [decision('approved', { actionUuid: 'A' }), decision('approved', { actionUuid: 'B' }), decision('withdrawn', { withdraws: { sequence: 2, actionUuid: 'B' } })];
    expect(deriveReviewState(rows)).toMatchObject({ state: 'withdrawn', actionUuid: undefined });
  });

  it('lets changes-requested supersede an approval', () => {
    expect(deriveReviewState([decision('approved', { actionUuid: 'A' }), decision('changes-requested')])).toMatchObject({ state: 'changes-requested', actionUuid: undefined });
  });

  it('ignores checkpoints for the decision state', () => {
    const checkpoint = { localId: 'l-1', sequence: 1, kind: 'checkpoint', createdAt: 'x', documentState: 'imported', stand: decision('reviewed').stand, diff: { version: 1, baseSequence: null, entries: [], truncated: false } } as unknown as ReviewTrailRow;
    expect(deriveReviewState([checkpoint])).toEqual({ state: 'none', actionUuid: undefined, supersededActionUuids: [], withdrawnActionUuids: [] });
  });
});

describe('appendDecisionError', () => {
  it('rejects duplicate and unknown withdrawals', () => {
    const state = deriveReviewState([decision('approved', { actionUuid: 'A' }), decision('withdrawn', { withdraws: { sequence: 1, actionUuid: 'A' } })]);
    expect(appendDecisionError(state, { decision: 'withdrawn', withdraws: { actionUuid: 'A' } })).toBe('REVIEW_WITHDRAWAL_DUPLICATE');
    expect(appendDecisionError(state, { decision: 'withdrawn', withdraws: { actionUuid: 'X' } })).toBe('REVIEW_WITHDRAWAL_TARGET_UNKNOWN');
  });

  it('rejects reviewed after approved and allows a new approval after withdrawal', () => {
    const approved = deriveReviewState([decision('approved', { actionUuid: 'A' })]);
    expect(appendDecisionError(approved, { decision: 'reviewed' })).toBe('REVIEW_DECISION_NOT_ALLOWED');
    const withdrawn = deriveReviewState([decision('approved', { actionUuid: 'A' }), decision('withdrawn', { withdraws: { sequence: 1, actionUuid: 'A' } })]);
    expect(appendDecisionError(withdrawn, { decision: 'approved' })).toBeNull();
  });

  it('allows withdrawing a superseded approval', () => {
    const state = deriveReviewState([decision('approved', { actionUuid: 'A' }), decision('approved', { actionUuid: 'B' })]);
    expect(appendDecisionError(state, { decision: 'withdrawn', withdraws: { actionUuid: 'A' } })).toBeNull();
  });
});

describe('resolveActionReferences', () => {
  const metadata = { roles: [{ id: 'r-1', title: 'Rolle' }], parties: [{ uuid: 'p-1', type: 'organization', name: 'Partei' }] };

  it('accepts a fully resolvable action', () => {
    expect(resolveActionReferences({ 'responsible-parties': [{ 'role-id': 'r-1', 'party-uuids': ['p-1'] }] }, metadata)).toEqual([]);
  });

  it('reports missing and ambiguous targets', () => {
    expect(resolveActionReferences({ 'responsible-parties': [{ 'role-id': 'r-2', 'party-uuids': ['p-2'] }] }, metadata)).toEqual([
      { code: 'REVIEW_ROLE_MISSING', roleId: 'r-2' },
      { code: 'REVIEW_PARTY_MISSING', partyUuid: 'p-2' },
    ]);
    const duplicated = { roles: [...metadata.roles, ...metadata.roles], parties: [...metadata.parties, ...metadata.parties] };
    expect(resolveActionReferences({ 'responsible-parties': [{ 'role-id': 'r-1', 'party-uuids': ['p-1'] }] }, duplicated)).toEqual([
      { code: 'REVIEW_ROLE_AMBIGUOUS', roleId: 'r-1' },
      { code: 'REVIEW_PARTY_AMBIGUOUS', partyUuid: 'p-1' },
    ]);
  });

  it('reports an action without responsible parties', () => {
    expect(resolveActionReferences({}, metadata)).toEqual([{ code: 'REVIEW_RESPONSIBLE_PARTY_MISSING' }]);
  });
});

describe('revisions projection', () => {
  it('keeps document order and duplicate version strings', () => {
    const entries = projectRevisions({ revisions: [{ version: '2' }, { version: '1', title: 'A' }, { version: '1' }, { title: 'ohne Version' }] });
    expect(entries.map(entry => [entry.index, entry.version, entry.title])).toEqual([[0, '2', undefined], [1, '1', 'A'], [2, '1', undefined]]);
  });

  it('reads absent or invalid revisions as empty', () => {
    expect(projectRevisions({})).toEqual([]);
    expect(projectRevisions({ revisions: 'keine Liste' })).toEqual([]);
  });
});

describe('approval action', () => {
  it('writes the native shape with the project namespace and closed type', () => {
    expect(approvalAction({ uuid: 'a-1', date: '2026-01-01T00:00:00Z', roleId: 'r-1', partyUuids: ['p-1'], reason: 'geprüft' })).toEqual({
      uuid: 'a-1',
      type: 'approved',
      system: REVIEW_ACTIONS_SYSTEM,
      date: '2026-01-01T00:00:00Z',
      'responsible-parties': [{ 'role-id': 'r-1', 'party-uuids': ['p-1'] }],
      remarks: 'geprüft',
    });
  });

  it('rejects incomplete or duplicate references', () => {
    expect(() => approvalAction({ uuid: 'a-1', date: 'd', roleId: '', partyUuids: ['p-1'] })).toThrow(new Error('REVIEW_APPROVAL_INVALID'));
    expect(() => approvalAction({ uuid: 'a-1', date: 'd', roleId: 'r-1', partyUuids: ['p-1', 'p-1'] })).toThrow(new Error('REVIEW_APPROVAL_INVALID'));
  });

  it('declares which events are exported', () => {
    expect(REVIEW_CAPABILITIES.filter(capability => capability.exported).map(capability => capability.carrier)).toEqual(['metadata.actions', 'metadata.revisions']);
  });
});
