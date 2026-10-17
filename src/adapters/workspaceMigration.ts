import type { Transaction } from 'dexie';
import { validWorkspaceBackupStructure } from '@/adapters/workspaceBackupStructure';
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

/** Runs only inside Dexie's versionchange transaction; source content is never rewritten. */
export async function migrateWorkspaceStorage(transaction: Transaction, fromVersion: number, toVersion: number): Promise<void> {
  try {
    // This implementation knows only the current envelope shape and its next version.
    if (fromVersion !== STORAGE_SCHEMA_VERSION || toVersion !== fromVersion + 1
      || transaction.idbtrans.mode !== 'versionchange') invalid();
    const stores = ['verbuende', 'documents', 'drafts', 'bindings', 'workspaceMeta'] as const;
    if (transaction.storeNames.length !== stores.length || stores.some(name => !transaction.storeNames.includes(name))) invalid();
    const data: Record<string, unknown> = { format: 'gspp-workspace', storageSchemaVersion: fromVersion };
    for (const name of stores) data[name] = await transaction.table(name).toArray();
    if (!validWorkspaceBackupStructure(data)) invalid();
    for (const envelope of data.documents) {
      if (!validSource(envelope.source)) invalid();
      const dispatched = dispatchOscalDocument(envelope.source, { trustClass: 'class-2-local-user' });
      if (!dispatched.ok || dispatched.rootType !== envelope.rootType || dispatched.oscalVersion !== envelope.oscalVersion) invalid();
    }
    for (const draft of data.drafts) if (!validSource(draft.source)) invalid();
    // Validate every row before the first write. A later write failure still aborts the upgrade.
    await transaction.table('documents').bulkPut(data.documents.map(row => ({ ...row, storageSchemaVersion: toVersion })));
    await transaction.table('workspaceMeta').bulkPut(data.workspaceMeta.map(row => ({ ...row, storageSchemaVersion: toVersion })));
  } catch {
    invalid();
  }
}
