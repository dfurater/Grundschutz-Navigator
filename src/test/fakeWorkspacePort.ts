import { screen } from '@testing-library/react';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { ScopeId, VerbundId, WorkspaceResult, WorkspaceScope, WorkspaceVerbund } from '@/domain/workspaceModel';
import type { WorkspacePort } from '@/state/workspaceVerbundView';

/** Speicher-Fakes für Shell-Tests des Bereichs Informationsverbünde. */
export const VERBUND: WorkspaceVerbund = {
  verbundId: '7a1d0c2e-5b3f-4c6d-8e9f-0a1b2c3d4e5f' as VerbundId,
  name: 'Lesbarer Verbund',
  createdAt: '2026-10-19T00:00:00.000Z',
  savedAt: '2026-10-19T00:00:00.000Z',
};

export const SCOPE: WorkspaceScope = {
  scopeId: '3c2b1a00-5b3f-4c6d-8e9f-0a1b2c3d4e5f' as ScopeId,
  name: 'Netzbetrieb Stadtwerke',
  createdAt: '2026-11-14T00:00:00.000Z',
  savedAt: '2026-11-14T00:00:00.000Z',
  items: [],
  evidence: [],
};

export const ok = <T,>(value: T): Promise<WorkspaceResult<T>> => Promise.resolve({ ok: true, value });
export const fail = (code: string) => Promise.resolve(failure(new StorageFailure(code)));

export function fakePort(overrides: Partial<WorkspacePort> = {}): WorkspacePort {
  return {
    schemaStatus: () => ok('current' as const),
    listVerbuende: () => ok([VERBUND]),
    listDocuments: () => ok([]),
    getDocument: () => ok(undefined),
    getDraft: () => ok(undefined),
    listBindings: () => ok([]),
    listScopes: () => ok([]),
    createScope: () => fail('WORKSPACE_STORAGE_FAILED'),
    renameScope: () => fail('WORKSPACE_STORAGE_FAILED'),
    deleteScope: () => fail('WORKSPACE_STORAGE_FAILED'),
    assignVerbuende: () => fail('WORKSPACE_STORAGE_FAILED'),
    changeVerbundScope: () => fail('WORKSPACE_STORAGE_FAILED'),
    createVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    renameVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    deleteVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    deleteAll: () => fail('WORKSPACE_STORAGE_FAILED'),
    exportBackup: () => ok('{"format":"gspp-workspace"}'),
    exportVerbundBackup: () => ok('{"format":"gspp-workspace-verbund"}'),
    previewRestore: () => fail('WORKSPACE_BACKUP_INVALID'),
    restoreBackup: () => fail('WORKSPACE_CONFIRMATION_REQUIRED'),
    restoreVerbundBackup: () => fail('WORKSPACE_CONFIRMATION_REQUIRED'),
    addDocument: () => fail('WORKSPACE_STORAGE_FAILED'),
    saveDocument: () => fail('WORKSPACE_STORAGE_FAILED'),
    saveProcessDecision: () => fail('WORKSPACE_STORAGE_FAILED'),
    autosaveDraft: () => fail('WORKSPACE_STORAGE_FAILED'),
    setBinding: () => fail('WORKSPACE_STORAGE_FAILED'),
    removeBinding: () => fail('WORKSPACE_STORAGE_FAILED'),
    deleteDocument: () => fail('WORKSPACE_STORAGE_FAILED'),
    listReviewTrail: () => fail('WORKSPACE_DOCUMENT_NOT_FOUND'),
    appendCheckpoint: () => fail('WORKSPACE_STORAGE_FAILED'),
    appendDecision: () => fail('WORKSPACE_STORAGE_FAILED'),
    listRequirementPackages: () => ok([]),
    setRequirementPackage: () => fail('WORKSPACE_STORAGE_FAILED'),
    clearRequirementPackage: () => fail('WORKSPACE_STORAGE_FAILED'),
    estimate: () => ok({ usage: 10, quota: 100 }),
    close: () => undefined,
    ...overrides,
  };
}

/** Benannte Speichermeldung des Bereichs als Listeneintrag. */
export function findNotice(name: string) {
  return screen.findByText(name, { selector: 'p' }).then((title) => title.closest('li')!);
}
