import Dexie, { type Table } from 'dexie';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { listArtifacts } from '@/domain/sourceRegistry';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import {
  STORAGE_SCHEMA_VERSION, isVerbundName,
  type DocumentState, type LocalId, type VerbundId, type WorkspaceBinding,
  type WorkspaceDraft, type WorkspaceEnvelope, type WorkspaceMeta, type WorkspaceDocumentSummary,
  type WorkspaceResult, type WorkspaceVerbund,
  type ReviewBaseline, type ReviewCheckpoint, type ReviewDecision, type ReviewDecisionKind, type ReviewTrailRow,
  type ReviewTrailView, type DocumentSnapshot,
} from '@/domain/workspaceModel';
import { snapshotDocument, assertAdmissible, assertState, pointerValue } from '@/adapters/workspaceDocumentAdmission';
import { parseWorkspaceBackup, parseVerbundBackup } from '@/adapters/workspaceBackup';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { exportNewerWorkspaceBackup } from '@/adapters/workspaceRecoveryStorage';
import { exportWorkspaceBackupSnapshot, restoreWorkspaceBackupSnapshot, exportVerbundBackupSnapshot, restoreVerbundBackupSnapshot, writtenRow } from '@/adapters/workspaceBackupStorage';
import { StorageFailure, failure, reject, timestamp } from '@/adapters/workspaceStorageFailure';
import { deleteDatabase, storedDatabaseShape, withinDeadline } from '@/adapters/workspaceDatabaseLifecycle';
import { migrateWorkspaceStorage } from '@/adapters/workspaceMigration';
import { reviewTrailInWorker } from '@/adapters/reviewTrailWork';
import { appendDecisionError, deriveReviewState, resolveActionReferences, REVIEW_ACTIONS_SYSTEM, REVIEW_ACTION_TYPE_APPROVED } from '@/domain/reviewTrail';
import { documentBody } from '@/domain/documentContent';
import { isJsonObject, readArray, type JsonObject } from '@/domain/jsonGuards';

export const WORKSPACE_DATABASE_NAME = 'gspp-workspace';
export const WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS = 2_000;
export const WORKSPACE_OPEN_TIMEOUT_MS = 2_000;

/** Schema of the current version; the v1 shape stays available for the migration step. */
export const WORKSPACE_SCHEMA = Object.freeze({
  verbuende: 'verbundId',
  documents: 'localId, verbundId, rootType, oscalVersion, savedAt',
  drafts: 'localId',
  bindings: '[fromLocalId+pointer], target.localId',
  reviewTrail: '[localId+sequence], localId',
  reviewBaseline: 'localId',
  workspaceMeta: 'id',
});

export const WORKSPACE_SCHEMA_V1 = Object.freeze({
  verbuende: 'verbundId',
  documents: 'localId, verbundId, rootType, oscalVersion, savedAt',
  drafts: 'localId',
  bindings: '[fromLocalId+pointer], target.localId',
  workspaceMeta: 'id',
});

/** Die native Freigabe wird mit dem Dokumentenschreibvorgang atomar geschrieben. */
export interface ReviewApprovalRequest {
  /** UUID der Aktion, die der Aufrufer bereits in `metadata.actions` eingetragen hat. */
  readonly actionUuid: string;
  /** Trail-Sequenz, gegen die der Aufrufer gelesen hat; ein anderer Wert ist ein Konflikt. */
  readonly expectedSequence: number;
  readonly roleId: string;
  readonly partyUuids: readonly string[];
  readonly reason?: string;
}

interface StoreDocumentOptions {
  readonly changedBindings?: readonly WorkspaceBinding[];
  readonly state?: DocumentState;
  readonly approval?: ReviewApprovalRequest;
  readonly resetBaseline?: boolean;
}

/** `approved` läuft ausschließlich über `saveDocument`; hier bleiben die Workspace-Entscheidungen. */
export interface ReviewDecisionRequest {
  readonly decision: Exclude<ReviewDecisionKind, 'approved'>;
  readonly expectedSequence: number;
  readonly withdraws?: { readonly sequence: number; readonly actionUuid: string };
  readonly roleId?: string;
  readonly partyUuids?: readonly string[];
  readonly reason?: string;
}

function approvalMatches(action: JsonObject, approval: ReviewApprovalRequest): boolean {
  if (action.type !== REVIEW_ACTION_TYPE_APPROVED || action.system !== REVIEW_ACTIONS_SYSTEM) return false;
  const responsible = readArray(action['responsible-parties']).filter(isJsonObject);
  if (responsible.length !== 1) return false;
  const parties = readArray(responsible[0]['party-uuids']);
  const expected = new Set(approval.partyUuids);
  return responsible[0]['role-id'] === approval.roleId && expected.size > 0 && expected.size === parties.length
    && approval.partyUuids.length === parties.length
    && parties.every(uuid => typeof uuid === 'string' && expected.has(uuid));
}

/** No singleton, cached sources, search index or document-content event payloads. */
export class WorkspaceStore {
  private readonly db: Dexie;
  // Bound on use: a newer schema without one of these stores still opens for the global export.
  private get documents(): Table<WorkspaceEnvelope, LocalId> { return this.db.table('documents'); }
  private get verbuende(): Table<WorkspaceVerbund, VerbundId> { return this.db.table('verbuende'); }
  private get drafts(): Table<WorkspaceDraft, LocalId> { return this.db.table('drafts'); }
  private get bindings(): Table<WorkspaceBinding, [LocalId, string]> { return this.db.table('bindings'); }
  private get reviewTrail(): Table<ReviewTrailRow, [LocalId, number]> { return this.db.table('reviewTrail'); }
  private get reviewBaseline(): Table<ReviewBaseline, LocalId> { return this.db.table('reviewBaseline'); }
  private get meta(): Table<WorkspaceMeta, string> { return this.db.table('workspaceMeta'); }

  /** Dexie reports a fallback version for an undeclared open, so the newer path is decided once from the native version. */
  private readonly newerSchema: boolean;
  private constructor(db: Dexie, newerSchema: boolean) { this.db = db; this.newerSchema = newerSchema; }

  /** IndexedDB queues every open behind a pending `deleteDatabase`; the deadline keeps that wait terminal. */
  static open(): Promise<WorkspaceResult<WorkspaceStore>> {
    // A connection that opens after the deadline is never handed out and must not hold the database open.
    return withinDeadline(WORKSPACE_OPEN_TIMEOUT_MS, 'WORKSPACE_OPEN_TIMEOUT', expired => WorkspaceStore.openDatabase(expired), late => { if (late.ok) late.value.close(); });
  }

  private static async openDatabase(expired: () => boolean): Promise<WorkspaceResult<WorkspaceStore>> {
    let db = new Dexie(WORKSPACE_DATABASE_NAME);
    let newerSchema = false;
    try {
      // Dynamic opening keeps newer databases readable without a downgrade.
      const exists = await Dexie.exists(WORKSPACE_DATABASE_NAME);
      // After the deadline nobody receives the store, so a late open must not recreate a deleted database.
      if (expired()) reject('WORKSPACE_OPEN_TIMEOUT');
      // A database deleted between the check and the shape read is reported as absent.
      const stored = exists ? await storedDatabaseShape(WORKSPACE_DATABASE_NAME) : undefined;
      if (!stored) {
        if (expired()) reject('WORKSPACE_OPEN_TIMEOUT');
        this.declareVersions(db);
        db.on('populate', transaction => {
          const now = timestamp();
          return transaction.table('workspaceMeta').add({ id: 'workspace', storageSchemaVersion: STORAGE_SCHEMA_VERSION, createdAt: now, savedAt: now });
        });
        await db.open();
      } else {
        // Declared versions would reconcile and rewrite an unknown schema, so the stored shape decides the path.
        newerSchema = stored.version > STORAGE_SCHEMA_VERSION;
        const known = Object.keys(stored.version >= STORAGE_SCHEMA_VERSION ? WORKSPACE_SCHEMA : WORKSPACE_SCHEMA_V1);
        if (newerSchema || known.some(store => !stored.stores.includes(store))) {
          if (expired()) reject('WORKSPACE_OPEN_TIMEOUT');
          db = new Dexie(WORKSPACE_DATABASE_NAME);
          await db.open();
        } else {
          this.declareVersions(db);
          await db.open();
        }
      }
      return { ok: true, value: new WorkspaceStore(db, newerSchema) };
    } catch (error) { db.close(); return failure(error); }
  }

  /** Both versions are declared so an existing v1 database runs the same upgrade that a fresh one skips. */
  private static declareVersions(db: Dexie): void {
    db.version(1).stores(WORKSPACE_SCHEMA_V1);
    db.version(STORAGE_SCHEMA_VERSION).stores(WORKSPACE_SCHEMA)
      .upgrade(async (transaction) => {
        try { await migrateWorkspaceStorage(transaction, 1, STORAGE_SCHEMA_VERSION); }
        catch { reject('WORKSPACE_MIGRATION_FAILED'); }
      });
  }

  /** Read-only rescue export after a failed migration; never creates a missing database. */
  static exportRecoveryBackup(): Promise<WorkspaceResult<string>> {
    return withinDeadline(WORKSPACE_OPEN_TIMEOUT_MS, 'WORKSPACE_OPEN_TIMEOUT', expired => WorkspaceStore.readRecoveryBackup(expired), () => undefined);
  }

  private static async readRecoveryBackup(expired: () => boolean): Promise<WorkspaceResult<string>> {
    try {
      if (!await Dexie.exists(WORKSPACE_DATABASE_NAME)) reject('WORKSPACE_STORAGE_FAILED');
      if (expired()) reject('WORKSPACE_OPEN_TIMEOUT');
      const db = new Dexie(WORKSPACE_DATABASE_NAME);
      try {
        await db.open();
        if (expired()) reject('WORKSPACE_OPEN_TIMEOUT');
        return await exportNewerWorkspaceBackup(db);
      } finally { db.close(); }
    } catch (error) { return failure(error); }
  }

  close(): void { this.db.close(); }

  private async read<T>(stores: readonly string[], operation: () => Promise<T>): Promise<WorkspaceResult<T>> {
    try {
      const present = new Set(this.db.tables.map(table => table.name));
      if (stores.some(store => !present.has(store))) reject(this.newerSchema ? 'WORKSPACE_SCHEMA_NEWER' : 'WORKSPACE_SCHEMA_INVALID');
      return { ok: true, value: await this.db.transaction('r', [...stores], operation) };
    } catch (error) { return failure(error); }
  }

  /** Every savedAt written in one transaction is its stamp; workspaceMeta.savedAt therefore bounds every issued comparison value. Without `touchMeta` the operation is a restore and issues its own stamp (`restoredStamp()`). */
  private async write<T>(operation: (stamp: string) => Promise<T>, touchMeta = true): Promise<WorkspaceResult<T>> {
    try {
      if (this.newerSchema) reject('WORKSPACE_SCHEMA_NEWER');
      const value = await this.db.transaction('rw', this.db.tables, async () => {
        const meta = await this.meta.get('workspace');
        if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
        if (meta.storageSchemaVersion > STORAGE_SCHEMA_VERSION) reject('WORKSPACE_SCHEMA_NEWER');
        const stamp = touchMeta ? timestamp(meta.savedAt) : meta.savedAt;
        const result = await operation(stamp);
        if (touchMeta) await this.meta.put({ ...meta, savedAt: stamp });
        return result;
      });
      return { ok: true, value };
    } catch (error) { return failure(error); }
  }

  /** `newer`: the stored schema is above this build's version; writes stay locked, reading and the global export remain. */
  async schemaStatus(): Promise<WorkspaceResult<'current' | 'newer'>> {
    if (this.newerSchema) return { ok: true, value: 'newer' };
    const meta = await this.read(['workspaceMeta'], () => this.meta.get('workspace'));
    if (!meta.ok) return meta;
    return { ok: true, value: (meta.value?.storageSchemaVersion ?? 0) > STORAGE_SCHEMA_VERSION ? 'newer' : 'current' };
  }

  listVerbuende(): Promise<WorkspaceResult<WorkspaceVerbund[]>> { return this.read(['verbuende'], () => this.verbuende.toArray()); }
  listDocuments(verbundId?: VerbundId): Promise<WorkspaceResult<WorkspaceDocumentSummary[]>> {
    return this.read(['documents'], async () => {
      const summaries: WorkspaceDocumentSummary[] = [];
      const collection = verbundId === undefined ? this.documents.toCollection() : this.documents.where('verbundId').equals(verbundId);
      await collection.each(row => {
        const summary = writtenRow({ ...row });
        delete summary.source;
        summaries.push(summary);
      });
      return summaries;
    });
  }
  getDocument(localId: LocalId): Promise<WorkspaceResult<WorkspaceEnvelope | undefined>> { return this.read(['documents'], () => this.documents.get(localId)); }
  getDraft(localId: LocalId): Promise<WorkspaceResult<WorkspaceDraft | undefined>> { return this.read(['drafts'], () => this.drafts.get(localId)); }
  listBindings(): Promise<WorkspaceResult<WorkspaceBinding[]>> { return this.read(['bindings'], () => this.bindings.toArray()); }

  createVerbund(name: string): Promise<WorkspaceResult<WorkspaceVerbund>> {
    return this.write(async stamp => {
      if (!isVerbundName(name)) reject('WORKSPACE_VERBUND_INVALID');
      const verbund = { verbundId: crypto.randomUUID() as VerbundId, name, createdAt: stamp, savedAt: stamp };
      await this.verbuende.add(verbund);
      return verbund;
    });
  }

  renameVerbund(verbundId: VerbundId, name: string): Promise<WorkspaceResult<WorkspaceVerbund>> {
    return this.write(async stamp => {
      const verbund = await this.verbuende.get(verbundId);
      if (!verbund) reject('WORKSPACE_VERBUND_NOT_FOUND');
      if (!isVerbundName(name)) reject('WORKSPACE_VERBUND_INVALID');
      const updated = { ...verbund, name, savedAt: stamp };
      await this.verbuende.put(updated);
      return updated;
    });
  }

  /** `outgoing` binds the new document in the same transaction; an invalid binding stores nothing. */
  async addDocument(verbundId: VerbundId, input: Class2OscalImportedDocument, state: DocumentState = 'imported', outgoing: readonly Omit<WorkspaceBinding, 'fromLocalId'>[] = [], signal?: AbortSignal): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    try {
      assertState(state);
      const bindingSnapshot = structuredClone(outgoing);
      const { document } = await snapshotDocument(input, state);
      if (signal?.aborted) reject('WORKSPACE_OPERATION_CANCELLED');
      return this.write(async stamp => {
        if (!await this.verbuende.get(verbundId)) reject('WORKSPACE_VERBUND_NOT_FOUND');
        if (signal?.aborted) reject('WORKSPACE_OPERATION_CANCELLED');
        const envelope: WorkspaceEnvelope = {
          localId: crypto.randomUUID() as LocalId, verbundId, storageSchemaVersion: STORAGE_SCHEMA_VERSION,
          source: document.source, rootType: document.rootType, oscalVersion: document.oscalVersion,
          trustClass: 'class-2-local-user', documentState: state, createdAt: stamp, savedAt: stamp,
        };
        if ((document.source as Record<string, { uuid?: string }>)[document.rootType]?.uuid === envelope.localId) reject('WORKSPACE_DOCUMENT_INVALID');
        await this.documents.add(envelope);
        for (const binding of bindingSnapshot) await this.putBinding({ ...binding, fromLocalId: envelope.localId });
        return envelope;
      });
    } catch (error) { return failure(error); }
  }

  private async current(localId: LocalId, expectedSavedAt?: string, expectedDraftSavedAt?: string | null): Promise<WorkspaceEnvelope> {
    const current = await this.documents.get(localId);
    if (!current) reject('WORKSPACE_DOCUMENT_NOT_FOUND');
    if (expectedSavedAt !== undefined && current.savedAt !== expectedSavedAt) reject('WORKSPACE_SAVE_CONFLICT');
    // null: no stored draft expected. Autosave leaves documents.savedAt unchanged, so the draft needs its own check.
    if (expectedDraftSavedAt !== undefined && ((await this.drafts.get(localId))?.savedAt ?? null) !== expectedDraftSavedAt) reject('WORKSPACE_SAVE_CONFLICT');
    return current;
  }

  async saveDocument(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, input: Class2OscalImportedDocument, changedBindings?: readonly WorkspaceBinding[], state?: DocumentState, approval?: ReviewApprovalRequest): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    return this.storeDocument(localId, expectedSavedAt, expectedDraftSavedAt, input, { changedBindings, state, approval });
  }

  private async storeDocument(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, input: Class2OscalImportedDocument, options: StoreDocumentOptions): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    const { changedBindings, state, approval, resetBaseline = false } = options;
    try {
      const bindingSnapshot = changedBindings === undefined ? undefined : structuredClone(changedBindings);
      if (state !== undefined) assertState(state);
      const { document, schemaValid } = await snapshotDocument(input, state);
      let approvalStand: DocumentSnapshot | undefined;
      if (approval) {
        // The approval gate holds for every caller: a schema-valid source and a stored state that is not draft.
        if (state === 'draft') reject('REVIEW_APPROVAL_BLOCKED');
        if (!schemaValid) reject('REVIEW_APPROVAL_SCHEMA');
        // Schema validity is no reference resolution: a missing or ambiguous role/party stops before any write.
        const metadata = documentBody(document.source, document.rootType)?.metadata;
        const action = readArray(isJsonObject(metadata) ? metadata.actions : undefined)
          .find(entry => isJsonObject(entry) && entry.uuid === approval.actionUuid);
        if (!isJsonObject(action) || !approvalMatches(action, approval)) reject('REVIEW_APPROVAL_INVALID');
        const findings = resolveActionReferences(action, metadata);
        if (findings.length) reject(findings[0].code);
        const work = await reviewTrailInWorker({ source: document.source, rootType: document.rootType, previous: null, baseSequence: null, diff: false });
        if (!work.ok) return work;
        approvalStand = work.value.snapshot;
      }
      return await this.write(async stamp => {
        const current = await this.current(localId, expectedSavedAt, expectedDraftSavedAt);
        assertAdmissible(state ?? current.documentState, schemaValid);
        if (approval && (state ?? current.documentState) === 'draft') reject('REVIEW_APPROVAL_BLOCKED');
        if ((document.source as Record<string, { uuid?: string }>)[document.rootType]?.uuid === localId) reject('WORKSPACE_DOCUMENT_INVALID');
        const updated: WorkspaceEnvelope = { ...writtenRow(current), source: document.source, rootType: document.rootType, oscalVersion: document.oscalVersion, savedAt: stamp, documentState: state ?? current.documentState };
        await this.documents.put(updated);
        if (bindingSnapshot !== undefined) {
          // Replaces this document's outgoing set, keeping incoming bindings.
          await this.bindings.where('[fromLocalId+pointer]').between([localId, Dexie.minKey], [localId, Dexie.maxKey]).delete();
          for (const binding of bindingSnapshot) {
            if (binding.fromLocalId !== localId) reject('WORKSPACE_BINDING_INVALID');
            await this.putBinding(binding);
          }
        }
        await this.drafts.delete(localId);
        // A replaced document starts a new comparison line; older checkpoints stay history.
        if (resetBaseline) await this.reviewBaseline.delete(localId);
        if (approval && approvalStand) {
          await this.appendDecisionRow(localId, 'approved', approval.expectedSequence, approvalStand, stamp, {
            actionUuid: approval.actionUuid, roleId: approval.roleId, partyUuids: [...approval.partyUuids], reason: approval.reason,
          });
        }
        return updated;
      });
    } catch (error) { return failure(error); }
  }

  replaceDocument(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, input: Class2OscalImportedDocument): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    return this.storeDocument(localId, expectedSavedAt, expectedDraftSavedAt, input, { resetBaseline: true });
  }

  async autosaveDraft(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, source: unknown): Promise<WorkspaceResult<WorkspaceDraft>> {
    try {
      if (enforceClass2ObjectGraphInvariants(source)) reject('WORKSPACE_DRAFT_INVALID');
      if (new TextEncoder().encode(serializeWorkspaceJson(source)).byteLength > CLASS_2_IMPORT_LIMITS.maxBytes) reject('WORKSPACE_DRAFT_INVALID');
      const snapshot = structuredClone(source);
      return this.write(async stamp => {
        await this.current(localId, expectedSavedAt, expectedDraftSavedAt);
        const draft = { localId, source: snapshot, savedAt: stamp };
        await this.drafts.put(draft);
        return draft;
      });
    } catch (error) { return failure(error); }
  }

  /** Trail plus Stand des gespeicherten Dokuments; der Hash entsteht im Worker. */
  async listReviewTrail(localId: LocalId): Promise<WorkspaceResult<ReviewTrailView>> {
    try {
      const read = await this.read(['documents', 'drafts', 'reviewTrail'], async () => {
        const document = await this.documents.get(localId);
        if (!document) reject('WORKSPACE_DOCUMENT_NOT_FOUND');
        return {
          document,
          draftSavedAt: (await this.drafts.get(localId))?.savedAt ?? null,
          trail: await this.reviewTrail.where('localId').equals(localId).toArray(),
        };
      });
      if (!read.ok) return read;
      const work = await reviewTrailInWorker({ source: read.value.document.source, rootType: read.value.document.rootType, previous: null, baseSequence: null, diff: false });
      if (!work.ok) return work;
      return { ok: true, value: { trail: read.value.trail, stand: work.value.snapshot, document: read.value.document, draftSavedAt: read.value.draftSavedAt } };
    } catch (error) { return failure(error); }
  }

  /** Ein Checkpoint schreibt nur Trail und Baseline, nie das Dokument. */
  async appendCheckpoint(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, expectedSequence: number): Promise<WorkspaceResult<ReviewCheckpoint>> {
    try {
      const read = await this.read(['documents', 'reviewBaseline'], async () => {
        const document = await this.documents.get(localId);
        if (!document) reject('WORKSPACE_DOCUMENT_NOT_FOUND');
        return { document, baseline: await this.reviewBaseline.get(localId) };
      });
      if (!read.ok) return read;
      const { document, baseline } = read.value;
      const work = await reviewTrailInWorker({
        source: document.source, rootType: document.rootType,
        previous: baseline?.source ?? null, baseSequence: baseline?.sequence ?? null, diff: true,
      });
      if (!work.ok) return work;
      const diff = work.value.diff;
      if (!diff) reject('REVIEW_TRAIL_WORK_FAILED');
      return await this.write(async stamp => {
        const current = await this.current(localId, expectedSavedAt, expectedDraftSavedAt);
        // A checkpoint binds a saved stand; an ungespeicherter Entwurf wäre sofort überholt.
        if (current.documentState === 'draft' || await this.drafts.get(localId)) reject('REVIEW_CHECKPOINT_NOT_ALLOWED');
        const last = await this.lastSequence(localId);
        if (last !== expectedSequence) reject('WORKSPACE_SAVE_CONFLICT');
        const checkpoint: ReviewCheckpoint = {
          localId, sequence: last + 1, kind: 'checkpoint', createdAt: stamp,
          documentState: current.documentState, stand: work.value.snapshot, diff,
        };
        await this.reviewTrail.add(checkpoint);
        await this.reviewBaseline.put({ localId, sequence: checkpoint.sequence, stand: checkpoint.stand, source: document.source });
        return checkpoint;
      });
    } catch (error) { return failure(error); }
  }

  /** Prüfung, Änderungsanforderung und Rücknahme; `approved` läuft über `saveDocument`. */
  async appendDecision(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, request: ReviewDecisionRequest): Promise<WorkspaceResult<ReviewDecision>> {
    try {
      const read = await this.read(['documents', 'reviewTrail'], async () => {
        const document = await this.documents.get(localId);
        if (!document) reject('WORKSPACE_DOCUMENT_NOT_FOUND');
        const trail = await this.reviewTrail.where('localId').equals(localId).toArray();
        const error = appendDecisionError(deriveReviewState(trail), request);
        if (error) reject(error);
        return document;
      });
      if (!read.ok) return read;
      const work = await reviewTrailInWorker({ source: read.value.source, rootType: read.value.rootType, previous: null, baseSequence: null, diff: false });
      if (!work.ok) return work;
      return await this.write(async stamp => {
        await this.current(localId, expectedSavedAt, expectedDraftSavedAt);
        return this.appendDecisionRow(localId, request.decision, request.expectedSequence, work.value.snapshot, stamp, request);
      });
    } catch (error) { return failure(error); }
  }

  private async lastSequence(localId: LocalId): Promise<number> {
    const last = await this.reviewTrail.where('localId').equals(localId).last();
    return last?.sequence ?? 0;
  }

  /** Läuft in der Schreibtransaktion; Übergang und Ziel der Rücknahme werden dort erneut geprüft. */
  private async appendDecisionRow(localId: LocalId, decision: ReviewDecisionKind, expectedSequence: number, stand: DocumentSnapshot, createdAt: string, extra: Partial<Pick<ReviewDecision, 'actionUuid' | 'withdraws' | 'roleId' | 'partyUuids' | 'reason'>>): Promise<ReviewDecision> {
    const last = await this.lastSequence(localId);
    if (last !== expectedSequence) reject('WORKSPACE_SAVE_CONFLICT');
    const trail = await this.reviewTrail.where('localId').equals(localId).toArray();
    const error = appendDecisionError(deriveReviewState(trail), { decision, withdraws: extra.withdraws });
    if (error) reject(error);
    if (extra.withdraws) {
      const target = await this.reviewTrail.get([localId, extra.withdraws.sequence]);
      if (target?.kind !== 'decision' || target.actionUuid !== extra.withdraws.actionUuid) reject('REVIEW_WITHDRAWAL_TARGET_UNKNOWN');
    }
    const row: ReviewDecision = {
      localId, sequence: last + 1, kind: 'decision', createdAt, decision, stand,
      ...(extra.actionUuid === undefined ? {} : { actionUuid: extra.actionUuid }),
      ...(extra.withdraws === undefined ? {} : { withdraws: extra.withdraws }),
      ...(extra.roleId === undefined ? {} : { roleId: extra.roleId }),
      ...(extra.partyUuids === undefined ? {} : { partyUuids: extra.partyUuids }),
      ...(extra.reason === undefined || extra.reason === '' ? {} : { reason: extra.reason }),
    };
    await this.reviewTrail.add(row);
    return row;
  }

  private async putBinding(binding: WorkspaceBinding, expectedSavedAt?: string): Promise<void> {
    const from = await this.current(binding.fromLocalId, expectedSavedAt);
    if (typeof binding.pointer !== 'string' || typeof binding.href !== 'string' || pointerValue(from.source, binding.pointer) !== binding.href) reject('WORKSPACE_BINDING_INVALID');
    if (binding.target?.kind === 'local') {
      const target = await this.current(binding.target.localId);
      if (from.verbundId !== target.verbundId) reject('WORKSPACE_BINDING_CROSS_VERBUND');
    } else if (binding.target?.kind === 'class-1') {
      const artifactKey = binding.target.artifactKey;
      if (!listArtifacts({ lifecycle: 'supported' }).some(artifact => artifact.artifactKey === artifactKey)) reject('WORKSPACE_ARTIFACT_UNSUPPORTED');
    } else reject('WORKSPACE_BINDING_INVALID');
    // Explicit construction prevents callers attaching content to the target.
    const target = binding.target.kind === 'local'
      ? { kind: 'local' as const, localId: binding.target.localId }
      : { kind: 'class-1' as const, artifactKey: binding.target.artifactKey };
    await this.bindings.put({ fromLocalId: binding.fromLocalId, pointer: binding.pointer, href: binding.href, target });
  }

  async setBinding(binding: WorkspaceBinding, expectedSavedAt: string): Promise<WorkspaceResult<void>> {
    try {
      const snapshot = structuredClone(binding);
      return this.write(async stamp => { await this.putBinding(snapshot, expectedSavedAt ?? ''); await this.touchDocument(snapshot.fromLocalId, stamp); });
    }
    catch (error) { return failure(error); }
  }
  removeBinding(fromLocalId: LocalId, pointer: string, expectedSavedAt: string): Promise<WorkspaceResult<void>> {
    return this.write(async stamp => {
      await this.current(fromLocalId, expectedSavedAt ?? '');
      if (!await this.bindings.get([fromLocalId, pointer])) return;
      await this.bindings.delete([fromLocalId, pointer]);
      await this.touchDocument(fromLocalId, stamp);
    });
  }

  private async touchDocument(localId: LocalId, savedAt: string): Promise<void> {
    const document = await this.current(localId);
    await this.documents.put(writtenRow({ ...document, savedAt }));
  }

  private async removeDocument(localId: LocalId, stamp: string): Promise<void> {
    const incoming = await this.bindings.where('target.localId').equals(localId).toArray();
    for (const sourceId of new Set(incoming.map(binding => binding.fromLocalId))) {
      if (sourceId !== localId) await this.touchDocument(sourceId, stamp);
    }
    await this.bindings.where('target.localId').equals(localId).delete();
    await this.bindings.where('[fromLocalId+pointer]').between([localId, Dexie.minKey], [localId, Dexie.maxKey]).delete();
    await this.drafts.delete(localId);
    await this.reviewTrail.where('localId').equals(localId).delete();
    await this.reviewBaseline.delete(localId);
    await this.documents.delete(localId);
  }
  deleteDocument(localId: LocalId): Promise<WorkspaceResult<void>> {
    return this.write(async stamp => { await this.current(localId); await this.removeDocument(localId, stamp); });
  }
  deleteVerbund(verbundId: VerbundId): Promise<WorkspaceResult<void>> {
    return this.write(async stamp => {
      if (!await this.verbuende.get(verbundId)) reject('WORKSPACE_VERBUND_NOT_FOUND');
      const ids = await this.documents.where('verbundId').equals(verbundId).primaryKeys();
      for (const id of ids) await this.removeDocument(id, stamp);
      await this.verbuende.delete(verbundId);
    });
  }

  exportBackup(): Promise<WorkspaceResult<string>> { return this.newerSchema ? exportNewerWorkspaceBackup(this.db) : this.read(this.db.tables.map(table => table.name), () => exportWorkspaceBackupSnapshot(this.db)); }
  exportVerbundBackup(verbundId: VerbundId): Promise<WorkspaceResult<string>> {
    return this.read(this.db.tables.map(table => table.name), () => exportVerbundBackupSnapshot(this.db, verbundId));
  }

  async restoreBackup(bytes: Uint8Array, confirmation: 'replace-workspace'): Promise<WorkspaceResult<void>> {
    if (confirmation !== 'replace-workspace') return failure(new StorageFailure('WORKSPACE_CONFIRMATION_REQUIRED'));
    const parsed = await parseWorkspaceBackup(bytes);
    if (!parsed.ok) return parsed;
    return this.write(() => restoreWorkspaceBackupSnapshot(this.db, parsed.value), false);
  }
  async restoreVerbundBackup(bytes: Uint8Array, confirmation: 'replace-verbund'): Promise<WorkspaceResult<void>> {
    if (confirmation !== 'replace-verbund') return failure(new StorageFailure('WORKSPACE_CONFIRMATION_REQUIRED'));
    const parsed = await parseVerbundBackup(bytes);
    if (!parsed.ok) return parsed;
    return this.write(() => restoreVerbundBackupSnapshot(this.db, parsed.value), false);
  }

  async estimate(): Promise<WorkspaceResult<StorageEstimate | undefined>> {
    try { return { ok: true, value: await navigator.storage?.estimate?.() }; }
    catch (error) { return failure(error); }
  }

  async deleteAll(confirmation: 'delete-workspace'): Promise<WorkspaceResult<void>> {
    if (confirmation !== 'delete-workspace') return failure(new StorageFailure('WORKSPACE_CONFIRMATION_REQUIRED'));
    this.close();
    return deleteDatabase(WORKSPACE_DATABASE_NAME, WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS);
  }
}
