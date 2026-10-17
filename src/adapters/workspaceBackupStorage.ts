import type Dexie from 'dexie';
import { STORAGE_SCHEMA_VERSION, type WorkspaceBackup, type WorkspaceMeta } from '@/domain/workspaceModel';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { enforceClass2ObjectGraphInvariants, enforceWorkspaceBackupGraphInvariants } from '@/domain/oscalObjectGraph';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { validWorkspaceBackupStructure } from '@/adapters/workspaceBackupStructure';
import { reject } from '@/adapters/workspaceStorageFailure';

function assertCurrentBackup(backup: unknown): void {
  if (enforceWorkspaceBackupGraphInvariants(backup)) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  if (!validWorkspaceBackupStructure(backup)) reject('WORKSPACE_BACKUP_INVALID');
  for (const row of [...backup.documents, ...backup.drafts]) {
    if (enforceClass2ObjectGraphInvariants(row.source)) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
}

/** Caller owns the single read transaction over all stores. */
export async function exportWorkspaceBackupSnapshot(db: Dexie): Promise<string> {
  const stores: Record<string, unknown> = {};
  const meta = await db.table<WorkspaceMeta>('workspaceMeta').get('workspace');
  if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
  const current = meta.storageSchemaVersion === STORAGE_SCHEMA_VERSION;
  let byteCount = 0;
  for (const table of db.tables) {
    const rows: unknown[] = [];
    let exceedsLimit = false;
    await table.toCollection().until(() => exceedsLimit).each(row => {
      // Cursor admission bounds retained current-version source graphs.
      if (current) {
        byteCount += new TextEncoder().encode(serializeWorkspaceJson(row)).byteLength;
        if (byteCount > WORKSPACE_BACKUP_MAX_BYTES) { exceedsLimit = true; return; }
      }
      rows.push(row);
    });
    // Reject after the cursor settles, preserving the limit diagnostic on native abort paths.
    if (exceedsLimit) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
    stores[table.name] = rows;
  }
  // Unknown future fields and stores pass through without interpretation.
  const backup = { format: 'gspp-workspace', storageSchemaVersion: meta.storageSchemaVersion, ...stores };
  if (current) assertCurrentBackup(backup);
  const text = serializeWorkspaceJson(backup);
  if (current && new TextEncoder().encode(text).byteLength > WORKSPACE_BACKUP_MAX_BYTES) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  return text;
}

/** Caller owns the single write transaction and has validated the whole bundle. */
export async function restoreWorkspaceBackupSnapshot(db: Dexie, backup: WorkspaceBackup): Promise<void> {
  for (const table of db.tables) await table.clear();
  await db.table('verbuende').bulkAdd(backup.verbuende);
  await db.table('documents').bulkAdd(backup.documents);
  await db.table('drafts').bulkAdd(backup.drafts);
  await db.table('bindings').bulkAdd(backup.bindings);
  await db.table('workspaceMeta').bulkAdd(backup.workspaceMeta);
}
