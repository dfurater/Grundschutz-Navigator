import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type {
  LocalId, ScopeId, VerbundId, WorkspaceDocumentSummary, WorkspaceRestorePreview, WorkspaceScope, WorkspaceVerbund,
  WorkspaceVerbundRestorePreview,
} from '@/domain/workspaceModel';
import { boundaryDraftBase, sameBoundaryInput, scopeBoundaryInput, type ScopeBoundaryDraft } from '@/domain/scopeBoundary';
import type { WorkspaceContextValue } from '@/state/WorkspaceContext';
import { discardDecisionDrafts, retainDecisionDrafts } from '@/state/processDecisionDrafts';

/** Schlüssel der offenen Anlage eines Anwendungsbereichs unter den Namensentwürfen; keine `scopeId` hat diese Form. */
export const NEW_SCOPE_DRAFT = 'neu';
export const scopedVerbundDraftKey = (scopeId: ScopeId) => `neuer-verbund:${scopeId}`;

export type RestorePreview = WorkspaceRestorePreview | WorkspaceVerbundRestorePreview;

type ScopeDocument = Pick<WorkspaceDocumentSummary, 'localId' | 'verbundId' | 'rootType'>;
type ScopeName = Pick<WorkspaceScope, 'scopeId' | 'name' | 'savedAt'>;

/**
 * Zielbereich einer Wiederherstellung. `documents` sind die Dokumente der Sicherung: Auch ein inzwischen
 * gelöschtes Dokument, das die Sicherung zurückbringt, kann noch ein offenes Importziel tragen.
 */
export type RestoreScope =
  | { readonly kind: 'workspace'; readonly documents: readonly ScopeDocument[] }
  | { readonly kind: 'verbund'; readonly verbundId: VerbundId; readonly documents: readonly ScopeDocument[] };

/**
 * Nicht gespeicherte Sitzungseingabe im Zielbereich, die eine Wiederherstellung ersetzen würde. `row` markiert
 * eine Umbenennung, die in einer Zeile der Übersicht offen ist; `orphan` ein Importziel ohne bekanntes Dokument.
 */
export type RestoreInput =
  | { readonly kind: 'rename'; readonly verbundId: VerbundId; readonly name: string; readonly draft: string; readonly row?: true }
  | { readonly kind: 'import'; readonly verbundId: VerbundId; readonly localId: LocalId; readonly rootType: OscalRootKey; readonly count: number }
  | { readonly kind: 'orphan'; readonly localId: LocalId; readonly count: number }
  /** Offener Name eines Anwendungsbereichs: Umbenennung mit Vergleichsstand oder, ohne `scope`, eine Anlage. */
  | { readonly kind: 'scope'; readonly scope: ScopeName | null; readonly draft: string; readonly newVerbund?: never }
  | { readonly kind: 'scope'; readonly scope: ScopeName; readonly draft: string; readonly newVerbund: true }
  /** Offener Abgrenzungsentwurf eines Anwendungsbereichs; `base` ist der Vergleichsstand, mit dem die Klärung ihn speichert. */
  | { readonly kind: 'boundary'; readonly scope: ScopeName; readonly draft: ScopeBoundaryDraft; readonly base: string };

/** Schlüssel eines Scope-Eintrags unter den Namensentwürfen. */
export function scopeDraftKey(entry: Extract<RestoreInput, { kind: 'scope' }>): string {
  if (entry.newVerbund) return scopedVerbundDraftKey(entry.scope.scopeId);
  return entry.scope?.scopeId ?? NEW_SCOPE_DRAFT;
}

/**
 * Offene Umbenennungen und Importziele im Zielbereich. Ein Umbenennungsentwurf mit dem gespeicherten Namen
 * ändert nichts; Eingaben unbeteiligter Verbünde gehören beim Verbund-Restore nicht dazu. Der Gesamt-Restore
 * ersetzt alle Importziele, auch solche, deren Dokument weder der Speicher noch die Sicherung kennt.
 */
export function collectRestoreInputs({ scope, renameDrafts, rowDrafts = new Map(), scopeDrafts = new Map(), boundaryDrafts = new Map(), scopes = [], importTargets, verbuende, documents }: Readonly<{
  scope: RestoreScope;
  renameDrafts: ReadonlyMap<string, string>;
  /** Offene Namen zu Anwendungsbereichen; nur der Gesamt-Restore ersetzt Anwendungsbereiche. */
  scopeDrafts?: ReadonlyMap<string, string>;
  /** Offene Abgrenzungsentwürfe je `scopeId`; ebenfalls nur vom Gesamt-Restore ersetzt. */
  boundaryDrafts?: ReadonlyMap<string, ScopeBoundaryDraft>;
  scopes?: readonly WorkspaceScope[];
  /** Offene Umbenennungen in den Zeilen der Übersicht, getrennt von `renameDrafts` geführt. */
  rowDrafts?: ReadonlyMap<string, string>;
  importTargets: ReadonlyMap<LocalId, ReadonlyMap<string, unknown>>;
  verbuende: readonly WorkspaceVerbund[];
  documents: readonly WorkspaceDocumentSummary[];
}>): RestoreInput[] {
  const inScope = (verbundId: string) => scope.kind === 'workspace' || scope.verbundId === verbundId;
  const inputs: RestoreInput[] = [];
  const renames = (drafts: ReadonlyMap<string, string>, row: boolean) => {
    for (const [verbundId, draft] of drafts) {
      const entry = verbuende.find((candidate) => candidate.verbundId === verbundId);
      if (!entry || !inScope(verbundId) || draft.trim() === entry.name) continue;
      inputs.push({ kind: 'rename', verbundId: entry.verbundId, name: entry.name, draft, ...(row ? { row: true as const } : {}) });
    }
  };
  renames(renameDrafts, false);
  renames(rowDrafts, true);
  if (scope.kind === 'workspace') inputs.push(...scopeInputs(scopeDrafts, scopes), ...boundaryInputs(boundaryDrafts, scopes));
  // Gespeicherte Dokumente gehen vor; aus der Sicherung kommen nur die, die der Speicher nicht mehr kennt.
  const candidates = new Map<LocalId, ScopeDocument>(scope.documents.map((document) => [document.localId, document]));
  for (const document of documents) candidates.set(document.localId, document);
  const restored = new Set(scope.documents.map((document) => document.localId));
  for (const document of candidates.values()) {
    const count = importTargets.get(document.localId)?.size ?? 0;
    if (count > 0 && (restored.has(document.localId) || inScope(document.verbundId))) {
      inputs.push({ kind: 'import', verbundId: document.verbundId, localId: document.localId, rootType: document.rootType, count });
    }
  }
  if (scope.kind === 'workspace') {
    for (const [localId, pending] of importTargets) {
      if (pending.size > 0 && !candidates.has(localId)) inputs.push({ kind: 'orphan', localId, count: pending.size });
    }
  }
  return inputs;
}

function scopeInputs(drafts: ReadonlyMap<string, string>, scopes: readonly WorkspaceScope[]): RestoreInput[] {
  const inputs: RestoreInput[] = [];
  for (const [key, draft] of drafts) {
    if (key === NEW_SCOPE_DRAFT) {
      if (draft.trim() !== '') inputs.push({ kind: 'scope', scope: null, draft });
      continue;
    }
    const stored = scopes.find((candidate) => candidate.scopeId === key || scopedVerbundDraftKey(candidate.scopeId) === key);
    if (!stored) continue;
    const scope = { scopeId: stored.scopeId, name: stored.name, savedAt: stored.savedAt };
    if (key === stored.scopeId) {
      if (draft.trim() !== stored.name) inputs.push({ kind: 'scope', scope, draft });
    } else if (draft.trim() !== '') inputs.push({ kind: 'scope', scope, draft, newVerbund: true });
  }
  return inputs;
}

/**
 * Abgrenzungsentwürfe gespeicherter Bereiche, deren Eingabe von der gespeicherten Abgrenzung abweicht. Liegt
 * inzwischen neuerer Inhalt vor, speichert die Klärung mit dem alten Vergleichsstand und scheitert als Konflikt.
 */
function boundaryInputs(drafts: ReadonlyMap<string, ScopeBoundaryDraft>, scopes: readonly WorkspaceScope[]): RestoreInput[] {
  const inputs: RestoreInput[] = [];
  for (const [scopeId, draft] of drafts) {
    const stored = scopes.find((candidate) => candidate.scopeId === scopeId);
    if (!stored) continue;
    if (sameBoundaryInput(draft.input, scopeBoundaryInput(stored.items[0]))) continue;
    const base = boundaryDraftBase(draft, stored) ?? draft.base;
    inputs.push({ kind: 'boundary', scope: { scopeId: stored.scopeId, name: stored.name, savedAt: stored.savedAt }, draft, base });
  }
  return inputs;
}

/**
 * Verwirft nach erfolgreichem Restore alle Sitzungseingaben des ersetzten Bereichs; unbeteiligte bleiben. Entwürfe der
 * Freigabedialoge bleiben für Dokumente, die der Restore zurückbringt, und gehen nur mit entfernten Dokumenten.
 */
export function discardReplacedInputs(preview: RestorePreview, importTargets: Map<LocalId, unknown>, renameDrafts: Map<string, string>): void {
  if (preview.kind === 'workspace') {
    importTargets.clear();
    retainDecisionDrafts(new Set(preview.backup.documents.map(({ localId }) => localId)));
    renameDrafts.clear();
    return;
  }
  for (const { localId } of [...preview.target.documents, ...preview.backup.documents]) importTargets.delete(localId);
  const restored = new Set(preview.backup.documents.map(({ localId }) => localId));
  discardDecisionDrafts(preview.target.documents.map(({ localId }) => localId).filter(localId => !restored.has(localId)));
  renameDrafts.delete(preview.verbundId);
}

/** Offene Eingabe, die die Klärung speichern kann. */
export type NamedInput = Extract<RestoreInput, { kind: 'rename' | 'scope' | 'boundary' }>;

/** Speichert eine offene Eingabe aus der Klärung; `true` erst nach bestätigtem Schreiben. */
export async function saveNamedInput(entry: NamedInput, writers: Pick<WorkspaceContextValue, 'renameVerbund' | 'renameScope' | 'createScope' | 'createVerbund' | 'saveScopeBoundary'>): Promise<boolean> {
  if (entry.kind === 'boundary') return (await writers.saveScopeBoundary(entry.scope.scopeId, entry.base, entry.draft.input)).ok;
  const name = entry.draft.trim();
  if (entry.kind === 'rename') return (await writers.renameVerbund(entry.verbundId, name)).ok;
  if (entry.newVerbund) return (await writers.createVerbund(name, entry.scope)).ok;
  if (entry.scope) return (await writers.renameScope(entry.scope.scopeId, name, entry.scope.savedAt)).ok;
  return (await writers.createScope(name)).ok;
}

/** Name des Verbunds, auf den sich eine Klärungszeile bezieht; leer ohne Verbundbezug. */
export function inputVerbundName(entry: RestoreInput, verbuende: readonly { readonly verbundId: string; readonly name: string }[] | null): string {
  return 'verbundId' in entry ? verbuende?.find((candidate) => candidate.verbundId === entry.verbundId)?.name ?? '' : '';
}
