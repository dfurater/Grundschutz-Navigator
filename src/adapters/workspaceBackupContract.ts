import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import type { WorkspaceResult } from '@/domain/workspaceModel';

export const WORKSPACE_BACKUP_WORKER_TIMEOUT_MS = 120_000;
export const WORKSPACE_BACKUP_DIAGNOSTIC_CODES = ['WORKSPACE_BACKUP_INVALID', 'WORKSPACE_BACKUP_INPUT_REJECTED', 'WORKSPACE_BACKUP_RESOURCE_REJECTED', 'WORKSPACE_BACKUP_DOCUMENT_REJECTED', 'WORKSPACE_BACKUP_WORKER_FAILURE'] as const;

export function rejectWorkspaceBackup(code = 'WORKSPACE_BACKUP_INVALID'): WorkspaceResult<never> {
  return { ok: false, diagnostic: createOscalDiagnostic({ code, stage: 'domain', validator: { name: 'gspp-workspace', version: '1' }, path: '/' }) };
}
