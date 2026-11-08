import { expect, it, vi } from 'vitest';
import { createWorkspaceDocuments } from '@/state/workspaceDocuments';
import { fakePort, fail } from '@/test/fakeWorkspacePort';
import type { LocalId, WorkspaceResult } from '@/domain/workspaceModel';

it.each([false, true])('friert Eingaben vor dem Katalogguard ein, Kategorien: %s', async withCategories => {
  const saveProcessDecision = vi.fn(() => fail('WORKSPACE_SAVE_CONFLICT'));
  const port = fakePort({ saveProcessDecision });
  const write = <T,>(operation: (store: typeof port) => Promise<WorkspaceResult<T>>) => operation(port);
  const documents = createWorkspaceDocuments({ port, write, quiet: write, class1: [], delivery: new Map(), targets: new Map() });
  const decision = { processUuid: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'approved' as const, uuid: 'bbbbbbbb-0000-4000-8000-000000000006', date: '2026-11-08T12:00:00Z', partyUuids: ['aaaaaaaa-0000-4000-8000-000000000005'], remarks: 'Erklärte Entscheidung' };
  const categories = withCategories ? { commit: 'a'.repeat(40), namespace: { source: { namespace: 'https://example.invalid/categories', repository: 'https://example.invalid/', path: 'categories.csv', fileName: 'categories.csv', routeId: 'categories', gitBlobSha: 'b'.repeat(40) }, columnOrder: ['Begriff'], valueColumn: 'Begriff', entries: [] } } : undefined;
  const initial = structuredClone(decision);
  const initialCategories = structuredClone(categories);
  const saving = documents.saveProcessDecision('local' as LocalId, 'saved', null, decision, categories);
  decision.partyUuids.splice(0);
  decision.remarks = 'Andere Eingabe';
  if (categories) categories.commit = 'c'.repeat(40);
  expect(await saving).toMatchObject({ ok: false });
  expect(saveProcessDecision).toHaveBeenCalledWith('local', 'saved', null, initial, initialCategories, expect.any(Function));
});
