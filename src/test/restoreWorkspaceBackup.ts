import type { WorkspaceStore } from '@/adapters/workspaceStore';
import type { WorkspaceResult } from '@/domain/workspaceModel';

/** Exercise both public steps while retaining validation failures as results. */
export async function restoreWorkspaceBackup(store: WorkspaceStore, bytes: Uint8Array): Promise<WorkspaceResult<void>> {
  const preview = await store.previewRestoreBackup(bytes);
  return preview.ok ? store.restoreBackup(preview.value) : preview;
}
