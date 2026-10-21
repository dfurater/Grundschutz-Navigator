import type Dexie from 'dexie';
import type { Collection } from 'dexie';
import { STORAGE_SCHEMA_VERSION, type LocalId, type VerbundId, type WorkspaceBackup, type WorkspaceVerbundBackup, type WorkspaceMeta, type WorkspaceEnvelope, type WorkspaceDraft, type WorkspaceBinding, type WorkspaceVerbund, type ReviewTrailRow, type ReviewBaseline } from '@/domain/workspaceModel';
import { CLASS_2_IMPORT_LIMITS, WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { countObjectGraphNodesCapped, enforceClass2ObjectGraphInvariants, enforceWorkspaceBackupGraphInvariants } from '@/domain/oscalObjectGraph';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { serializeWorkspaceRecoveryJson } from '@/adapters/workspaceRecoveryJson';
import { validWorkspaceBackupStructure, validVerbundBackupStructure } from '@/adapters/workspaceBackupStructure';
import { LAST_TIMESTAMP_MS, reject, timestamp } from '@/adapters/workspaceStorageFailure';

/** Root members of the global bundle; a store with one of these names cannot be exported without loss. */
const BACKUP_FRAME_MEMBERS = new Set(['format', 'storageSchemaVersion', 'outOfLineKeys']);

function assertCurrentBackup(backup: unknown): void {
  if (enforceWorkspaceBackupGraphInvariants(backup)) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  if (!validWorkspaceBackupStructure(backup) && !validVerbundBackupStructure(backup)) reject('WORKSPACE_BACKUP_INVALID');
  for (const row of [...backup.documents, ...backup.drafts]) {
    if (enforceClass2ObjectGraphInvariants(row.source)) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  }
}

/** Date, binary and ±Infinity keys get a tagged JSON form; no valid IndexedDB key is a plain object, so the tags stay unambiguous. */
export function encodeWorkspaceBackupKey(key: unknown): unknown {
  if (key === Infinity || key === -Infinity) return { number: String(key) };
  if (key instanceof Date) return { date: key.toISOString() };
  if (key instanceof ArrayBuffer || ArrayBuffer.isView(key)) {
    const bytes = key instanceof ArrayBuffer ? new Uint8Array(key) : new Uint8Array(key.buffer, key.byteOffset, key.byteLength);
    let binary = '';
    for (const byte of bytes) binary += String.fromCodePoint(byte);
    return { binary: btoa(binary) };
  }
  return Array.isArray(key) ? key.map(encodeWorkspaceBackupKey) : key;
}

/**
 * Export form of a row: a restored row carries the value read from the backup file under
 * `backupSavedAt`; the export emits it as `savedAt` and drops the field. A real write
 * removes the field (`writtenRow`), then `savedAt` is the file value itself.
 */
function restoredRowExport<T>(row: T): T {
  if (row === null || typeof row !== 'object' || !Object.hasOwn(row, 'backupSavedAt')) return row;
  const exported = { ...(row as Record<string, unknown>) };
  const fileValue = exported.backupSavedAt;
  delete exported.backupSavedAt;
  exported.savedAt = fileValue;
  return exported as T;
}

/** Shared budgets of one export run; a row that crosses either budget ends the collection. */
interface BackupBudget {
  bytes: number;
  nodes: number;
}

/** Frame nodes of a bundle: the root, `format`, `storageSchemaVersion` and one array per store. */
function frameNodes(storeCount: number): number {
  return 3 + storeCount;
}

async function readRows<T>(collection: Collection<T>, budget?: BackupBudget, keys?: unknown[]): Promise<T[]> {
  const rows: T[] = [];
  let exceedsLimit = false;
  await collection.until(() => exceedsLimit).each((row, cursor) => {
    const exported = budget === undefined ? row : restoredRowExport(row);
    if (budget !== undefined) {
      // The node budget checks before serialization: the row that crosses it is not serialized at all.
      budget.nodes += countObjectGraphNodesCapped(exported, CLASS_2_IMPORT_LIMITS.maxNodes - budget.nodes);
      if (budget.nodes > CLASS_2_IMPORT_LIMITS.maxNodes) { exceedsLimit = true; return; }
      budget.bytes += new TextEncoder().encode(serializeWorkspaceJson(exported)).byteLength;
      if (budget.bytes > WORKSPACE_BACKUP_MAX_BYTES) { exceedsLimit = true; return; }
    }
    rows.push(exported);
    keys?.push(encodeWorkspaceBackupKey(cursor.primaryKey));
  });
  // Reject after the cursor settles, preserving the limit diagnostic on native abort paths.
  if (exceedsLimit) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  return rows;
}

function serializeBackup(backup: unknown, current = true): string {
  if (current) assertCurrentBackup(backup);
  const text = current ? serializeWorkspaceJson(backup) : serializeWorkspaceRecoveryJson(backup as { storageSchemaVersion: number });
  if (current && new TextEncoder().encode(text).byteLength > WORKSPACE_BACKUP_MAX_BYTES) reject('WORKSPACE_BACKUP_LIMIT_EXCEEDED');
  return text;
}

/** Caller owns the single read transaction over all stores. */
export async function exportWorkspaceBackupSnapshot(db: Dexie): Promise<string> {
  const stores: Record<string, unknown> = Object.create(null);
  // Newer database versions pass through without interpreting even the metadata store.
  let storageSchemaVersion = db.verno;
  if (storageSchemaVersion <= STORAGE_SCHEMA_VERSION) {
    if (!db.tables.some(table => table.name === 'workspaceMeta')) reject('WORKSPACE_SCHEMA_INVALID');
    const meta = await db.table<WorkspaceMeta>('workspaceMeta').get('workspace');
    if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
    storageSchemaVersion = meta.storageSchemaVersion;
  }
  const current = storageSchemaVersion === STORAGE_SCHEMA_VERSION;
  const budget: BackupBudget | undefined = current ? { bytes: 0, nodes: frameNodes(db.tables.length) } : undefined;
  const outOfLineKeys: Record<string, unknown[]> = Object.create(null);
  for (const table of db.tables) {
    if (BACKUP_FRAME_MEMBERS.has(table.name)) reject('WORKSPACE_SCHEMA_INVALID');
    // A store whose key is not part of its rows keeps its keys in read order next to the rows.
    const keys = table.schema.primKey.keyPath ? undefined : [];
    if (keys) outOfLineKeys[table.name] = keys;
    stores[table.name] = await readRows(table.toCollection(), budget, keys);
  }
  // Unknown future fields and stores pass through without interpretation.
  const backup = { format: 'gspp-workspace', storageSchemaVersion, ...stores, ...(Object.keys(outOfLineKeys).length > 0 && { outOfLineKeys }) };
  return serializeBackup(backup, current);
}

/** Partition only a known schema; unknown future stores remain available through the global export. */
export async function exportVerbundBackupSnapshot(db: Dexie, verbundId: VerbundId): Promise<string> {
  // Before the first store access: a newer schema may lack a known store.
  if (db.verno > STORAGE_SCHEMA_VERSION) reject('WORKSPACE_SCHEMA_NEWER');
  const verbund = await db.table<WorkspaceVerbund>('verbuende').get(verbundId);
  if (!verbund) reject('WORKSPACE_VERBUND_NOT_FOUND');
  const meta = await db.table<WorkspaceMeta>('workspaceMeta').get('workspace');
  if (!meta || !Number.isInteger(meta.storageSchemaVersion) || meta.storageSchemaVersion < 1) reject('WORKSPACE_SCHEMA_INVALID');
  if (meta.storageSchemaVersion > STORAGE_SCHEMA_VERSION) reject('WORKSPACE_SCHEMA_NEWER');
  // Frame of this export — root, `format`, `storageSchemaVersion`, six lists — plus the verbund row itself.
  const budget: BackupBudget = {
    bytes: new TextEncoder().encode(serializeWorkspaceJson(verbund)).byteLength,
    nodes: frameNodes(6) + countObjectGraphNodesCapped(verbund, CLASS_2_IMPORT_LIMITS.maxNodes),
  };
  const documents = await readRows(db.table<WorkspaceEnvelope>('documents').where('verbundId').equals(verbundId), budget);
  const ids = new Set(documents.map(row => row.localId));
  const drafts = await readRows(db.table<WorkspaceDraft>('drafts').where('localId').anyOf([...ids]), budget);
  const bindings = await readRows(db.table<WorkspaceBinding>('bindings').filter(row => ids.has(row.fromLocalId)), budget);
  const reviewTrail = await readRows(db.table<ReviewTrailRow>('reviewTrail').filter(row => ids.has(row.localId)), budget);
  const reviewBaseline = await readRows(db.table<ReviewBaseline>('reviewBaseline').filter(row => ids.has(row.localId)), budget);
  return serializeBackup({ format: 'gspp-workspace-verbund', storageSchemaVersion: meta.storageSchemaVersion, verbuende: [verbund], documents, drafts, bindings, reviewTrail, reviewBaseline });
}

/**
 * Fresh shared stamp of both restores: past the previous `workspaceMeta.savedAt` and every row value of the bundle, so no
 * comparison value issued before the restore and none carried by the bundle matches a restored row. The bundle's own
 * `workspaceMeta.savedAt` is no row value and stays out: it carries the stamp of the restore that preceded its export.
 */
async function restoredStamp(db: Dexie, rows: readonly { savedAt: string }[]): Promise<string> {
  const meta = await db.table<WorkspaceMeta>('workspaceMeta').get('workspace');
  if (!meta) reject('WORKSPACE_SCHEMA_INVALID');
  const latest = rows.reduce((max, row) => Math.max(max, Date.parse(row.savedAt)), Date.parse(meta.savedAt));
  // The mark must lie after every restored value and still within the bundle grammar; it may take the reserved last millisecond.
  if (latest >= LAST_TIMESTAMP_MS) reject('WORKSPACE_BACKUP_INVALID');
  return timestamp(new Date(latest).toISOString(), LAST_TIMESTAMP_MS);
}

/** The stored comparison value is the fresh stamp; the file value stays visible in every export as `backupSavedAt`. */
function restoredRow<T extends { savedAt: string }>(row: T, stamp: string): T & { backupSavedAt: string } {
  return { ...row, savedAt: stamp, backupSavedAt: row.savedAt };
}

/** Row as a real write stores it: without `backupSavedAt`; its `savedAt` is then the write stamp itself. */
export function writtenRow<T extends { backupSavedAt?: string }>(row: T): T {
  const written = { ...row };
  delete written.backupSavedAt;
  return written;
}

/** Caller owns the single write transaction and has validated the whole bundle. */
export async function restoreWorkspaceBackupSnapshot(db: Dexie, backup: WorkspaceBackup): Promise<void> {
  const stamp = await restoredStamp(db, [
    ...backup.verbuende, ...backup.documents, ...backup.drafts,
    ...backup.reviewTrail.map(row => ({ savedAt: row.createdAt })),
  ]);
  for (const table of db.tables) await table.clear();
  await db.table('verbuende').bulkAdd(backup.verbuende);
  await db.table('documents').bulkAdd(backup.documents.map(row => restoredRow(row, stamp)));
  await db.table('drafts').bulkAdd(backup.drafts.map(row => restoredRow(row, stamp)));
  await db.table('bindings').bulkAdd(backup.bindings);
  await db.table('reviewTrail').bulkAdd(backup.reviewTrail);
  await db.table('reviewBaseline').bulkAdd(backup.reviewBaseline);
  await db.table('workspaceMeta').bulkAdd(backup.workspaceMeta.map(row => ({ ...row, savedAt: stamp })));
}

/** Validate collisions before the first write; the caller owns the single write transaction. */
export async function restoreVerbundBackupSnapshot(db: Dexie, backup: WorkspaceVerbundBackup): Promise<void> {
  const verbundId = backup.verbuende[0].verbundId;
  const documents = db.table<WorkspaceEnvelope, LocalId>('documents');
  const incoming = await documents.bulkGet(backup.documents.map(row => row.localId));
  if (incoming.some(row => row && row.verbundId !== verbundId)) reject('WORKSPACE_BACKUP_CONFLICT');
  const stamp = await restoredStamp(db, [
    ...backup.verbuende, ...backup.documents, ...backup.drafts,
    ...backup.reviewTrail.map(row => ({ savedAt: row.createdAt })),
  ]);
  const oldIds = new Set(await documents.where('verbundId').equals(verbundId).primaryKeys());
  await db.table<WorkspaceBinding>('bindings').filter(row => oldIds.has(row.fromLocalId) || (row.target.kind === 'local' && oldIds.has(row.target.localId))).delete();
  await db.table('drafts').bulkDelete([...oldIds]);
  await db.table('reviewTrail').where('localId').anyOf([...oldIds]).delete();
  await db.table('reviewBaseline').bulkDelete([...oldIds]);
  await documents.bulkDelete([...oldIds]);
  await db.table('verbuende').put(backup.verbuende[0]);
  await documents.bulkAdd(backup.documents.map(row => restoredRow(row, stamp)));
  await db.table('drafts').bulkAdd(backup.drafts.map(row => restoredRow(row, stamp)));
  await db.table('bindings').bulkAdd(backup.bindings);
  await db.table('reviewTrail').bulkAdd(backup.reviewTrail);
  await db.table('reviewBaseline').bulkAdd(backup.reviewBaseline);
  await db.table('workspaceMeta').update('workspace', { savedAt: stamp });
}
