// Gemeinsame Bausteine der Prüfspur-Verträge des WorkspaceStore (GSPP-315, GSPP-362).
// Die `vi.mock`-Fabriken laden diese Datei dynamisch, weil Mocks vor den Importen stehen.
import { vi } from 'vitest';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { approvalAction } from '@/domain/reviewTrail';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

export async function importGateMock() {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
}

/** Rechnet den Worker-Auftrag im Testprozess; ein nicht lesbares Dokument liefert den Worker-Fehler. */
export async function reviewTrailWorkMock() {
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
}

export function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}
export const bytes = (text: string) => new TextEncoder().encode(text);

export const APPROVAL_UUID = '99999999-9999-4999-8999-999999999999';
export const PARTY_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const ROLE_ID = 'approver';

export async function imported(source: Record<string, unknown>): Promise<Class2OscalImportedDocument> {
  const result = await (await import('@/adapters/oscalImportGate')).importClass2OscalDocument(bytes(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}

interface ApprovalSource { title?: string; roles?: unknown[] | null; parties?: unknown[] | null; action?: boolean }
export function catalogSource({ title = 'DOCUMENT', roles, parties, action = true }: ApprovalSource = {}): Record<string, unknown> {
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
