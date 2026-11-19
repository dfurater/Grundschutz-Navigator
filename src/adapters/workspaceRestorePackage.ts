import type Dexie from 'dexie';
import { serializeWorkspaceJsonSorted } from '@/domain/workspaceJson';
import type { LocalId, WorkspaceEnvelope, WorkspaceVerbund, WorkspaceVerbundBackup } from '@/domain/workspaceModel';

// Paketregeln des Verbund-Restores (GSPP-708); der Aufrufer hält die Lesetransaktion über alle Stores.

/**
 * Paketverweise behalten ihren Verbundkontext über den Restore hinaus: Die `packageId` der Datei gehört keinem anderen
 * Zielverbund, ihre Baseline-`localId` keinem Dokument eines anderen Verbunds, und kein anderer Zielverbund verweist mit
 * seiner Baseline auf ein Dokument der Datei oder auf dieselbe Baseline-`localId` wie die Datei, auch wenn das Dokument fehlt.
 */
export async function foreignPackageReference(db: Dexie, backup: WorkspaceVerbundBackup): Promise<boolean> {
  const verbundId = backup.verbuende[0].verbundId;
  const filePackage = backup.verbuende[0].requirementPackage;
  const fileDocuments = new Set<string>(backup.documents.map(row => row.localId));
  if (filePackage && !fileDocuments.has(filePackage.baseline.localId)) {
    const owner = await db.table<WorkspaceEnvelope, LocalId>('documents').get(filePackage.baseline.localId);
    if (owner && owner.verbundId !== verbundId) return true;
  }
  const others = await db.table<WorkspaceVerbund>('verbuende')
    .filter(row => row.verbundId !== verbundId && row.requirementPackage !== undefined
      && (row.requirementPackage.packageId === filePackage?.packageId || row.requirementPackage.baseline.localId === filePackage?.baseline.localId
        || fileDocuments.has(row.requirementPackage.baseline.localId)))
    .count();
  return others > 0;
}

/** Ein bestehender Zielverbund nimmt nur ein Bündel mit identischem Paket auf, verglichen als vollständiges Plain JSON. */
export function requirementPackageConflict(file: WorkspaceVerbund, existing: WorkspaceVerbund | null): boolean {
  if (!existing) return false;
  const plain = (verbund: WorkspaceVerbund) => verbund.requirementPackage === undefined ? null : serializeWorkspaceJsonSorted(verbund.requirementPackage);
  return plain(file) !== plain(existing);
}
