import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { DocumentDiff } from '@/domain/documentDiff';

declare const localIdBrand: unique symbol;
declare const verbundIdBrand: unique symbol;
export type LocalId = string & { readonly [localIdBrand]: 'LocalId' };
export type VerbundId = string & { readonly [verbundIdBrand]: 'VerbundId' };
export const STORAGE_SCHEMA_VERSION = 3;
export type DocumentState = 'imported' | 'draft' | 'export-ready';

/** A verbund name carries at least one non-whitespace character. */
export function isVerbundName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export interface WorkspaceVerbund {
  readonly backupSavedAt?: string;
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

/** Der versionierte Content-Hash-Vertrag; `version` 1 heißt SHA-256 über `sorted-json/1`. */
export interface ContentHash {
  readonly version: number;
  readonly algorithm: string;
  readonly value: string;
}

/** Der Dokumentstempel ohne Inhalt: was ein Schreibvorgang verändert. */
export interface DocumentStamp {
  readonly rootType: OscalRootKey;
  readonly uuid: string;
  /** ISO 8601 mit Zeitzone, aus `metadata.last-modified`. */
  readonly lastModified: string;
  readonly version: string;
  readonly oscalVersion: string;
}

/** Der vollständige gebundene Stand eines Checkpoints oder einer Entscheidung. */
export interface DocumentSnapshot extends DocumentStamp {
  readonly contentHash: ContentHash;
}

export interface ReviewCheckpoint {
  readonly localId: LocalId;
  readonly sequence: number;
  readonly kind: 'checkpoint';
  readonly createdAt: string;
  readonly documentState: DocumentState;
  readonly stand: DocumentSnapshot;
  readonly diff: DocumentDiff;
}

/** Vergleichskopie des zuletzt geprüften Stands; höchstens eine je Dokument. */
export interface ReviewBaseline {
  readonly localId: LocalId;
  /** Checkpoint, zu dem die Vergleichskopie gehört. */
  readonly sequence: number;
  readonly stand: DocumentSnapshot;
  readonly source: unknown;
}

export interface ReviewDecision {
  readonly localId: LocalId;
  readonly sequence: number;
  readonly kind: 'decision';
  readonly createdAt: string;
  readonly decision: ReviewDecisionKind;
  readonly stand: DocumentSnapshot;
  /** Nur bei `approved`: die native Aktions-UUID. */
  readonly actionUuid?: string;
  /** Nur bei `withdrawn`: Zielaktion und deren Trail-Sequenz. */
  readonly withdraws?: { readonly sequence: number; readonly actionUuid: string };
  readonly roleId?: string;
  readonly partyUuids?: readonly string[];
  readonly reason?: string;
}

export type ReviewDecisionKind = 'reviewed' | 'changes-requested' | 'approved' | 'withdrawn';

export type ReviewTrailRow = ReviewCheckpoint | ReviewDecision;

/** Trail plus gespeicherter Dokumentstand; der Entwurf bleibt ein eigener CAS-Wert. */
export interface ReviewTrailView {
  readonly trail: readonly ReviewTrailRow[];
  readonly stand: DocumentSnapshot;
  readonly document: WorkspaceEnvelope;
  readonly draftSavedAt: string | null;
}

export interface WorkspaceDraft {
  readonly localId: LocalId;
  readonly savedAt: string;
  /** Der `savedAt`-Wert aus einem wiederhergestellten Bündel; beide Bündel-Exporte geben ihn wieder als `savedAt` aus, ein echter Schreibvorgang führt ihn nicht mit. */
  readonly backupSavedAt?: string;
  readonly source: unknown;
}

export interface WorkspaceMeta {
  readonly databaseId: string;
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
  readonly reviewTrail: ReviewTrailRow[];
  readonly reviewBaseline: ReviewBaseline[];
}

export type WorkspaceVerbundBackup = Omit<WorkspaceBackup, 'format' | 'workspaceMeta' | 'verbuende'> & {
  readonly format: 'gspp-workspace-verbund';
  readonly verbuende: [WorkspaceVerbund];
};

export type WorkspaceRestoreTarget = Pick<WorkspaceMeta, 'databaseId' | 'storageSchemaVersion' | 'savedAt'>;

export interface WorkspaceRestorePreview {
  readonly kind: 'workspace';
  readonly backup: WorkspaceBackup;
  readonly target: WorkspaceRestoreTarget;
  readonly counts: Readonly<Record<Exclude<keyof WorkspaceBackup, 'format' | 'storageSchemaVersion'>, { readonly file: number; readonly target: number }>>;
}

export type WorkspaceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly diagnostic: OscalDiagnostic };
