import type { ReferenceGraphDocumentKey, ReferenceNodeKind } from '@/domain/referenceGraphModel';
import type { OscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import type { WorkspaceDocumentEdgeKind } from '@/domain/workspaceEdges';
import type { TrustClass } from '@/domain/oscalDocumentContext';

export interface WorkspaceClass1Artifact {
  readonly artifactKey: string;
  readonly lifecycle: 'supported';
  readonly trustClass: 'class-1-verified-public';
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly source: unknown;
  /** Explicit dependency bindings between already loaded public artifacts. */
  readonly bindings?: readonly { readonly pointer: string; readonly href: string; readonly artifactKey: string }[];
}

export interface WorkspaceGraphInput {
  readonly members: readonly WorkspaceEnvelope[];
  readonly bindings?: readonly WorkspaceBinding[];
  /** Already loaded and hash-verified; this API performs no loading. */
  readonly class1Artifacts?: readonly WorkspaceClass1Artifact[];
}

export interface WorkspaceGraphDocument {
  readonly key: ReferenceGraphDocumentKey;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly source: unknown;
  readonly trustClass: TrustClass;
  readonly savedAt?: string;
}

export interface WorkspaceNodeId {
  readonly document: ReferenceGraphDocumentKey;
  readonly kind: ReferenceNodeKind;
  readonly localId: string | null;
  /** Statement identity is scoped to its containing control. */
  readonly controlId?: string;
}
export interface WorkspaceGraphNode extends WorkspaceNodeId {
  readonly derived?: true;
  readonly rootType: OscalRootKey;
  readonly oscalVersion: string;
  readonly trustClass: TrustClass;
}

export interface WorkspaceGraphEdge {
  readonly kind: WorkspaceDocumentEdgeKind | 'document-internal' | 'component-control' | 'ssp-control' | 'ssp-statement' | 'component-incorporates';
  readonly from: WorkspaceNodeId;
  readonly path: string;
  readonly state: 'resolved' | 'resolved-empty' | 'missing-source' | 'not-evaluable' | 'external' | 'error';
  readonly to?: WorkspaceNodeId;
  readonly diagnostic?: OscalDiagnostic;
}

export type WorkspaceProfileResolution = {
  readonly document: ReferenceGraphDocumentKey;
  readonly status: 'resolved';
  readonly derived: true;
  readonly transient: true;
  readonly specificationStatus: 'work-in-progress';
  readonly source: unknown;
} | {
  readonly document: ReferenceGraphDocumentKey;
  readonly status: 'not-evaluable' | 'error';
  readonly diagnostic?: OscalDiagnostic;
};

export interface WorkspaceGraph {
  readonly members: readonly Pick<WorkspaceEnvelope, 'localId' | 'rootType' | 'oscalVersion' | 'trustClass' | 'savedAt'>[];
  readonly nodes: readonly WorkspaceGraphNode[];
  readonly edges: readonly WorkspaceGraphEdge[];
  readonly diagnostics: readonly OscalDiagnostic[];
  readonly resolutions: readonly WorkspaceProfileResolution[];
}

/** Disjoint tokens for internal maps; never used as OSCAL or diagnostic fields. */
export function workspaceDocumentToken(key: ReferenceGraphDocumentKey): string {
  return key.kind === 'local' ? `local:${key.localId}` : `class-1:${key.artifactKey}`;
}

export function localDocumentKey(localId: LocalId): ReferenceGraphDocumentKey {
  return { kind: 'local', localId };
}
