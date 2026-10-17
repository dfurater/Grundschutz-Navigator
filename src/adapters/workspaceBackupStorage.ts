import type Dexie from 'dexie';
import type { Collection } from 'dexie';
import { STORAGE_SCHEMA_VERSION, type LocalId, type VerbundId, type WorkspaceBackup, type WorkspaceVerbundBackup, type WorkspaceMeta, type WorkspaceEnvelope, type WorkspaceDraft, type WorkspaceBinding, type WorkspaceVerbund } from '@/domain/workspaceModel';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { enforceClass2ObjectGraphInvariants, enforceWorkspaceBackupGraphInvariants } from '@/domain/oscalObjectGraph';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { validWorkspaceBackupStructure, validVerbundBackupStructure } from '@/adapters/workspaceBackupStructure';
import { reject } from '@/adapters/workspaceStorageFailure';

function assertCurrentBackup(backup: unknown): void {
  if (enforceWorkspaceBackupGraphInvariants(backup)) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  if (!validWorkspaceBackupStructure(backup) && !validVerbundBackupStructure(backup)) reject('WORKSPACE_BACKUP_INVALID');
  for (const row of [...backup.documents, ...backup.drafts]) {
    if (enforceClass2ObjectGraphInvariants(row.source)) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
}

async function readRows<T>(collection: Collection<T>, budget?: { bytes: number }): Promise<T[]> {
  const rows: T[] = [];
  let exceedsLimit = false;
  await collection.until(() => exceedsLimit).each(row => {
    if (budget) {
      budget.bytes += new TextEncoder().encode(serializeWorkspaceJson(row)).byteLength;
      if (budget.bytes > WORKSPACE_BACKUP_MAX_BYTES) { exceedsLimit = true; return; }
    }
    rows.push(row);
  });
  // Reject after the cursor settles, preserving the limit diagnostic on native abort paths.
  if (exceedsLimit) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  return rows;
}

function serializeBackup(backup: unknown, current = true): string {
  if (current) assertCurrentBackup(backup);
  const text = serializeWorkspaceJson(backup);
  if (current && new TextEncoder().encode(text).byteLength > WORKSPACE_BACKUP_MAX_BYTES) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  return text;
}

/** Caller owns the single read transaction over all stores. */
export async function exportWorkspaceBackupSnapshot(db: Dexie): Promise<string> {
  const stores: Record<string, unknown> = {};
  const meta = await db.table<WorkspaceMeta>('workspaceMeta').get('workspace');
  if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
  const current = meta.storageSchemaVersion === STORAGE_SCHEMA_VERSION;
  const budget = current ? { bytes: 0 } : undefined;
  for (const table of db.tables) {
    stores[table.name] = await readRows(table.toCollection(), budget);
  }
  // Unknown future fields and stores pass through without interpretation.
  const backup = { format: 'gspp-workspace', storageSchemaVersion: meta.storageSchemaVersion, ...stores };
  return serializeBackup(backup, current);
}

/** Partition only a known schema; unknown future stores remain available through the global export. */
export async function exportVerbundBackupSnapshot(db: Dexie, verbundId: VerbundId): Promise<string> {
  const verbund = await db.table<WorkspaceVerbund>('verbuende').get(verbundId);
  if (!verbund) reject('WORKSPACE_VERBUND_NOT_FOUND');
  const meta = await db.table<WorkspaceMeta>('workspaceMeta').get('workspace');
  if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
  if (db.verno > STORAGE_SCHEMA_VERSION || meta.storageSchemaVersion > STORAGE_SCHEMA_VERSION) reject('WORKSPACE_SCHEMA_NEWER');
  const budget = { bytes: new TextEncoder().encode(serializeWorkspaceJson(verbund)).byteLength };
  const documents = await readRows(db.table<WorkspaceEnvelope>('documents').where('verbundId').equals(verbundId), budget);
  const ids = new Set(documents.map(row => row.localId));
  const drafts = await readRows(db.table<WorkspaceDraft>('drafts').where('localId').anyOf([...ids]), budget);
  const bindings = await readRows(db.table<WorkspaceBinding>('bindings').filter(row => ids.has(row.fromLocalId)), budget);
  return serializeBackup({ format: 'gspp-workspace-verbund', storageSchemaVersion: meta.storageSchemaVersion, verbuende: [verbund], documents, drafts, bindings });
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

/** Validate collisions before the first write; the caller owns the single write transaction. */
export async function restoreVerbundBackupSnapshot(db: Dexie, backup: WorkspaceVerbundBackup): Promise<void> {
  const verbundId = backup.verbuende[0].verbundId;
  const documents = db.table<WorkspaceEnvelope, LocalId>('documents');
  const incoming = await documents.bulkGet(backup.documents.map(row => row.localId));
  if (incoming.some(row => row && row.verbundId !== verbundId)) reject('WORKSPACE_BACKUP_CONFLICT');
  const oldIds = new Set(await documents.where('verbundId').equals(verbundId).primaryKeys());
  await db.table<WorkspaceBinding>('bindings').filter(row => oldIds.has(row.fromLocalId) || (row.target.kind === 'local' && oldIds.has(row.target.localId))).delete();
  await db.table('drafts').bulkDelete([...oldIds]);
  await documents.bulkDelete([...oldIds]);
  await db.table('verbuende').put(backup.verbuende[0]);
  await documents.bulkAdd(backup.documents);
  await db.table('drafts').bulkAdd(backup.drafts);
  await db.table('bindings').bulkAdd(backup.bindings);
}
