import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StorageFailure, UNSAVED_INPUT_CODE, failure } from '@/adapters/workspaceStorageFailure';
import { isLocalIdentity } from '@/app/routes';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { CatalogDelivery } from '@/domain/workspaceCatalogPin';
import { catalogDelivery, verifiedCatalogArtifacts } from '@/state/workspaceCatalogSession';
import type { WorkspaceClass1Artifact } from '@/domain/workspaceGraphModel';
import type { LocalId, VerbundId, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import {
  collectRestoreInputs, discardReplacedInputs, type RestoreInput, type RestorePreview, type RestoreScope,
} from '@/state/workspaceRestore';
import { CatalogContext } from '@/state/CatalogContext';
import {
  noticeForDiagnostic, quotaNearlyExhausted, withNotice, withoutNotice, type WorkspaceNotice,
} from '@/state/workspaceNotices';
import { createWorkspaceDocuments, type PendingImportTarget, type WorkspaceDocuments } from '@/state/workspaceDocuments';
import type { VerbundView, WorkspacePort } from '@/state/workspaceVerbundView';
import { createWorkspaceSession, type ExclusiveEntry, type WorkspaceSession } from '@/state/workspaceSession';

/** `existing`: nur einen vorhandenen Speicher öffnen; ein fehlender ergibt `null`, statt angelegt zu werden. */
export type OpenWorkspace = (existing?: boolean) => Promise<WorkspaceResult<WorkspacePort | null>>;

// Speicher und Dokumentgraph laden als eigene Chunks: Der Katalogpfad lädt sie nie.
// Ein nicht geladener Chunk oder ein Wurf wird zur redigierten Speicherdiagnose.
const storageFailed = () => failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));
const openWorkspaceStore: OpenWorkspace = (existing) =>
  import('@/adapters/workspaceStore').then(({ WorkspaceStore }) => existing ? WorkspaceStore.openExisting() : WorkspaceStore.open());
const loadView = (port: WorkspacePort, verbundId: VerbundId, class1: readonly WorkspaceClass1Artifact[], delivery: CatalogDelivery): Promise<WorkspaceResult<VerbundView | null>> =>
  import('@/state/workspaceVerbundView')
    .then(({ loadVerbundView }) => loadVerbundView(port, verbundId, class1, delivery))
    .catch(storageFailed);

/** Speichert einen offenen Entwurf; Stationen registrieren ihn für den Bereichswechsel. */
export type AutosaveFlush = () => Promise<WorkspaceResult<unknown>>;

export interface VerbundViewState {
  readonly verbundId: string;
  readonly status: 'loading' | 'ready' | 'not-found' | 'failed';
  readonly view?: VerbundView;
}

export interface WorkspaceContextValue {
  /**
   * `idle` bis zum ersten Betreten des Bereichs; der Katalogpfad öffnet den Speicher nicht.
   * `deleted`, wenn die Gesamtlöschung dieses oder eines anderen Tabs den Speicher entfernt hat: Er ist nicht geöffnet.
   */
  readonly status: 'idle' | 'opening' | 'ready' | 'unavailable' | 'deleted';
  readonly verbuende: readonly WorkspaceVerbund[] | null;
  readonly writable: boolean;
  /** Ausgelieferte BSI-Katalogstände dieser Sitzung; nur das Manifest, keine Katalogbytes. */
  readonly catalogDelivery: CatalogDelivery;
  readonly notices: readonly WorkspaceNotice[];
  readonly verbund: VerbundViewState | null;
  readonly activate: () => void;
  readonly selectVerbund: (verbundId: string | null) => void;
  readonly reload: () => void;
  readonly createVerbund: (name: string) => Promise<WorkspaceResult<WorkspaceVerbund>>;
  readonly renameVerbund: (verbundId: VerbundId, name: string) => Promise<WorkspaceResult<WorkspaceVerbund>>;
  readonly deleteVerbund: (verbundId: VerbundId) => Promise<WorkspaceResult<void>>;
  /** Stand der Gesamtlöschung; `pending` heißt: Der gestartete Löschrequest wartet auf eine andere Verbindung. */
  readonly deletion: 'idle' | 'deleting' | 'pending' | 'failed';
  /** Prüft unter exklusiver Koordination auf weitere Arbeitsbereich-Tabs; `granted` sperrt neue Sitzungen bis zum Verlassen. */
  readonly enterWorkspaceDeletion: () => Promise<ExclusiveEntry['status']>;
  readonly leaveWorkspaceDeletion: () => void;
  /** Startet genau einen Löschrequest; `true` erst nach dessen endgültigem nativem Erfolg. */
  readonly deleteWorkspace: () => Promise<boolean>;
  readonly dismissDeletionFailure: () => void;
  readonly exportBackup: () => Promise<WorkspaceResult<string>>;
  readonly exportVerbundBackup: (verbundId: VerbundId) => Promise<WorkspaceResult<string>>;
  /** Prüft eine Sicherungsdatei und liest die an diesen Speicher gebundene Vorschau; schreibt nichts. */
  readonly previewRestore: (bytes: Uint8Array) => Promise<WorkspaceResult<RestorePreview>>;
  /** Ersetzt den Zielbereich mit genau dieser Vorschau und verwirft danach die ersetzten Sitzungseingaben. */
  readonly restoreBackup: (preview: RestorePreview) => Promise<WorkspaceResult<void>>;
  readonly pendingRestoreInputs: (scope: RestoreScope, rowDrafts?: ReadonlyMap<string, string>) => Promise<WorkspaceResult<readonly RestoreInput[]>>;
  readonly discardRestoreInput: (input: RestoreInput, rowDrafts?: Map<string, string>) => void;
  readonly registerAutosave: (flush: AutosaveFlush) => () => void;
  /** Speichert alle registrierten Entwürfe; `false`, wenn einer nicht gespeichert werden konnte. */
  readonly flushAutosaves: () => Promise<boolean>;
  /** Dokumentoperationen der Stationen (GSPP-292). */
  readonly documents: WorkspaceDocuments;
  /** Invalidierung nur für sitzungsgebundene Profilanalysen; Dokumentzugriff bleibt stabil. */
  readonly analysisRevision: number;
  /**
   * Offene Umbenennungen je `verbundId`, nur im Arbeitsspeicher des Tabs. Löschen
   * und ein Bestand ohne den Verbund verwerfen den Eintrag.
   */
  readonly renameDrafts: Map<string, string>;
}

const unavailable = () => Promise.resolve(storageFailed());
const unavailableWrite = <T,>(): Promise<WorkspaceResult<T>> => Promise.resolve(storageFailed());

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  status: 'idle',
  verbuende: null,
  writable: false,
  catalogDelivery: new Map(),
  notices: [],
  verbund: null,
  activate: () => undefined,
  selectVerbund: () => undefined,
  reload: () => undefined,
  createVerbund: unavailable,
  renameVerbund: unavailable,
  deleteVerbund: unavailable,
  deletion: 'idle',
  enterWorkspaceDeletion: () => Promise.resolve('unavailable'),
  leaveWorkspaceDeletion: () => undefined,
  deleteWorkspace: () => Promise.resolve(false),
  dismissDeletionFailure: () => undefined,
  exportBackup: unavailable,
  exportVerbundBackup: unavailable,
  previewRestore: unavailable,
  restoreBackup: unavailable,
  pendingRestoreInputs: unavailable,
  discardRestoreInput: () => undefined,
  renameDrafts: new Map(),
  registerAutosave: () => () => undefined,
  flushAutosaves: () => Promise.resolve(true),
  documents: createWorkspaceDocuments({ port: null, write: unavailableWrite, quiet: unavailableWrite, class1: [], delivery: new Map(), targets: new Map() }),
  analysisRevision: 0,
});

export function WorkspaceProvider({ open = openWorkspaceStore, session: providedSession, children }: Readonly<{
  open?: OpenWorkspace;
  session?: WorkspaceSession;
  children: ReactNode;
}>) {
  const [session] = useState(() => providedSession ?? createWorkspaceSession());
  const [deletion, setDeletion] = useState<WorkspaceContextValue['deletion']>('idle');
  // Ab dem Start der Gesamtlöschung bis zu ihrem endgültigen Ausgang: kein Öffnen, keine Meldung überholter Rückläufe.
  const [freeze] = useState(() => {
    let active = false;
    return { active: () => active, set: (next: boolean) => { active = next; } };
  });
  const exclusive = useRef<(() => void) | null>(null);
  const entryRun = useRef(0);
  const entering = useRef<Promise<unknown>>(Promise.resolve());
  const [port, setPort] = useState<WorkspacePort | null>(null);
  const [status, setStatus] = useState<WorkspaceContextValue['status']>('idle');
  const [verbuende, setVerbuende] = useState<readonly WorkspaceVerbund[] | null>(null);
  const [writable, setWritable] = useState(true);
  const [notices, setNotices] = useState<readonly WorkspaceNotice[]>([]);
  const [selectedVerbundId, setSelectedVerbundId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<VerbundViewState | null>(null);
  const [revision, setRevision] = useState(0);
  const [analysisRevision, setAnalysisRevision] = useState(0);
  const [analysisEpoch] = useState(() => {
    let version = 0;
    return { read: () => version, advance: () => ++version };
  });
  const analysisVersion = analysisEpoch.read;
  const invalidateAnalysis = useCallback(() => {
    setAnalysisRevision(analysisEpoch.advance());
  }, [analysisEpoch]);
  const openRef = useRef(open);
  const opening = useRef<Promise<WorkspacePort | null> | null>(null);
  const autosaves = useRef(new Set<AutosaveFlush>());
  // Ein stabiles Objekt je Provider, nur im Arbeitsspeicher dieses Tabs.
  const [importTargets] = useState(() => new Map<LocalId, Map<string, PendingImportTarget>>());
  const [renameDrafts] = useState(() => new Map<string, string>());
  const { catalogs, requestCatalog } = useContext(CatalogContext);
  const class1 = useMemo(() => verifiedCatalogArtifacts(catalogs), [catalogs]);
  const delivery = useMemo(() => catalogDelivery(catalogs), [catalogs]);

  const report = useCallback((diagnostic: { readonly code: string }) => {
    if (freeze.active()) return;
    const notice = noticeForDiagnostic(diagnostic);
    if (notice === 'write-locked') setWritable(false);
    setNotices((current) => withNotice(current, notice));
  }, [freeze]);

  // Eine nicht bestätigte Schemaversion gibt das Schreiben nicht frei; Lesen und Export bleiben.
  const checkSchema = useCallback(async (store: WorkspacePort) => {
    const schema = await store.schemaStatus().catch(storageFailed);
    if (!schema.ok) {
      setWritable(false);
      report(schema.diagnostic);
    } else if (schema.value === 'newer') {
      report({ code: 'WORKSPACE_SCHEMA_NEWER' });
    } else {
      setWritable(true);
      setNotices((current) => withoutNotice(current, 'write-locked'));
    }
  }, [report]);

  const openStore = useCallback((): Promise<WorkspacePort | null> => {
    if (freeze.active()) return Promise.resolve(null);
    opening.current ??= (async () => {
      setStatus('opening');
      // Die Anmeldung wartet, solange ein anderer Tab die Gesamtlöschung vorbereitet oder ausführt.
      let waited = false;
      await session.register(() => { waited = true; });
      // Hat der andere Tab inzwischen gelöscht, legt erst ein neuer ausdrücklicher Einstieg den Speicher wieder an.
      const opened = await openRef.current(waited).catch(storageFailed);
      if (!opened.ok) {
        setStatus('unavailable');
        report(opened.diagnostic);
        return null;
      }
      if (!opened.value) {
        opening.current = null;
        setVerbuende([]);
        setStatus('deleted');
        return null;
      }
      await checkSchema(opened.value);
      setPort(opened.value);
      setStatus('ready');
      return opened.value;
    })();
    return opening.current;
  }, [session, report, checkSchema, freeze]);
  const activate = useCallback(() => { void openStore(); }, [openStore]);

  useEffect(() => () => port?.close(), [port]);

  // Eine aus dem Seitencache zurückgeholte Seite hielte einen Arbeitsstand von vor einer möglichen Löschung.
  useEffect(() => {
    const hide = (event: PageTransitionEvent) => {
      if (!event.persisted || freeze.active()) return;
      port?.close();
      session.leave();
    };
    // shortcut: Neuladen verwirft auch offene Eingaben; ein feineres Zurücksetzen lohnt erst, wenn die Seite den Seitencache tatsächlich nutzt.
    const show = (event: PageTransitionEvent) => { if (event.persisted) globalThis.location.reload(); };
    globalThis.addEventListener('pagehide', hide);
    globalThis.addEventListener('pageshow', show);
    return () => {
      globalThis.removeEventListener('pagehide', hide);
      globalThis.removeEventListener('pageshow', show);
    };
  }, [port, session, freeze]);

  // Bestand und Speicherbelegung bei jedem Öffnen, Neuladen und Schreiben.
  useEffect(() => {
    if (!port) return;
    let current = true;
    void port.listVerbuende().then((result) => {
      if (!current) return;
      if (!result.ok) { report(result.diagnostic); return; }
      // Ein anderswo gelöschter Verbund hinterlässt keinen Namensentwurf im Tab.
      for (const verbundId of renameDrafts.keys()) {
        if (!result.value.some((entry) => entry.verbundId === verbundId)) renameDrafts.delete(verbundId);
      }
      setVerbuende([...result.value].sort((a, b) => a.name.localeCompare(b.name, 'de')));
    });
    void port.estimate().then((result) => {
      if (!current || !result.ok) return;
      setNotices((notices) => quotaNearlyExhausted(result.value)
        ? withNotice(notices, 'quota-warning')
        : withoutNotice(notices, 'quota-warning'));
    });
    return () => { current = false; };
  }, [port, revision, report, renameDrafts]);

  // Nur der asynchrone Rückruf schreibt; Auswahl, Ladezustand und ungültige
  // Identitäten leitet `verbund` unten ab.
  useEffect(() => {
    if (!port || selectedVerbundId === null || !isLocalIdentity(selectedVerbundId)) return;
    let current = true;
    void loadView(port, selectedVerbundId as VerbundId, class1, delivery).then((result) => {
      if (!current) return;
      if (!result.ok) {
        report(result.diagnostic);
        setLoaded({ verbundId: selectedVerbundId, status: 'failed' });
      } else if (result.value === null) {
        setLoaded({ verbundId: selectedVerbundId, status: 'not-found' });
      } else {
        setLoaded({ verbundId: selectedVerbundId, status: 'ready', view: result.value });
      }
    });
    return () => { current = false; };
  }, [port, selectedVerbundId, revision, report, class1, delivery]);

  // Ein Katalogpaar ohne Bindung fordert seinen Katalog sonst nirgends an; nur so wird der Bezugsstand prüfbar.
  useEffect(() => {
    const pending = new Set((loaded?.view?.documents ?? []).flatMap((document) => document.catalogPin?.pending ?? []));
    for (const catalogKey of pending) requestCatalog?.(catalogKey as CatalogKey);
  }, [loaded, requestCatalog]);

  const verbund = useMemo<VerbundViewState | null>(() => {
    if (selectedVerbundId === null) return null;
    if (!isLocalIdentity(selectedVerbundId)) return { verbundId: selectedVerbundId, status: 'not-found' };
    // Ein gescheitertes Öffnen ist terminal; „Neu laden“ auf der Fehlerfläche versucht es erneut.
    if (status === 'unavailable') return { verbundId: selectedVerbundId, status: 'failed' };
    // Nach der Gesamtlöschung gibt es den Verbund nicht mehr; während sie läuft, lädt ohne Port nichts.
    if (status === 'deleted') return { verbundId: selectedVerbundId, status: 'not-found' };
    if (deletion !== 'idle') return { verbundId: selectedVerbundId, status: 'failed' };
    if (loaded?.verbundId === selectedVerbundId) return loaded;
    return { verbundId: selectedVerbundId, status: 'loading' };
  }, [selectedVerbundId, loaded, status, deletion]);

  const writeTo = useCallback(async <T,>(store: WorkspacePort | null, operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> => {
    if (!store) return storageFailed();
    const result = await operation(store);
    if (result.ok) {
      invalidateAnalysis();
      setRevision((value) => value + 1);
    } else if (result.diagnostic.code !== 'WORKSPACE_OPERATION_CANCELLED') report(result.diagnostic);
    return result;
  }, [report, invalidateAnalysis]);
  const write = useCallback(async <T,>(operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>) => writeTo(port, operation), [port, writeTo]);

  const enterWorkspaceDeletion = useCallback((): Promise<ExclusiveEntry['status']> => {
    const run = ++entryRun.current;
    // Nacheinander: Eine noch laufende eigene Prüfung hält das Tor und sähe sonst wie ein anderer Tab aus.
    const next = entering.current.then(async (): Promise<ExclusiveEntry['status']> => {
      if (run !== entryRun.current) return 'other-sessions';
      if (exclusive.current) return 'granted';
      const entry = await session.enterExclusive();
      if (entry.status !== 'granted') return entry.status;
      // Inzwischen abgebrochen: Diese Freigabe hält niemand mehr.
      if (run !== entryRun.current) { entry.release(); return 'other-sessions'; }
      exclusive.current = entry.release;
      return 'granted';
    });
    entering.current = next;
    return next;
  }, [session]);

  const leaveWorkspaceDeletion = useCallback(() => {
    entryRun.current++;
    // Nach dem Start endet die Koordination erst mit dem endgültigen Ausgang des Löschrequests.
    if (freeze.active()) return;
    exclusive.current?.();
    exclusive.current = null;
  }, [freeze]);

  const deleteWorkspace = useCallback((): Promise<boolean> => {
    const release = exclusive.current;
    if (!port || !release || freeze.active()) return Promise.resolve(false);
    freeze.set(true);
    setDeletion('deleting');
    // Ohne Port erreicht keine Operation des Bereichs mehr den Speicher; der Adapter schließt seine Verbindung selbst.
    setPort(null);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const settle = (result: WorkspaceResult<void>) => {
        if (settled) return;
        settled = true;
        freeze.set(false);
        exclusive.current = null;
        opening.current = null;
        if (result.ok) {
          // Keine Restkopie des gelöschten Bestands im Tab.
          importTargets.clear();
          renameDrafts.clear();
          setLoaded(null);
          setVerbuende([]);
          setNotices([]);
          setWritable(true);
          invalidateAnalysis();
          setDeletion('idle');
          setStatus('deleted');
        } else {
          // Der Bestand kann fortbestehen; erst ein erneutes Öffnen zeigt ihn wieder.
          setDeletion('failed');
          setStatus('unavailable');
          setNotices((current) => withNotice(current, 'storage-failed'));
        }
        release();
        resolve(result.ok);
      };
      void port.deleteAll('delete-workspace', settle).catch(storageFailed).then((first) => {
        if (settled) return;
        if (!first.ok && first.diagnostic.code === 'WORKSPACE_DELETE_PENDING') setDeletion('pending');
        else settle(first);
      });
    });
  }, [port, importTargets, renameDrafts, invalidateAnalysis, freeze]);

  const quiet = useCallback(async <T,>(operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> => {
    if (!port) return storageFailed();
    const result = await operation(port).catch(storageFailed);
    if (!result.ok) report(result.diagnostic);
    return result;
  }, [port, report]);

  const documents = useMemo(
    () => createWorkspaceDocuments({ port, write, quiet, class1, delivery, targets: importTargets, analysisVersion }),
    [port, write, quiet, class1, delivery, importTargets, analysisVersion],
  );

  const registerAutosave = useCallback((flush: AutosaveFlush) => {
    autosaves.current.add(flush);
    return () => { autosaves.current.delete(flush); };
  }, []);

  const flushAutosaves = useCallback(async () => {
    const results = await Promise.all([...autosaves.current].map((flush) => flush().catch(storageFailed)));
    const failures = results.filter((result) => !result.ok);
    // Offene Formulareingaben sperren nur das Verlassen; der Editor zeigt den Hinweis selbst.
    for (const failure of failures) if (!failure.ok && failure.diagnostic.code !== UNSAVED_INPUT_CODE) report(failure.diagnostic);
    return failures.length === 0;
  }, [report]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    status,
    verbuende,
    writable,
    catalogDelivery: delivery,
    notices,
    verbund,
    activate,
    selectVerbund: setSelectedVerbundId,
    reload: () => {
      invalidateAnalysis();
      setNotices((current) => withoutNotice(withoutNotice(current, 'conflict'), 'storage-failed'));
      setRevision((current) => current + 1);
      // Ein gescheitertes Öffnen wird erneut versucht, eine gescheiterte Schemaprüfung
      // ebenso; eine Schreibsperre durch ein neueres Speicherschema bleibt bestehen.
      if (status === 'unavailable') {
        opening.current = null;
        activate();
      } else if (port && !writable && !notices.includes('write-locked')) {
        void checkSchema(port);
      }
    },
    // Nach einer Gesamtlöschung legt erst dieses ausdrückliche Anlegen einen neuen Speicher an.
    createVerbund: async (name) => writeTo(status === 'deleted' ? await openStore() : port, (store) => store.createVerbund(name)),
    renameVerbund: (verbundId, name) => write((store) => store.renameVerbund(verbundId, name)),
    deleteVerbund: async (verbundId) => {
      // Auch ungespeicherte Importziele sind Dokumentinhalt (`href`); sie fallen mit dem Verbund.
      // Ohne Mitgliederliste keine Löschung: Sonst blieben deren ungespeicherte Importziele im Tab zurück.
      const listed = port ? await port.listDocuments(verbundId) : storageFailed();
      if (!listed.ok) {
        report(listed.diagnostic);
        return listed;
      }
      const members = listed.value;
      const result = await write((store) => store.deleteVerbund(verbundId));
      // Keine Restkopie der gelöschten Inhalte im Tab, auch nicht für Browser-Zurück.
      if (result.ok) {
        setLoaded((current) => current?.verbundId === verbundId ? null : current);
        for (const member of members) importTargets.delete(member.localId);
        renameDrafts.delete(verbundId);
      }
      return result;
    },
    deletion,
    enterWorkspaceDeletion,
    leaveWorkspaceDeletion,
    deleteWorkspace,
    dismissDeletionFailure: () => setDeletion((current) => current === 'failed' ? 'idle' : current),
    exportBackup: async () => {
      if (port) {
        const result = await port.exportBackup();
        if (!result.ok) report(result.diagnostic);
        return result;
      }
      if (freeze.active() || !notices.includes('migration-failed')) return storageFailed();
      const result = await import('@/adapters/workspaceStore')
        .then(({ WorkspaceStore }) => WorkspaceStore.exportRecoveryBackup())
        .catch(storageFailed);
      if (!result.ok) report(result.diagnostic);
      return result;
    },
    exportVerbundBackup: (verbundId) => quiet((store) => store.exportVerbundBackup(verbundId)),
    previewRestore: async (bytes) => {
      // Nach einer Gesamtlöschung ist die gewählte Sicherungsdatei ein ausdrücklicher Einstieg: Er legt den Speicher neu an.
      const store = status === 'deleted' ? await openStore() : port;
      if (!store) return storageFailed();
      const result = await store.previewRestore(bytes).catch(storageFailed);
      // Die Ansicht zeigt jeden Fehler selbst; nur die Schreibsperre ist ein Zustand des Bereichs.
      if (!result.ok && result.diagnostic.code === 'WORKSPACE_SCHEMA_NEWER') report(result.diagnostic);
      return result;
    },
    restoreBackup: async (preview) => {
      if (!port) return storageFailed();
      const result = await (preview.kind === 'workspace' ? port.restoreBackup(preview) : port.restoreVerbundBackup(preview)).catch(storageFailed);
      if (!result.ok) {
        if (result.diagnostic.code === 'WORKSPACE_SCHEMA_NEWER') report(result.diagnostic);
        return result;
      }
      discardReplacedInputs(preview, importTargets, renameDrafts);
      setLoaded((current) => preview.kind === 'workspace' || current?.verbundId === preview.verbundId ? null : current);
      invalidateAnalysis();
      setRevision((value) => value + 1);
      return result;
    },
    pendingRestoreInputs: async (scope, rowDrafts) => {
      // Die Gesamtlöschung hat alle Sitzungseingaben verworfen; ein danach geöffneter Speicher ist leer.
      if (status === 'deleted') return { ok: true, value: [] };
      const listed = port ? await port.listDocuments().catch(storageFailed) : storageFailed();
      if (!listed.ok) return listed;
      return { ok: true, value: collectRestoreInputs({ scope, renameDrafts, rowDrafts, importTargets, verbuende: verbuende ?? [], documents: listed.value }) };
    },
    discardRestoreInput: (input, rowDrafts) => {
      if (input.kind !== 'rename') {
        importTargets.delete(input.localId);
        return;
      }
      // Eine während des Speicherns weitergetippte Umbenennung bleibt offen.
      const drafts = input.row ? rowDrafts : renameDrafts;
      if (drafts?.get(input.verbundId) === input.draft) drafts.delete(input.verbundId);
    },
    registerAutosave,
    flushAutosaves,
    documents,
    analysisRevision,
    renameDrafts,
  }), [status, verbuende, writable, delivery, notices, verbund, activate, openStore, checkSchema, write, writeTo, deletion, enterWorkspaceDeletion, leaveWorkspaceDeletion, deleteWorkspace, freeze, quiet, port, report, registerAutosave, flushAutosaves, documents, importTargets, invalidateAnalysis, analysisRevision, renameDrafts]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
