import { validWorkspaceBackupStructure, validVerbundBackupStructure } from '@/adapters/workspaceBackupStructure';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { rejectWorkspaceBackup, WORKSPACE_BACKUP_DIAGNOSTIC_CODES, WORKSPACE_BACKUP_WORKER_TIMEOUT_MS } from '@/adapters/workspaceBackupContract';
import type { WorkspaceBackup, WorkspaceVerbundBackup, WorkspaceResult } from '@/domain/workspaceModel';

/** A dedicated worker owns backup decoding and JSON validation. */
function parseBackup<T extends WorkspaceBackup | WorkspaceVerbundBackup>(bytes: Uint8Array, scope: 'workspace' | 'verbund', validStructure: (value: unknown) => value is T): Promise<WorkspaceResult<T>> {
  if (bytes.byteLength > WORKSPACE_BACKUP_MAX_BYTES) return Promise.resolve(rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED'));
  return new Promise(resolve => {
    let worker: Worker;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: WorkspaceResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker?.terminate();
      resolve(result);
    };
    try {
      worker = new Worker(new URL('../workers/workspaceBackup.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkspaceResult<T>>) => {
        // The sole producer is the locally created module worker. No document-origin fields are used as diagnostics.
        if (event.origin !== '' && event.origin !== globalThis.location.origin) return finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
        const result = event.data;
        if (!result || typeof result !== 'object' || Object.keys(result).length !== 2) return finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
        if (result.ok === false) {
          const code = result.diagnostic?.code;
          const allowedCodes: readonly string[] = WORKSPACE_BACKUP_DIAGNOSTIC_CODES;
          finish(rejectWorkspaceBackup(allowedCodes.includes(code) ? code : 'WORKSPACE_BACKUP_WORKER_FAILURE'));
          return;
        }
        // This locally created worker is the validation authority; check the closed transport envelope before adoption.
        if (result.ok !== true || !Object.hasOwn(result, 'value') || !validStructure(result.value)) {
          finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
          return;
        }
        finish(result);
      };
      worker.onerror = () => finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
      worker.onmessageerror = () => finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
      timeout = setTimeout(() => finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE')), WORKSPACE_BACKUP_WORKER_TIMEOUT_MS);
      const copy = bytes.slice();
      worker.postMessage({ scope, buffer: copy.buffer }, [copy.buffer]);
    } catch { finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE')); }
  });
}

export function parseWorkspaceBackup(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceBackup>> {
  return parseBackup(bytes, 'workspace', validWorkspaceBackupStructure);
}
export function parseVerbundBackup(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceVerbundBackup>> {
  return parseBackup(bytes, 'verbund', validVerbundBackupStructure);
}
