import Dexie, { type Table } from 'dexie';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { listArtifacts } from '@/domain/sourceRegistry';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import {
  STORAGE_SCHEMA_VERSION, isVerbundName,
  type DocumentState, type LocalId, type VerbundId, type WorkspaceBinding,
  type WorkspaceDraft, type WorkspaceEnvelope, type WorkspaceMeta, type WorkspaceDocumentSummary,
  type WorkspaceResult, type WorkspaceVerbund,
} from '@/domain/workspaceModel';
import { snapshotDocument, assertAdmissible, assertState, pointerValue } from '@/adapters/workspaceDocumentAdmission';
import { parseWorkspaceBackup, parseVerbundBackup } from '@/adapters/workspaceBackup';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { exportNewerWorkspaceBackup } from '@/adapters/workspaceRecoveryStorage';
import { exportWorkspaceBackupSnapshot, restoreWorkspaceBackupSnapshot, exportVerbundBackupSnapshot, restoreVerbundBackupSnapshot, writtenRow } from '@/adapters/workspaceBackupStorage';
import { StorageFailure, failure, reject, timestamp } from '@/adapters/workspaceStorageFailure';
import { deleteDatabase, withinDeadline } from '@/adapters/workspaceDatabaseLifecycle';

export const WORKSPACE_DATABASE_NAME = 'gspp-workspace';
export const WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS = 2_000;
export const WORKSPACE_OPEN_TIMEOUT_MS = 2_000;
export const WORKSPACE_SCHEMA = Object.freeze({
  verbuende: 'verbundId',
  documents: 'localId, verbundId, rootType, oscalVersion, savedAt',
  drafts: 'localId',
  bindings: '[fromLocalId+pointer], target.localId',
  workspaceMeta: 'id',
});

/** No singleton, cached sources, search index or document-content event payloads. */
export class WorkspaceStore {
  private readonly db: Dexie;
  // Bound on use: a newer schema without one of these stores still opens for the global export.
  private get documents(): Table<WorkspaceEnvelope, LocalId> { return this.db.table('documents'); }
  private get verbuende(): Table<WorkspaceVerbund, VerbundId> { return this.db.table('verbuende'); }
  private get drafts(): Table<WorkspaceDraft, LocalId> { return this.db.table('drafts'); }
  private get bindings(): Table<WorkspaceBinding, [LocalId, string]> { return this.db.table('bindings'); }
  private get meta(): Table<WorkspaceMeta, string> { return this.db.table('workspaceMeta'); }

  private constructor(db: Dexie) { this.db = db; }

  /** IndexedDB queues every open behind a pending `deleteDatabase`; the deadline keeps that wait terminal. */
  static open(): Promise<WorkspaceResult<WorkspaceStore>> {
    // A connection that opens after the deadline is never handed out and must not hold the database open.
    return withinDeadline(WORKSPACE_OPEN_TIMEOUT_MS, 'WORKSPACE_OPEN_TIMEOUT', expired => WorkspaceStore.openDatabase(expired), late => { if (late.ok) late.value.close(); });
  }

  private static async openDatabase(expired: () => boolean): Promise<WorkspaceResult<WorkspaceStore>> {
    let db = new Dexie(WORKSPACE_DATABASE_NAME);
    try {
      // Dynamic opening keeps newer databases readable without a downgrade.
      const exists = await Dexie.exists(WORKSPACE_DATABASE_NAME);
      // After the deadline nobody receives the store, so a late open must not recreate a deleted database.
      if (expired()) reject('WORKSPACE_OPEN_TIMEOUT');
      if (!exists) {
        db.version(STORAGE_SCHEMA_VERSION).stores(WORKSPACE_SCHEMA);
        db.on('populate', transaction => {
          const now = timestamp();
          return transaction.table('workspaceMeta').add({ id: 'workspace', storageSchemaVersion: STORAGE_SCHEMA_VERSION, createdAt: now, savedAt: now });
        });
      }
      try { await db.open(); }
      catch (error) {
        if (!(error instanceof Error) || error.name !== 'VersionError') throw error;
        db.close();
        db = new Dexie(WORKSPACE_DATABASE_NAME);
        await db.open();
      }
      return { ok: true, value: new WorkspaceStore(db) };
    } catch (error) { db.close(); return failure(error); }
  }

  close(): void { this.db.close(); }

  private async read<T>(stores: readonly string[], operation: () => Promise<T>): Promise<WorkspaceResult<T>> {
    try {
      const present = new Set(this.db.tables.map(table => table.name));
      if (stores.some(store => !present.has(store))) reject(this.db.verno > STORAGE_SCHEMA_VERSION ? 'WORKSPACE_SCHEMA_NEWER' : 'WORKSPACE_SCHEMA_INVALID');
      return { ok: true, value: await this.db.transaction('r', [...stores], operation) };
    } catch (error) { return failure(error); }
  }

  /** Every savedAt written in one transaction is its stamp; workspaceMeta.savedAt therefore bounds every issued comparison value. Without `touchMeta` the operation is a restore and issues its own stamp (`restoredStamp()`). */
  private async write<T>(operation: (stamp: string) => Promise<T>, touchMeta = true): Promise<WorkspaceResult<T>> {
    try {
      if (this.db.verno > STORAGE_SCHEMA_VERSION) reject('WORKSPACE_SCHEMA_NEWER');
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
    if (this.db.verno > STORAGE_SCHEMA_VERSION) return { ok: true, value: 'newer' };
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
  async addDocument(verbundId: VerbundId, input: Class2OscalImportedDocument, state: DocumentState = 'imported', outgoing: readonly Omit<WorkspaceBinding, 'fromLocalId'>[] = []): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    try {
      assertState(state);
      const bindingSnapshot = structuredClone(outgoing);
      const { document } = await snapshotDocument(input, state);
      return this.write(async stamp => {
        if (!await this.verbuende.get(verbundId)) reject('WORKSPACE_VERBUND_NOT_FOUND');
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

  async saveDocument(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, input: Class2OscalImportedDocument, changedBindings?: readonly WorkspaceBinding[], state?: DocumentState): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    try {
      const bindingSnapshot = changedBindings === undefined ? undefined : structuredClone(changedBindings);
      if (state !== undefined) assertState(state);
      const { document, schemaValid } = await snapshotDocument(input, state);
      return this.write(async stamp => {
        const current = await this.current(localId, expectedSavedAt, expectedDraftSavedAt);
        assertAdmissible(state ?? current.documentState, schemaValid);
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
        return updated;
      });
    } catch (error) { return failure(error); }
  }

  replaceDocument(localId: LocalId, expectedSavedAt: string, expectedDraftSavedAt: string | null, input: Class2OscalImportedDocument): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    return this.saveDocument(localId, expectedSavedAt, expectedDraftSavedAt, input);
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

  exportBackup(): Promise<WorkspaceResult<string>> { return this.db.verno > STORAGE_SCHEMA_VERSION ? exportNewerWorkspaceBackup(this.db) : this.read(this.db.tables.map(table => table.name), () => exportWorkspaceBackupSnapshot(this.db)); }
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
