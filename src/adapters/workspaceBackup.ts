import { validWorkspaceBackupStructure } from '@/adapters/workspaceBackupStructure';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { rejectWorkspaceBackup, WORKSPACE_BACKUP_DIAGNOSTIC_CODES, WORKSPACE_BACKUP_WORKER_TIMEOUT_MS } from '@/adapters/workspaceBackupContract';
import type { WorkspaceBackup, WorkspaceResult } from '@/domain/workspaceModel';

/** A dedicated worker owns backup decoding and JSON validation. */
export function parseWorkspaceBackup(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceBackup>> {
  if (bytes.byteLength > WORKSPACE_BACKUP_MAX_BYTES) return Promise.resolve(rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED'));
  return new Promise(resolve => {
    let worker: Worker;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: WorkspaceResult<WorkspaceBackup>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker?.terminate();
      resolve(result);
    };
    try {
      worker = new Worker(new URL('../workers/workspaceBackup.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<WorkspaceResult<WorkspaceBackup>>) => {
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
        if (result.ok !== true || !Object.hasOwn(result, 'value') || !validWorkspaceBackupStructure(result.value)) {
          finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
          return;
        }
        finish(result);
      };
      worker.onerror = () => finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
      worker.onmessageerror = () => finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
      timeout = setTimeout(() => finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE')), WORKSPACE_BACKUP_WORKER_TIMEOUT_MS);
      const copy = bytes.slice();
      worker.postMessage(copy.buffer, [copy.buffer]);
    } catch { finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE')); }
  });
}
