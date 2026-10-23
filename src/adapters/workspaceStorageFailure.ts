import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { WorkspaceResult } from '@/domain/workspaceModel';

/** Only stable codes cross the adapter boundary, never native error messages. */
export class StorageFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export function reject(code: string): never { throw new StorageFailure(code); }

/** Eine Station hält nicht übernommene Eingaben; das Verlassen des Bereichs bleibt gesperrt, ohne eine Speichermeldung auszulösen. */
export const UNSAVED_INPUT_CODE = 'WORKSPACE_UNSAVED_INPUT';
function isQuotaError(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if ('name' in current && current.name === 'QuotaExceededError') return true;
    current = 'inner' in current ? current.inner : undefined;
  }
  return false;
}
function storageCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    if (current instanceof StorageFailure) return current.code;
    current = 'inner' in current ? current.inner : undefined;
  }
  return undefined;
}
export function failure(error: unknown): WorkspaceResult<never> {
  const code = storageCode(error) ?? (isQuotaError(error) ? 'WORKSPACE_QUOTA_EXCEEDED' : 'WORKSPACE_STORAGE_FAILED');
  return { ok: false, diagnostic: createOscalDiagnostic({ code, stage: 'domain', validator: { name: 'gspp-workspace', version: '1' }, path: '/' }) };
}

/** Latest instant the bundle grammar admits; it accepts four-digit years only. */
export const LAST_TIMESTAMP_MS = Date.parse('9999-12-31T23:59:59.999Z');

/**
 * Write stamps end one millisecond before `LAST_TIMESTAMP_MS`; the last one is reserved for the restore stamp, so every
 * exported bundle stays restorable. A later stamp aborts the write and the stored state stays exportable.
 */
export function timestamp(previous?: string, last = LAST_TIMESTAMP_MS - 1): string {
  const value = Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0);
  if (value > last) reject('WORKSPACE_TIMESTAMP_EXHAUSTED');
  return new Date(value).toISOString();
}
