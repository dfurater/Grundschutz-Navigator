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
