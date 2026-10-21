import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import { isLocalIdentity } from '@/app/routes';
import type { CatalogState } from '@/domain/models';
import { getCatalogByKey } from '@/domain/sourceRegistry';
import type { WorkspaceClass1Artifact } from '@/domain/workspaceGraphModel';
import type { LocalId, VerbundId, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import {
  noticeForDiagnostic, quotaNearlyExhausted, withNotice, withoutNotice, type WorkspaceNotice,
} from '@/state/workspaceNotices';
import { createWorkspaceDocuments, type PendingImportTarget, type WorkspaceDocuments } from '@/state/workspaceDocuments';
import type { VerbundView, WorkspacePort } from '@/state/workspaceVerbundView';

export type OpenWorkspace = () => Promise<WorkspaceResult<WorkspacePort>>;

// Speicher und Dokumentgraph laden als eigene Chunks: Der Katalogpfad lädt sie nie.
// Ein nicht geladener Chunk oder ein Wurf wird zur redigierten Speicherdiagnose.
const storageFailed = () => failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));
const openWorkspaceStore: OpenWorkspace = () =>
  import('@/adapters/workspaceStore').then(({ WorkspaceStore }) => WorkspaceStore.open());
const loadView = (port: WorkspacePort, verbundId: VerbundId, class1: readonly WorkspaceClass1Artifact[]): Promise<WorkspaceResult<VerbundView | null>> =>
  import('@/state/workspaceVerbundView')
    .then(({ loadVerbundView }) => loadVerbundView(port, verbundId, class1))
    .catch(storageFailed);

/**
 * Bereits geladene Kataloge mit bestandener Hashprüfung als lesende
 * Klasse-1-Artefakte für den Dokumentgraphen. Nicht verifizierte oder nicht
 * unterstützte Kataloge bleiben draußen; nichts davon gelangt in den Speicher.
 */
function verifiedCatalogArtifacts(catalogs: CatalogState['catalogs'] | undefined): WorkspaceClass1Artifact[] {
  const artifacts: WorkspaceClass1Artifact[] = [];
  for (const [catalogKey, loaded] of catalogs ?? []) {
    const entry = getCatalogByKey(catalogKey);
    if (entry?.lifecycle !== 'supported' || !loaded.catalogDocument || loaded.verification?.valid !== true) continue;
    artifacts.push({
      artifactKey: entry.artifactKey,
      lifecycle: 'supported',
      trustClass: 'class-1-verified-public',
      rootType: entry.expectedRootType,
      oscalVersion: entry.oscalVersion,
      source: loaded.catalogDocument.source,
    });
  }
  return artifacts;
}

/** Speichert einen offenen Entwurf; Stationen registrieren ihn für den Bereichswechsel. */
export type AutosaveFlush = () => Promise<WorkspaceResult<unknown>>;

export interface VerbundViewState {
  readonly verbundId: string;
  readonly status: 'loading' | 'ready' | 'not-found' | 'failed';
  readonly view?: VerbundView;
}

export interface WorkspaceContextValue {
  /** `idle` bis zum ersten Betreten des Bereichs; der Katalogpfad öffnet den Speicher nicht. */
  readonly status: 'idle' | 'opening' | 'ready' | 'unavailable';
  readonly verbuende: readonly WorkspaceVerbund[] | null;
  readonly writable: boolean;
  readonly notices: readonly WorkspaceNotice[];
  readonly verbund: VerbundViewState | null;
  readonly activate: () => void;
  readonly selectVerbund: (verbundId: string | null) => void;
  readonly reload: () => void;
  readonly createVerbund: (name: string) => Promise<WorkspaceResult<WorkspaceVerbund>>;
  readonly renameVerbund: (verbundId: VerbundId, name: string) => Promise<WorkspaceResult<WorkspaceVerbund>>;
  readonly deleteVerbund: (verbundId: VerbundId) => Promise<WorkspaceResult<void>>;
  readonly exportBackup: () => Promise<WorkspaceResult<string>>;
  readonly registerAutosave: (flush: AutosaveFlush) => () => void;
  /** Speichert alle registrierten Entwürfe; `false`, wenn einer nicht gespeichert werden konnte. */
  readonly flushAutosaves: () => Promise<boolean>;
  /** Dokumentoperationen der Stationen (GSPP-292). */
  readonly documents: WorkspaceDocuments;
}

const unavailable = () => Promise.resolve(storageFailed());
const unavailableWrite = <T,>(): Promise<WorkspaceResult<T>> => Promise.resolve(storageFailed());

export const WorkspaceContext = createContext<WorkspaceContextValue>({
  status: 'idle',
  verbuende: null,
  writable: false,
  notices: [],
  verbund: null,
  activate: () => undefined,
  selectVerbund: () => undefined,
  reload: () => undefined,
  createVerbund: unavailable,
  renameVerbund: unavailable,
  deleteVerbund: unavailable,
  exportBackup: unavailable,
  registerAutosave: () => () => undefined,
  flushAutosaves: () => Promise.resolve(true),
  documents: createWorkspaceDocuments({ port: null, write: unavailableWrite, quiet: unavailableWrite, class1: [], targets: new Map() }),
});

export function WorkspaceProvider({ open = openWorkspaceStore, children }: Readonly<{
  open?: OpenWorkspace;
  children: ReactNode;
}>) {
  const [port, setPort] = useState<WorkspacePort | null>(null);
  const [status, setStatus] = useState<WorkspaceContextValue['status']>('idle');
  const [verbuende, setVerbuende] = useState<readonly WorkspaceVerbund[] | null>(null);
  const [writable, setWritable] = useState(true);
  const [notices, setNotices] = useState<readonly WorkspaceNotice[]>([]);
  const [selectedVerbundId, setSelectedVerbundId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<VerbundViewState | null>(null);
  const [revision, setRevision] = useState(0);
  const openRef = useRef(open);
  const startedRef = useRef(false);
  const autosaves = useRef(new Set<AutosaveFlush>());
  // Ein stabiles Objekt je Provider, nur im Arbeitsspeicher dieses Tabs.
  const [importTargets] = useState(() => new Map<LocalId, Map<string, PendingImportTarget>>());
  const { catalogs } = useContext(CatalogContext);
  const class1 = useMemo(() => verifiedCatalogArtifacts(catalogs), [catalogs]);

  const report = useCallback((diagnostic: { readonly code: string }) => {
    const notice = noticeForDiagnostic(diagnostic);
    if (notice === 'write-locked') setWritable(false);
    setNotices((current) => withNotice(current, notice));
  }, []);

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

  const activate = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus('opening');
    void openRef.current().catch(storageFailed).then(async (opened) => {
      if (!opened.ok) {
        setStatus('unavailable');
        report(opened.diagnostic);
        return;
      }
      await checkSchema(opened.value);
      setPort(opened.value);
      setStatus('ready');
    });
  }, [report, checkSchema]);

  useEffect(() => () => port?.close(), [port]);

  // Bestand und Speicherbelegung bei jedem Öffnen, Neuladen und Schreiben.
  useEffect(() => {
    if (!port) return;
    let current = true;
    void port.listVerbuende().then((result) => {
      if (!current) return;
      if (result.ok) setVerbuende([...result.value].sort((a, b) => a.name.localeCompare(b.name, 'de')));
      else report(result.diagnostic);
    });
    void port.estimate().then((result) => {
      if (!current || !result.ok) return;
      setNotices((notices) => quotaNearlyExhausted(result.value)
        ? withNotice(notices, 'quota-warning')
        : withoutNotice(notices, 'quota-warning'));
    });
    return () => { current = false; };
  }, [port, revision, report]);

  // Nur der asynchrone Rückruf schreibt; Auswahl, Ladezustand und ungültige
  // Identitäten leitet `verbund` unten ab.
  useEffect(() => {
    if (!port || selectedVerbundId === null || !isLocalIdentity(selectedVerbundId)) return;
    let current = true;
    void loadView(port, selectedVerbundId as VerbundId, class1).then((result) => {
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
  }, [port, selectedVerbundId, revision, report, class1]);

  const verbund = useMemo<VerbundViewState | null>(() => {
    if (selectedVerbundId === null) return null;
    if (!isLocalIdentity(selectedVerbundId)) return { verbundId: selectedVerbundId, status: 'not-found' };
    // Ein gescheitertes Öffnen ist terminal; „Neu laden“ auf der Fehlerfläche versucht es erneut.
    if (status === 'unavailable') return { verbundId: selectedVerbundId, status: 'failed' };
    if (loaded?.verbundId === selectedVerbundId) return loaded;
    return { verbundId: selectedVerbundId, status: 'loading' };
  }, [selectedVerbundId, loaded, status]);

  const write = useCallback(async <T,>(operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> => {
    if (!port) return storageFailed();
    const result = await operation(port);
    if (result.ok) setRevision((value) => value + 1);
    else if (result.diagnostic.code !== 'WORKSPACE_OPERATION_CANCELLED') report(result.diagnostic);
    return result;
  }, [port, report]);

  const quiet = useCallback(async <T,>(operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> => {
    if (!port) return storageFailed();
    const result = await operation(port).catch(storageFailed);
    if (!result.ok) report(result.diagnostic);
    return result;
  }, [port, report]);

  const documents = useMemo(
    () => createWorkspaceDocuments({ port, write, quiet, class1, targets: importTargets }),
    [port, write, quiet, class1, importTargets],
  );

  const registerAutosave = useCallback((flush: AutosaveFlush) => {
    autosaves.current.add(flush);
    return () => { autosaves.current.delete(flush); };
  }, []);

  const flushAutosaves = useCallback(async () => {
    const results = await Promise.all([...autosaves.current].map((flush) => flush().catch(storageFailed)));
    const failures = results.filter((result) => !result.ok);
    for (const failure of failures) if (!failure.ok) report(failure.diagnostic);
    return failures.length === 0;
  }, [report]);

  const value = useMemo<WorkspaceContextValue>(() => ({
    status,
    verbuende,
    writable,
    notices,
    verbund,
    activate,
    selectVerbund: setSelectedVerbundId,
    reload: () => {
      setNotices((current) => withoutNotice(withoutNotice(current, 'conflict'), 'storage-failed'));
      setRevision((current) => current + 1);
      // Ein gescheitertes Öffnen wird erneut versucht, eine gescheiterte Schemaprüfung
      // ebenso; eine Schreibsperre durch ein neueres Speicherschema bleibt bestehen.
      if (status === 'unavailable') {
        startedRef.current = false;
        activate();
      } else if (port && !writable && !notices.includes('write-locked')) {
        void checkSchema(port);
      }
    },
    createVerbund: (name) => write((store) => store.createVerbund(name)),
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
      }
      return result;
    },
    exportBackup: async () => {
      if (!port) return storageFailed();
      const result = await port.exportBackup();
      if (!result.ok) report(result.diagnostic);
      return result;
    },
    registerAutosave,
    flushAutosaves,
    documents,
  }), [status, verbuende, writable, notices, verbund, activate, checkSchema, write, port, report, registerAutosave, flushAutosaves, documents, importTargets]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
