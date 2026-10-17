import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/class2ImportLimits.mjs';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { parseWorkspaceBackupInput } from '@/domain/oscalImportProcessing';
import { enforceClass2ObjectGraphInvariants, enforceWorkspaceBackupGraphInvariants } from '@/domain/oscalObjectGraph';
import { validWorkspaceBackupStructure, validVerbundBackupStructure } from '@/adapters/workspaceBackupStructure';
import { rejectWorkspaceBackup } from '@/adapters/workspaceBackupContract';
import { type WorkspaceBackup, type WorkspaceVerbundBackup, type WorkspaceResult } from '@/domain/workspaceModel';

/**
 * Closed restore format. Runs inside the backup module worker; every persisted document source traverses the
 * class-2 chain of the import worker in this worker, so compiled schema cells serve all documents of one bundle.
 */
async function processBackupBytes<T extends WorkspaceBackup | WorkspaceVerbundBackup>(bytes: Uint8Array, validStructure: (value: unknown) => value is T): Promise<WorkspaceResult<T>> {
  try {
    const parsed = parseWorkspaceBackupInput(bytes);
    if (!parsed.ok) return rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED');
    if (enforceWorkspaceBackupGraphInvariants(parsed.source)) return rejectWorkspaceBackup('WORKSPACE_BACKUP_RESOURCE_REJECTED');
    serializeWorkspaceJson(parsed.source);
    if (!validStructure(parsed.source)) return rejectWorkspaceBackup();
    for (const draft of parsed.source.drafts) {
      if (enforceClass2ObjectGraphInvariants(draft.source)
        || new TextEncoder().encode(serializeWorkspaceJson(draft.source)).byteLength > CLASS_2_IMPORT_LIMITS.maxBytes) {
        return rejectWorkspaceBackup('WORKSPACE_BACKUP_RESOURCE_REJECTED');
      }
    }
    for (const envelope of parsed.source.documents) {
      const imported = await processClass2OscalBytes(new TextEncoder().encode(serializeWorkspaceJson(envelope.source)), { trustClass: 'class-2-local-user' });
      if (!imported.ok || imported.document.rootType !== envelope.rootType || imported.document.oscalVersion !== envelope.oscalVersion) return rejectWorkspaceBackup('WORKSPACE_BACKUP_DOCUMENT_REJECTED');
    }
    return { ok: true, value: parsed.source };
  } catch { return rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED'); }
}

export function processWorkspaceBackupBytes(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceBackup>> {
  return processBackupBytes(bytes, validWorkspaceBackupStructure);
}
export function processVerbundBackupBytes(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceVerbundBackup>> {
  return processBackupBytes(bytes, validVerbundBackupStructure);
}
