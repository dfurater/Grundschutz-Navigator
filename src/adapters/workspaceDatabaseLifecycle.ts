import type { WorkspaceResult } from '@/domain/workspaceModel';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';

/**
 * Resolves with `code` once `ms` elapse. `run` reads `expired()` to stop before side effects; a result that still
 * arrives afterwards goes to `discard` and never reaches the caller.
 */
export function withinDeadline<T>(
  ms: number,
  code: string,
  run: (expired: () => boolean) => Promise<WorkspaceResult<T>>,
  discard: (late: WorkspaceResult<T>) => void,
): Promise<WorkspaceResult<T>> {
  return new Promise(resolve => {
    let expired = false;
    const timer = setTimeout(() => {
      expired = true;
      resolve(failure(new StorageFailure(code)));
    }, ms);
    void run(() => expired).then(result => {
      if (expired) { discard(result); return; }
      clearTimeout(timer);
      resolve(result);
    });
  });
}

/**
 * Reads the stored version and store names without a schema declaration. Dexie would reconcile an existing schema
 * against a declared one, so a database that must stay untouched is opened through the native API only. Dexie stores
 * a logical version `v` as native `v * 10`; a schema patched without a version bump lands between two multiples, hence
 * the rounding. `indexedDB.open(name)` without a version would create a missing database, so an upgrade started on a
 * vanished database is aborted and reported as `undefined`.
 */
export function storedDatabaseShape(name: string): Promise<{ version: number; stores: readonly string[] } | undefined> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let created = false;
    request.onupgradeneeded = () => { created = true; request.transaction?.abort(); };
    request.onsuccess = () => {
      const database = request.result;
      const version = Math.round(database.version / 10);
      const stores = [...database.objectStoreNames];
      database.close();
      resolve({ version, stores });
    };
    request.onerror = () => {
      if (created) resolve(undefined);
      else reject(request.error ?? new Error('WORKSPACE_OPEN_FAILED'));
    };
  });
}

/** A started `deleteDatabase` cannot be cancelled: blocked for `blockedMs`, it reports `WORKSPACE_DELETE_PENDING` and the browser completes it later. */
export function deleteDatabase(name: string, blockedMs: number): Promise<WorkspaceResult<void>> {
  return new Promise(resolve => {
    const request = indexedDB.deleteDatabase(name);
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
      timer ??= setTimeout(() => finish(failure(new StorageFailure('WORKSPACE_DELETE_PENDING'))), blockedMs);
    };
  });
}
