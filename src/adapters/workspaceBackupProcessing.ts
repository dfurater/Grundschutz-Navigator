import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { parseWorkspaceBackupInput } from '@/domain/oscalImportProcessing';
import { enforceWorkspaceBackupGraphInvariants } from '@/domain/oscalObjectGraph';
import { bindsEnvelopeSource, withinSourceLimits } from '@/adapters/workspaceDraftSource';
import { normalizeWorkspaceBackup, normalizeVerbundBackup } from '@/adapters/workspaceBackupStructure';
import { rejectWorkspaceBackup } from '@/adapters/workspaceBackupContract';
import { type WorkspaceBackup, type WorkspaceVerbundBackup, type WorkspaceResult } from '@/domain/workspaceModel';

/**
 * Closed restore format. Runs inside the backup module worker; every persisted document source outside state draft
 * traverses the class-2 chain of the import worker in this worker, so compiled schema cells serve all documents of one
 * bundle. A draft document keeps only the source limits and its root binding.
 */
async function processBackupBytes<T extends WorkspaceBackup | WorkspaceVerbundBackup>(bytes: Uint8Array, adopt: (value: unknown) => T | null): Promise<WorkspaceResult<T>> {
  try {
    const parsed = parseWorkspaceBackupInput(bytes);
    if (!parsed.ok) return rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED');
    if (enforceWorkspaceBackupGraphInvariants(parsed.source)) return rejectWorkspaceBackup('WORKSPACE_BACKUP_RESOURCE_REJECTED');
    serializeWorkspaceJson(parsed.source);
    const backup = adopt(parsed.source);
    if (!backup) return rejectWorkspaceBackup();
    for (const draft of backup.drafts) {
      if (!withinSourceLimits(draft.source)) return rejectWorkspaceBackup('WORKSPACE_BACKUP_RESOURCE_REJECTED');
    }
    for (const envelope of backup.documents) {
      if (envelope.documentState === 'draft') {
        if (!bindsEnvelopeSource(envelope.source, envelope.rootType, envelope.oscalVersion)) return rejectWorkspaceBackup('WORKSPACE_BACKUP_DOCUMENT_REJECTED');
        continue;
      }
      const imported = await processClass2OscalBytes(new TextEncoder().encode(serializeWorkspaceJson(envelope.source)), { trustClass: 'class-2-local-user' });
      if (!imported.ok || imported.document.rootType !== envelope.rootType || imported.document.oscalVersion !== envelope.oscalVersion) return rejectWorkspaceBackup('WORKSPACE_BACKUP_DOCUMENT_REJECTED');
    }
    return { ok: true, value: backup };
  } catch { return rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED'); }
}

export function processWorkspaceBackupBytes(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceBackup>> {
  return processBackupBytes(bytes, normalizeWorkspaceBackup);
}
export function processVerbundBackupBytes(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceVerbundBackup>> {
  return processBackupBytes(bytes, normalizeVerbundBackup);
}
