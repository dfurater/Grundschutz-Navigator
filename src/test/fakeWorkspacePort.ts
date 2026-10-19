import { screen } from '@testing-library/react';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { VerbundId, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import type { WorkspacePort } from '@/state/workspaceVerbundView';

/** Speicher-Fakes für Shell-Tests des Bereichs Informationsverbünde. */
export const VERBUND: WorkspaceVerbund = {
  verbundId: '7a1d0c2e-5b3f-4c6d-8e9f-0a1b2c3d4e5f' as VerbundId,
  name: 'Lesbarer Verbund',
  createdAt: '2026-10-19T00:00:00.000Z',
  savedAt: '2026-10-19T00:00:00.000Z',
};

export const ok = <T,>(value: T): Promise<WorkspaceResult<T>> => Promise.resolve({ ok: true, value });
export const fail = (code: string) => Promise.resolve(failure(new StorageFailure(code)));

export function fakePort(overrides: Partial<WorkspacePort> = {}): WorkspacePort {
  return {
    schemaStatus: () => ok('current' as const),
    listVerbuende: () => ok([VERBUND]),
    listDocuments: () => ok([]),
    getDocument: () => ok(undefined),
    listBindings: () => ok([]),
    createVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    renameVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    deleteVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    exportBackup: () => ok('{"format":"gspp-workspace"}'),
    estimate: () => ok({ usage: 10, quota: 100 }),
    close: () => undefined,
    ...overrides,
  };
}

/** Benannte Speichermeldung des Bereichs als Listeneintrag. */
export function findNotice(name: string) {
  return screen.findByText(name, { selector: 'p' }).then((title) => title.closest('li')!);
}
