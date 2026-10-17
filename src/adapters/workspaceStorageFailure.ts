import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { WorkspaceResult } from '@/domain/workspaceModel';

/** Only stable codes cross the adapter boundary, never native error messages. */
export class StorageFailure extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

export function reject(code: string): never { throw new StorageFailure(code); }
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
export function failure(error: unknown): WorkspaceResult<never> {
  let code = 'WORKSPACE_STORAGE_FAILED';
  if (error instanceof StorageFailure) code = error.code;
  else if (isQuotaError(error)) code = 'WORKSPACE_QUOTA_EXCEEDED';
  return { ok: false, diagnostic: createOscalDiagnostic({ code, stage: 'domain', validator: { name: 'gspp-workspace', version: '1' }, path: '/' }) };
}

export function timestamp(previous?: string): string {
  return new Date(Math.max(Date.now(), previous ? Date.parse(previous) + 1 : 0)).toISOString();
}
