// =============================================================================
// Prüf- und Freigabeablauf: Vertrag, Standvergleich und Ableitung (GSPP-315)
//
// OSCAL-nativ trägt nur die Freigabe (`metadata.actions`), alles andere bleibt
// Workspace-Metadaten (docs/PERSISTENCE.md §9). Der Standvergleich ist für alle
// Roots derselbe: Root-Typ, Dokument-UUID, `last-modified`, `version`,
// `oscal-version` und Content-Hash. Die Dokument-UUID ändert sich nur in den
// `reassign`-Roots (src/domain/rootUuidPolicy.ts).
// =============================================================================

import { computeSHA256 } from '@/domain/integrity';
import { documentBody, documentContent } from '@/domain/documentContent';
import { isJsonObject, readArray, readString, type JsonObject } from '@/domain/jsonGuards';
import { serializeWorkspaceJsonSorted } from '@/domain/workspaceJson';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type {
  DocumentSnapshot, DocumentStamp, ReviewDecisionKind, ReviewTrailRow,
} from '@/domain/workspaceModel';

export const REVIEW_ACTIONS_SYSTEM = 'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/actions';
export const REVIEW_ACTION_TYPE_APPROVED = 'approved';
/** Geschlossene Typmenge für `metadata.actions`; Projektfestlegung, kein NIST-Vokabular. */
export const REVIEW_ACTION_TYPES = Object.freeze([REVIEW_ACTION_TYPE_APPROVED] as const);

/** `hashVersion` 1 heißt SHA-256 über `sorted-json/1`. */
export const CONTENT_HASH_VERSION = 1;
export const CONTENT_HASH_ALGORITHM = 'sha-256';
export const CONTENT_CANONIZATION_VERSION = 1;

/** Frist für Hash und Diff im Worker; ein Ablauf schreibt nichts. */
export const REVIEW_TRAIL_DEADLINE_MS = 15_000;

export function documentStamp(source: unknown, rootType: OscalRootKey): DocumentStamp | undefined {
  const body = documentBody(source, rootType);
  const metadata = body && isJsonObject(body.metadata) ? body.metadata : undefined;
  const uuid = readString(body?.uuid);
  const version = readString(metadata?.version);
  const oscalVersion = readString(metadata?.['oscal-version']);
  const lastModified = readString(metadata?.['last-modified']);
  if (!uuid || !version || !oscalVersion || !lastModified) return undefined;
  return { rootType, uuid, lastModified, version, oscalVersion };
}

/** Kanonisches JSON des Inhalts: sortierte Objektschlüssel, geordnete Arrays, `-0` erhalten. */
export function canonicalDocumentContent(source: unknown, rootType: OscalRootKey): string {
  return serializeWorkspaceJsonSorted(documentContent(source, rootType));
}

export async function documentSnapshot(source: unknown, rootType: OscalRootKey): Promise<DocumentSnapshot | undefined> {
  const stamp = documentStamp(source, rootType);
  if (!stamp) return undefined;
  const bytes = new TextEncoder().encode(canonicalDocumentContent(source, rootType));
  return {
    ...stamp,
    contentHash: {
      version: CONTENT_HASH_VERSION,
      algorithm: CONTENT_HASH_ALGORITHM,
      value: await computeSHA256(bytes.buffer as ArrayBuffer),
    },
  };
}

/** Die eine Aktualitätsregel: identischer Stand in allen sechs Feldern. */
export function sameStand(bound: DocumentSnapshot, current: DocumentSnapshot): boolean {
  return bound.rootType === current.rootType
    && bound.uuid === current.uuid
    && bound.lastModified === current.lastModified
    && bound.version === current.version
    && bound.oscalVersion === current.oscalVersion
    && bound.contentHash.version === current.contentHash.version
    && bound.contentHash.algorithm === current.contentHash.algorithm
    && bound.contentHash.value === current.contentHash.value;
}

export type ReviewStateKind = 'none' | ReviewDecisionKind;

export interface DerivedReviewState {
  readonly state: ReviewStateKind;
  /** Aktuelle Freigabeaktion; nur bei `state === 'approved'`. */
  readonly actionUuid?: string;
  /** Frühere Freigaben, die eine neuere Entscheidung überholt hat. */
  readonly supersededActionUuids: readonly string[];
  /** Durch Rücknahme beendete Freigaben. */
  readonly withdrawnActionUuids: readonly string[];
}

/**
 * Fold über die Entscheidungszeilen in Sequenzreihenfolge. Eine Rücknahme wirkt
 * nur auf ihr Ziel: Sie zieht keine neuere Freigabe zurück und macht keine
 * überholte wieder aktuell.
 */
export function deriveReviewState(rows: readonly ReviewTrailRow[]): DerivedReviewState {
  let state: ReviewStateKind = 'none';
  let actionUuid: string | undefined;
  const superseded = new Set<string>();
  const withdrawn = new Set<string>();
  for (const row of rows) {
    if (row.kind !== 'decision') continue;
    if (row.decision === 'approved') {
      if (actionUuid) superseded.add(actionUuid);
      actionUuid = row.actionUuid;
      state = 'approved';
    } else if (row.decision === 'withdrawn') {
      const target = row.withdraws?.actionUuid;
      if (!target) continue;
      withdrawn.add(target);
      if (target === actionUuid) {
        actionUuid = undefined;
        state = 'withdrawn';
      }
    } else {
      if (actionUuid) superseded.add(actionUuid);
      actionUuid = undefined;
      state = row.decision;
    }
  }
  return {
    state,
    actionUuid,
    supersededActionUuids: [...superseded],
    withdrawnActionUuids: [...withdrawn],
  };
}

export type ReviewDecisionError =
  | 'REVIEW_DECISION_NOT_ALLOWED'
  | 'REVIEW_WITHDRAWAL_TARGET_UNKNOWN'
  | 'REVIEW_WITHDRAWAL_DUPLICATE';

/** Prüft einen Zustandswechsel gegen den abgeleiteten Zustand; `null` heißt zulässig. */
export function appendDecisionError(
  current: DerivedReviewState,
  next: { readonly decision: ReviewDecisionKind; readonly withdraws?: { readonly actionUuid: string } },
): ReviewDecisionError | null {
  switch (next.decision) {
    case 'approved':
      return null;
    case 'reviewed':
      return current.state === 'none' || current.state === 'changes-requested' ? null : 'REVIEW_DECISION_NOT_ALLOWED';
    case 'changes-requested':
      return current.state === 'reviewed' || current.state === 'approved' || current.state === 'none'
        ? null
        : 'REVIEW_DECISION_NOT_ALLOWED';
    case 'withdrawn': {
      const target = next.withdraws?.actionUuid;
      if (!target) return 'REVIEW_WITHDRAWAL_TARGET_UNKNOWN';
      if (current.withdrawnActionUuids.includes(target)) return 'REVIEW_WITHDRAWAL_DUPLICATE';
      return target === current.actionUuid || current.supersededActionUuids.includes(target)
        ? null
        : 'REVIEW_WITHDRAWAL_TARGET_UNKNOWN';
    }
    default:
      return 'REVIEW_DECISION_NOT_ALLOWED';
  }
}

export type ReviewReferenceCode =
  | 'REVIEW_RESPONSIBLE_PARTY_MISSING'
  | 'REVIEW_ROLE_MISSING'
  | 'REVIEW_ROLE_AMBIGUOUS'
  | 'REVIEW_PARTY_MISSING'
  | 'REVIEW_PARTY_AMBIGUOUS';

export interface ReviewReferenceFinding {
  readonly code: ReviewReferenceCode;
  readonly roleId?: string;
  readonly partyUuid?: string;
}

function countMatches(entries: readonly unknown[], field: 'id' | 'uuid', value: string): number {
  return entries.filter(entry => isJsonObject(entry) && entry[field] === value).length;
}

/**
 * Löst `responsible-parties` einer Aktion ausschließlich dokumentintern auf.
 * Mehrdeutige Ziele zählen wie fehlende. Ein Freigabeschreibvorgang bricht bei
 * jedem Befund ab; importierte Aktionen bleiben lesbar und zeigen ihn an.
 */
export function resolveActionReferences(action: unknown, metadata: unknown): readonly ReviewReferenceFinding[] {
  const findings: ReviewReferenceFinding[] = [];
  const actionObject = isJsonObject(action) ? action : {};
  const responsible = readArray(actionObject['responsible-parties']).filter(isJsonObject);
  const roles = readArray(isJsonObject(metadata) ? metadata.roles : undefined);
  const parties = readArray(isJsonObject(metadata) ? metadata.parties : undefined);
  if (!responsible.length) return [{ code: 'REVIEW_RESPONSIBLE_PARTY_MISSING' }];
  for (const entry of responsible) {
    const roleId = readString(entry['role-id']);
    const partyUuids = readArray(entry['party-uuids']).filter((uuid): uuid is string => typeof uuid === 'string');
    if (!roleId) findings.push({ code: 'REVIEW_RESPONSIBLE_PARTY_MISSING' });
    else {
      const matches = countMatches(roles, 'id', roleId);
      if (!matches) findings.push({ code: 'REVIEW_ROLE_MISSING', roleId });
      else if (matches > 1) findings.push({ code: 'REVIEW_ROLE_AMBIGUOUS', roleId });
    }
    if (!partyUuids.length) findings.push({ code: 'REVIEW_RESPONSIBLE_PARTY_MISSING' });
    for (const partyUuid of partyUuids) {
      const matches = countMatches(parties, 'uuid', partyUuid);
      if (!matches) findings.push({ code: 'REVIEW_PARTY_MISSING', partyUuid });
      else if (matches > 1) findings.push({ code: 'REVIEW_PARTY_AMBIGUOUS', partyUuid });
    }
  }
  return findings;
}

export interface ReviewRevisionEntry {
  /** Position in `metadata.revisions`; die Liste ist eine Konvention, keine Ordnung. */
  readonly index: number;
  readonly version: string;
  readonly title?: string;
  readonly published?: string;
  readonly lastModified?: string;
  readonly oscalVersion?: string;
}

/**
 * Projektion von `metadata.revisions`: Dokumentreihenfolge, keine Sortierung,
 * Duplikate bleiben getrennt, kein Inhalt und keine `uuid` (die es dort nicht gibt).
 */
export function projectRevisions(metadata: unknown): readonly ReviewRevisionEntry[] {
  const entries: ReviewRevisionEntry[] = [];
  readArray(isJsonObject(metadata) ? metadata.revisions : undefined).forEach((entry, index) => {
    if (!isJsonObject(entry)) return;
    const version = readString(entry.version);
    if (version === undefined) return;
    entries.push({
      index,
      version,
      title: readString(entry.title),
      published: readString(entry.published),
      lastModified: readString(entry['last-modified']),
      oscalVersion: readString(entry['oscal-version']),
    });
  });
  return entries;
}

export interface ReviewCapability {
  readonly event: 'checkpoint' | 'approved' | 'reviewed' | 'changes-requested' | 'withdrawn' | 'revision';
  readonly carrier: 'workspace' | 'metadata.actions' | 'metadata.revisions';
  readonly exported: boolean;
}

/** Was modellnativ speicherbar ist und was den Workspace nicht verlässt. */
export const REVIEW_CAPABILITIES: readonly ReviewCapability[] = Object.freeze([
  { event: 'checkpoint', carrier: 'workspace', exported: false },
  { event: 'reviewed', carrier: 'workspace', exported: false },
  { event: 'changes-requested', carrier: 'workspace', exported: false },
  { event: 'withdrawn', carrier: 'workspace', exported: false },
  { event: 'approved', carrier: 'metadata.actions', exported: true },
  { event: 'revision', carrier: 'metadata.revisions', exported: true },
]);

export interface ApprovalActionInput {
  readonly uuid: string;
  readonly date: string;
  readonly roleId: string;
  readonly partyUuids: readonly string[];
  readonly reason?: string;
}

/** Der native Freigabeeintrag; kein Hash, kein `prop`, keine `link`. */
export function approvalAction({ uuid, date, roleId, partyUuids, reason }: ApprovalActionInput): JsonObject {
  if (!uuid || !date || !roleId || !partyUuids.length || new Set(partyUuids).size !== partyUuids.length) {
    throw new Error('REVIEW_APPROVAL_INVALID');
  }
  return {
    uuid,
    type: REVIEW_ACTION_TYPE_APPROVED,
    system: REVIEW_ACTIONS_SYSTEM,
    date,
    'responsible-parties': [{ 'role-id': roleId, 'party-uuids': [...partyUuids] }],
    ...(reason ? { remarks: reason } : {}),
  };
}

export function documentMetadata(source: unknown, rootType: OscalRootKey): JsonObject | undefined {
  const metadata = documentBody(source, rootType)?.metadata;
  return isJsonObject(metadata) ? metadata : undefined;
}

export interface ReviewIdentityInput {
  /** Eine Rolle trägt `id` und `title`; eine Anzeige mit bloßem Namen ist keine Rolle. */
  readonly role: { readonly id: string; readonly title: string };
  readonly party?: { readonly uuid: string; readonly name: string };
}

/**
 * Ergänzt eine fehlende Rolle und Partei mit den schema-pflichtigen Feldern.
 * Bestehende `id`/`uuid` bleiben unverändert; die Quelle wird nicht mutiert.
 */
export function withReviewIdentities(source: unknown, rootType: OscalRootKey, { role, party }: ReviewIdentityInput): unknown {
  const next = structuredClone(source);
  const metadata = documentMetadata(next, rootType);
  if (!metadata) return next;
  if (!readArray(metadata.roles).some(entry => isJsonObject(entry) && entry.id === role.id)) {
    metadata.roles = [...readArray(metadata.roles), { id: role.id, title: role.title }];
  }
  if (party && !readArray(metadata.parties).some(entry => isJsonObject(entry) && entry.uuid === party.uuid)) {
    metadata.parties = [...readArray(metadata.parties), { uuid: party.uuid, type: 'organization', name: party.name }];
  }
  return next;
}

/** Fügt die Freigabeaktion der Root-`metadata` hinzu; ein reiner Freigabeschreibvorgang. */
export function withApprovalAction(source: unknown, rootType: OscalRootKey, action: JsonObject): unknown {
  const next = structuredClone(source);
  const metadata = documentMetadata(next, rootType);
  if (!metadata) return next;
  metadata.actions = [...readArray(metadata.actions), action];
  return next;
}
