import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';

declare const localIdBrand: unique symbol;
declare const verbundIdBrand: unique symbol;
export type LocalId = string & { readonly [localIdBrand]: 'LocalId' };
export type VerbundId = string & { readonly [verbundIdBrand]: 'VerbundId' };
export const STORAGE_SCHEMA_VERSION = 1;
export type DocumentState = 'imported' | 'draft' | 'export-ready';

/** A verbund name carries at least one non-whitespace character. */
export function isVerbundName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export interface WorkspaceVerbund {
  readonly verbundId: VerbundId;
  readonly name: string;
  readonly createdAt: string;
  readonly savedAt: string;
}

export interface WorkspaceEnvelope {
  readonly localId: LocalId;
  readonly verbundId: VerbundId;
  readonly storageSchemaVersion: number;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly trustClass: 'class-2-local-user';
  readonly documentState: DocumentState;
  readonly derivedFrom?: { readonly artifactKey: string; readonly contentSha256: string; readonly snapshotCommit: string };
  readonly createdAt: string;
  readonly savedAt: string;
  /** Der `savedAt`-Wert aus einem wiederhergestellten Bündel; beide Bündel-Exporte geben ihn wieder als `savedAt` aus, ein echter Schreibvorgang führt ihn nicht mit. */
  readonly backupSavedAt?: string;
  readonly source: unknown;
}

export type WorkspaceDocumentSummary = Omit<WorkspaceEnvelope, 'source' | 'backupSavedAt'>;

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
  /** Der `savedAt`-Wert aus einem wiederhergestellten Bündel; beide Bündel-Exporte geben ihn wieder als `savedAt` aus, ein echter Schreibvorgang führt ihn nicht mit. */
  readonly backupSavedAt?: string;
  readonly source: unknown;
}

export interface WorkspaceMeta {
  readonly id: 'workspace';
  readonly storageSchemaVersion: number;
  readonly createdAt: string;
  readonly savedAt: string;
}

export interface WorkspaceBackup {
  readonly format: 'gspp-workspace';
  readonly storageSchemaVersion: number;
  readonly verbuende: WorkspaceVerbund[];
  readonly documents: WorkspaceEnvelope[];
  readonly drafts: WorkspaceDraft[];
  readonly bindings: WorkspaceBinding[];
  readonly workspaceMeta: WorkspaceMeta[];
}

export type WorkspaceVerbundBackup = Omit<WorkspaceBackup, 'format' | 'workspaceMeta' | 'verbuende'> & {
  readonly format: 'gspp-workspace-verbund';
  readonly verbuende: [WorkspaceVerbund];
};

export type WorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };
