import { validWorkspaceBackupStructure, validVerbundBackupStructure } from '@/adapters/workspaceBackupStructure';
import { CLASS_2_IMPORT_LIMITS, WORKSPACE_BACKUP_FRAME_DEPTH, WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { OscalSourceDecoder, type TransportLimits } from '@/domain/oscalImportTransport';
import { rejectWorkspaceBackup, WORKSPACE_BACKUP_DIAGNOSTIC_CODES, WORKSPACE_BACKUP_WORKER_TIMEOUT_MS } from '@/adapters/workspaceBackupContract';
import type { WorkspaceBackup, WorkspaceVerbundBackup, WorkspaceResult } from '@/domain/workspaceModel';

/** Bundle bounds of the return transport: the node and depth limits of the bundle graph, string units within the byte limit. */
const BACKUP_TRANSPORT_LIMITS: TransportLimits = {
  maxNodes: CLASS_2_IMPORT_LIMITS.maxNodes,
  maxDepth: CLASS_2_IMPORT_LIMITS.maxDepth + WORKSPACE_BACKUP_FRAME_DEPTH,
  maxCodeUnits: WORKSPACE_BACKUP_MAX_BYTES,
};

function hasKeys(value: object, keys: string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

/**
 * A dedicated worker owns backup decoding and JSON validation. It returns the validated bundle in acknowledged fragments,
 * so the main thread rebuilds it one bounded message at a time.
 */
function parseBackup<T extends WorkspaceBackup | WorkspaceVerbundBackup>(bytes: Uint8Array, scope: 'workspace' | 'verbund', validStructure: (value: unknown) => value is T): Promise<WorkspaceResult<T>> {
  if (bytes.byteLength > WORKSPACE_BACKUP_MAX_BYTES) return Promise.resolve(rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED'));
  return new Promise(resolve => {
    let worker: Worker;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let decoder: OscalSourceDecoder | undefined;
    let sequence = 0;
    let settled = false;
    const finish = (result: WorkspaceResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      decoder?.dispose();
      decoder = undefined;
      worker?.terminate();
      resolve(result);
    };
    const workerFailure = () => finish(rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE'));
    try {
      worker = new Worker(new URL('../workers/workspaceBackup.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent) => {
        if (settled) return;
        // The sole producer is the locally created module worker. No document-origin fields are used as diagnostics.
        if (event.origin !== '' && event.origin !== globalThis.location.origin) return workerFailure();
        try {
          const frame = event.data as Record<string, unknown> | null;
          if (!frame || typeof frame !== 'object') throw new Error('Invalid frame');
          if (frame.type === 'start' && hasKeys(frame, ['type']) && !decoder) {
            decoder = new OscalSourceDecoder(BACKUP_TRANSPORT_LIMITS);
          } else if (frame.type === 'chunk' && hasKeys(frame, ['type', 'sequence', 'operations']) && decoder && frame.sequence === sequence) {
            // The acknowledgement is back pressure; `sequence` rules out skipped and repeated fragments.
            decoder.accept(frame.operations);
            worker.postMessage({ type: 'ack', sequence: sequence++ });
          } else if (frame.type === 'done' && hasKeys(frame, ['type', 'sequence']) && decoder && frame.sequence === sequence) {
            // This locally created worker is the validation authority; check the closed bundle form before adoption.
            const value = decoder.finish();
            if (!validStructure(value)) throw new Error('Invalid bundle');
            finish({ ok: true, value });
          } else if (frame.type === 'rejected' && hasKeys(frame, ['type', 'diagnostic']) && !decoder) {
            const diagnostic = frame.diagnostic;
            const code = diagnostic && typeof diagnostic === 'object' ? (diagnostic as Record<string, unknown>).code : undefined;
            const allowedCodes: readonly unknown[] = WORKSPACE_BACKUP_DIAGNOSTIC_CODES;
            finish(rejectWorkspaceBackup(allowedCodes.includes(code) ? code as string : 'WORKSPACE_BACKUP_WORKER_FAILURE'));
          } else throw new Error('Invalid frame');
        } catch { workerFailure(); }
      };
      worker.onerror = workerFailure;
      worker.onmessageerror = workerFailure;
      timeout = setTimeout(workerFailure, WORKSPACE_BACKUP_WORKER_TIMEOUT_MS);
      const copy = bytes.slice();
      worker.postMessage({ scope, buffer: copy.buffer }, [copy.buffer]);
    } catch { workerFailure(); }
  });
}

export function parseWorkspaceBackup(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceBackup>> {
  return parseBackup(bytes, 'workspace', validWorkspaceBackupStructure);
}
export function parseVerbundBackup(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceVerbundBackup>> {
  return parseBackup(bytes, 'verbund', validVerbundBackupStructure);
}
