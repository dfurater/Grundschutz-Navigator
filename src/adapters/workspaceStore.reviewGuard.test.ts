// @vitest-environment node
// Contract of the ReviewGuard (GSPP-362): the catalog lock is checked inside the
// write transaction, and a rejecting guard leaves document, bindings, draft and trail untouched.
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { describe, expect, it, vi } from 'vitest';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { WorkspaceBinding, WorkspaceResult } from '@/domain/workspaceModel';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/reviewTrailWork', async () => {
  const { documentSnapshot } = await import('@/domain/reviewTrail');
  const { diffDocuments } = await import('@/domain/documentDiff');
  const { createOscalDiagnostic } = await import('@/domain/oscalDiagnostics');
  return {
    reviewTrailInWorker: vi.fn(async (request: { source: unknown; rootType: OscalRootKey; previous: unknown; baseSequence: number | null; diff: boolean }) => {
      const snapshot = await documentSnapshot(request.source, request.rootType);
      if (!snapshot) return { ok: false, diagnostic: createOscalDiagnostic({ code: 'REVIEW_TRAIL_WORK_FAILED', stage: 'domain', validator: { name: 'gspp-review-trail', version: '1' }, path: '/' }) };
      return {
        ok: true,
        value: {
          snapshot,
          ...(request.diff ? { diff: diffDocuments({ base: request.previous ?? {}, next: request.source, rootType: request.rootType, baseSequence: request.baseSequence }) } : {}),
        },
      };
    }),
  };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME, type ReviewApprovalRequest, type ReviewGuard } from './workspaceStore';
import { approvalAction } from '@/domain/reviewTrail';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
const bytes = (text: string) => new TextEncoder().encode(text);

const APPROVAL_UUID = '99999999-9999-4999-8999-999999999999';
const PARTY_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ROLE_ID = 'approver';

async function imported(source: Record<string, unknown>): Promise<Class2OscalImportedDocument> {
  const result = await (await import('@/adapters/oscalImportGate')).importClass2OscalDocument(bytes(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}

interface ApprovalSource { title?: string; roles?: unknown[] | null; parties?: unknown[] | null; action?: boolean }
function catalogSource({ title = 'DOCUMENT', roles, parties, action = true }: ApprovalSource = {}): Record<string, unknown> {
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  const metadata = (source.catalog as { metadata: Record<string, unknown> }).metadata;
  metadata.title = title;
  if (roles !== null) metadata.roles = roles ?? [{ id: ROLE_ID, title: 'Approver' }];
  if (parties !== null) metadata.parties = parties ?? [{ uuid: PARTY_UUID, type: 'organization', name: 'Synthetic' }];
  if (action) {
    metadata.actions = [approvalAction({ uuid: APPROVAL_UUID, date: '2026-10-21T10:00:00Z', roleId: ROLE_ID, partyUuids: [PARTY_UUID], reason: 'Geprüft' })];
  }
  return source;
}

describe('ReviewGuard in the write transaction (GSPP-362)', () => {
  const locked = () => 'X';

  it('rolls an approved save back completely when the guard locks', async () => {
    const store = value(await WorkspaceStore.open());
    try {
      const verbund = value(await store.createVerbund('Guard'));
      const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
      const other = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false, title: 'OTHER' }))));
      const draft = value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, catalogSource({ action: false, title: 'DRAFT' })));
      const before = value(await store.getDocument(envelope.localId))!;
      const bindingsBefore = value(await store.listBindings());
      const binding: WorkspaceBinding = { fromLocalId: envelope.localId, pointer: '/catalog/metadata/title', href: 'APPROVED', target: { kind: 'local', localId: other.localId } };
      const approval: ReviewApprovalRequest = { actionUuid: APPROVAL_UUID, expectedSequence: 0, roleId: ROLE_ID, partyUuids: [PARTY_UUID] };

      expect(await store.saveDocument(envelope.localId, before.savedAt, draft.savedAt, await imported(catalogSource({ title: 'APPROVED' })), [binding], undefined, approval, locked))
        .toMatchObject({ ok: false, diagnostic: { code: 'X' } });
      expect(value(await store.getDocument(envelope.localId))).toEqual(before);
      expect(value(await store.listBindings())).toEqual(bindingsBefore);
      const view = value(await store.listReviewTrail(envelope.localId));
      expect(view.draftSavedAt).toBe(draft.savedAt);
      expect(view.trail).toEqual([]);
    } finally { store.close(); }
  });

  it('writes neither checkpoint nor baseline nor decision when the guard locks', async () => {
    const store = value(await WorkspaceStore.open());
    try {
      const verbund = value(await store.createVerbund('Guard'));
      const envelope = value(await store.addDocument(verbund.verbundId, await imported(catalogSource({ action: false }))));
      expect(await store.appendCheckpoint(envelope.localId, envelope.savedAt, null, 0, locked)).toMatchObject({ ok: false, diagnostic: { code: 'X' } });
      expect(await store.appendDecision(envelope.localId, envelope.savedAt, null, { decision: 'reviewed', expectedSequence: 0 }, locked)).toMatchObject({ ok: false, diagnostic: { code: 'X' } });
      expect(value(await store.listReviewTrail(envelope.localId)).trail).toEqual([]);
      const db = new Dexie(WORKSPACE_DATABASE_NAME);
      await db.open();
      try { expect(await db.table('reviewBaseline').get(envelope.localId)).toBeUndefined(); } finally { db.close(); }
    } finally { store.close(); }
  });

  it('hands an open guard exactly the members and bindings of its own verbund', async () => {
    const store = value(await WorkspaceStore.open());
    try {
      const own = value(await store.createVerbund('Own'));
      const foreign = value(await store.createVerbund('Foreign'));
      const subject = value(await store.addDocument(own.verbundId, await imported(catalogSource({ action: false }))));
      const sibling = value(await store.addDocument(own.verbundId, await imported(catalogSource({ action: false, title: 'SIBLING' }))));
      const stranger = value(await store.addDocument(foreign.verbundId, await imported(catalogSource({ action: false, title: 'STRANGER' }))));
      const strangerPeer = value(await store.addDocument(foreign.verbundId, await imported(catalogSource({ action: false, title: 'PEER' }))));
      const pointer = '/catalog/metadata/title';
      value(await store.setBinding({ fromLocalId: subject.localId, pointer, href: 'DOCUMENT', target: { kind: 'local', localId: sibling.localId } }, subject.savedAt));
      value(await store.setBinding({ fromLocalId: stranger.localId, pointer, href: 'STRANGER', target: { kind: 'local', localId: strangerPeer.localId } }, stranger.savedAt));
      const current = value(await store.getDocument(subject.localId))!;
      const guard = vi.fn<ReviewGuard>(() => null);

      value(await store.appendCheckpoint(subject.localId, current.savedAt, null, 0, guard));
      expect(guard).toHaveBeenCalledTimes(1);
      const [localId, members, bindings] = guard.mock.calls[0]!;
      expect(localId).toBe(subject.localId);
      expect(members.map(member => member.localId).sort()).toEqual([subject.localId, sibling.localId].sort());
      expect(bindings).toEqual([expect.objectContaining({ fromLocalId: subject.localId, target: { kind: 'local', localId: sibling.localId } })]);
    } finally { store.close(); }
  });
});
