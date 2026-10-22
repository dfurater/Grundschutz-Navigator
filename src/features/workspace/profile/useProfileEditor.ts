import { useCallback, useMemo, useState } from 'react';
import { readProfileImports, type ProfileImportView } from '@/domain/profileAuthoring';
import { alignImportBindings, importHrefPointer, removeImport, shiftImportBindings } from '@/domain/profileImportList';
import { exportProfileInWorker } from '@/adapters/profileWorkbench';
import { commitExplicitSave, sameProfileContent } from '@/domain/profileSave';
import { approvalAction, withApprovalAction, withReviewIdentities } from '@/domain/reviewTrail';
import type { BindingTarget, LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { ReviewApprovalRequest } from '@/adapters/workspaceStore';
import type { DecisionSubmission } from '@/features/workspace/review/reviewView';
import { useDocumentEditor, type CommitResult, type DocumentEditorCoreMessage, type DocumentSaveState } from '@/features/workspace/useDocumentEditor';
import type { PendingImportTarget } from '@/state/workspaceDocuments';

const IMPORT_POINTER = /^\/profile\/imports\/\d+\/href$/;

export type ProfileSaveState = DocumentSaveState;

export type ProfileEditorMessage = DocumentEditorCoreMessage | 'saved-as-draft';

export interface ProfileApprovalInput extends DecisionSubmission {
  /** Trail-Sequenz, gegen die der Aufrufer gelesen hat. */
  readonly expectedSequence: number;
}

export type ProfileApprovalResult = { readonly ok: true } | { readonly ok: false; readonly code: string };

export interface ProfileEditor {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly envelope?: WorkspaceEnvelope;
  readonly working: unknown;
  readonly imports: readonly ProfileImportView[];
  /** Der Arbeitsstand unterscheidet sich inhaltlich vom gespeicherten Dokument. */
  readonly dirty: boolean;
  readonly saveState: ProfileSaveState;
  readonly busy: boolean;
  readonly message?: ProfileEditorMessage;
  /** Der vollständige ausgehende Bindungssatz des Arbeitsstands. */
  readonly bindings: readonly WorkspaceBinding[];
  readonly targetFor: (entry: ProfileImportView) => BindingTarget | undefined;
  readonly change: (patch: (source: unknown) => unknown) => void;
  /** Entfernt einen Import; die Bindungen der folgenden Importe rücken mit. */
  readonly removeImportAt: (index: number) => void;
  /** Ändert die Quelle und ordnet einem `href` ein Importziel zu. */
  readonly changeWithTarget: (patch: (source: unknown) => { source: unknown; href: string; index: number }, target: BindingTarget) => void;
  readonly save: () => Promise<void>;
  /** Übernimmt einen neueren gespeicherten Stand nur ohne offene Eingaben; sonst bleibt der Konflikt erhalten. */
  readonly adopt: (document: WorkspaceEnvelope) => Promise<'adopted' | 'blocked' | 'failed'>;
  /** Schreibt die Freigabe als `metadata.actions` und den Trail in einem Dokumentenschreibvorgang. */
  readonly approve: (input: ProfileApprovalInput) => Promise<ProfileApprovalResult>;
  readonly exportDocument: () => Promise<void>;
  /** Löscht das Dokument samt Entwurf und Bindungen; ein offener Autosave entfällt. */
  readonly remove: () => Promise<boolean>;
}

/**
 * Ziel eines Imports: die Bindung an genau seinem Pointer, sonst eine
 * ungespeicherte Zuordnung. `stored` ist stets an den Pointern des
 * Arbeitsstands ausgerichtet (`alignImportBindings`, `shiftImportBindings`).
 */
function targetOf(entry: ProfileImportView, stored: readonly WorkspaceBinding[], pending: ReadonlyMap<string, PendingImportTarget>): BindingTarget | undefined {
  if (entry.href === undefined) return undefined;
  const pointer = importHrefPointer(entry.index);
  const assigned = pending.get(pointer);
  return stored.find((binding) => binding.pointer === pointer && binding.href === entry.href)?.target
    ?? (assigned?.href === entry.href ? assigned.target : undefined);
}

function sameTarget(a: BindingTarget, b: BindingTarget): boolean {
  return a.kind === 'local' ? b.kind === 'local' && a.localId === b.localId : b.kind === 'class-1' && a.artifactKey === b.artifactKey;
}

/** Ungespeicherte Zuordnungen nach dem Entfernen eines Imports, an denselben Pointern wie `shiftImportBindings`. */
function shiftPending(pending: Map<string, PendingImportTarget>, removed: number): void {
  const shifted = shiftImportBindings([...pending].map(([pointer, value]) => ({ pointer, ...value })), removed);
  pending.clear();
  for (const { pointer, href, target } of shifted) pending.set(pointer, { href, target });
}

function editorBindings(localId: LocalId, imports: readonly ProfileImportView[], stored: readonly WorkspaceBinding[], pending: ReadonlyMap<string, PendingImportTarget>): WorkspaceBinding[] {
  const others = stored.filter((binding) => !IMPORT_POINTER.test(binding.pointer));
  const own = imports.flatMap((entry) => {
    const target = targetOf(entry, stored, pending);
    return entry.href !== undefined && target ? [{ fromLocalId: localId, pointer: importHrefPointer(entry.index), href: entry.href, target }] : [];
  });
  return [...others, ...own];
}

/**
 * Arbeitsstand eines Profils: gezielte Patches auf eine Kopie der Quelle,
 * Autosave in den Entwurf (UUID und `last-modified` bleiben), explizites
 * Speichern mit change-on-write und Export aus dem gespeicherten Stand.
 */
export function useProfileEditor(localId: LocalId): ProfileEditor {
  const { documents } = useWorkspace();
  const pending = documents.importTargets(localId);
  const hasPendingBindings = useCallback(() => pending.size > 0, [pending]);
  const core = useDocumentEditor<'saved-as-draft'>({ localId, rootType: 'profile', sameContent: sameProfileContent, alignBindings: alignImportBindings, hasPendingBindings });
  const { working, stored, setStored, change, commit, saving, latest, dirty, setMessage, exportWith } = core;
  // Spiegel der Map aus dem Arbeitsbereich, damit neue Zuordnungen neu rendern.
  const [pendingTargets, setPendingTargets] = useState<ReadonlyMap<string, PendingImportTarget>>(() => new Map(pending));

  const changeWithTarget = useCallback((patch: (source: unknown) => { source: unknown; href: string; index: number }, target: BindingTarget) => {
    change((source) => {
      const result = patch(source);
      pending.set(importHrefPointer(result.index), { href: result.href, target });
      return result.source;
    });
    setPendingTargets(new Map(pending));
  }, [change, pending]);

  const removeImportAt = useCallback((index: number) => {
    // Während des Speicherns gesperrt: Der Abschluss schreibt die Bindungen des gespeicherten Stands.
    if (saving.current) return;
    change((source) => removeImport(source, index));
    setStored((current) => shiftImportBindings(current, index));
    shiftPending(pending, index);
    setPendingTargets(new Map(pending));
  }, [change, pending, saving, setStored]);

  const imports = useMemo(() => readProfileImports(working), [working]);
  const bindings = useMemo(() => editorBindings(localId, imports, stored, pendingTargets), [localId, imports, stored, pendingTargets]);

  const commitProfile = useCallback((source: unknown, approval?: { readonly request: ReviewApprovalRequest; readonly requireSchema: boolean }): Promise<CommitResult> =>
    commit(source, async (storedSource, snapshot) => {
      const { source: next } = commitExplicitSave(storedSource, snapshot, { uuid: crypto.randomUUID(), lastModified: new Date().toISOString() });
      const schema = await documents.checkProfileSchema(next);
      // Eine Freigabe über einem schemawidrigen Stand wäre keine belastbare Freigabe.
      if (approval?.requireSchema && schema.status !== 'passed') return { ok: false, code: 'REVIEW_APPROVAL_SCHEMA' };
      return { ok: true, source: next, documentState: schema.status === 'passed' ? 'export-ready' : 'draft', bindings, approval: approval?.request };
    }, (saved) => {
      // Nur Zuordnungen, die genau so gespeichert wurden; eine während des Speicherns geänderte bleibt offen.
      for (const binding of saved) {
        const assigned = pending.get(binding.pointer);
        if (assigned?.href === binding.href && sameTarget(assigned.target, binding.target)) pending.delete(binding.pointer);
      }
      setPendingTargets(new Map(pending));
    }), [bindings, commit, documents, pending]);

  const save = useCallback(async () => {
    const result = await commitProfile(latest.current.working);
    if (result.ok && result.documentState === 'draft') setMessage('saved-as-draft');
  }, [commitProfile, latest, setMessage]);

  const approve = useCallback(async (input: ProfileApprovalInput): Promise<ProfileApprovalResult> => {
    const state = latest.current;
    // Freigeben heißt: genau der gespeicherte Stand, ohne offene Eingaben und ohne Entwurfsstand.
    if (!state.envelope || state.unsaved || dirty || state.envelope.documentState === 'draft') return { ok: false, code: 'REVIEW_APPROVAL_BLOCKED' };
    const actionUuid = crypto.randomUUID();
    const partyUuid = input.partyName ? crypto.randomUUID() : undefined;
    const role = { id: input.roleId, title: input.roleTitle ?? input.roleId };
    const partyUuids = [...input.partyUuids, ...(partyUuid ? [partyUuid] : [])];
    try {
      const action = approvalAction({ uuid: actionUuid, date: new Date().toISOString(), roleId: role.id, partyUuids, reason: input.reason });
      const identified = withReviewIdentities(state.envelope.source, 'profile', {
        role,
        ...(partyUuid ? { party: { uuid: partyUuid, name: input.partyName ?? '' } } : {}),
      });
      const source = withApprovalAction(identified, 'profile', action);
      const result = await commitProfile(source, {
        requireSchema: true,
        request: { actionUuid, expectedSequence: input.expectedSequence, roleId: role.id, partyUuids, reason: input.reason },
      });
      return result.ok ? { ok: true } : { ok: false, code: result.code };
    } catch {
      return { ok: false, code: 'REVIEW_APPROVAL_INVALID' };
    }
  }, [commitProfile, dirty, latest]);

  const exportDocument = useCallback(() => exportWith(exportProfileInWorker, 'profile.json'), [exportWith]);

  return {
    status: core.status, envelope: core.envelope, working, imports, dirty, saveState: core.saveState, busy: core.busy, message: core.message, bindings,
    targetFor: (entry) => targetOf(entry, stored, pendingTargets),
    change, changeWithTarget, removeImportAt, save, adopt: core.adopt, approve, exportDocument, remove: core.remove,
  };
}
