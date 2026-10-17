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
import { snapshotDocument, assertState, pointerValue } from '@/adapters/workspaceDocumentAdmission';
import { parseWorkspaceBackup, parseVerbundBackup } from '@/adapters/workspaceBackup';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { exportWorkspaceBackupSnapshot, restoreWorkspaceBackupSnapshot, exportVerbundBackupSnapshot, restoreVerbundBackupSnapshot } from '@/adapters/workspaceBackupStorage';
import { StorageFailure, failure, reject, timestamp } from '@/adapters/workspaceStorageFailure';

export const WORKSPACE_DATABASE_NAME = 'gspp-workspace';
export const WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS = 2_000;
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
  private readonly documents: Table<WorkspaceEnvelope, LocalId>;
  private readonly verbuende: Table<WorkspaceVerbund, VerbundId>;
  private readonly drafts: Table<WorkspaceDraft, LocalId>;
  private readonly bindings: Table<WorkspaceBinding, [LocalId, string]>;
  private readonly meta: Table<WorkspaceMeta, string>;

  private constructor(db: Dexie) {
    this.db = db;
    this.documents = db.table('documents');
    this.verbuende = db.table('verbuende');
    this.drafts = db.table('drafts');
    this.bindings = db.table('bindings');
    this.meta = db.table('workspaceMeta');
  }

  static async open(): Promise<WorkspaceResult<WorkspaceStore>> {
    let db = new Dexie(WORKSPACE_DATABASE_NAME);
    try {
      // Dynamic opening keeps newer databases readable without a downgrade.
      if (!await Dexie.exists(WORKSPACE_DATABASE_NAME)) {
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

  private async read<T>(tables: Table[], operation: () => Promise<T>): Promise<WorkspaceResult<T>> {
    try { return { ok: true, value: await this.db.transaction('r', tables, operation) }; }
    catch (error) { return failure(error); }
  }

  private async write<T>(operation: () => Promise<T>, touchMeta = true): Promise<WorkspaceResult<T>> {
    try {
      const value = await this.db.transaction('rw', this.db.tables, async () => {
        const meta = await this.meta.get('workspace');
        if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
        if (this.db.verno > STORAGE_SCHEMA_VERSION || (meta && meta.storageSchemaVersion > STORAGE_SCHEMA_VERSION)) reject('WORKSPACE_SCHEMA_NEWER');
        const result = await operation();
        if (touchMeta) await this.meta.put({ ...meta, savedAt: timestamp(meta.savedAt) });
        return result;
      });
      return { ok: true, value };
    } catch (error) { return failure(error); }
  }

  listVerbuende(): Promise<WorkspaceResult<WorkspaceVerbund[]>> { return this.read([this.verbuende], () => this.verbuende.toArray()); }
  listDocuments(verbundId?: VerbundId): Promise<WorkspaceResult<WorkspaceDocumentSummary[]>> {
    return this.read([this.documents], async () => {
      const summaries: WorkspaceDocumentSummary[] = [];
      const collection = verbundId === undefined ? this.documents.toCollection() : this.documents.where('verbundId').equals(verbundId);
      await collection.each(row => {
        const summary = { ...row };
        delete summary.source;
        summaries.push(summary);
      });
      return summaries;
    });
  }
  getDocument(localId: LocalId): Promise<WorkspaceResult<WorkspaceEnvelope | undefined>> { return this.read([this.documents], () => this.documents.get(localId)); }
  getDraft(localId: LocalId): Promise<WorkspaceResult<WorkspaceDraft | undefined>> { return this.read([this.drafts], () => this.drafts.get(localId)); }
  listBindings(): Promise<WorkspaceResult<WorkspaceBinding[]>> { return this.read([this.bindings], () => this.bindings.toArray()); }

  createVerbund(name: string): Promise<WorkspaceResult<WorkspaceVerbund>> {
    return this.write(async () => {
      if (!isVerbundName(name)) reject('WORKSPACE_VERBUND_INVALID');
      const now = timestamp();
      const verbund = { verbundId: crypto.randomUUID() as VerbundId, name, createdAt: now, savedAt: now };
      await this.verbuende.add(verbund);
      return verbund;
    });
  }

  renameVerbund(verbundId: VerbundId, name: string): Promise<WorkspaceResult<WorkspaceVerbund>> {
    return this.write(async () => {
      const verbund = await this.verbuende.get(verbundId);
      if (!verbund) reject('WORKSPACE_VERBUND_NOT_FOUND');
      if (!isVerbundName(name)) reject('WORKSPACE_VERBUND_INVALID');
      const updated = { ...verbund, name, savedAt: timestamp(verbund.savedAt) };
      await this.verbuende.put(updated);
      return updated;
    });
  }

  async addDocument(verbundId: VerbundId, input: Class2OscalImportedDocument, state: DocumentState = 'imported'): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    try {
      const document = await snapshotDocument(input);
      assertState(state);
      return this.write(async () => {
        if (!await this.verbuende.get(verbundId)) reject('WORKSPACE_VERBUND_NOT_FOUND');
        const now = timestamp();
        const envelope: WorkspaceEnvelope = {
          localId: crypto.randomUUID() as LocalId, verbundId, storageSchemaVersion: STORAGE_SCHEMA_VERSION,
          source: document.source, rootType: document.rootType, oscalVersion: document.oscalVersion,
          trustClass: 'class-2-local-user', documentState: state, createdAt: now, savedAt: now,
        };
        if ((document.source as Record<string, { uuid?: string }>)[document.rootType]?.uuid === envelope.localId) reject('WORKSPACE_DOCUMENT_INVALID');
        await this.documents.add(envelope);
        return envelope;
      });
    } catch (error) { return failure(error); }
  }

  private async current(localId: LocalId, expectedSavedAt?: string): Promise<WorkspaceEnvelope> {
    const current = await this.documents.get(localId);
    if (!current) reject('WORKSPACE_DOCUMENT_NOT_FOUND');
    if (expectedSavedAt !== undefined && current.savedAt !== expectedSavedAt) reject('WORKSPACE_SAVE_CONFLICT');
    return current;
  }

  async saveDocument(localId: LocalId, expectedSavedAt: string, input: Class2OscalImportedDocument, changedBindings?: readonly WorkspaceBinding[], state?: DocumentState): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    try {
      const bindingSnapshot = changedBindings === undefined ? undefined : structuredClone(changedBindings);
      if (state !== undefined) assertState(state);
      const document = await snapshotDocument(input);
      return this.write(async () => {
        const current = await this.current(localId, expectedSavedAt);
        if ((document.source as Record<string, { uuid?: string }>)[document.rootType]?.uuid === localId) reject('WORKSPACE_DOCUMENT_INVALID');
        const updated: WorkspaceEnvelope = { ...current, source: document.source, rootType: document.rootType, oscalVersion: document.oscalVersion, savedAt: timestamp(current.savedAt), documentState: state ?? current.documentState };
        await this.documents.put(updated);
        if (bindingSnapshot !== undefined) {
          // Replaces this document's outgoing set, keeping incoming bindings.
          await this.bindings.filter(binding => binding.fromLocalId === localId).delete();
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

  replaceDocument(localId: LocalId, expectedSavedAt: string, input: Class2OscalImportedDocument): Promise<WorkspaceResult<WorkspaceEnvelope>> {
    return this.saveDocument(localId, expectedSavedAt, input);
  }

  async autosaveDraft(localId: LocalId, expectedSavedAt: string, source: unknown): Promise<WorkspaceResult<WorkspaceDraft>> {
    try {
      if (enforceClass2ObjectGraphInvariants(source)) reject('WORKSPACE_DRAFT_INVALID');
      if (new TextEncoder().encode(serializeWorkspaceJson(source)).byteLength > CLASS_2_IMPORT_LIMITS.maxBytes) reject('WORKSPACE_DRAFT_INVALID');
      const snapshot = structuredClone(source);
      return this.write(async () => {
        await this.current(localId, expectedSavedAt);
        const previous = await this.drafts.get(localId);
        const draft = { localId, source: snapshot, savedAt: timestamp(previous?.savedAt) };
        await this.drafts.put(draft);
        return draft;
      });
    } catch (error) { return failure(error); }
  }

  private async putBinding(binding: WorkspaceBinding): Promise<void> {
    const from = await this.current(binding.fromLocalId);
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

  async setBinding(binding: WorkspaceBinding): Promise<WorkspaceResult<void>> {
    try {
      const snapshot = structuredClone(binding);
      return this.write(async () => { await this.putBinding(snapshot); await this.touchDocument(snapshot.fromLocalId); });
    }
    catch (error) { return failure(error); }
  }
  removeBinding(fromLocalId: LocalId, pointer: string): Promise<WorkspaceResult<void>> {
    return this.write(async () => {
      await this.current(fromLocalId);
      if (!await this.bindings.get([fromLocalId, pointer])) return;
      await this.bindings.delete([fromLocalId, pointer]);
      await this.touchDocument(fromLocalId);
    });
  }

  private async touchDocument(localId: LocalId): Promise<void> {
    const document = await this.current(localId);
    await this.documents.put({ ...document, savedAt: timestamp(document.savedAt) });
  }

  private async removeDocument(localId: LocalId): Promise<void> {
    const incoming = await this.bindings.where('target.localId').equals(localId).toArray();
    for (const sourceId of new Set(incoming.map(binding => binding.fromLocalId))) {
      if (sourceId !== localId) await this.touchDocument(sourceId);
    }
    await this.bindings.where('target.localId').equals(localId).delete();
    await this.bindings.filter(binding => binding.fromLocalId === localId).delete();
    await this.drafts.delete(localId);
    await this.documents.delete(localId);
  }
  deleteDocument(localId: LocalId): Promise<WorkspaceResult<void>> {
    return this.write(async () => { await this.current(localId); await this.removeDocument(localId); });
  }
  deleteVerbund(verbundId: VerbundId): Promise<WorkspaceResult<void>> {
    return this.write(async () => {
      if (!await this.verbuende.get(verbundId)) reject('WORKSPACE_VERBUND_NOT_FOUND');
      const ids = await this.documents.where('verbundId').equals(verbundId).primaryKeys();
      for (const id of ids) await this.removeDocument(id);
      await this.verbuende.delete(verbundId);
    });
  }

  exportBackup(): Promise<WorkspaceResult<string>> { return this.read(this.db.tables, () => exportWorkspaceBackupSnapshot(this.db)); }
  exportVerbundBackup(verbundId: VerbundId): Promise<WorkspaceResult<string>> {
    return this.read(this.db.tables, () => exportVerbundBackupSnapshot(this.db, verbundId));
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
    return this.write(() => restoreVerbundBackupSnapshot(this.db, parsed.value));
  }

  async estimate(): Promise<WorkspaceResult<StorageEstimate | undefined>> {
    try { return { ok: true, value: await navigator.storage?.estimate?.() }; }
    catch (error) { return failure(error); }
  }

  async deleteAll(confirmation: 'delete-workspace'): Promise<WorkspaceResult<void>> {
    if (confirmation !== 'delete-workspace') return failure(new StorageFailure('WORKSPACE_CONFIRMATION_REQUIRED'));
    this.close();
    return new Promise(resolve => {
      const request = indexedDB.deleteDatabase(WORKSPACE_DATABASE_NAME);
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (result: WorkspaceResult<void>) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        resolve(result);
      };
      request.onsuccess = () => finish({ ok: true, value: undefined });
      request.onerror = () => finish(failure(request.error));
      request.onblocked = () => {
        timer ??= setTimeout(() => finish(failure(new StorageFailure('WORKSPACE_DELETE_BLOCKED'))), WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS);
      };
    });
  }
}
