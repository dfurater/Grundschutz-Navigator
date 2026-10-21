import Dexie, { type Transaction } from 'dexie';
import { createWorkspaceStructureValidator } from '@/adapters/workspaceBackupStructure';
import { bindsEnvelopeSource, withinSourceLimits } from '@/adapters/workspaceDraftSource';

function invalid(): never { throw new Error('WORKSPACE_MIGRATION_INVALID'); }

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

/** Only v1 → v2 runs here; a future schema version adds its own step. */
export async function migrateWorkspaceStorage(transaction: Transaction, fromVersion: number, toVersion: number): Promise<void> {
  try {
    // This implementation knows only the v1 envelope shape and its next version.
    if (fromVersion !== 1 || toVersion !== 2 || transaction.idbtrans.mode !== 'versionchange') invalid();
    // `transaction.storeNames` is the target schema: the five v1 stores plus the two empty v2 stores.
    const stores = ['verbuende', 'documents', 'drafts', 'bindings', 'workspaceMeta', 'reviewTrail', 'reviewBaseline'] as const;
    if (transaction.storeNames.length !== stores.length || stores.some(name => !transaction.storeNames.includes(name))) invalid();
    const validate = createWorkspaceStructureValidator(1);
    await visitRows(transaction, 'verbuende', cursor => { if (!validate.verbuende(cursor.value)) invalid(); });
    await visitRows(transaction, 'documents', cursor => {
      const row = cursor.value;
      if (!validate.documents(row) || !bindsEnvelopeSource(row.source, row.rootType, row.oscalVersion)) invalid();
    });
    await visitRows(transaction, 'drafts', cursor => {
      const row = cursor.value;
      if (!validate.drafts(row) || !withinSourceLimits(row.source)) invalid();
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
