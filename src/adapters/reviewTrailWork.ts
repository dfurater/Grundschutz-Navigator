import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { OSCAL_ROOT_KEYS, type OscalRootKey } from '@/domain/oscalVersionMatrix';
import { CONTENT_HASH_ALGORITHM, CONTENT_HASH_VERSION, REVIEW_TRAIL_DEADLINE_MS } from '@/domain/reviewTrail';
import type { DocumentDiff } from '@/domain/documentDiff';
import type { DocumentSnapshot, WorkspaceResult } from '@/domain/workspaceModel';

export interface ReviewTrailWorkRequest {
  readonly source: unknown;
  readonly rootType: OscalRootKey;
  /** Quelle der Vergleichsbaseline; `null` heißt gegen das leere Dokument. */
  readonly previous: unknown | null;
  readonly baseSequence: number | null;
  /** `false` spart den Diff, wenn nur der Stand gebraucht wird (Freigabe, reine Prüfung). */
  readonly diff: boolean;
}

export interface ReviewTrailWorkResult {
  readonly snapshot: DocumentSnapshot;
  readonly diff?: DocumentDiff;
}

export type ReviewTrailWorkResponse =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot; readonly diff?: DocumentDiff }
  | { readonly ok: false };

const SHA256 = /^[a-f0-9]{64}$/;
const DIFF_KINDS = ['added', 'removed', 'changed'];
const DIFF_VALUE_KINDS = ['object', 'array', 'string', 'number', 'boolean', 'null'];

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validSnapshot(value: unknown): value is DocumentSnapshot {
  if (!record(value) || !OSCAL_ROOT_KEYS.includes(value.rootType as never)) return false;
  if (!['uuid', 'lastModified', 'version', 'oscalVersion'].every(key => typeof value[key] === 'string' && (value[key] as string).length > 0)) return false;
  const hash = value.contentHash;
  return record(hash) && hash.version === CONTENT_HASH_VERSION && hash.algorithm === CONTENT_HASH_ALGORITHM
    && typeof hash.value === 'string' && SHA256.test(hash.value);
}

function validDiff(value: unknown): value is DocumentDiff {
  if (!record(value) || value.version !== 1 || typeof value.truncated !== 'boolean' || !Array.isArray(value.entries)) return false;
  if (!(value.baseSequence === null || (Number.isInteger(value.baseSequence) && (value.baseSequence as number) > 0))) return false;
  return value.entries.every(entry => record(entry) && typeof entry.path === 'string' && entry.path.startsWith('/')
    && DIFF_KINDS.includes(entry.kind as string) && DIFF_VALUE_KINDS.includes(entry.valueKind as string)
    && typeof entry.marker === 'boolean');
}

function failed(): WorkspaceResult<never> {
  return {
    ok: false,
    diagnostic: createOscalDiagnostic({
      code: 'REVIEW_TRAIL_WORK_FAILED', stage: 'domain', validator: { name: 'gspp-review-trail', version: '1' }, path: '/',
    }),
  };
}

/**
 * One dedicated worker per request computes content hash and structural diff. There is no in-process fallback:
 * a timeout, a worker error or a rejected input yields `REVIEW_TRAIL_WORK_FAILED` and writes nothing.
 */
export function reviewTrailInWorker(request: ReviewTrailWorkRequest): Promise<WorkspaceResult<ReviewTrailWorkResult>> {
  return new Promise(resolve => {
    let worker: Worker | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (result: WorkspaceResult<ReviewTrailWorkResult>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker?.terminate();
      resolve(result);
    };
    const workerFailure = () => finish(failed());
    try {
      worker = new Worker(new URL('../workers/reviewTrail.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent) => {
        if (settled) return;
        if (event.origin !== '' && event.origin !== globalThis.location.origin) return workerFailure();
        const data = event.data as Record<string, unknown> | null;
        if (!data || typeof data !== 'object' || data.ok !== true || !validSnapshot(data.snapshot)) return workerFailure();
        const keys = Object.keys(data).sort().join(',');
        if (keys !== (request.diff ? 'diff,ok,snapshot' : 'ok,snapshot')) return workerFailure();
        if (request.diff ? !validDiff(data.diff) : data.diff !== undefined) return workerFailure();
        finish({ ok: true, value: { snapshot: data.snapshot, ...(request.diff ? { diff: data.diff as DocumentDiff } : {}) } });
      };
      worker.onerror = workerFailure;
      worker.onmessageerror = workerFailure;
      timeout = setTimeout(workerFailure, REVIEW_TRAIL_DEADLINE_MS);
      worker.postMessage(request);
    } catch { workerFailure(); }
  });
}
