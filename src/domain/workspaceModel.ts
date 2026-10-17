import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';

export type LocalId = string;
export type VerbundId = string;
export type StorageSchemaVersion = number;
export const STORAGE_SCHEMA_VERSION = 1;
export type DocumentState = 'imported' | 'draft' | 'export-ready';

export interface WorkspaceVerbund {
  readonly verbundId: VerbundId;
  readonly name: string;
  readonly createdAt: string;
  readonly savedAt: string;
}

export interface WorkspaceEnvelope {
  readonly localId: LocalId;
  readonly verbundId: VerbundId;
  readonly storageSchemaVersion: StorageSchemaVersion;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly trustClass: 'class-2-local-user';
  readonly documentState: DocumentState;
  readonly derivedFrom?: { readonly artifactKey: string; readonly contentSha256: string; readonly snapshotCommit: string };
  readonly createdAt: string;
  readonly savedAt: string;
  readonly source: unknown;
}

export type BindingTarget =
  | { readonly kind: 'local'; readonly localId: LocalId }
  | { readonly kind: 'class-1'; readonly artifactKey: string };

export interface WorkspaceBinding {
  readonly fromLocalId: LocalId;
  readonly pointer: string;
  readonly href: string;
  readonly target: BindingTarget;
}

export interface WorkspaceDraft {
  readonly localId: LocalId;
  readonly savedAt: string;
  readonly source: unknown;
}

export interface WorkspaceMeta {
  readonly id: 'workspace';
  readonly storageSchemaVersion: StorageSchemaVersion;
  readonly createdAt: string;
  readonly savedAt: string;
}

export interface WorkspaceBackup {
  readonly format: 'gspp-workspace';
  readonly storageSchemaVersion: StorageSchemaVersion;
  readonly verbuende: WorkspaceVerbund[];
  readonly documents: WorkspaceEnvelope[];
  readonly drafts: WorkspaceDraft[];
  readonly bindings: WorkspaceBinding[];
  readonly workspaceMeta: WorkspaceMeta[];
}

export type WorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };
