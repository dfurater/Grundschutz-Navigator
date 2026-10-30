import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { processClass2OscalBytes } from '@/domain/oscalClass2Import';
import { parseWorkspaceBackupInput } from '@/domain/oscalImportProcessing';
import { enforceWorkspaceBackupGraphInvariants } from '@/domain/oscalObjectGraph';
import { bindsEnvelopeSource, withinSourceLimits } from '@/adapters/workspaceDraftSource';
import { validWorkspaceBackupStructure, validVerbundBackupStructure } from '@/adapters/workspaceBackupStructure';
import { rejectWorkspaceBackup } from '@/adapters/workspaceBackupContract';
import { documentSnapshot, sameStand } from '@/domain/reviewTrail';
import { type WorkspaceBackup, type WorkspaceVerbundBackup, type WorkspaceResult } from '@/domain/workspaceModel';

/** Die Vergleichsbasis muss den Stand aus ihrer eigenen Quelle belegen; sonst wäre der nächste Diff falsch. */
async function verifyBaselines(backup: WorkspaceBackup | WorkspaceVerbundBackup): Promise<'ok' | 'invalid' | 'failed'> {
  const documents = new Map(backup.documents.map(entry => [entry.localId, entry]));
  for (const row of backup.reviewBaseline) {
    const document = documents.get(row.localId);
    if (!document) return 'invalid';
    let snapshot;
    try { snapshot = await documentSnapshot(row.source, document.rootType); }
    catch { return 'failed'; }
    if (!snapshot || !sameStand(row.stand, snapshot)) return 'invalid';
  }
  return 'ok';
}

/** Entwürfe binden nur Root und Version; jedes andere Dokument durchläuft die Klasse-2-Kette des Import-Workers. */
async function documentsAdmissible(backup: WorkspaceBackup | WorkspaceVerbundBackup): Promise<boolean> {
  for (const envelope of backup.documents) {
    if (envelope.documentState === 'draft') {
      if (!bindsEnvelopeSource(envelope.source, envelope.rootType, envelope.oscalVersion)) return false;
      continue;
    }
    const imported = await processClass2OscalBytes(new TextEncoder().encode(serializeWorkspaceJson(envelope.source)), { trustClass: 'class-2-local-user' });
    if (!imported.ok || imported.document.rootType !== envelope.rootType || imported.document.oscalVersion !== envelope.oscalVersion) return false;
  }
  return true;
}

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
    if (!backup.drafts.every(draft => withinSourceLimits(draft.source))) return rejectWorkspaceBackup('WORKSPACE_BACKUP_RESOURCE_REJECTED');
    if (!await documentsAdmissible(backup)) return rejectWorkspaceBackup('WORKSPACE_BACKUP_DOCUMENT_REJECTED');
    const baseline = await verifyBaselines(backup);
    if (baseline === 'invalid') return rejectWorkspaceBackup();
    if (baseline === 'failed') return rejectWorkspaceBackup('WORKSPACE_BACKUP_WORKER_FAILURE');
    return { ok: true, value: backup };
  } catch { return rejectWorkspaceBackup('WORKSPACE_BACKUP_INPUT_REJECTED'); }
}

export function processWorkspaceBackupBytes(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceBackup>> {
  return processBackupBytes(bytes, value => validWorkspaceBackupStructure(value) ? value : null);
}
export function processVerbundBackupBytes(bytes: Uint8Array): Promise<WorkspaceResult<WorkspaceVerbundBackup>> {
  return processBackupBytes(bytes, value => validVerbundBackupStructure(value) ? value : null);
}
