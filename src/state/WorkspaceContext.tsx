import { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import { isLocalIdentity } from '@/app/routes';
import type { VerbundId, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import {
  noticeForDiagnostic, quotaNearlyExhausted, withNotice, withoutNotice, type WorkspaceNotice,
} from '@/state/workspaceNotices';
import type { VerbundView, WorkspacePort } from '@/state/workspaceVerbundView';

export type OpenWorkspace = () => Promise<WorkspaceResult<WorkspacePort>>;

// Speicher und Dokumentgraph laden als eigene Chunks: Der Katalogpfad lädt sie nie.
// Ein nicht geladener Chunk oder ein Wurf wird zur redigierten Speicherdiagnose.
const storageFailed = () => failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));
const openWorkspaceStore: OpenWorkspace = () =>
  import('@/adapters/workspaceStore').then(({ WorkspaceStore }) => WorkspaceStore.open());
const loadView = (port: WorkspacePort, verbundId: VerbundId): Promise<WorkspaceResult<VerbundView | null>> =>
  import('@/state/workspaceVerbundView')
    .then(({ loadVerbundView }) => loadVerbundView(port, verbundId))
    .catch(storageFailed);

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
}

const unavailable = () => Promise.resolve(storageFailed());

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

  const report = useCallback((diagnostic: { readonly code: string }) => {
    const notice = noticeForDiagnostic(diagnostic);
    if (notice === 'write-locked') setWritable(false);
    setNotices((current) => withNotice(current, notice));
  }, []);

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
      const schema = await opened.value.schemaStatus();
      if (schema.ok && schema.value === 'newer') report({ code: 'WORKSPACE_SCHEMA_NEWER' });
      setPort(opened.value);
      setStatus('ready');
    });
  }, [report]);

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
    void loadView(port, selectedVerbundId as VerbundId).then((result) => {
      if (!current) return;
      if (!result.ok) report(result.diagnostic);
      setLoaded(!result.ok
        ? { verbundId: selectedVerbundId, status: 'failed' }
        : result.value === null
          ? { verbundId: selectedVerbundId, status: 'not-found' }
          : { verbundId: selectedVerbundId, status: 'ready', view: result.value });
    });
    return () => { current = false; };
  }, [port, selectedVerbundId, revision, report]);

  const verbund = useMemo<VerbundViewState | null>(() => {
    if (selectedVerbundId === null) return null;
    if (!isLocalIdentity(selectedVerbundId)) return { verbundId: selectedVerbundId, status: 'not-found' };
    if (loaded?.verbundId === selectedVerbundId) return loaded;
    return { verbundId: selectedVerbundId, status: 'loading' };
  }, [selectedVerbundId, loaded]);

  const write = useCallback(async <T,>(operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> => {
    if (!port) return storageFailed();
    const result = await operation(port);
    if (result.ok) setRevision((value) => value + 1);
    else report(result.diagnostic);
    return result;
  }, [port, report]);

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
      // Ein gescheitertes Öffnen wird erneut versucht.
      if (status === 'unavailable') {
        startedRef.current = false;
        activate();
      }
    },
    createVerbund: (name) => write((store) => store.createVerbund(name)),
    renameVerbund: (verbundId, name) => write((store) => store.renameVerbund(verbundId, name)),
    deleteVerbund: (verbundId) => write((store) => store.deleteVerbund(verbundId)),
    exportBackup: async () => {
      if (!port) return storageFailed();
      const result = await port.exportBackup();
      if (!result.ok) report(result.diagnostic);
      return result;
    },
    registerAutosave,
    flushAutosaves,
  }), [status, verbuende, writable, notices, verbund, activate, write, port, report, registerAutosave, flushAutosaves]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
