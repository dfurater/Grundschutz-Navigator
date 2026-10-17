import Dexie, { type Table } from 'dexie';
import { dispatchOscalDocument } from '@/domain/oscalRootDispatch';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { listArtifacts } from '@/domain/sourceRegistry';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import {
  STORAGE_SCHEMA_VERSION,
  type DocumentState, type LocalId, type VerbundId, type WorkspaceBinding,
  type WorkspaceDraft, type WorkspaceEnvelope, type WorkspaceMeta,
  type WorkspaceResult, type WorkspaceVerbund,
} from '@/domain/workspaceModel';
import { parseWorkspaceBackup } from '@/adapters/workspaceBackup';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { validWorkspaceBackupStructure } from '@/adapters/workspaceBackupStructure';

export const WORKSPACE_DATABASE_NAME = 'gspp-workspace';
export const WORKSPACE_DELETE_BLOCKED_TIMEOUT_MS = 2_000;
export const WORKSPACE_SCHEMA = Object.freeze({
  verbuende: 'verbundId',
  documents: 'localId, verbundId, rootType, oscalVersion, savedAt',
  drafts: 'localId',
  bindings: '[fromLocalId+pointer], target.localId',
  workspaceMeta: 'id',
});

/** Only stable codes cross the adapter boundary, never native error messages. */
class StorageFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

function reject(code: string): never { throw new StorageFailure(code); }
function failure(error: unknown): WorkspaceResult<never> {
  let code = 'WORKSPACE_STORAGE_FAILED';
  if (error instanceof StorageFailure) code = error.code;
  else if (error instanceof Error && error.name === 'QuotaExceededError') code = 'WORKSPACE_QUOTA_EXCEEDED';
  return { ok: false, diagnostic: createOscalDiagnostic({ code, stage: 'domain', validator: { name: 'gspp-workspace', version: '1' }, path: '/' }) };
}

function timestamp(previous?: string): string {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}

async function snapshotDocument(document: Class2OscalImportedDocument): Promise<Class2OscalImportedDocument> {
  if (document?.context?.trustClass !== 'class-2-local-user') reject('WORKSPACE_TRUST_CLASS_REJECTED');
  if (enforceClass2ObjectGraphInvariants(document.source)) reject('WORKSPACE_DOCUMENT_INVALID');
  const source = structuredClone(document.source);
  const bytes = new TextEncoder().encode(serializeWorkspaceJson(source));
  if (bytes.byteLength > CLASS_2_IMPORT_LIMITS.maxBytes) reject('WORKSPACE_DOCUMENT_INVALID');
  const bound = dispatchOscalDocument(source, { trustClass: 'class-2-local-user' });
  if (!bound.ok || bound.rootType !== document.rootType || bound.oscalVersion !== document.oscalVersion) reject('WORKSPACE_DOCUMENT_INVALID');
  const validated = await importClass2OscalDocument(bytes, { trustClass: 'class-2-local-user' });
  if (!validated.ok) reject('WORKSPACE_DOCUMENT_INVALID');
  return { source, context: { trustClass: 'class-2-local-user' }, rootType: bound.rootType, oscalVersion: bound.oscalVersion };
}

function assertState(state: DocumentState): void {
  if (!['imported', 'draft', 'export-ready'].includes(state)) reject('WORKSPACE_DOCUMENT_INVALID');
}

function pointerValue(source: unknown, pointer: string): unknown {
  if (!pointer.startsWith('/') || /~(?![01])/.test(pointer)) reject('WORKSPACE_BINDING_INVALID');
  let value = source;
  for (const segment of pointer.slice(1).split('/')) {
    const key = segment.replaceAll('~1', '/').replaceAll('~0', '~');
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) reject('WORKSPACE_BINDING_INVALID');
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

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
  listDocuments(verbundId?: VerbundId): Promise<WorkspaceResult<WorkspaceEnvelope[]>> {
    return this.read([this.documents], () => verbundId === undefined ? this.documents.toArray() : this.documents.where('verbundId').equals(verbundId).toArray());
  }
  getDocument(localId: LocalId): Promise<WorkspaceResult<WorkspaceEnvelope | undefined>> { return this.read([this.documents], () => this.documents.get(localId)); }
  getDraft(localId: LocalId): Promise<WorkspaceResult<WorkspaceDraft | undefined>> { return this.read([this.drafts], () => this.drafts.get(localId)); }
  listBindings(): Promise<WorkspaceResult<WorkspaceBinding[]>> { return this.read([this.bindings], () => this.bindings.toArray()); }

  createVerbund(name: string): Promise<WorkspaceResult<WorkspaceVerbund>> {
    return this.write(async () => {
      if (typeof name !== 'string' || !name.trim()) reject('WORKSPACE_VERBUND_INVALID');
      const now = timestamp();
      const verbund = { verbundId: crypto.randomUUID(), name, createdAt: now, savedAt: now };
      await this.verbuende.add(verbund);
      return verbund;
    });
  }

  renameVerbund(verbundId: VerbundId, name: string): Promise<WorkspaceResult<WorkspaceVerbund>> {
    return this.write(async () => {
      const verbund = await this.verbuende.get(verbundId);
      if (!verbund) reject('WORKSPACE_VERBUND_NOT_FOUND');
      if (typeof name !== 'string' || !name.trim()) reject('WORKSPACE_VERBUND_INVALID');
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
          localId: crypto.randomUUID(), verbundId, storageSchemaVersion: STORAGE_SCHEMA_VERSION,
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
    try { const snapshot = structuredClone(binding); return this.write(() => this.putBinding(snapshot)); }
    catch (error) { return failure(error); }
  }
  removeBinding(fromLocalId: LocalId, pointer: string): Promise<WorkspaceResult<void>> {
    return this.write(async () => { await this.current(fromLocalId); await this.bindings.delete([fromLocalId, pointer]); });
  }

  private async removeDocument(localId: LocalId): Promise<void> {
    await this.bindings.where('target.localId').equals(localId).delete();
    await this.bindings.filter(binding => binding.fromLocalId === localId).delete();
    await this.drafts.delete(localId);
    await this.documents.delete(localId);
  }
  deleteDocument(localId: LocalId): Promise<WorkspaceResult<void>> { return this.write(() => this.removeDocument(localId)); }
  deleteVerbund(verbundId: VerbundId): Promise<WorkspaceResult<void>> {
    return this.write(async () => {
      const ids = await this.documents.where('verbundId').equals(verbundId).primaryKeys();
      for (const id of ids) await this.removeDocument(id);
      await this.verbuende.delete(verbundId);
    });
  }

  exportBackup(): Promise<WorkspaceResult<string>> {
    return this.read(this.db.tables, async () => {
      const stores: Record<string, unknown> = {};
      const meta = await this.meta.get('workspace');
      if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
      const current = meta.storageSchemaVersion === STORAGE_SCHEMA_VERSION;
      let byteCount = 0;
      for (const table of this.db.tables) {
        const rows: unknown[] = [];
        await table.each(row => {
          // Cursor admission bounds retained current-version source graphs.
          if (current) {
            byteCount += new TextEncoder().encode(serializeWorkspaceJson(row)).byteLength;
            if (byteCount > WORKSPACE_BACKUP_MAX_BYTES) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
          }
          rows.push(row);
        });
        stores[table.name] = rows;
      }
      // Unknown future fields and stores pass through without interpretation.
      const backup = { format: 'gspp-workspace', storageSchemaVersion: meta.storageSchemaVersion, ...stores };
      if (current && (enforceClass2ObjectGraphInvariants(backup) || !validWorkspaceBackupStructure(backup))) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
      const text = serializeWorkspaceJson(backup);
      if (current && new TextEncoder().encode(text).byteLength > WORKSPACE_BACKUP_MAX_BYTES) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
      return text;
    });
  }

  async restoreBackup(bytes: Uint8Array, confirmation: 'replace-workspace'): Promise<WorkspaceResult<void>> {
    if (confirmation !== 'replace-workspace') return failure(new StorageFailure('WORKSPACE_CONFIRMATION_REQUIRED'));
    const parsed = await parseWorkspaceBackup(bytes);
    if (!parsed.ok) return parsed;
    const backup = parsed.value;
    return this.write(async () => {
      for (const table of this.db.tables) await table.clear();
      await this.verbuende.bulkAdd(backup.verbuende);
      await this.documents.bulkAdd(backup.documents);
      await this.drafts.bulkAdd(backup.drafts);
      await this.bindings.bulkAdd(backup.bindings);
      await this.meta.bulkAdd(backup.workspaceMeta);
    }, false);
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
