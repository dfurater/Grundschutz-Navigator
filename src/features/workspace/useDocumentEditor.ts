import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { downloadBlob } from '@/adapters/browserDownload';
import type { ReviewApprovalRequest } from '@/adapters/workspaceStore';
import { isPinnedOscalVersion, type OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';

/** Wartezeit nach der letzten Änderung, bevor der Entwurf automatisch gesichert wird. */
export const DOCUMENT_AUTOSAVE_DELAY_MS = 800;
// Ein explizites Speichern hat begonnen; außerhalb der Kette abwarten, weil `save()` auf `chain.current` wartet.
const FLUSH_RESTART = Symbol('flush-restart');

export type DocumentSaveState =
  | { readonly kind: 'stored' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'autosaved'; readonly at: string }
  | { readonly kind: 'saved'; readonly at: string }
  | { readonly kind: 'failed' };

/** Meldungen, die der Kern selbst setzt; eine Station ergänzt eigene. */
export type DocumentEditorCoreMessage = 'export-failed' | 'save-failed' | 'delete-failed';
/** Was ein explizites Speichern schreibt: Quelle, Zielzustand und der vollständige ausgehende Bindungssatz. */
export type PreparedSave =
  | {
    readonly ok: true;
    readonly source: unknown;
    readonly documentState: 'export-ready' | 'draft';
    readonly bindings: readonly WorkspaceBinding[];
    readonly approval?: ReviewApprovalRequest;
  }
  | { readonly ok: false; readonly code: string };
export type CommitResult = { readonly ok: true; readonly documentState: 'export-ready' | 'draft' } | { readonly ok: false; readonly code: string };

export type ExportResult = { readonly ok: true; readonly json: string } | { readonly ok: false };
interface Latest {
  readonly working: unknown;
  readonly envelope: WorkspaceEnvelope | undefined;
  readonly draftSavedAt: string | null;
  readonly unsaved: boolean;
}
export interface DocumentEditorCore<M extends string> {
  readonly status: 'loading' | 'ready' | 'failed';
  readonly envelope?: WorkspaceEnvelope;
  readonly working: unknown;
  /** Der Arbeitsstand unterscheidet sich inhaltlich vom gespeicherten Dokument. */
  readonly dirty: boolean;
  readonly saveState: DocumentSaveState;
  readonly busy: boolean;
  readonly message?: DocumentEditorCoreMessage | M;
  readonly setMessage: (message: DocumentEditorCoreMessage | M | undefined) => void;
  /** Gespeicherte ausgehende Bindungen, am Arbeitsstand ausgerichtet. */
  readonly stored: readonly WorkspaceBinding[];
  readonly setStored: (update: (current: readonly WorkspaceBinding[]) => readonly WorkspaceBinding[]) => void;
  readonly latest: MutableRefObject<Latest>;
  /** Läuft ein explizites Speichern? */
  readonly saving: MutableRefObject<boolean>;
  readonly change: (patch: (source: unknown) => unknown) => void;
  /**
   * Explizites Speichern von `working`: `prepare` bestimmt Quelle, Zustand und
   * Bindungen; `onSaved` erhält die geschriebenen Bindungen.
   */
  readonly commit: (
    working: unknown,
    prepare: (storedSource: unknown, snapshot: unknown) => Promise<PreparedSave>,
    onSaved?: (bindings: readonly WorkspaceBinding[]) => void,
  ) => Promise<CommitResult>;
  /** Übernimmt einen neueren gespeicherten Stand nur ohne offene Eingaben; sonst bleibt der Konflikt erhalten. */
  readonly adopt: (document: WorkspaceEnvelope) => Promise<'adopted' | 'blocked' | 'failed'>;
  /** Exportiert den gespeicherten Stand; offene Eingaben verhindern den Export. */
  readonly exportWith: (run: (document: WorkspaceEnvelope) => Promise<ExportResult>, filename: string) => Promise<void>;
  /** Löscht das Dokument samt Entwurf und Bindungen; ein offener Autosave entfällt. */
  readonly remove: () => Promise<boolean>;
}

export interface DocumentEditorOptions {
  readonly localId: LocalId;
  readonly rootType: OscalRootKey;
  /** Inhaltsgleichheit ohne die Felder, die nur den Schreibvorgang bezeichnen. */
  readonly sameContent: (a: unknown, b: unknown) => boolean;
  /** Richtet gespeicherte Bindungen an einem Entwurf aus, dessen Pointer sich verschoben haben können. */
  readonly alignBindings?: (own: readonly WorkspaceBinding[], storedSource: unknown, draftSource: unknown) => WorkspaceBinding[];
  /** Ungespeicherte Bindungsänderungen sperren als offene Eingaben die Übernahme eines neueren Stands. */
  readonly hasPendingBindings?: () => boolean;
}
/**
 * Lebenszyklus eines bearbeitbaren Workspace-Dokuments: Laden von Dokument,
 * Entwurf und Bindungen, gezielte Patches auf den Arbeitsstand, Autosave in den
 * Entwurf (UUID und `last-modified` bleiben), serialisiertes explizites
 * Speichern, Übernahme eines neueren Stands, Export aus dem gespeicherten Stand
 * und Löschung. Was ein Speichern schreibt, bestimmt die Station.
 */
export function useDocumentEditor<M extends string>({ localId, rootType, sameContent, alignBindings, hasPendingBindings }: DocumentEditorOptions): DocumentEditorCore<M> {
  const { documents, registerAutosave } = useWorkspace();
  const [envelope, setEnvelope] = useState<WorkspaceEnvelope>();
  const [status, setStatus] = useState<DocumentEditorCore<M>['status']>('loading');
  const [working, setWorking] = useState<unknown>();
  const [stored, setStored] = useState<readonly WorkspaceBinding[]>([]);
  const [saveState, setSaveState] = useState<DocumentSaveState>({ kind: 'stored' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<DocumentEditorCoreMessage | M>();
  const latest = useRef<Latest>({ working: undefined, envelope: undefined, draftSavedAt: null, unsaved: false });
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
  const options = useRef({ rootType, sameContent, alignBindings, hasPendingBindings });
  useEffect(() => { options.current = { rootType, sameContent, alignBindings, hasPendingBindings }; }, [rootType, sameContent, alignBindings, hasPendingBindings]);

  const ownBindings = useCallback((all: readonly WorkspaceBinding[], document: WorkspaceEnvelope, draftSource: unknown) => {
    const own = all.filter((binding) => binding.fromLocalId === localId);
    const align = options.current.alignBindings;
    return draftSource !== undefined && align ? align(own, document.source, draftSource) : own;
  }, [localId]);

  useEffect(() => {
    let current = true;
    const store = documentsRef.current;
    void Promise.all([store.getDocument(localId), store.getDraft(localId), store.listBindings()]).then(([document, draft, bindings]) => {
      if (!current) return;
      if (!document.ok || document.value?.rootType !== options.current.rootType || !draft.ok || !bindings.ok) {
        setStatus('failed');
        return;
      }
      const source = draft.value?.source ?? document.value.source;
      latest.current = { working: source, envelope: document.value, draftSavedAt: draft.value?.savedAt ?? null, unsaved: false };
      setEnvelope(document.value);
      setWorking(source);
      setStored(ownBindings(bindings.value, document.value, draft.value?.source));
      setSaveState(draft.value ? { kind: 'autosaved', at: draft.value.savedAt } : { kind: 'stored' });
      setStatus('ready');
    });
    return () => { current = false; };
  }, [localId, ownBindings]);

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

  useEffect(() => registerAutosave(flush), [registerAutosave, flush]);  // Wer den Editor innerhalb des Bereichs verlässt, sichert offene Eingaben sofort statt nach der Wartezeit.
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);
  useEffect(() => {
    const pendingFlush = flushRef;
    return () => { void pendingFlush.current(); };
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, DOCUMENT_AUTOSAVE_DELAY_MS);
  }, [flush]);

  const adopt = useCallback(async (document: WorkspaceEnvelope): Promise<'adopted' | 'blocked' | 'failed'> => {
    if (saving.current || options.current.hasPendingBindings?.()) return 'blocked';
    const before = latest.current;
    if (!before.envelope) return 'failed';
    if (document.savedAt <= before.envelope.savedAt) return 'adopted';
    const store = documentsRef.current;
    const [draft, bindings] = await Promise.all([store.getDraft(localId), store.listBindings()]);
    if (!draft.ok || !bindings.ok) return 'failed';
    const current = latest.current;
    // Eingaben oder ein anderer Übernahmeversuch während des Lesens: nicht still überschreiben.
    if (current.envelope !== before.envelope || current.working !== before.working || current.unsaved) return 'blocked';
    if (!current.envelope || !options.current.sameContent(current.envelope.source, current.working)) return 'blocked';
    const source = draft.value?.source ?? document.source;
    latest.current = { working: source, envelope: document, draftSavedAt: draft.value?.savedAt ?? null, unsaved: false };
    setEnvelope(document);
    setWorking(source);
    setStored(ownBindings(bindings.value, document, draft.value?.source));
    setMessage(undefined);
    setSaveState(draft.value ? { kind: 'autosaved', at: draft.value.savedAt } : { kind: 'stored' });
    return 'adopted';
  }, [localId, ownBindings]);

  const change = useCallback((patch: (source: unknown) => unknown) => {
    const next = patch(latest.current.working);
    latest.current = { ...latest.current, working: next, unsaved: true };
    setWorking(next);
    setMessage(undefined);
    setSaveState({ kind: 'pending' });
    schedule();
  }, [schedule]);

  const commit = useCallback<DocumentEditorCore<M>['commit']>(async (working, prepare, onSaved) => {
    const envelope = latest.current.envelope;
    const oscalVersion = envelope?.oscalVersion;
    if (!envelope || oscalVersion === undefined || !isPinnedOscalVersion(oscalVersion)) return { ok: false, code: 'WORKSPACE_DOCUMENT_NOT_FOUND' };
    if (saving.current) return { ok: false, code: 'WORKSPACE_SAVE_CONFLICT' };
    setBusy(true);
    setMessage(undefined);
    saving.current = true;
    let release = () => {};
    savingDone.current = new Promise<void>((resolve) => { release = resolve; });
    // Freigaben speichern eine abgeleitete Quelle; offene Eingaben sind der Vergleich zum Startstand.
    const startWorking = latest.current.working;
    let prepared: PreparedSave;
    let result: Awaited<ReturnType<typeof documents.saveDocument>> | undefined;
    try {
      await chain.current;
      clearTimeout(timer.current);
      prepared = await prepare(envelope.source, working);
      if (prepared.ok) {
        const input = { source: prepared.source, context: { trustClass: 'class-2-local-user' as const }, rootType: envelope.rootType, oscalVersion };
        result = await documents.saveDocument(localId, envelope.savedAt, latest.current.draftSavedAt, input, prepared.bindings, prepared.documentState, prepared.approval);
      }
    } finally {
      saving.current = false;
      release();
      setBusy(false);
    }
    // Eine Abweisung vor dem Schreiben hält den Autosave ebenso am Laufen wie ein gescheitertes Schreiben.
    if (!prepared.ok || result === undefined || !result.ok) {
      if (latest.current.unsaved) schedule();
      if (!prepared.ok) return prepared;
      setMessage('save-failed');
      return { ok: false, code: result?.ok === false ? result.diagnostic.code : 'WORKSPACE_STORAGE_FAILED' };
    }
    onSaved?.(prepared.bindings);
    setEnvelope(result.value);
    setStored(prepared.bindings);
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
    return { ok: true, documentState: prepared.documentState };
  }, [documents, localId, schedule]);

  const dirty = envelope !== undefined && !sameContent(envelope.source, working);

  const exportWith = useCallback(async (run: (document: WorkspaceEnvelope) => Promise<ExportResult>, filename: string) => {
    const current = latest.current.envelope;
    if (!current || dirty) return;
    const result = await run(current);
    if (!result.ok) {
      setMessage('export-failed');
      return;
    }
    downloadBlob(new Blob([result.json], { type: 'application/json' }), filename);
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

  return { status, envelope, working, dirty, saveState, busy, message, setMessage, stored, setStored, latest, saving, change, commit, adopt, exportWith, remove };
}
