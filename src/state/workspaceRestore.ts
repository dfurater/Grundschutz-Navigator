import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type {
  LocalId, VerbundId, WorkspaceDocumentSummary, WorkspaceRestorePreview, WorkspaceVerbund, WorkspaceVerbundRestorePreview,
} from '@/domain/workspaceModel';

export type RestorePreview = WorkspaceRestorePreview | WorkspaceVerbundRestorePreview;

/** Zielbereich einer Wiederherstellung; `localIds` sind bisherige und wiederhergestellte Dokumente des Verbunds. */
export type RestoreScope =
  | { readonly kind: 'workspace' }
  | { readonly kind: 'verbund'; readonly verbundId: VerbundId; readonly localIds: readonly LocalId[] };

/** Nicht gespeicherte Sitzungseingabe im Zielbereich, die eine Wiederherstellung ersetzen würde. */
export type RestoreInput =
  | { readonly kind: 'rename'; readonly verbundId: VerbundId; readonly name: string; readonly draft: string }
  | { readonly kind: 'import'; readonly verbundId: VerbundId; readonly localId: LocalId; readonly rootType: OscalRootKey; readonly count: number };

/**
 * Offene Umbenennungen und Importziele im Zielbereich. Ein Umbenennungsentwurf mit dem gespeicherten Namen
 * ändert nichts; Eingaben unbeteiligter Verbünde gehören beim Verbund-Restore nicht dazu.
 */
export function collectRestoreInputs({ scope, renameDrafts, importTargets, verbuende, documents }: Readonly<{
  scope: RestoreScope;
  renameDrafts: ReadonlyMap<string, string>;
  importTargets: ReadonlyMap<LocalId, ReadonlyMap<string, unknown>>;
  verbuende: readonly WorkspaceVerbund[];
  documents: readonly WorkspaceDocumentSummary[];
}>): RestoreInput[] {
  const inScope = (verbundId: string) => scope.kind === 'workspace' || scope.verbundId === verbundId;
  const inputs: RestoreInput[] = [];
  for (const [verbundId, draft] of renameDrafts) {
    const entry = verbuende.find((candidate) => candidate.verbundId === verbundId);
    if (entry && inScope(verbundId) && draft.trim() !== entry.name) inputs.push({ kind: 'rename', verbundId: entry.verbundId, name: entry.name, draft });
  }
  const localIds = scope.kind === 'verbund' ? new Set(scope.localIds) : null;
  for (const document of documents) {
    const count = importTargets.get(document.localId)?.size ?? 0;
    if (count > 0 && (!localIds || localIds.has(document.localId) || inScope(document.verbundId))) {
      inputs.push({ kind: 'import', verbundId: document.verbundId, localId: document.localId, rootType: document.rootType, count });
    }
  }
  return inputs;
}

/** Verwirft nach erfolgreichem Restore alle Sitzungseingaben des ersetzten Bereichs; unbeteiligte bleiben. */
export function discardReplacedInputs(preview: RestorePreview, importTargets: Map<LocalId, unknown>, renameDrafts: Map<string, string>): void {
  if (preview.kind === 'workspace') {
    importTargets.clear();
    renameDrafts.clear();
    return;
  }
  for (const { localId } of [...preview.target.documents, ...preview.backup.documents]) importTargets.delete(localId);
  renameDrafts.delete(preview.verbundId);
}
