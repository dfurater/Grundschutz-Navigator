import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { CatalogDelivery } from '@/domain/workspaceCatalogPin';
import type { WorkspaceClass1Artifact } from '@/domain/workspaceGraphModel';
import type { BindingTarget, LocalId, WorkspaceResult } from '@/domain/workspaceModel';
import type { ProfileAnalysis, ProfileAnalysisInput, ProfileSchemaCheck } from '@/state/workspaceProfileAnalysis';
import type { WorkspacePort } from '@/state/workspaceVerbundView';

/*
 * Dokumentoperationen des Bereichs Informationsverbünde (GSPP-292). Jede
 * Operation geht über `src/adapters/workspaceStore.ts`; dieses Modul legt
 * keinen eigenen Speicher an. Schreibende Operationen außer dem Autosave
 * laden die Verbundansicht neu.
 */

type Port<K extends keyof WorkspacePort> = WorkspacePort[K];

/** Ungespeicherte Zuordnung eines Imports; der `href` prüft, dass der Import an dem Pointer noch derselbe ist. */
export interface PendingImportTarget {
  readonly href: string;
  readonly target: BindingTarget;
}

export interface WorkspaceDocuments {
  readonly getDocument: Port<'getDocument'>;
  readonly getDraft: Port<'getDraft'>;
  readonly listBindings: Port<'listBindings'>;
  readonly addDocument: Port<'addDocument'>;
  readonly saveDocument: Port<'saveDocument'>;
  /** Schreibt nur den Entwurf; die Verbundansicht bleibt, weil sie Entwürfe nicht liest. */
  readonly autosaveDraft: Port<'autosaveDraft'>;
  readonly setBinding: Port<'setBinding'>;
  readonly deleteDocument: Port<'deleteDocument'>;
  /** Prüfspur und gespeicherter Stand; die UI bildet die Fehlercodes selbst auf Texte ab. */
  readonly listReviewTrail: Port<'listReviewTrail'>;
  /** Schreibt nur Trail und Vergleichsbaseline, nie das Dokument. */
  readonly appendCheckpoint: Port<'appendCheckpoint'>;
  readonly appendDecision: Port<'appendDecision'>;
  /** Leitet den Verbundgraphen mit einem ungespeicherten Arbeitsstand ab; schreibt nichts. */
  readonly analyzeProfile: (input: ProfileAnalysisInput) => Promise<WorkspaceResult<ProfileAnalysis>>;
  /** Schemaprüfung einer ungespeicherten Quelle; entscheidet beim Speichern über `export-ready`. */
  readonly checkProfileSchema: (source: unknown) => Promise<ProfileSchemaCheck>;
  /**
   * Importziele ungespeicherter Importe je Dokument, nach JSON Pointer des `href`. Sie leben nur
   * im Arbeitsspeicher dieses Tabs und werden beim expliziten Speichern zu
   * Bindungen; nichts davon gelangt in einen Browserspeicher.
   */
  readonly importTargets: (localId: LocalId) => Map<string, PendingImportTarget>;
}

type Write = <T>(operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>) => Promise<WorkspaceResult<T>>;

const storageFailed = () => failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));

/**
 * Prüf- und Freigabeaktionen nur über einem gebundenen Bezugsstand, auch einem über lokale
 * Referenzen geerbten (SSP → Profil → Katalog). Dieselbe Ableitung wie die Verbundansicht,
 * hier im Speicherpfad, damit eine gesperrte Oberfläche nicht die einzige Sperre ist.
 */
async function reviewGate(port: WorkspacePort, localId: LocalId, delivery: CatalogDelivery): Promise<WorkspaceResult<null>> {
  const document = await port.getDocument(localId);
  if (!document.ok) return document;
  if (!document.value) return { ok: true, value: null };
  const [{ loadMembers }, { applyCatalogPins, reviewLocked }] = await Promise.all([
    import('@/state/workspaceVerbundView'),
    import('@/domain/workspaceCatalogPin'),
  ]);
  const members = await loadMembers(port, document.value.verbundId);
  if (!members.ok) return members;
  const bindings = await port.listBindings();
  if (!bindings.ok) return bindings;
  const ids = new Set<string>(members.value.map((member) => member.localId));
  const pin = applyCatalogPins(members.value, bindings.value.filter((binding) => ids.has(binding.fromLocalId)), delivery).pins.get(localId);
  return reviewLocked(pin) ? failure(new StorageFailure(pin?.code ?? 'OSCAL_WORKSPACE_CATALOG_PIN_UNVERIFIED')) : { ok: true, value: null };
}

/** Liest den Schnappschuss im Main Thread und leitet ihn im Worker ab. */
async function analyze(port: WorkspacePort, input: ProfileAnalysisInput, class1: readonly WorkspaceClass1Artifact[], delivery: CatalogDelivery): Promise<WorkspaceResult<ProfileAnalysis>> {
  const [{ profileAnalysisSnapshot }, { analyzeProfileInWorker }] = await Promise.all([
    import('@/state/workspaceProfileAnalysis'),
    import('@/adapters/profileWorkbench'),
  ]);
  const snapshot = await profileAnalysisSnapshot(port, input, class1, delivery);
  if (!snapshot.ok) return snapshot;
  const analysis = await analyzeProfileInWorker(snapshot.value);
  return analysis ? { ok: true, value: analysis } : storageFailed();
}

/** Schemaprüfung über das Klasse-2-Importgate (Modul-Worker). */
async function checkSchema(source: unknown): Promise<ProfileSchemaCheck> {
  const [{ importClass2OscalDocument }, { serializeWorkspaceJson }] = await Promise.all([
    import('@/adapters/oscalImportGate'),
    import('@/domain/workspaceJson'),
  ]);
  const result = await importClass2OscalDocument(new TextEncoder().encode(serializeWorkspaceJson(source)), { trustClass: 'class-2-local-user' });
  return result.ok ? { status: 'passed' } : { status: 'failed', code: result.diagnostic.code, path: result.diagnostic.path };
}

export function createWorkspaceDocuments({ port, write, quiet, class1, delivery, targets }: Readonly<{
  port: WorkspacePort | null;
  /** Schreibt und lädt danach die Verbundansicht neu. */
  write: Write;
  /** Schreibt ohne Neuladen; Fehler erscheinen als Speichermeldung. */
  quiet: Write;
  class1: readonly WorkspaceClass1Artifact[];
  delivery: CatalogDelivery;
  targets: Map<LocalId, Map<string, PendingImportTarget>>;
}>): WorkspaceDocuments {
  const read = <T,>(operation: (store: WorkspacePort) => Promise<WorkspaceResult<T>>): Promise<WorkspaceResult<T>> =>
    port ? operation(port).catch(storageFailed) : Promise.resolve(storageFailed());
  // Prüfentscheidungen ändern die Verbundansicht nicht; die Station zeigt ihre Codes selbst.
  return {
    getDocument: (localId) => read((store) => store.getDocument(localId)),
    getDraft: (localId) => read((store) => store.getDraft(localId)),
    listBindings: () => read((store) => store.listBindings()),
    addDocument: (...args) => write((store) => store.addDocument(...args)),
    saveDocument: (...args) => write(async (store) => {
      // Eine Freigabe ist eine Prüfentscheidung und braucht den gebundenen Bezugsstand.
      if (args[6] !== undefined) {
        const gate = await reviewGate(store, args[0], delivery);
        if (!gate.ok) return gate;
      }
      return store.saveDocument(...args);
    }),
    autosaveDraft: (...args) => quiet((store) => store.autosaveDraft(...args)),
    setBinding: (...args) => write((store) => store.setBinding(...args)),
    deleteDocument: async (localId) => {
      const result = await write((store) => store.deleteDocument(localId));
      if (result.ok) targets.delete(localId);
      return result;
    },
    listReviewTrail: (localId) => read((store) => store.listReviewTrail(localId)),
    appendCheckpoint: (...args) => read(async (store) => {
      const gate = await reviewGate(store, args[0], delivery);
      return gate.ok ? store.appendCheckpoint(...args) : gate;
    }),
    appendDecision: (...args) => read(async (store) => {
      const gate = await reviewGate(store, args[0], delivery);
      return gate.ok ? store.appendDecision(...args) : gate;
    }),
    analyzeProfile: (input) => read((store) => analyze(store, input, class1, delivery)),
    checkProfileSchema: (source) => checkSchema(source)
      .catch((): ProfileSchemaCheck => ({ status: 'failed', code: 'OSCAL_EXPORT_SOURCE_INVALID', path: '/' })),
    importTargets: (localId) => {
      let map = targets.get(localId);
      if (!map) {
        map = new Map();
        targets.set(localId, map);
      }
      return map;
    },
  };
}
