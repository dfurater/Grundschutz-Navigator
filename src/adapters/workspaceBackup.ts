import { normalizeWorkspaceBackup, normalizeVerbundBackup } from '@/adapters/workspaceBackupStructure';
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

/** Transport state of one restore: the decoder exists between `start` and the end of the transport. */
interface Receiver { decoder?: OscalSourceDecoder; sequence: number }

/** Keeps only an allowlisted code of a worker rejection and rebuilds every other diagnostic field. */
function rejectedResult(diagnostic: unknown): WorkspaceResult<never> {
  const code = diagnostic && typeof diagnostic === 'object' ? (diagnostic as Record<string, unknown>).code : undefined;
  const allowedCodes: readonly unknown[] = WORKSPACE_BACKUP_DIAGNOSTIC_CODES;
  return rejectWorkspaceBackup(allowedCodes.includes(code) ? code as string : 'WORKSPACE_BACKUP_WORKER_FAILURE');
}

/**
 * Applies one worker frame. Returns the result once the transport ends and `undefined` while fragments follow; a
 * protocol violation throws.
 */
function receiveFrame<T>(data: unknown, receiver: Receiver, adopt: (value: unknown) => T | null, ack: (sequence: number) => void): WorkspaceResult<T> | undefined {
  const frame = data as Record<string, unknown> | null;
  if (!frame || typeof frame !== 'object') throw new Error('Invalid frame');
  const { decoder } = receiver;
  if (frame.type === 'start' && hasKeys(frame, ['type']) && !decoder) {
    receiver.decoder = new OscalSourceDecoder(BACKUP_TRANSPORT_LIMITS);
    return undefined;
  }
  if (frame.type === 'chunk' && hasKeys(frame, ['type', 'sequence', 'operations']) && decoder && frame.sequence === receiver.sequence) {
    // The acknowledgement is back pressure; `sequence` rules out skipped and repeated fragments.
    decoder.accept(frame.operations);
    ack(receiver.sequence++);
    return undefined;
  }
  if (frame.type === 'done' && hasKeys(frame, ['type', 'sequence']) && decoder && frame.sequence === receiver.sequence) {
    // This locally created worker is the validation authority; the adopter checks the closed bundle form and normalizes supported legacy bundles.
    const value = adopt(decoder.finish());
    if (!value) throw new Error('Invalid bundle');
    return { ok: true, value };
  }
  if (frame.type === 'rejected' && hasKeys(frame, ['type', 'diagnostic']) && !decoder) return rejectedResult(frame.diagnostic);
  throw new Error('Invalid frame');
}

/**
 * A dedicated worker owns backup decoding and JSON validation. It returns the validated bundle in acknowledged fragments,
 * so the main thread rebuilds it one bounded message at a time.
 */
function parseBackup<T extends WorkspaceBackup | WorkspaceVerbundBackup>(bytes: Uint8Array, scope: 'workspace' | 'verbund', adopt: (value: unknown) => T | null): Promise<WorkspaceResult<T>> {
  if (bytes.byteLength > WORKSPACE_BACKUP_MAX_BYTES) return Promise.resolve(rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED'));
  return new Promise(resolve => {
    let worker: Worker;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const receiver: Receiver = { sequence: 0 };
    let settled = false;
    const finish = (result: WorkspaceResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      receiver.decoder?.dispose();
      receiver.decoder = undefined;
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
          const result = receiveFrame(event.data, receiver, adopt, sequence => worker.postMessage({ type: 'ack', sequence }));
          if (result) finish(result);
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
  return parseBackup(bytes, 'workspace', normalizeWorkspaceBackup);
}
export function parseVerbundBackup(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceVerbundBackup>> {
  return parseBackup(bytes, 'verbund', normalizeVerbundBackup);
}
