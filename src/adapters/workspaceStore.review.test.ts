// @vitest-environment node
// Contract of the review trail (GSPP-315): checkpoint CAS, decision transitions,
// atomic approval, reference validation and worker failure without a write.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { expect, it, vi } from 'vitest';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/reviewTrailFixtures')).importGateMock());
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/reviewTrailFixtures')).reviewTrailWorkMock());
vi.mock('@/adapters/workspaceBackup', async () => {
  const { processWorkspaceBackupBytes, processVerbundBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes, parseVerbundBackup: processVerbundBackupBytes };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME, type ReviewApprovalRequest } from './workspaceStore';
import { reviewTrailInWorker } from './reviewTrailWork';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { APPROVAL_UUID, PARTY_UUID, ROLE_ID, bytes, catalogSource, imported, value } from '@/test/reviewTrailFixtures';

const workerFailure = { ok: false, diagnostic: createOscalDiagnostic({ code: 'REVIEW_TRAIL_WORK_FAILED', stage: 'domain', validator: { name: 'gspp-review-trail', version: '1' }, path: '/' }) } as const;

it('numbers checkpoints, diffs against the stored baseline and rejects a stale sequence', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource())));
    const first = value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    expect(first).toMatchObject({ sequence: 1, kind: 'checkpoint', diff: { baseSequence: null, truncated: false } });
    expect(first.diff.entries.length).toBeGreaterThan(0);
    expect(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    const second = value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 1));
    expect(second.diff).toMatchObject({ baseSequence: 1, entries: [] });
    expect(value(await store.listReviewTrail(envelope.localId)).trail.map(row => row.sequence)).toEqual([1, 2]);
  } finally { store.close(); }
});

it('reports the saved document and draft marker and binds no checkpoint over a draft', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
    const view = value(await store.listReviewTrail(envelope.localId));
    expect(view).toMatchObject({ document: { localId: envelope.localId, savedAt: envelope.savedAt }, draftSavedAt: null, trail: [] });

    const draft = value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, catalogSource({ action: false, title: 'DRAFT' })));
    expect(value(await store.listReviewTrail(envelope.localId))).toMatchObject({ draftSavedAt: draft.savedAt, document: { savedAt: envelope.savedAt } });
    expect(await store.appendCheckpoint(envelope.localId, envelope.savedAt, draft.savedAt, 0)).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_CHECKPOINT_NOT_ALLOWED' } });
    expect(value(await store.listReviewTrail(envelope.localId)).trail).toEqual([]);

    const draftDocument = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false, title: 'DRAFT DOC' })), 'draft'));
    expect(await store.appendCheckpoint(draftDocument.localId, draftDocument.savedAt, null, 0)).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_CHECKPOINT_NOT_ALLOWED' } });
  } finally { store.close(); }
});

it('diffs a changed document as a structural entry without values', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
    value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    const saved = value(await store.saveDocument(envelope.localId, envelope.savedAt, null, await imported(catalogSource({ action: false, title: 'CHANGED' }))));
    const checkpoint = value(await store.appendCheckpoint(envelope.localId, saved.savedAt, null, 1));
    expect(checkpoint.diff).toMatchObject({ baseSequence: 1 });
    expect(checkpoint.diff.entries).toContainEqual({ path: '/catalog/metadata/title', kind: 'changed', valueKind: 'string', marker: false });
    expect(JSON.stringify(checkpoint.diff)).not.toContain('CHANGED');
  } finally { store.close(); }
});

it('starts a new comparison line after replaceDocument while older checkpoints stay', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
    value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    const replaced = value(await store.replaceDocument(envelope.localId, envelope.savedAt, null, await imported(catalogSource({ action: false, title: 'REPLACED' }))));
    const checkpoint = value(await store.appendCheckpoint(envelope.localId, replaced.savedAt, null, 1));
    expect(checkpoint).toMatchObject({ sequence: 2, diff: { baseSequence: null } });
    expect(value(await store.listReviewTrail(envelope.localId)).trail).toHaveLength(2);
  } finally { store.close(); }
});

it.each(['workspace', 'verbund'] as const)('keeps a root change backupable with its historic root types (%s)', async (scope) => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Root change'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
    value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 1, reason: 'Katalog' }));
    const profile = await imported(makeSchemaValidOscalDocument('profile', '1.1.3'));
    const replaced = value(await store.replaceDocument(envelope.localId, envelope.savedAt, null, profile));
    expect(replaced.rootType).toBe('profile');
    value(await store.appendCheckpoint(envelope.localId, replaced.savedAt, null, 2));

    const backup = value(await (scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(verbund.verbundId)));
    value(await (scope === 'workspace'
      ? store.restoreBackup(bytes(backup), 'replace-workspace')
      : store.restoreVerbundBackup(bytes(backup), 'replace-verbund')));
    const view = value(await store.listReviewTrail(envelope.localId));
    expect(view.document.rootType).toBe('profile');
    expect(view.trail.map(row => [row.sequence, row.stand.rootType])).toEqual([[1, 'catalog'], [2, 'catalog'], [3, 'profile']]);
  } finally { store.close(); }
});

it('rejects an approval on the draft path regardless of the caller', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
    value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, catalogSource({ action: false, title: 'DRAFT' })));
    const before = value(await store.getDocument(envelope.localId))!;
    const draftBefore = value(await store.listReviewTrail(envelope.localId)).draftSavedAt;
    const approval: ReviewApprovalRequest = { actionUuid: APPROVAL_UUID, expectedSequence: 0, roleId: ROLE_ID, partyUuids: [PARTY_UUID] };
    const invalid = catalogSource();
    delete (invalid.catalog as { metadata: Record<string, unknown> }).metadata.title;
    const input: Class2OscalImportedDocument = { source: invalid, context: { trustClass: 'class-2-local-user' }, rootType: 'catalog', oscalVersion: '1.1.3' };

    expect(await store.saveDocument(envelope.localId, before.savedAt, draftBefore, input, undefined, 'draft', { request: approval })).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_APPROVAL_BLOCKED' } });
    expect(await store.saveDocument(envelope.localId, before.savedAt, draftBefore, input, undefined, undefined, { request: approval })).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_APPROVAL_SCHEMA' } });
    expect(await store.saveDocument(envelope.localId, before.savedAt, draftBefore, await imported(catalogSource()), undefined, 'draft', { request: approval })).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_APPROVAL_BLOCKED' } });
    const after = value(await store.listReviewTrail(envelope.localId));
    expect(value(await store.getDocument(envelope.localId))).toEqual(before);
    expect(after.draftSavedAt).toBe(draftBefore);
    expect(after.trail).toEqual([]);
  } finally { store.close(); }
});

it('enforces the decision transitions and withdraws only an issued approval', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false, title: 'DECISIONS' }))));
    const reviewed = value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 0 }));
    expect(reviewed).toMatchObject({ sequence: 1, decision: 'reviewed' });
    expect(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 1 })).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_DECISION_NOT_ALLOWED' } });
    value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'changes-requested', expectedSequence: 1, reason: 'Nacharbeit' }));
    value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 2 }));
    expect(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'withdrawn', expectedSequence: 3, withdraws: { sequence: 9, actionUuid: APPROVAL_UUID } })).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_WITHDRAWAL_TARGET_UNKNOWN' } });

    const approved = value(await store.saveDocument(envelope.localId, envelope.savedAt, null, await imported(catalogSource({ title: 'APPROVED' })), undefined, undefined, { request: { actionUuid: APPROVAL_UUID, expectedSequence: 3, roleId: ROLE_ID, partyUuids: [PARTY_UUID] } }));
    const view = value(await store.listReviewTrail(envelope.localId));
    expect(view.trail.at(-1)).toMatchObject({ sequence: 4, kind: 'decision', decision: 'approved', actionUuid: APPROVAL_UUID });
    expect(view.stand.contentHash.value).toMatch(/^[a-f0-9]{64}$/);
    const withdrawn = value(await store.appendDecision(envelope.localId, approved.savedAt, null, { decision: 'withdrawn', expectedSequence: 4, withdraws: { sequence: 4, actionUuid: APPROVAL_UUID } }));
    expect(withdrawn).toMatchObject({ sequence: 5, decision: 'withdrawn' });
    expect(await store.appendDecision(envelope.localId, approved.savedAt, null, { decision: 'withdrawn', expectedSequence: 5, withdraws: { sequence: 4, actionUuid: APPROVAL_UUID } })).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_WITHDRAWAL_DUPLICATE' } });
  } finally { store.close(); }
});

it('writes an approval only when the action resolves and the document write succeeds', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
    const approval: ReviewApprovalRequest = { actionUuid: APPROVAL_UUID, expectedSequence: 0, roleId: ROLE_ID, partyUuids: [PARTY_UUID], reason: 'Geprüft' };
    const before = value(await store.getDocument(envelope.localId))!;

    const cases = [
      [await imported(catalogSource({ action: false })), 'REVIEW_APPROVAL_INVALID'],
      [await imported(catalogSource({ roles: null })), 'REVIEW_ROLE_MISSING'],
      [await imported(catalogSource({ roles: [{ id: ROLE_ID, title: 'One' }, { id: ROLE_ID, title: 'Two' }] })), 'REVIEW_ROLE_AMBIGUOUS'],
      [await imported(catalogSource({ parties: null })), 'REVIEW_PARTY_MISSING'],
      [await imported(catalogSource({ parties: [{ uuid: PARTY_UUID, type: 'organization', name: 'One' }, { uuid: PARTY_UUID, type: 'organization', name: 'Two' }] })), 'REVIEW_PARTY_AMBIGUOUS'],
    ] as const;
    for (const [input, code] of cases) {
      expect(await store.saveDocument(envelope.localId, before.savedAt, null, input, undefined, undefined, { request: approval })).toMatchObject({ ok: false, diagnostic: { code } });
      expect(value(await store.getDocument(envelope.localId))).toEqual(before);
      expect(value(await store.listReviewTrail(envelope.localId)).trail).toEqual([]);
    }
    // A stale expected sequence and a mismatched action shape both stop before the write.
    expect(await store.saveDocument(envelope.localId, before.savedAt, null, await imported(catalogSource()), undefined, undefined, { request: { ...approval, expectedSequence: 7 } })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    expect(await store.saveDocument(envelope.localId, before.savedAt, null, await imported(catalogSource()), undefined, undefined, { request: { ...approval, roleId: 'other' } })).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_APPROVAL_INVALID' } });
    expect(value(await store.getDocument(envelope.localId))).toEqual(before);

    const saved = value(await store.saveDocument(envelope.localId, before.savedAt, null, await imported(catalogSource({ title: 'APPROVED' })), undefined, undefined, { request: approval }));
    expect(saved.savedAt > before.savedAt).toBe(true);
    expect(value(await store.listReviewTrail(envelope.localId)).trail).toMatchObject([{ sequence: 1, kind: 'decision', decision: 'approved', actionUuid: APPROVAL_UUID, roleId: ROLE_ID, partyUuids: [PARTY_UUID] }]);
  } finally { store.close(); }
});

it('writes nothing when the worker fails and cascades the trail on delete', async () => {
  const store = value(await WorkspaceStore.open());
  try {
    const verbund = value(await store.createVerbund('Review'));
    const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
    vi.mocked(reviewTrailInWorker).mockResolvedValueOnce(workerFailure);
    expect(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0)).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
    expect(value(await store.listReviewTrail(envelope.localId)).trail).toEqual([]);
    value(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0));
    value(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 1 }));
    value(await store.deleteDocument(envelope.localId));
    const db = new Dexie(WORKSPACE_DATABASE_NAME);
    await db.open();
    try {
      expect(await db.table('reviewTrail').where('localId').equals(envelope.localId).count()).toBe(0);
      expect(await db.table('reviewBaseline').get(envelope.localId)).toBeUndefined();
    } finally { db.close(); }
  } finally { store.close(); }
});
