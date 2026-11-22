import type { LocalId } from '@/domain/workspaceModel';

/** Neue Partei einer Prozessentscheidung; die UUID bleibt über Fehlversuche gleich. */
export interface DecisionParty { readonly uuid: string; readonly type: 'organization' | 'person'; readonly name: string }

/** Offene Eingaben eines Freigabe- oder Rücknahmedialogs. */
export interface DecisionDialogDraft {
  readonly party: string;
  readonly remarks: string;
  readonly newParty?: DecisionParty;
}

/*
 * Dialogentwürfe je Dokument im Arbeitsspeicher des Tabs. Sie überstehen Routenwechsel;
 * Abbrechen, ein Schreiberfolg und jede Löschung oder Ersetzung des Dokuments verwerfen sie.
 */
const drafts = new Map<LocalId, Map<string, DecisionDialogDraft>>();

export function decisionDrafts(localId: LocalId): Map<string, DecisionDialogDraft> {
  let map = drafts.get(localId);
  if (!map) {
    map = new Map();
    drafts.set(localId, map);
  }
  return map;
}

/** Ohne Angabe verwirft die Funktion alle Entwürfe des Tabs. */
export function discardDecisionDrafts(localIds?: Iterable<LocalId>): void {
  if (!localIds) {
    drafts.clear();
    return;
  }
  for (const localId of localIds) drafts.delete(localId);
}
