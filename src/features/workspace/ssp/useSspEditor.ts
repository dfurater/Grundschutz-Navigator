import { useCallback, useMemo, useState } from 'react';
import { exportSspInWorker } from '@/adapters/sspWorkbench';
import { readString } from '@/domain/jsonGuards';
import { SSP_ADAPTER_DIAGNOSTIC_CODES } from '@/adapters/oscalSspReaders';
import { readSspValue, setBaselineTitle, sspBaselineBindable, SspPatchError, SSP_IMPORT_PROFILE_POINTER } from '@/domain/sspAuthoring';
import { catalogPinsForSave } from '@/domain/workspaceCatalogPin';
import { commitSspSave, sameSspContent, sspReadinessBlocker, sspSaveBlocker } from '@/domain/sspSave';
import type { BindingTarget, LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { useDocumentEditor, type DocumentEditorCoreMessage, type DocumentSaveState } from '@/features/workspace/useDocumentEditor';
import type { PendingImportTarget } from '@/state/workspaceDocuments';

type SspMessage = 'saved-as-draft' | 'component-unresolved' | 'component-referenced' | 'patch-failed' | 'catalog-locked';

export type SspEditorMessage = DocumentEditorCoreMessage | SspMessage;

export interface SspEditor {
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

/**
 * Arbeitsstand eines SSP: gezielte Patches, Autosave in den Entwurf und
 * explizites Speichern mit unveränderter Root-UUID. `export-ready` entsteht
 * nur mit bestandenem Schema und bestandener Referenzprüfung; die Baseline ist
 * eine Bindung am Pointer `import-profile.href`, nie ein aufgelöster Verweis.
 */
export function useSspEditor(localId: LocalId): SspEditor {
  const { documents, catalogDelivery } = useWorkspace();
  // Ungespeicherte Baseline-Wahl im Arbeitsspeicher des Tabs, wie die Importziele der Profile.
  const pending = documents.importTargets(localId);
  const hasPendingBindings = useCallback((current: unknown, envelope: WorkspaceEnvelope | undefined) =>
    effectiveChoice(pending.get(SSP_IMPORT_PROFILE_POINTER), baselineHref(current), envelope) !== undefined, [pending]);
  const core = useDocumentEditor<SspMessage>({ localId, rootType: 'system-security-plan', sameContent: sameSspContent, hasPendingBindings });
  const { working, stored, change, commit, latest, setMessage, exportWith } = core;
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
    let next: unknown;
    try {
      next = patch(latest.current.working);
    } catch (error) {
      setMessage(error instanceof SspPatchError && error.code === 'SSP_COMPONENT_REFERENCED' ? 'component-referenced' : 'patch-failed');
      return false;
    }
    change(() => next);
    return true;
  }, [change, latest, setMessage]);

  const chooseBaseline = useCallback((target: BindingTarget, title: string) => {
    change((source) => setBaselineTitle(source, title));
    const current = baselineHref(latest.current.working);
    if (current === undefined) return;
    const choice = { href: current, target, basis: latest.current.envelope?.savedAt };
    pending.set(SSP_IMPORT_PROFILE_POINTER, choice);
    setPendingBaseline(choice);
  }, [change, latest, pending]);

  const commitSsp = useCallback(async (rebind: boolean) => {
    const result = await commit(latest.current.working, async (storedSource, snapshot) => {
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
      const ready = schema.status === 'passed' && sspReadinessBlocker(source) === undefined;
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
    if (!result.ok && result.code === SSP_ADAPTER_DIAGNOSTIC_CODES.COMPONENT_REFERENCE_UNRESOLVED) setMessage('component-unresolved');
    else if (result.ok && result.documentState === 'draft') setMessage('saved-as-draft');
  }, [bindings, catalogDelivery, commit, documents, latest, pending, setMessage, stored]);

  const save = useCallback(() => commitSsp(false), [commitSsp]);
  // Ein offener Entwurf wird dabei mitgespeichert: Er ist sonst unter der Sperre nicht mehr zu sichern.
  const bindCatalogStand = useCallback(() => commitSsp(true), [commitSsp]);

  // Eine ungespeicherte Baseline-Wahl ist eine offene Änderung, auch wenn die Quelle gleich bleibt.
  const dirty = core.dirty || choice !== undefined;
  const exportDocument = useCallback(async () => { if (!dirty) await exportWith(exportSspInWorker, 'ssp.json'); }, [dirty, exportWith]);

  return {
    status: core.status, envelope: core.envelope, working, dirty, saveState: core.saveState, busy: core.busy, message: core.message,
    baseline, baselineBindable, apply, chooseBaseline, save, bindCatalogStand, exportDocument, remove: core.remove, adopt: core.adopt,
  };
}
