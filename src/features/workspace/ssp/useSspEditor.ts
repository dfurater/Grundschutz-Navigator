import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { exportSspInWorker } from '@/adapters/sspWorkbench';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import { SSP_ADAPTER_DIAGNOSTIC_CODES } from '@/adapters/oscalSspReaders';
import { addSspItem, readSspValue, setBaselineTitle, setSspValue, sspBaselineBindable, SspPatchError, SSP_IMPORT_PROFILE_POINTER } from '@/domain/sspAuthoring';
import { catalogPinsForSave } from '@/domain/workspaceCatalogPin';
import { commitSspSave, sameSspContent, sspReadinessBlocker, sspSaveBlocker } from '@/domain/sspSave';
import type { BindingTarget, LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { downloadBlob } from '@/adapters/browserDownload';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import { sspCategoryContext } from '@/domain/sspCategoryContext';
import { prepareSspTargets, validateSspTargets, type TargetCategoryContext, type TargetFailure } from '@/domain/sspTargetObjects';
import { deriveSspProcessProtection, processProtectionFailure } from '@/domain/sspProcessProtection';
import type { ProcessDecisionInput } from '@/domain/sspProcessApproval';
import { targetDeletionUses } from '@/domain/sspTargetDeletion';
import type { SspPath } from '@/domain/sspAuthoring';
import { useCatalog } from '@/hooks/useCatalog';
import { StorageFailure, UNSAVED_INPUT_CODE, failure } from '@/adapters/workspaceStorageFailure';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useDocumentEditor, type DocumentEditorCoreMessage, type DocumentSaveState } from '@/features/workspace/useDocumentEditor';
import type { PendingImportTarget } from '@/state/workspaceDocuments';
import type { DecisionParty } from '@/state/processDecisionDrafts';

type SspMessage = 'saved-as-draft' | 'component-unresolved' | 'component-referenced' | 'patch-failed' | 'catalog-locked' | 'target-invalid' | 'target-delete-blocked' | 'target-form-pending';

export type SspEditorMessage = DocumentEditorCoreMessage | SspMessage;
export type { DecisionParty } from '@/state/processDecisionDrafts';

export interface SspEditor {
  readonly localId: LocalId;
  readonly status: 'loading' | 'ready' | 'failed';
  readonly envelope?: WorkspaceEnvelope;
  readonly working: unknown;
  readonly dirty: boolean;
  readonly saveState: DocumentSaveState;
  readonly busy: boolean;
  readonly message?: SspEditorMessage;
  /** Ziel der Baseline des Arbeitsstands: gespeicherte Bindung oder ungespeicherte Wahl. */
  readonly baseline?: BindingTarget;
  /** `import-profile.href` kann eine Bindung tragen; ein externer Verweis kann es nie. */
  readonly baselineBindable: boolean;
  /** Wendet einen Patch an; ein abgewiesener Patch ändert nichts und meldet seinen Grund. */
  readonly apply: (patch: (source: unknown) => unknown) => boolean;
  readonly chooseBaseline: (target: BindingTarget, title: string) => void;
  readonly save: () => Promise<void>;
  /** Bindet ein SSP ohne Katalogpaar bestätigt an den ausgelieferten, verifizierten Stand. */
  readonly bindCatalogStand: () => Promise<void>;
  readonly exportDocument: () => Promise<void>;
  readonly remove: () => Promise<boolean>;
  readonly categories?: TargetCategoryContext;
  readonly targetFailure?: TargetFailure;
  readonly hasPendingTargetForms: boolean;
  readonly setTargetFormPending: (id: string, pending: boolean) => void;
  readonly checkTargetRemoval: (path: SspPath) => Promise<readonly string[]>;
  readonly exportPreserved: () => void;
  /** Hängt eine Prozessentscheidung an den gespeicherten Stand; liefert den Fehlercode oder `undefined`. */
  readonly decideProcess: (input: ProcessDecisionInput) => Promise<string | undefined>;
  /** Legt eine Partei an oder aktualisiert sie nach einem Fehlversuch und speichert das SSP; `uuid` heißt gespeichert, `code` daneben meldet ein als Entwurf gespeichertes SSP. */
  readonly addDecisionParty: (party: DecisionParty) => Promise<{ readonly uuid?: string; readonly code?: string }>;
  /** Übernimmt einen neueren gespeicherten Stand nur ohne offene Eingaben. */
  readonly adopt: (document: WorkspaceEnvelope) => Promise<'adopted' | 'blocked' | 'failed'>;
}

function baselineHref(source: unknown): string | undefined {
  return readString(readSspValue(source, ['import-profile', 'href']));
}

/**
 * Wirkt eine ungespeicherte Baseline-Wahl auf den Arbeitsstand? Nur für den
 * aktuellen `href` und gegen genau den geladenen Speicherstand: Ein neueres
 * Speichern, etwa aus einem anderen Tab, überholt die Wahl, und seine Bindung gilt.
 */
function effectiveChoice(choice: PendingImportTarget | undefined, href: string | undefined, envelope: WorkspaceEnvelope | undefined): PendingImportTarget | undefined {
  return choice?.href === href && choice?.basis === envelope?.savedAt ? choice : undefined;
}

// Laufende Prozessentscheidungen je Dokument: Eine während des Schreibens neu geöffnete Station übernimmt deren Ergebnis,
// statt den vorher geladenen Stand weiter anzuzeigen oder zu exportieren.
const decisionWrites = new Map<LocalId, Promise<WorkspaceEnvelope | undefined>>();

/**
 * Arbeitsstand eines SSP: gezielte Patches, Autosave in den Entwurf und
 * explizites Speichern mit unveränderter Root-UUID. `export-ready` entsteht
 * nur mit bestandenem Schema und bestandener Referenzprüfung; die Baseline ist
 * eine Bindung am Pointer `import-profile.href`, nie ein aufgelöster Verweis.
 */
export function useSspEditor(localId: LocalId): SspEditor {
  const { documents, catalogDelivery, registerAutosave } = useWorkspace();
  const catalog = useCatalog();
  const categories = useMemo(() => sspCategoryContext(catalog), [catalog]);
  const pendingForms = useRef(new Set<string>());
  const [hasPendingForms, setHasPendingForms] = useState(false);
  const setTargetFormPending = useCallback((id: string, pending: boolean) => {
    if (pending) pendingForms.current.add(id);
    else pendingForms.current.delete(id);
    setHasPendingForms(pendingForms.current.size > 0);
  }, []);
  // Ungespeicherte Baseline-Wahl im Arbeitsspeicher des Tabs, wie die Importziele der Profile.
  const pending = documents.importTargets(localId);
  const hasPendingBindings = useCallback((current: unknown, envelope: WorkspaceEnvelope | undefined) =>
    pendingForms.current.size > 0 || effectiveChoice(pending.get(SSP_IMPORT_PROFILE_POINTER), baselineHref(current), envelope) !== undefined, [pending]);
  const core = useDocumentEditor<SspMessage>({ localId, rootType: 'system-security-plan', sameContent: sameSspContent, hasPendingBindings });
  const { working, stored, change, commit, latest, setMessage, exportWith } = core;
  // Nicht übernommene Bewertungseingaben liegen nur im Formular; der Bereichswechsel bleibt gesperrt, bis sie übernommen oder zurückgesetzt sind.
  useEffect(() => registerAutosave(async () => {
    if (pendingForms.current.size === 0) return { ok: true as const, value: undefined };
    setMessage('target-form-pending');
    return failure(new StorageFailure(UNSAVED_INPUT_CODE));
  }), [registerAutosave, setMessage]);
  const [pendingBaseline, setPendingBaseline] = useState<PendingImportTarget | undefined>(() => pending.get(SSP_IMPORT_PROFILE_POINTER));

  const href = baselineHref(working);
  // Dieselbe Klassifikation wie im Verbundgraphen: Ein externer Verweis nutzt nie eine Bindung.
  const baselineBindable = useMemo(() => sspBaselineBindable(working), [working]);
  const storedBaseline = stored.find((binding) => binding.pointer === SSP_IMPORT_PROFILE_POINTER && binding.href === href);
  const choice = effectiveChoice(pendingBaseline, href, core.envelope);
  const chosen = choice?.target ?? storedBaseline?.target;
  const baseline = baselineBindable ? chosen : undefined;
  const bindings = useMemo((): readonly WorkspaceBinding[] => baselineBindable ? [
    ...stored.filter((binding) => binding.pointer !== SSP_IMPORT_PROFILE_POINTER),
    ...(baseline && href !== undefined ? [{ fromLocalId: localId, pointer: SSP_IMPORT_PROFILE_POINTER, href, target: baseline }] : []),
  ] : stored, [baselineBindable, stored, baseline, href, localId]);

  const apply = useCallback((patch: (source: unknown) => unknown) => {
    if (latest.current.envelope && validateSspTargets(latest.current.envelope.source, categories)) {
      setMessage('target-invalid');
      return false;
    }
    let next: unknown;
    try {
      next = patch(latest.current.working);
    } catch (error) {
      setMessage(error instanceof SspPatchError && error.code === 'SSP_COMPONENT_REFERENCED' ? 'component-referenced' : 'patch-failed');
      return false;
    }
    change(() => next);
    return true;
  }, [categories, change, latest, setMessage]);

  const chooseBaseline = useCallback((target: BindingTarget, title: string) => {
    change((source) => setBaselineTitle(source, title));
    const current = baselineHref(latest.current.working);
    if (current === undefined) return;
    const choice = { href: current, target, basis: latest.current.envelope?.savedAt };
    pending.set(SSP_IMPORT_PROFILE_POINTER, choice);
    setPendingBaseline(choice);
  }, [change, latest, pending]);

  const commitSsp = useCallback(async (rebind: boolean) => {
    if (pendingForms.current.size) { setMessage('target-form-pending'); return { ok: false as const, code: UNSAVED_INPUT_CODE }; }
    const result = await commit(latest.current.working, async (storedSource, snapshot) => {
      const importedFailure = validateSspTargets(storedSource, categories);
      if (importedFailure) { setMessage('target-invalid'); return { ok: false, code: importedFailure.code }; }
      const processFailure = processProtectionFailure(deriveSspProcessProtection(snapshot));
      if (processFailure && !rebind) { setMessage('target-invalid'); return { ok: false, code: processFailure.code }; }
      const targets = sameSspContent(storedSource, snapshot) ? { ok: true as const, source: snapshot } : prepareSspTargets(snapshot, categories, { allowInvalidProcessDraft: rebind });
      if (!targets.ok) { setMessage('target-invalid'); return targets; }
      snapshot = targets.source;
      const blocker = sspSaveBlocker(snapshot);
      if (blocker) return { ok: false, code: blocker.code };
      // Schreibschutz aus dem gespeicherten Stand; eine Bindung an einen BSI-Katalog erhält das Paar des ausgelieferten Stands.
      const pinned = catalogPinsForSave({ source: storedSource, rootType: 'system-security-plan', bindings: stored }, snapshot, bindings, catalogDelivery, rebind);
      if (!pinned.ok) {
        setMessage('catalog-locked');
        return pinned;
      }
      const { source } = commitSspSave(storedSource, pinned.source, new Date().toISOString());
      const schema = await documents.checkProfileSchema(source);
      const ready = !processFailure && schema.status === 'passed' && sspReadinessBlocker(source) === undefined;
      return { ok: true, source, documentState: ready ? 'export-ready' : 'draft', bindings };
    }, (saved, savedAt) => {
      const written = saved.find((binding) => binding.pointer === SSP_IMPORT_PROFILE_POINTER);
      const open = pending.get(SSP_IMPORT_PROFILE_POINTER);
      if (!open) return;
      // Nur eine genau so gespeicherte Wahl entfällt; eine während des Speicherns geänderte bleibt offen und gilt dem neuen Stand.
      if (written?.href === open.href && written.target === open.target) {
        pending.delete(SSP_IMPORT_PROFILE_POINTER);
        setPendingBaseline(undefined);
      } else if (open.basis === latest.current.envelope?.savedAt) {
        const rebased = { ...open, basis: savedAt };
        pending.set(SSP_IMPORT_PROFILE_POINTER, rebased);
        setPendingBaseline(rebased);
      }
    });
    if (!result.ok && result.code === 'SSP_TARGET_DELETE_BLOCKED') setMessage('target-delete-blocked');
    else if (!result.ok && result.code === SSP_ADAPTER_DIAGNOSTIC_CODES.COMPONENT_REFERENCE_UNRESOLVED) setMessage('component-unresolved');
    else if (result.ok && result.documentState === 'draft') setMessage('saved-as-draft');
    return result;
  }, [bindings, categories, catalogDelivery, commit, documents, latest, pending, setMessage, stored]);

  const save = useCallback(async () => { await commitSsp(false); }, [commitSsp]);
  // Ein offener Entwurf wird dabei mitgespeichert: Er ist sonst unter der Sperre nicht mehr zu sichern.
  const bindCatalogStand = useCallback(async () => { await commitSsp(true); }, [commitSsp]);

  // Eine ungespeicherte Baseline-Wahl ist eine offene Änderung, auch wenn die Quelle gleich bleibt.
  const dirty = core.dirty || choice !== undefined || hasPendingForms;
  // Nach erfolgreicher Löschung gibt es keine Eingaben mehr zu schützen; bei einem Fehler bleibt die Sperre bestehen.
  const { remove: removeDocument } = core;
  const remove = useCallback(async () => {
    const removed = await removeDocument();
    if (removed) { pendingForms.current.clear(); setHasPendingForms(false); }
    return removed;
  }, [removeDocument]);
  const exportDocument = useCallback(async () => { if (!dirty) await exportWith(document => exportSspInWorker(document, categories), 'ssp.json'); }, [categories, dirty, exportWith]);

  const checkTargetRemoval = useCallback(async (path: SspPath): Promise<readonly string[]> => {
    const bindings = await documents.listBindings();
    if (!bindings.ok) return ['Verwendung nicht vollständig prüfbar'];
    const ids = [...new Set(bindings.value.map(binding => binding.fromLocalId))];
    const members: WorkspaceEnvelope[] = [];
    for (const id of ids) {
      const member = await documents.getDocument(id);
      if (!member.ok || !member.value) return ['Verwendung nicht vollständig prüfbar'];
      members.push(member.value);
    }
    return targetDeletionUses(latest.current.working, path, localId, members, bindings.value);
  }, [documents, latest, localId]);
  const { adopt } = core;
  const pendingDecision = useMemo(() => decisionWrites.get(localId), [localId]);
  useEffect(() => {
    if (core.status !== 'ready' || !pendingDecision) return;
    void pendingDecision.then(document => { if (document) void adopt(document); });
  }, [adopt, core.status, pendingDecision]);
  const decideProcess = useCallback(async (input: ProcessDecisionInput) => {
    const { envelope, draftSavedAt, working: current, unsaved } = latest.current;
    // Offene Eingaben gehören nicht zum gebundenen Stand; die Entscheidung schreibt dann nichts.
    if (!envelope || unsaved || hasPendingBindings(current, envelope) || !sameSspContent(envelope.source, current)) return 'SSP_PROCESS_DECISION_BLOCKED';
    const write = documents.saveProcessDecision(localId, envelope.savedAt, draftSavedAt, input, categories);
    const written = write.then(result => result.ok ? result.value : undefined, () => undefined);
    decisionWrites.set(localId, written);
    void written.then(() => { if (decisionWrites.get(localId) === written) decisionWrites.delete(localId); });
    const result = await write;
    if (!result.ok) return result.diagnostic.code;
    // Die Entscheidung ist geschrieben; offene Eingaben verhindern nur die Anzeige des neuen Stands.
    const adopted = await adopt(result.value);
    if (adopted === 'adopted') return undefined;
    return adopted === 'blocked' ? 'SSP_PROCESS_DECISION_NOT_SHOWN' : 'SSP_PROCESS_DECISION_NOT_ADOPTED';
  }, [adopt, categories, documents, hasPendingBindings, latest, localId]);
  const addDecisionParty = useCallback(async ({ uuid, type, name }: DecisionParty) => {
    const path = ['metadata', 'parties'];
    // Ein erneuter Versuch nach einem Fehler aktualisiert dieselbe Partei, statt sie zu verdoppeln.
    const index = readArray(readSspValue(latest.current.working, path)).findIndex(item => isJsonObject(item) && item.uuid === uuid);
    const added = apply(source => index < 0
      ? addSspItem(source, path, { uuid, type, name })
      : setSspValue(setSspValue(source, [...path, index, 'type'], type), [...path, index, 'name'], name));
    if (!added) return { code: 'SSP_PARTY_NOT_ADDED' };
    const result = await commitSsp(false);
    if (!result.ok) return { code: result.code };
    // Die Partei ist gespeichert; eine Entscheidung braucht zusätzlich einen technisch gültigen gespeicherten Stand.
    return result.documentState === 'draft' ? { uuid, code: 'SSP_PARTY_SAVED_AS_DRAFT' } : { uuid };
  }, [apply, commitSsp, latest]);
  const targetFailure = core.envelope ? validateSspTargets(core.envelope.source, categories) : undefined;
  const exportPreserved = useCallback(() => {
    if (latest.current.envelope) downloadBlob(new Blob([serializeWorkspaceJson(latest.current.envelope.source)], { type: 'application/json' }), 'ssp-ungeprueft.json');
  }, [latest]);

  return {
    localId, categories, targetFailure, checkTargetRemoval, exportPreserved, hasPendingTargetForms: hasPendingForms, setTargetFormPending,
    status: core.status, envelope: core.envelope, working, dirty, saveState: core.saveState, busy: core.busy, message: core.message,
    baseline, baselineBindable, apply, chooseBaseline, save, bindCatalogStand, exportDocument, remove, adopt, decideProcess, addDecisionParty,
  };
}
