// =============================================================================
// Anzeigemodell des Prüf- und Freigabeablaufs (GSPP-315)
//
// Leitet aus dem lokalen Trail und dem gespeicherten Stand nur den Prüfzustand
// ab, den die Oberfläche zeigen darf. Eine Freigabe ist ein Dokumenteintrag;
// sie belegt weder eine Signatur noch eine geprüfte Identität.
// =============================================================================

import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import {
  deriveReviewState,
  documentMetadata,
  resolveActionReferences,
  sameStand,
  REVIEW_ACTIONS_SYSTEM,
  REVIEW_ACTION_TYPE_APPROVED,
  type DerivedReviewState,
  type ReviewReferenceCode,
  type ReviewReferenceFinding,
} from '@/domain/reviewTrail';
import type {
  DocumentSnapshot,
  ReviewCheckpoint,
  ReviewDecision,
  ReviewDecisionKind,
  ReviewTrailRow,
} from '@/domain/workspaceModel';

export type ReviewBadge = 'none' | 'reviewed' | 'changes-requested' | 'approved' | 'withdrawn' | 'stale' | 'unverified';

/** Was eine Freigabe an Rollen-, Partei- und Begründungsangaben mitbringt. */
export interface DecisionSubmission {
  readonly roleId: string;
  /** Nur bei einer neu angelegten Rolle. */
  readonly roleTitle?: string;
  readonly partyUuids: readonly string[];
  /** Nur bei einer neu anzulegenden Partei. */
  readonly partyName?: string;
  readonly reason: string;
}

export interface ReviewViewInput {
  readonly trail: readonly ReviewTrailRow[];
  /** Aktueller gespeicherter Stand des Dokuments. */
  readonly stand?: DocumentSnapshot;
  /** Ungespeicherte Eingaben im Editor. */
  readonly editorDirty: boolean;
  /** Die Prüfspur wird gerade neu geladen; die positive Anzeige bleibt gesperrt. */
  readonly refreshing?: boolean;
  /** Root-`metadata` des Dokuments. */
  readonly metadata: unknown;
  /** `metadata.actions`-UUIDs mit unserem System-Namespace; ohne Angabe aus `metadata` abgeleitet. */
  readonly nativeActionUuids?: readonly string[];
}

/** Aktionen im Projekt-Namespace; fremde Aktionen bleiben Dokumentinhalt ohne lokalen Nachweis. */
export function nativeApprovalUuids(metadata: unknown): readonly string[] {
  return readArray(isJsonObject(metadata) ? metadata.actions : undefined)
    .flatMap(entry => isJsonObject(entry) && entry.system === REVIEW_ACTIONS_SYSTEM && entry.type === REVIEW_ACTION_TYPE_APPROVED && readString(entry.uuid) ? [entry.uuid as string] : []);
}

/** Rollen und Parteien des Dokuments als Anzeigeform; mehrdeutige Einträge bleiben einzeln sichtbar. */
export function reviewIdentities(metadata: unknown): { roles: { id: string; title: string }[]; parties: { uuid: string; name: string }[] } {
  const source = isJsonObject(metadata) ? metadata : {};
  const roles: { id: string; title: string }[] = [];
  const parties: { uuid: string; name: string }[] = [];
  for (const entry of readArray(source.roles)) {
    if (!isJsonObject(entry)) continue;
    const id = readString(entry.id);
    if (id) roles.push({ id, title: readString(entry.title) ?? id });
  }
  for (const entry of readArray(source.parties)) {
    if (!isJsonObject(entry)) continue;
    const uuid = readString(entry.uuid);
    if (uuid) parties.push({ uuid, name: readString(entry.name) ?? uuid });
  }
  return { roles, parties };
}

export function metadataOf(source: unknown, rootType: OscalRootKey): unknown {
  return documentMetadata(source, rootType);
}

export interface ReviewView {
  readonly badge: ReviewBadge;
  readonly derived: DerivedReviewState;
  readonly latestCheckpoint?: ReviewCheckpoint;
  readonly latestDecision?: ReviewDecision;
  /** Befunde zur aktuellen Entscheidung; nur bei vorhandener Aktion befüllt. */
  readonly findings: readonly ReviewReferenceFinding[];
  readonly reason?: string;
  readonly trail: readonly ReviewTrailRow[];
}

function findApproval(trail: readonly ReviewTrailRow[], actionUuid: string): ReviewDecision | undefined {
  let approval: ReviewDecision | undefined;
  for (const row of trail) {
    if (row.kind === 'decision' && row.actionUuid === actionUuid) approval = row;
  }
  return approval;
}

function findReviewed(trail: readonly ReviewTrailRow[]): ReviewDecision | undefined {
  let reviewed: ReviewDecision | undefined;
  for (const row of trail) if (row.kind === 'decision' && row.decision === 'reviewed') reviewed = row;
  return reviewed;
}

function latestRows(trail: readonly ReviewTrailRow[]): { latestCheckpoint?: ReviewCheckpoint; latestDecision?: ReviewDecision } {
  let latestCheckpoint: ReviewCheckpoint | undefined;
  let latestDecision: ReviewDecision | undefined;
  for (const row of trail) {
    if (row.kind === 'checkpoint') latestCheckpoint = row;
    else latestDecision = row;
  }
  return { latestCheckpoint, latestDecision };
}

function isCurrent(stand: DocumentSnapshot | undefined, bound: DocumentSnapshot, editorDirty: boolean, refreshing: boolean): boolean {
  return !editorDirty && !refreshing && stand !== undefined && sameStand(bound, stand);
}

function badgeFor(derived: DerivedReviewState, trail: readonly ReviewTrailRow[], stand: DocumentSnapshot | undefined, editorDirty: boolean, refreshing: boolean, nativeActionUuids: readonly string[]): ReviewBadge {
  if (derived.state === 'none' && nativeActionUuids.length > 0) return 'unverified';
  if (derived.state === 'approved') {
    const approval = derived.actionUuid ? findApproval(trail, derived.actionUuid) : undefined;
    return approval && isCurrent(stand, approval.stand, editorDirty, refreshing) ? 'approved' : 'stale';
  }
  if (derived.state === 'reviewed') {
    const reviewed = findReviewed(trail);
    return reviewed && isCurrent(stand, reviewed.stand, editorDirty, refreshing) ? 'reviewed' : 'stale';
  }
  return derived.state;
}

export function buildReviewView({ trail, stand, editorDirty, refreshing = false, metadata, nativeActionUuids = nativeApprovalUuids(metadata) }: ReviewViewInput): ReviewView {
  const derived = deriveReviewState(trail);
  const { latestCheckpoint, latestDecision } = latestRows(trail);
  const badge = badgeFor(derived, trail, stand, editorDirty, refreshing, nativeActionUuids);
  const actionUuid = derived.actionUuid ?? latestDecision?.withdraws?.actionUuid;
  const actions = readArray(isJsonObject(metadata) ? metadata.actions : undefined).filter(isJsonObject);
  const action = actionUuid === undefined ? undefined : actions.find((entry) => entry.uuid === actionUuid);
  const findings: readonly ReviewReferenceFinding[] = action ? resolveActionReferences(action, metadata) : [];

  return { badge, derived, latestCheckpoint, latestDecision, findings, reason: latestDecision?.reason, trail };
}

export const REVIEW_BADGE_TEXT: Readonly<Record<ReviewBadge, string>> = {
  none: 'Nicht geprüft',
  reviewed: 'Geprüft',
  'changes-requested': 'Änderungen angefordert',
  approved: 'Freigegeben',
  withdrawn: 'Freigabe zurückgenommen',
  stale: 'Prüfstand überholt',
  unverified: 'Freigabe ohne lokalen Nachweis',
};

export const REVIEW_DECISION_TEXT: Readonly<Record<ReviewDecisionKind, string>> = {
  reviewed: 'Geprüft',
  'changes-requested': 'Änderungen angefordert',
  approved: 'Freigegeben',
  withdrawn: 'Freigabe zurückgenommen',
};

export const REVIEW_REFERENCE_TEXT: Readonly<Record<ReviewReferenceCode, string>> = {
  REVIEW_RESPONSIBLE_PARTY_MISSING: 'Verantwortliche Rolle oder Partei fehlt.',
  REVIEW_ROLE_MISSING: 'Rolle fehlt in metadata.roles.',
  REVIEW_ROLE_AMBIGUOUS: 'Rolle ist in metadata.roles mehrdeutig.',
  REVIEW_PARTY_MISSING: 'Partei fehlt in metadata.parties.',
  REVIEW_PARTY_AMBIGUOUS: 'Partei ist in metadata.parties mehrdeutig.',
};

export function reviewReferenceText(finding: ReviewReferenceFinding): string {
  switch (finding.code) {
    case 'REVIEW_ROLE_MISSING':
      return `Rolle ${finding.roleId ?? 'ohne Kennung'} fehlt in metadata.roles.`;
    case 'REVIEW_ROLE_AMBIGUOUS':
      return `Rolle ${finding.roleId ?? 'ohne Kennung'} ist in metadata.roles mehrdeutig.`;
    case 'REVIEW_PARTY_MISSING':
      return `Partei ${finding.partyUuid ?? 'ohne UUID'} fehlt in metadata.parties.`;
    case 'REVIEW_PARTY_AMBIGUOUS':
      return `Partei ${finding.partyUuid ?? 'ohne UUID'} ist in metadata.parties mehrdeutig.`;
    default:
      return REVIEW_REFERENCE_TEXT.REVIEW_RESPONSIBLE_PARTY_MISSING;
  }
}
