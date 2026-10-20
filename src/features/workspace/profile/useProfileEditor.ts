import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '@/adapters/browserDownload';
import { readProfileImports, type ProfileImportView } from '@/domain/profileAuthoring';
import { importHrefPointer } from '@/domain/profileImportList';
import { exportProfileInWorker } from '@/adapters/profileWorkbench';
import { isPinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { commitExplicitSave, sameProfileContent } from '@/domain/profileSave';
import type { BindingTarget, LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';

/** Wartezeit nach der letzten Änderung, bevor der Entwurf automatisch gesichert wird. */
export const PROFILE_AUTOSAVE_DELAY_MS = 800;

const IMPORT_POINTER = /^\/profile\/imports\/\d+\/href$/;

export type ProfileSaveState =
  | { readonly kind: 'stored' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'autosaved'; readonly at: string }
  | { readonly kind: 'saved'; readonly at: string }
  | { readonly kind: 'failed' };

export type ProfileEditorMessage = 'saved-as-draft' | 'export-failed' | 'save-failed' | 'delete-failed';

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
  /** Ändert die Quelle und ordnet einem `href` ein Importziel zu. */
  readonly changeWithTarget: (patch: (source: unknown) => { source: unknown; href: string }, target: BindingTarget) => void;
  readonly save: () => Promise<void>;
  readonly exportDocument: () => Promise<void>;
  /** Löscht das Dokument samt Entwurf und Bindungen; ein offener Autosave entfällt. */
  readonly remove: () => Promise<boolean>;
}

/**
 * Ziel eines Imports: die gespeicherte Bindung an genau seinem Pointer, dann
 * eine ungespeicherte Zuordnung, dann eine eindeutige gespeicherte Bindung
 * desselben `href` (der Import ist nach dem Entfernen eines früheren nachgerückt).
 */
function targetOf(entry: ProfileImportView, stored: readonly WorkspaceBinding[], pending: ReadonlyMap<string, BindingTarget>): BindingTarget | undefined {
  if (entry.href === undefined) return undefined;
  const pointer = importHrefPointer(entry.index);
  const exact = stored.find((binding) => binding.pointer === pointer && binding.href === entry.href);
  if (exact) return exact.target;
  const assigned = pending.get(entry.href);
  if (assigned) return assigned;
  const sameHref = stored.filter((binding) => IMPORT_POINTER.test(binding.pointer) && binding.href === entry.href);
  return sameHref.length === 1 ? sameHref[0].target : undefined;
}

function editorBindings(localId: LocalId, imports: readonly ProfileImportView[], stored: readonly WorkspaceBinding[], pending: ReadonlyMap<string, BindingTarget>): WorkspaceBinding[] {
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
  const [pendingTargets, setPendingTargets] = useState<ReadonlyMap<string, BindingTarget>>(() => new Map(pending));
  const [saveState, setSaveState] = useState<ProfileSaveState>({ kind: 'stored' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ProfileEditorMessage>();
  const latest = useRef({ working: undefined as unknown, envelope: undefined as WorkspaceEnvelope | undefined, draftSavedAt: null as string | null, unsaved: false });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  // Während eines expliziten Speicherns schreibt der Autosave nicht; das Speichern plant ihn danach neu.
  const saving = useRef(false);
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
      setStored(bindings.value.filter((binding) => binding.fromLocalId === localId));
      setSaveState(draft.value ? { kind: 'autosaved', at: draft.value.savedAt } : { kind: 'stored' });
      setStatus('ready');
    });
    return () => { current = false; };
  }, [localId]);

  /** Sichert den Arbeitsstand als Entwurf; Aufrufe laufen nacheinander. */
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const run = chain.current.then(async () => {
      const state = latest.current;
      if (!state.unsaved || !state.envelope || saving.current) return { ok: true as const, value: undefined };
      const snapshot = state.working;
      const result = await documents.autosaveDraft(localId, state.envelope.savedAt, state.draftSavedAt, snapshot);
      if (!result.ok) {
        setSaveState({ kind: 'failed' });
        return result;
      }
      latest.current = { ...latest.current, draftSavedAt: result.value.savedAt, unsaved: latest.current.working !== snapshot };
      setSaveState({ kind: 'autosaved', at: result.value.savedAt });
      return result;
    });
    chain.current = run.catch(() => undefined);
    return run;
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

  const changeWithTarget = useCallback((patch: (source: unknown) => { source: unknown; href: string }, target: BindingTarget) => {
    change((source) => {
      const result = patch(source);
      pending.set(result.href, target);
      return result.source;
    });
    setPendingTargets(new Map(pending));
  }, [change, pending]);

  const imports = useMemo(() => readProfileImports(working), [working]);
  const bindings = useMemo(() => editorBindings(localId, imports, stored, pendingTargets), [localId, imports, stored, pendingTargets]);
  const dirty = envelope !== undefined && !sameProfileContent(envelope.source, working);

  const save = useCallback(async () => {
    const state = latest.current;
    const oscalVersion = state.envelope?.oscalVersion;
    if (!state.envelope || busy || oscalVersion === undefined || !isPinnedOscalVersion(oscalVersion)) return;
    setBusy(true);
    setMessage(undefined);
    saving.current = true;
    await chain.current;
    clearTimeout(timer.current);
    const snapshot = state.working;
    const { source } = commitExplicitSave(state.envelope.source, snapshot, { uuid: crypto.randomUUID(), lastModified: new Date().toISOString() });
    const schema = await documents.checkProfileSchema(source);
    const documentState = schema.status === 'passed' ? 'export-ready' : 'draft';
    const input = { source, context: { trustClass: 'class-2-local-user' as const }, rootType: 'profile' as const, oscalVersion };
    const result = await documents.saveDocument(localId, state.envelope.savedAt, latest.current.draftSavedAt, input, bindings, documentState);
    saving.current = false;
    setBusy(false);
    if (!result.ok) {
      setMessage('save-failed');
      if (latest.current.unsaved) schedule();
      return;
    }
    for (const binding of bindings) pending.delete(binding.href);
    setPendingTargets(new Map(pending));
    setEnvelope(result.value);
    setStored(bindings);
    // Eingaben während des Speicherns bleiben Arbeitsstand und gehen in den nächsten Entwurf.
    const changedMeanwhile = latest.current.working !== snapshot;
    latest.current = { working: changedMeanwhile ? latest.current.working : result.value.source, envelope: result.value, draftSavedAt: null, unsaved: changedMeanwhile };
    if (changedMeanwhile) {
      setSaveState({ kind: 'pending' });
      schedule();
    } else {
      setWorking(result.value.source);
      setSaveState({ kind: 'saved', at: result.value.savedAt });
    }
    if (documentState === 'draft') setMessage('saved-as-draft');
  }, [busy, bindings, documents, localId, pending, schedule]);

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
      latest.current = { ...latest.current, unsaved };
      if (unsaved) schedule();
      setMessage('delete-failed');
    }
    return result.ok;
  }, [documents, localId, schedule]);

  return {
    status, envelope, working, imports, dirty, saveState, busy, message, bindings,
    targetFor: (entry) => targetOf(entry, stored, pendingTargets),
    change, changeWithTarget, save, exportDocument, remove,
  };
}
