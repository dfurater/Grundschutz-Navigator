import Dexie, { type Transaction } from 'dexie';
import { createWorkspaceStructureValidator } from '@/adapters/workspaceBackupStructure';
import { dispatchOscalDocument } from '@/domain/oscalRootDispatch';
import { enforceClass2ObjectGraphInvariants } from '@/domain/oscalObjectGraph';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { STORAGE_SCHEMA_VERSION } from '@/domain/workspaceModel';

function invalid(): never { throw new Error('WORKSPACE_MIGRATION_INVALID'); }
function validSource(source: unknown): boolean {
  return !enforceClass2ObjectGraphInvariants(source)
    && new TextEncoder().encode(serializeWorkspaceJson(source)).byteLength <= CLASS_2_IMPORT_LIMITS.maxBytes;
}

function visitRows(transaction: Transaction, store: string, visit: (cursor: IDBCursorWithValue) => IDBRequest | void): Promise<void> {
  return new Dexie.Promise<void>((resolve, reject) => {
    const fail = (event?: Event) => {
      // Let the rejected upgrade promise abort with the redacted diagnostic.
      event?.preventDefault();
      event?.stopPropagation();
      reject(new Error('WORKSPACE_MIGRATION_INVALID'));
    };
    const request = transaction.idbtrans.objectStore(store).openCursor();
    request.onerror = fail;
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      const advance = () => {
        try { cursor.continue(); } catch { fail(); }
      };
      try {
        const update = visit(cursor);
        // Read the next source only after the current write has completed.
        if (update) { update.onerror = fail; update.onsuccess = advance; }
        else advance();
      } catch { fail(); }
    };
  });
}

/** Runs only inside Dexie's versionchange transaction; source content is never rewritten. */
export async function migrateWorkspaceStorage(transaction: Transaction, fromVersion: number, toVersion: number): Promise<void> {
  try {
    // This implementation knows only the current envelope shape and its next version.
    if (fromVersion !== STORAGE_SCHEMA_VERSION || toVersion !== fromVersion + 1
      || transaction.idbtrans.mode !== 'versionchange') invalid();
    const stores = ['verbuende', 'documents', 'drafts', 'bindings', 'workspaceMeta'] as const;
    if (transaction.storeNames.length !== stores.length || stores.some(name => !transaction.storeNames.includes(name))) invalid();
    const validate = createWorkspaceStructureValidator();
    await visitRows(transaction, 'verbuende', cursor => { if (!validate.verbuende(cursor.value)) invalid(); });
    await visitRows(transaction, 'documents', cursor => {
      const row = cursor.value;
      if (!validate.documents(row) || !validSource(row.source)) invalid();
      const dispatched = dispatchOscalDocument(row.source, { trustClass: 'class-2-local-user' });
      if (!dispatched.ok || dispatched.rootType !== row.rootType || dispatched.oscalVersion !== row.oscalVersion) invalid();
    });
    await visitRows(transaction, 'drafts', cursor => {
      const row = cursor.value;
      if (!validate.drafts(row) || !validSource(row.source)) invalid();
    });
    await visitRows(transaction, 'bindings', cursor => { if (!validate.bindings(cursor.value)) invalid(); });
    await visitRows(transaction, 'workspaceMeta', cursor => { if (!validate.workspaceMeta(cursor.value)) invalid(); });
    if (!validate.hasWorkspaceMeta) invalid();
    // Validate every row before the first write. A later write failure still aborts the upgrade.
    for (const store of ['documents', 'workspaceMeta']) {
      await visitRows(transaction, store, cursor => cursor.update({ ...cursor.value, storageSchemaVersion: toVersion }));
    }
  } catch {
    invalid();
  }
}
