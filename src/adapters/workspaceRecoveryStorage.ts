import type Dexie from 'dexie';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import { serializeWorkspaceRecoveryJson } from '@/adapters/workspaceRecoveryJson';
import { encodeWorkspaceBackupKey } from '@/adapters/workspaceBackupStorage';
import { failure, reject } from '@/adapters/workspaceStorageFailure';

/** Native enumeration includes stores that Dexie omits because their names match Object.prototype. */
export async function exportNewerWorkspaceBackup(db: Dexie): Promise<WorkspaceResult<string>> {
  try {
    const native = db.backendDB();
    const names = [...native.objectStoreNames];
    if (names.some(name => ['format', 'storageSchemaVersion', 'outOfLineKeys'].includes(name))) reject('WORKSPACE_SCHEMA_INVALID');
    const stores: Record<string, unknown[]> = Object.create(null);
    const outOfLineKeys: Record<string, unknown[]> = Object.create(null);
    const text = await new Promise<string>((resolve, reject) => {
      const transaction = native.transaction(names, 'readonly');
      transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB-Transaktion wurde abgebrochen.'));
      transaction.oncomplete = () => {
        try {
          resolve(serializeWorkspaceRecoveryJson({ format: 'gspp-workspace', storageSchemaVersion: db.verno, ...stores, ...(Object.keys(outOfLineKeys).length > 0 && { outOfLineKeys }) }));
        } catch (error) { reject(error); }
      };
      for (const name of names) {
        const table = transaction.objectStore(name);
        const rows: unknown[] = [];
        stores[name] = rows;
        const keys: unknown[] | undefined = table.keyPath === null ? [] : undefined;
        if (keys) outOfLineKeys[name] = keys;
        const request = table.openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return;
          rows.push(cursor.value);
          keys?.push(encodeWorkspaceBackupKey(cursor.primaryKey));
          cursor.continue();
        };
      }
    });
    return { ok: true, value: text };
  } catch (error) { return failure(error); }
}
