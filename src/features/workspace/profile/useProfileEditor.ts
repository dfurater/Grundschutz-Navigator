import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '@/adapters/browserDownload';
import { readProfileImports, type ProfileImportView } from '@/domain/profileAuthoring';
import { alignImportBindings, importHrefPointer, removeImport, shiftImportBindings } from '@/domain/profileImportList';
import { exportProfileInWorker } from '@/adapters/profileWorkbench';
import { isPinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { commitExplicitSave, sameProfileContent } from '@/domain/profileSave';
import { approvalAction, withApprovalAction, withReviewIdentities } from '@/domain/reviewTrail';
import type { BindingTarget, LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import type { ReviewApprovalRequest } from '@/adapters/workspaceStore';
import type { DecisionSubmission } from '@/features/workspace/review/reviewView';
import type { PendingImportTarget } from '@/state/workspaceDocuments';

/** Wartezeit nach der letzten Änderung, bevor der Entwurf automatisch gesichert wird. */
export const PROFILE_AUTOSAVE_DELAY_MS = 800;

const IMPORT_POINTER = /^\/profile\/imports\/\d+\/href$/;

// Meldet, dass ein explizites Speichern begonnen hat; es wird außerhalb der Kette
// abgewartet, weil `save()` selbst auf `chain.current` wartet.
const FLUSH_RESTART = Symbol('flush-restart');

export type ProfileSaveState =
  | { readonly kind: 'stored' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'autosaved'; readonly at: string }
  | { readonly kind: 'saved'; readonly at: string }
  | { readonly kind: 'failed' };

export type ProfileEditorMessage = 'saved-as-draft' | 'export-failed' | 'save-failed' | 'delete-failed';

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
  const { documents, registerAutosave } = useWorkspace();
  const [envelope, setEnvelope] = useState<WorkspaceEnvelope>();
  const [status, setStatus] = useState<ProfileEditor['status']>('loading');
  const [working, setWorking] = useState<unknown>();
  const [stored, setStored] = useState<readonly WorkspaceBinding[]>([]);
  const pending = documents.importTargets(localId);
  // Spiegel der Map aus dem Arbeitsbereich, damit neue Zuordnungen neu rendern.
  const [pendingTargets, setPendingTargets] = useState<ReadonlyMap<string, PendingImportTarget>>(() => new Map(pending));
  const [saveState, setSaveState] = useState<ProfileSaveState>({ kind: 'stored' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ProfileEditorMessage>();
  const latest = useRef({ working: undefined as unknown, envelope: undefined as WorkspaceEnvelope | undefined, draftSavedAt: null as string | null, unsaved: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // Während eines expliziten Speicherns schreibt der Autosave nicht; das Speichern plant ihn danach neu.
  const saving = useRef(false);
  // Löst sich, wenn das laufende explizite Speichern endet; ein Flush wartet darauf, statt Erfolg zu melden.
  const savingDone = useRef<Promise<void>>(Promise.resolve());
  // Der Speicherzugang wechselt seine Identität etwa mit jedem geladenen Katalog;
  // das Öffnen liest ihn über die Referenz, damit es den Arbeitsstand nicht zurücksetzt.
  const documentsRef = useRef(documents);
  useEffect(() => { documentsRef.current = documents; }, [documents]);

  useEffect(() => {
    let current = true;
    const store = documentsRef.current;
    void Promise.all([store.getDocument(localId), store.getDraft(localId), store.listBindings()]).then(([document, draft, bindings]) => {
      if (!current) return;
      if (!document.ok || document.value?.rootType !== 'profile' || !draft.ok || !bindings.ok) {
        setStatus('failed');
        return;
      }
      const source = draft.value?.source ?? document.value.source;
      latest.current = { working: source, envelope: document.value, draftSavedAt: draft.value?.savedAt ?? null, unsaved: false };
      setEnvelope(document.value);
      setWorking(source);
      const own = bindings.value.filter((binding) => binding.fromLocalId === localId);
      setStored(draft.value ? alignImportBindings(own, document.value.source, draft.value.source) : own);
      setSaveState(draft.value ? { kind: 'autosaved', at: draft.value.savedAt } : { kind: 'stored' });
      setStatus('ready');
    });
    return () => { current = false; };
  }, [localId]);

  /** Sichert den Arbeitsstand als Entwurf; Aufrufe laufen nacheinander. */
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    for (;;) {
      while (saving.current) await savingDone.current;
      const run = chain.current.then(async () => {
        // Eingaben, die während einer Sicherung entstehen, gehören in denselben Flush:
        // Erfolg erst, wenn kein Arbeitsstand mehr offen ist; ein Fehler bleibt Fehler.
        for (;;) {
          // Ein jetzt beginnendes Speichern schreibt den neuesten Stand selbst; Erfolg erst nach seinem Ende.
          if (saving.current) return FLUSH_RESTART;
          const state = latest.current;
          if (!state.unsaved || !state.envelope) return { ok: true as const, value: undefined };
          const snapshot = state.working;
          const result = await documents.autosaveDraft(localId, state.envelope.savedAt, state.draftSavedAt, snapshot);
          if (!result.ok) {
            setSaveState({ kind: 'failed' });
            return result;
          }
          latest.current = { ...latest.current, draftSavedAt: result.value.savedAt, unsaved: latest.current.working !== snapshot };
          setSaveState({ kind: 'autosaved', at: result.value.savedAt });
          // Auch ohne offenen Arbeitsstand gilt der Flush erst nach einem während des Autosave begonnenen Speichern als erfolgreich.
          if (saving.current) return FLUSH_RESTART;
          if (!latest.current.unsaved) return result;
        }
      });
      chain.current = run.catch(() => undefined);
      const result = await run;
      if (result !== FLUSH_RESTART) return result;
    }
  }, [documents, localId]);

  useEffect(() => registerAutosave(flush), [registerAutosave, flush]);
  // Wer den Editor innerhalb des Bereichs verlässt, sichert offene Eingaben sofort statt nach der Wartezeit.
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  useEffect(() => {
    const pendingFlush = flushRef;
    return () => { void pendingFlush.current(); };
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, PROFILE_AUTOSAVE_DELAY_MS);
  }, [flush]);

  const change = useCallback((patch: (source: unknown) => unknown) => {
    const next = patch(latest.current.working);
    latest.current = { ...latest.current, working: next, unsaved: true };
    setWorking(next);
    setMessage(undefined);
    setSaveState({ kind: 'pending' });
    schedule();
  }, [schedule]);

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
  }, [change, pending]);

  const imports = useMemo(() => readProfileImports(working), [working]);
  const bindings = useMemo(() => editorBindings(localId, imports, stored, pendingTargets), [localId, imports, stored, pendingTargets]);
  const dirty = envelope !== undefined && !sameProfileContent(envelope.source, working);

  type CommitResult = { readonly ok: true; readonly documentState: 'export-ready' | 'draft' } | { readonly ok: false; readonly code: string };

  const commit = useCallback(async (working: unknown, approval?: { readonly request: ReviewApprovalRequest; readonly requireSchema: boolean }): Promise<CommitResult> => {
    const state = latest.current;
    const envelope = state.envelope;
    const oscalVersion = envelope?.oscalVersion;
    if (!envelope || oscalVersion === undefined || !isPinnedOscalVersion(oscalVersion)) return { ok: false, code: 'WORKSPACE_DOCUMENT_NOT_FOUND' };
    if (saving.current) return { ok: false, code: 'WORKSPACE_SAVE_CONFLICT' };
    setBusy(true);
    setMessage(undefined);
    saving.current = true;
    let release = () => {};
    savingDone.current = new Promise<void>((resolve) => { release = resolve; });
    const snapshot = working;
    // Freigaben speichern eine abgeleitete Quelle; offene Eingaben sind der Vergleich zum Startstand.
    const startWorking = latest.current.working;
    let documentState: 'export-ready' | 'draft';
    let result: Awaited<ReturnType<typeof documents.saveDocument>>;
    try {
      await chain.current;
      clearTimeout(timer.current);
      const { source } = commitExplicitSave(envelope.source, snapshot, { uuid: crypto.randomUUID(), lastModified: new Date().toISOString() });
      const schema = await documents.checkProfileSchema(source);
      // Eine Freigabe über einem schemawidrigen Stand wäre keine belastbare Freigabe.
      if (approval?.requireSchema && schema.status !== 'passed') return { ok: false, code: 'REVIEW_APPROVAL_SCHEMA' };
      documentState = schema.status === 'passed' ? 'export-ready' : 'draft';
      const input = { source, context: { trustClass: 'class-2-local-user' as const }, rootType: 'profile' as const, oscalVersion };
      result = await documents.saveDocument(localId, envelope.savedAt, latest.current.draftSavedAt, input, bindings, documentState, approval?.request);
    } finally {
      saving.current = false;
      release();
      setBusy(false);
    }
    if (!result.ok) {
      setMessage('save-failed');
      if (latest.current.unsaved) schedule();
      return { ok: false, code: result.diagnostic.code };
    }
    // Nur Zuordnungen, die genau so gespeichert wurden; eine während des Speicherns geänderte bleibt offen.
    for (const binding of bindings) {
      const assigned = pending.get(binding.pointer);
      if (assigned?.href === binding.href && sameTarget(assigned.target, binding.target)) pending.delete(binding.pointer);
    }
    setPendingTargets(new Map(pending));
    setEnvelope(result.value);
    setStored(bindings);
    // Eingaben während des Speicherns bleiben Arbeitsstand und gehen in den nächsten Entwurf.
    const changedMeanwhile = latest.current.working !== startWorking;
    latest.current = { working: changedMeanwhile ? latest.current.working : result.value.source, envelope: result.value, draftSavedAt: null, unsaved: changedMeanwhile };
    if (changedMeanwhile) {
      setSaveState({ kind: 'pending' });
      schedule();
    } else {
      setWorking(result.value.source);
      setSaveState({ kind: 'saved', at: result.value.savedAt });
    }
    return { ok: true, documentState };
  }, [bindings, documents, localId, pending, schedule]);

  const save = useCallback(async () => {
    const result = await commit(latest.current.working);
    if (result.ok && result.documentState === 'draft') setMessage('saved-as-draft');
  }, [commit]);

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
      const result = await commit(source, {
        requireSchema: true,
        request: { actionUuid, expectedSequence: input.expectedSequence, roleId: role.id, partyUuids, reason: input.reason },
      });
      return result.ok ? { ok: true } : { ok: false, code: result.code };
    } catch {
      return { ok: false, code: 'REVIEW_APPROVAL_INVALID' };
    }
  }, [commit, dirty]);

  const exportDocument = useCallback(async () => {
    const current = latest.current.envelope;
    if (!current || dirty) return;
    const result = await exportProfileInWorker(current);
    if (!result.ok) {
      setMessage('export-failed');
      return;
    }
    downloadBlob(new Blob([result.json], { type: 'application/json' }), 'profile.json');
  }, [dirty]);

  const remove = useCallback(async () => {
    clearTimeout(timer.current);
    const unsaved = latest.current.unsaved;
    latest.current = { ...latest.current, unsaved: false };
    await chain.current;
    setBusy(true);
    const result = await documents.deleteDocument(localId);
    setBusy(false);
    if (!result.ok) {
      // Das Dokument besteht weiter: offene Eingaben bleiben ungesichert markiert.
      // Eingaben während der Löschung haben `unsaved` bereits gesetzt; beide Marken bleiben erhalten.
      const stillUnsaved = unsaved || latest.current.unsaved;
      latest.current = { ...latest.current, unsaved: stillUnsaved };
      if (stillUnsaved) schedule();
      setMessage('delete-failed');
    }
    return result.ok;
  }, [documents, localId, schedule]);

  return {
    status, envelope, working, imports, dirty, saveState, busy, message, bindings,
    targetFor: (entry) => targetOf(entry, stored, pendingTargets),
    change, changeWithTarget, removeImportAt, save, approve, exportDocument, remove,
  };
}
