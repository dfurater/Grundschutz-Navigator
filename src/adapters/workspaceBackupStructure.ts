import { hasRegistryKeyGrammar } from '@/domain/sourceRegistry';
import { OSCAL_ROOT_KEYS } from '@/domain/oscalVersionMatrix';
import { bindsEnvelopeSource, withinSourceLimits } from '@/adapters/workspaceDraftSource';
import {
  STORAGE_SCHEMA_VERSION, isVerbundName,
  type DocumentSnapshot, type ReviewTrailRow, type WorkspaceBackup, type WorkspaceEnvelope, type WorkspaceVerbundBackup,
} from '@/domain/workspaceModel';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;
const DIFF_KINDS = new Set(['added', 'removed', 'changed']);
const DIFF_VALUE_KINDS = new Set(['object', 'array', 'string', 'number', 'boolean', 'null']);
const DECISIONS = new Set(['reviewed', 'changes-requested', 'approved', 'withdrawn']);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function fields(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return record(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
}
function uuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }
function nonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function positiveInteger(value: unknown): value is number { return Number.isInteger(value) && (value as number) > 0; }
function timestamp(value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);
}
function times(value: Record<string, unknown>): boolean { return timestamp(value.createdAt) && timestamp(value.savedAt); }

/**
 * Vier Teilprüfungen eines Bündels: v1 kennt weder Trail noch Baseline, v2
 * verlangt beide Schlüssel. Die Version wird nie aus dem Inhalt geraten.
 */
interface BundleContext {
  readonly version: 1 | 2;
  readonly verbuende: Set<string>;
  readonly documents: Map<string, { verbundId: string; rootType: string; oscalVersion: string }>;
  readonly drafts: Set<string>;
  readonly bindings: Set<string>;
  readonly sequences: Map<string, number>;
  readonly checkpoints: Map<string, Map<number, DocumentSnapshot>>;
  readonly approvals: Map<string, Map<string, number>>;
  readonly baselines: Set<string>;
  metaSeen: boolean;
}

function newContext(version: 1 | 2): BundleContext {
  return {
    version,
    verbuende: new Set(),
    documents: new Map(),
    drafts: new Set(),
    bindings: new Set(),
    sequences: new Map(),
    checkpoints: new Map(),
    approvals: new Map(),
    baselines: new Set(),
    metaSeen: false,
  };
}

function collectVerbuende(context: BundleContext, rows: readonly unknown[]): boolean {
  for (const row of rows) {
    if (!fields(row, ['verbundId', 'name', 'createdAt', 'savedAt']) || !uuid(row.verbundId) || !isVerbundName(row.name)
      || !times(row) || context.verbuende.has(row.verbundId)) return false;
    context.verbuende.add(row.verbundId);
  }
  return true;
}

function validDerivedFrom(value: unknown): boolean {
  if (value === undefined) return true;
  return fields(value, ['artifactKey', 'contentSha256', 'snapshotCommit'])
    && hasRegistryKeyGrammar(value.artifactKey) && typeof value.contentSha256 === 'string'
    && SHA256.test(value.contentSha256) && typeof value.snapshotCommit === 'string'
    && /^[a-f0-9]{40}$/.test(value.snapshotCommit);
}

/** Ein mitgeführtes `backupSavedAt` — der `savedAt`-Wert eines eingelesenen Bündels — muss ein Zeitstempel sein. */
function validBackupSavedAt(value: unknown): boolean {
  return value === undefined || timestamp(value);
}

function validDocumentFields(row: unknown, version: 1 | 2): row is Record<string, unknown> {
  return fields(row, ['localId', 'verbundId', 'storageSchemaVersion', 'rootType', 'oscalVersion', 'trustClass', 'documentState', 'createdAt', 'savedAt', 'source'], ['derivedFrom', 'backupSavedAt'])
    && uuid(row.localId) && uuid(row.verbundId) && row.storageSchemaVersion === version
    && OSCAL_ROOT_KEYS.includes(row.rootType as never) && nonEmptyString(row.oscalVersion)
    && row.trustClass === 'class-2-local-user' && ['imported', 'draft', 'export-ready'].includes(row.documentState as string)
    && times(row) && validBackupSavedAt(row.backupSavedAt) && validDerivedFrom(row.derivedFrom);
}

function validDocumentRoot(row: Record<string, unknown>): boolean {
  if (!record(row.source)) return false;
  const root = row.source[row.rootType as string];
  return record(root) && root.uuid !== row.localId;
}

function collectDocuments(context: BundleContext, rows: readonly unknown[]): boolean {
  for (const row of rows) {
    if (!validDocumentFields(row, context.version) || !context.verbuende.has(row.verbundId as string)
      || context.documents.has(row.localId as string) || !validDocumentRoot(row)) return false;
    context.documents.set(row.localId as string, { verbundId: row.verbundId as string, rootType: row.rootType as string, oscalVersion: row.oscalVersion as string });
  }
  return true;
}

function validDrafts(context: BundleContext, rows: readonly unknown[]): boolean {
  for (const row of rows) {
    if (!fields(row, ['localId', 'savedAt', 'source'], ['backupSavedAt']) || !uuid(row.localId) || !context.documents.has(row.localId)
      || context.drafts.has(row.localId) || !timestamp(row.savedAt) || !validBackupSavedAt(row.backupSavedAt)) return false;
    context.drafts.add(row.localId);
  }
  return true;
}

function validBindingFields(row: unknown, context: BundleContext): row is Record<string, unknown> {
  return fields(row, ['fromLocalId', 'pointer', 'href', 'target']) && uuid(row.fromLocalId) && context.documents.has(row.fromLocalId)
    && typeof row.pointer === 'string' && /^(?:\/(?:[^~/]|~[01])*)*$/.test(row.pointer)
    && typeof row.href === 'string' && record(row.target);
}

function validBindingTarget(context: BundleContext, target: Record<string, unknown>, fromLocalId: string): boolean {
  if (target.kind === 'local') {
    return fields(target, ['kind', 'localId']) && uuid(target.localId) && context.documents.has(target.localId)
      && context.documents.get(fromLocalId)?.verbundId === context.documents.get(target.localId)?.verbundId;
  }
  return target.kind === 'class-1' && fields(target, ['kind', 'artifactKey']) && hasRegistryKeyGrammar(target.artifactKey);
}

function collectBindings(context: BundleContext, rows: readonly unknown[]): boolean {
  for (const row of rows) {
    if (!validBindingFields(row, context)) return false;
    const key = JSON.stringify([row.fromLocalId, row.pointer]);
    if (context.bindings.has(key)) return false;
    context.bindings.add(key);
    if (!validBindingTarget(context, row.target as Record<string, unknown>, row.fromLocalId as string)) return false;
  }
  return true;
}

function validWorkspaceMeta(rows: readonly unknown[], version: 1 | 2): boolean {
  return rows.length === 1 && rows.every(row => fields(row, ['id', 'storageSchemaVersion', 'createdAt', 'savedAt'])
    && row.id === 'workspace' && row.storageSchemaVersion === version && times(row));
}

function validSnapshot(value: unknown): value is DocumentSnapshot {
  return fields(value, ['rootType', 'uuid', 'lastModified', 'version', 'oscalVersion', 'contentHash'])
    && OSCAL_ROOT_KEYS.includes(value.rootType as never) && nonEmptyString(value.uuid)
    && nonEmptyString(value.lastModified) && nonEmptyString(value.version) && nonEmptyString(value.oscalVersion)
    && fields(value.contentHash, ['version', 'algorithm', 'value'])
    && positiveInteger(value.contentHash.version) && nonEmptyString(value.contentHash.algorithm)
    && typeof value.contentHash.value === 'string' && SHA256.test(value.contentHash.value);
}

function validDiff(value: unknown, sequence: number, checkpoints: ReadonlyMap<number, DocumentSnapshot>): boolean {
  if (!fields(value, ['version', 'baseSequence', 'entries', 'truncated'])) return false;
  if (value.version !== 1 || typeof value.truncated !== 'boolean' || !Array.isArray(value.entries)) return false;
  const base = value.baseSequence;
  if (!(base === null || (positiveInteger(base) && base < sequence && checkpoints.has(base)))) return false;
  return value.entries.every(entry => fields(entry, ['path', 'kind', 'valueKind', 'marker'])
    && typeof entry.path === 'string' && entry.path.startsWith('/')
    && DIFF_KINDS.has(entry.kind as string) && DIFF_VALUE_KINDS.has(entry.valueKind as string)
    && typeof entry.marker === 'boolean');
}

function validStandForDocument(context: BundleContext, localId: string, stand: unknown): stand is DocumentSnapshot {
  return validSnapshot(stand) && stand.rootType === context.documents.get(localId)?.rootType;
}

function sameSnapshot(left: DocumentSnapshot, right: DocumentSnapshot): boolean {
  return left.rootType === right.rootType && left.uuid === right.uuid && left.lastModified === right.lastModified
    && left.version === right.version && left.oscalVersion === right.oscalVersion
    && left.contentHash.version === right.contentHash.version && left.contentHash.algorithm === right.contentHash.algorithm
    && left.contentHash.value === right.contentHash.value;
}

function collectCheckpoint(context: BundleContext, row: Record<string, unknown>, localId: string, sequence: number): boolean {
  if (!fields(row, ['localId', 'sequence', 'kind', 'createdAt', 'documentState', 'stand', 'diff'])
    || !timestamp(row.createdAt) || !['imported', 'draft', 'export-ready'].includes(row.documentState as string)) return false;
  const checkpoints = context.checkpoints.get(localId) ?? new Map<number, DocumentSnapshot>();
  if (!validStandForDocument(context, localId, row.stand) || !validDiff(row.diff, sequence, checkpoints)) return false;
  checkpoints.set(sequence, row.stand);
  context.checkpoints.set(localId, checkpoints);
  return true;
}

function collectApproval(context: BundleContext, row: Record<string, unknown>, localId: string, sequence: number): boolean {
  if (row.decision !== 'approved') return row.actionUuid === undefined;
  if (!uuid(row.actionUuid)) return false;
  const approved = context.approvals.get(localId) ?? new Map<string, number>();
  approved.set(row.actionUuid, sequence);
  context.approvals.set(localId, approved);
  return true;
}

function validWithdrawal(context: BundleContext, row: Record<string, unknown>, localId: string): boolean {
  if (row.decision !== 'withdrawn') return row.withdraws === undefined;
  if (!fields(row.withdraws, ['sequence', 'actionUuid']) || !positiveInteger(row.withdraws.sequence) || !uuid(row.withdraws.actionUuid)) return false;
  return context.approvals.get(localId)?.get(row.withdraws.actionUuid) === row.withdraws.sequence;
}

function validDecisionDetails(row: Record<string, unknown>): boolean {
  if (row.roleId !== undefined && !nonEmptyString(row.roleId)) return false;
  if (row.partyUuids !== undefined && (!Array.isArray(row.partyUuids) || !row.partyUuids.length || new Set(row.partyUuids).size !== row.partyUuids.length
    || !row.partyUuids.every(nonEmptyString))) return false;
  if (row.reason !== undefined && (typeof row.reason !== 'string' || row.reason.length > 1000)) return false;
  return true;
}

function collectDecision(context: BundleContext, row: Record<string, unknown>, localId: string, sequence: number): boolean {
  if (!fields(row, ['localId', 'sequence', 'kind', 'createdAt', 'decision', 'stand'], ['actionUuid', 'withdraws', 'roleId', 'partyUuids', 'reason'])
    || row.kind !== 'decision' || !timestamp(row.createdAt) || !DECISIONS.has(row.decision as string)
    || !validStandForDocument(context, localId, row.stand)) return false;
  return collectApproval(context, row, localId, sequence)
    && validWithdrawal(context, row, localId)
    && validDecisionDetails(row);
}

function collectReviewTrail(context: BundleContext, rows: readonly unknown[]): boolean {
  if (context.version !== STORAGE_SCHEMA_VERSION) return true;
  for (const row of rows) {
    if (!record(row) || !context.documents.has(row.localId as string)) return false;
    const localId = row.localId as string;
    const sequence = row.sequence;
    if (!positiveInteger(sequence) || sequence <= (context.sequences.get(localId) ?? 0)) return false;
    context.sequences.set(localId, sequence);
    const accepted = row.kind === 'checkpoint'
      ? collectCheckpoint(context, row, localId, sequence)
      : collectDecision(context, row, localId, sequence);
    if (!accepted) return false;
  }
  return true;
}

function collectReviewBaseline(context: BundleContext, rows: readonly unknown[]): boolean {
  if (context.version !== STORAGE_SCHEMA_VERSION) return true;
  for (const row of rows) {
    if (!fields(row, ['localId', 'sequence', 'stand', 'source']) || !context.documents.has(row.localId as string)
      || !positiveInteger(row.sequence) || context.baselines.has(row.localId as string)) return false;
    const localId = row.localId as string;
    const document = context.documents.get(localId);
    const checkpoint = context.checkpoints.get(localId)?.get(row.sequence as number);
    if (!checkpoint || !validSnapshot(row.stand) || !sameSnapshot(row.stand, checkpoint)) return false;
    if (!document || !withinSourceLimits(row.source) || !bindsEnvelopeSource(row.source, document.rootType as never, document.oscalVersion)) return false;
    context.baselines.add(localId);
  }
  return true;
}

/** Call in store dependency order; retained state contains identifiers, never source graphs. */
export function createWorkspaceStructureValidator(version: 1 | 2 = STORAGE_SCHEMA_VERSION) {
  const context = newContext(version);
  return {
    verbuende: (row: WorkspaceBackup['verbuende'][number]) => collectVerbuende(context, [row]),
    documents: (row: WorkspaceBackup['documents'][number]) => collectDocuments(context, [row]),
    drafts: (row: WorkspaceBackup['drafts'][number]) => validDrafts(context, [row]),
    bindings: (row: WorkspaceBackup['bindings'][number]) => collectBindings(context, [row]),
    reviewTrail: (row: ReviewTrailRow) => collectReviewTrail(context, [row]),
    reviewBaseline: (row: WorkspaceBackup['reviewBaseline'][number]) => collectReviewBaseline(context, [row]),
    workspaceMeta: (row: WorkspaceBackup['workspaceMeta'][number]) => {
      if (context.metaSeen || !validWorkspaceMeta([row], version)) return false;
      context.metaSeen = true;
      return true;
    },
    get hasWorkspaceMeta() { return context.metaSeen; },
  };
}

function validBackupStructure(value: unknown, format: 'gspp-workspace' | 'gspp-workspace-verbund', version: 1 | 2): boolean {
  const required = ['format', 'storageSchemaVersion', 'verbuende', 'documents', 'drafts', 'bindings'];
  if (format === 'gspp-workspace') required.push('workspaceMeta');
  if (version === STORAGE_SCHEMA_VERSION) required.push('reviewTrail', 'reviewBaseline');
  if (!fields(value, required) || value.format !== format || value.storageSchemaVersion !== version
    || ![value.verbuende, value.documents, value.drafts, value.bindings].every(Array.isArray)) return false;
  const backup = value as unknown as WorkspaceBackup;
  if (!Array.isArray(backup.verbuende) || !Array.isArray(backup.documents)) return false;
  if (format === 'gspp-workspace' && (!Array.isArray(backup.workspaceMeta) || !validWorkspaceMeta(backup.workspaceMeta, version))) return false;
  if (format === 'gspp-workspace-verbund' && backup.verbuende.length !== 1) return false;
  const context = newContext(version);
  const trail = version === STORAGE_SCHEMA_VERSION ? backup.reviewTrail : [];
  const baseline = version === STORAGE_SCHEMA_VERSION ? backup.reviewBaseline : [];
  if (version === STORAGE_SCHEMA_VERSION && (!Array.isArray(trail) || !Array.isArray(baseline))) return false;
  return collectVerbuende(context, backup.verbuende) && collectDocuments(context, backup.documents)
    && validDrafts(context, backup.drafts) && collectBindings(context, backup.bindings)
    && collectReviewTrail(context, trail) && collectReviewBaseline(context, baseline);
}

export function validWorkspaceBackupStructure(value: unknown): value is WorkspaceBackup {
  return validBackupStructure(value, 'gspp-workspace', STORAGE_SCHEMA_VERSION);
}
export function validVerbundBackupStructure(value: unknown): value is WorkspaceVerbundBackup {
  return validBackupStructure(value, 'gspp-workspace-verbund', STORAGE_SCHEMA_VERSION);
}

function upgradeRows<T extends object>(rows: readonly T[]): T[] {
  return rows.map(row => ({ ...row, storageSchemaVersion: STORAGE_SCHEMA_VERSION }));
}

/** Ein v1-Bündel wird beim Restore auf v2 normalisiert; die Historie startet leer. */
export function normalizeWorkspaceBackup(value: unknown): WorkspaceBackup | null {
  if (validWorkspaceBackupStructure(value)) return value;
  if (!validBackupStructure(value, 'gspp-workspace', 1)) return null;
  const legacy = value as unknown as WorkspaceBackup;
  return {
    format: 'gspp-workspace',
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    verbuende: legacy.verbuende,
    documents: upgradeRows(legacy.documents) as WorkspaceEnvelope[],
    drafts: legacy.drafts,
    bindings: legacy.bindings,
    workspaceMeta: upgradeRows(legacy.workspaceMeta),
    reviewTrail: [],
    reviewBaseline: [],
  };
}

export function normalizeVerbundBackup(value: unknown): WorkspaceVerbundBackup | null {
  if (validVerbundBackupStructure(value)) return value;
  if (!validBackupStructure(value, 'gspp-workspace-verbund', 1)) return null;
  const legacy = value as unknown as WorkspaceVerbundBackup;
  return {
    format: 'gspp-workspace-verbund',
    storageSchemaVersion: STORAGE_SCHEMA_VERSION,
    verbuende: legacy.verbuende,
    documents: upgradeRows(legacy.documents) as WorkspaceEnvelope[],
    drafts: legacy.drafts,
    bindings: legacy.bindings,
    reviewTrail: [],
    reviewBaseline: [],
  };
}
