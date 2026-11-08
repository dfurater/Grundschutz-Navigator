import { expect, it, vi } from 'vitest';
import { createWorkspaceDocuments } from '@/state/workspaceDocuments';
import { fakePort, fail } from '@/test/fakeWorkspacePort';
import type { LocalId, WorkspaceResult } from '@/domain/workspaceModel';

it('ergänzt den Katalogguard an der Prozessentscheidung des Workspace-Zugangs', async () => {
  const saveProcessDecision = vi.fn(() => fail('WORKSPACE_SAVE_CONFLICT'));
  const port = fakePort({ saveProcessDecision });
  const write = <T,>(operation: (store: typeof port) => Promise<WorkspaceResult<T>>) => operation(port);
  const documents = createWorkspaceDocuments({ port, write, quiet: write, class1: [], delivery: new Map(), targets: new Map() });
  const decision = { processUuid: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'approved' as const, uuid: 'bbbbbbbb-0000-4000-8000-000000000006', date: '2026-11-08T12:00:00Z', partyUuids: ['aaaaaaaa-0000-4000-8000-000000000005'], remarks: 'Erklärte Entscheidung' };
  expect(await documents.saveProcessDecision('local' as LocalId, 'saved', null, decision)).toMatchObject({ ok: false });
  expect(saveProcessDecision).toHaveBeenCalledWith('local', 'saved', null, decision, undefined, expect.any(Function));
});
