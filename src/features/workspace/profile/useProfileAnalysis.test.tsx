import { act, renderHook } from '@testing-library/react';
import { StrictMode, useEffect, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileAnalysis, PROFILE_ANALYSIS_DELAY_MS } from '@/features/workspace/profile/useProfileAnalysis';
import { useBaselineControls } from '@/features/workspace/ssp/useBaselineControls';
import { useWorkspace } from '@/hooks/useWorkspace';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { CatalogContext } from '@/state/CatalogContext';
import { EMPTY_CATALOG_STATE, withLoadedCatalog } from '@/test/renderWorkspaceArea';
import { FakeWorker } from '@/test/fakeWorker';
import { fakePort, ok } from '@/test/fakeWorkspacePort';
import { member } from '@/test/fixtures/workspaceGraph';
import type { LocalId, VerbundId, WorkspaceBinding } from '@/domain/workspaceModel';

const PROFILE = member('profile', 'p');
const ANALYSIS = { schema: { status: 'passed' }, hints: [], imports: [], targets: new Map(), resolution: { status: 'not-evaluable' } };

function setup(strict = false, withBaseline = false) {
  const workers: FakeWorker[] = [];
  let reply = true;
  vi.stubGlobal('Worker', vi.fn(function create() {
    const worker = new FakeWorker((self, data) => {
      if (reply) self.emitMessage({ type: 'analysis', requestId: (data as { requestId: number }).requestId, analysis: ANALYSIS });
    });
    workers.push(worker);
    return worker;
  }));
  const listDocuments = vi.fn(() => ok([PROFILE]));
  const port = fakePort({ listDocuments, getDocument: () => ok(PROFILE), autosaveDraft: () => ok(undefined) as never, saveDocument: () => ok(PROFILE), deleteDocument: () => ok(undefined) });
  let catalogs = EMPTY_CATALOG_STATE;
  const wrapper = ({ children }: { children: ReactNode }) => {
    const content = <CatalogContext.Provider value={catalogs}><WorkspaceProvider open={() => ok(port)}>{children}</WorkspaceProvider></CatalogContext.Provider>;
    return strict ? <StrictMode>{content}</StrictMode> : content;
  };
  const bindings: readonly WorkspaceBinding[] = [];
  const target = withBaseline ? { kind: 'local' as const, localId: PROFILE.localId } : undefined;
  const hook = renderHook(({ source, localId, verbundId }: { source: unknown; localId: LocalId; verbundId: VerbundId }) => {
    const workspace = useWorkspace();
    useEffect(() => workspace.activate(), [workspace.activate]);
    useBaselineControls(verbundId, target, undefined);
    return { ...useProfileAnalysis(verbundId, localId, source, bindings), workspace };
  }, { wrapper, initialProps: { source: PROFILE.source, localId: PROFILE.localId, verbundId: PROFILE.verbundId } });
  const tick = async () => {
    await act(async () => { await vi.dynamicImportSettled(); });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PROFILE_ANALYSIS_DELAY_MS);
      await vi.dynamicImportSettled();
    });
  };
  return { ...hook, tick, workers, listDocuments, port, silence: () => { reply = false; }, changeCatalogs: () => { catalogs = withLoadedCatalog(true); } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Lebenszyklus der Profilanalyse', () => {
  it('lässt bei Autosave und Reload den Dokumentzugang und die unabhängige SSP-Baselineanalyse stabil', async () => {
    const hook = setup(false, true);
    await hook.tick();
    const documents = hook.result.current.workspace.documents;
    const baselineRequests = () => hook.workers.flatMap((worker) => worker.postMessage.mock.calls)
      .filter(([message]) => (message as { type: string }).type === 'analyze');
    expect(baselineRequests()).toHaveLength(1);
    await act(async () => { await documents.autosaveDraft(PROFILE.localId, PROFILE.savedAt, null, {}); });
    await hook.tick();
    expect(hook.result.current.workspace.documents).toBe(documents);
    expect(baselineRequests()).toHaveLength(1);
    act(() => hook.result.current.workspace.reload());
    await hook.tick();
    expect(hook.result.current.workspace.documents).toBe(documents);
    expect(baselineRequests()).toHaveLength(1);
    hook.unmount();
  });

  it('verwendet in StrictMode den untätigen Worker und die gelesene Basis erneut', async () => {
    const hook = setup(true);
    await hook.tick();
    expect(hook.result.current.current).toBe(true);
    hook.rerender({ source: {}, localId: PROFILE.localId, verbundId: PROFILE.verbundId });
    expect(hook.result.current.current).toBe(false);
    await hook.tick();
    expect(hook.workers).toHaveLength(1);
    expect(hook.listDocuments).toHaveBeenCalledOnce();
    expect(hook.workers[0].postMessage.mock.calls[1][0]).not.toHaveProperty('basis');
    hook.unmount();
    expect(hook.workers[0].terminate).toHaveBeenCalledOnce();
  });

  it('beendet laufende Berechnung vor dem nächsten Debounce und übernimmt kein altes Ergebnis', async () => {
    const hook = setup();
    hook.silence();
    await hook.tick();
    hook.rerender({ source: {}, localId: PROFILE.localId, verbundId: PROFILE.verbundId });
    expect(hook.workers[0].terminate).toHaveBeenCalledOnce();
    expect(hook.workers).toHaveLength(1);
    expect(hook.result.current.failed).toBe(false);
    await hook.tick();
    expect(hook.workers).toHaveLength(2);
    const request = hook.workers[1].postMessage.mock.lastCall?.[0] as { requestId: number };
    await act(async () => {
      hook.workers[0].emitMessage({ type: 'analysis', requestId: 1, analysis: ANALYSIS });
      hook.workers[1].emitMessage({ type: 'analysis', requestId: request.requestId, analysis: ANALYSIS });
    });
    expect(hook.result.current.current).toBe(true);
    expect(hook.listDocuments).toHaveBeenCalledOnce();
    hook.unmount();
  });

  it('erhält bei Autosave Ergebnis, Analyseversion und Basis ohne weitere Anfrage', async () => {
    const hook = setup();
    await hook.tick();
    const documents = hook.result.current.workspace.documents;
    const version = documents.analysisVersion();
    const analysis = hook.result.current.analysis;
    await act(async () => { await documents.autosaveDraft(PROFILE.localId, PROFILE.savedAt, null, {}); });
    expect(hook.result.current.current).toBe(true);
    expect(documents.analysisVersion()).toBe(version);
    expect(hook.result.current.analysis).toBe(analysis);
    await hook.tick();
    expect(hook.listDocuments).toHaveBeenCalledOnce();
    expect(hook.workers).toHaveLength(1);
    expect(hook.workers[0].postMessage).toHaveBeenCalledOnce();
    expect(hook.workers[0].terminate).not.toHaveBeenCalled();
    hook.rerender({ source: {}, localId: PROFILE.localId, verbundId: PROFILE.verbundId });
    await hook.tick();
    expect(hook.listDocuments).toHaveBeenCalledOnce();
    expect(hook.workers[0].postMessage.mock.calls[1][0]).not.toHaveProperty('basis');
    hook.unmount();
  });

  it('lässt eine beim Autosave laufende Analyse ohne Abbruch oder Ersatz fertig werden', async () => {
    const hook = setup();
    hook.silence();
    await hook.tick();
    await act(async () => { await hook.result.current.workspace.documents.autosaveDraft(PROFILE.localId, PROFILE.savedAt, null, {}); });
    expect(hook.workers[0].terminate).not.toHaveBeenCalled();
    await hook.tick();
    expect(hook.listDocuments).toHaveBeenCalledOnce();
    expect(hook.workers).toHaveLength(1);
    expect(hook.workers[0].postMessage).toHaveBeenCalledOnce();
    const request = hook.workers[0].postMessage.mock.calls[0][0] as { requestId: number };
    await act(async () => { hook.workers[0].emitMessage({ type: 'analysis', requestId: request.requestId, analysis: ANALYSIS }); });
    expect(hook.result.current.current).toBe(true);
    expect(hook.result.current.failed).toBe(false);
    hook.unmount();
  });

  it('invalidiert nach Speichern, Dokumentlöschung, Reload und Katalogwechsel', async () => {
    const hook = setup();
    await hook.tick();
    const originalDocuments = hook.result.current.workspace.documents;
    const version = originalDocuments.analysisVersion();
    await act(async () => { await originalDocuments.saveDocument(PROFILE.localId, PROFILE.savedAt, null, {} as never); });
    expect(hook.result.current.current).toBe(false);
    expect(hook.result.current.workspace.documents.analysisVersion()).toBe(version + 1);
    await hook.tick();
    expect(hook.listDocuments).toHaveBeenCalledTimes(2);
    await act(async () => { await hook.result.current.workspace.documents.deleteDocument(PROFILE.localId); });
    await hook.tick();
    expect(hook.listDocuments).toHaveBeenCalledTimes(3);
    act(() => hook.result.current.workspace.reload());
    expect(hook.result.current.current).toBe(false);
    await hook.tick();
    expect(hook.listDocuments).toHaveBeenCalledTimes(4);
    hook.changeCatalogs();
    hook.rerender({ source: PROFILE.source, localId: PROFILE.localId, verbundId: PROFILE.verbundId });
    await hook.tick();
    expect(hook.listDocuments).toHaveBeenCalledTimes(5);
    hook.unmount();
  });

  it('gibt auch einen untätigen Worker beim Dokument- und Verbundwechsel frei', async () => {
    const hook = setup();
    await hook.tick();
    hook.rerender({ source: PROFILE.source, localId: 'other' as LocalId, verbundId: PROFILE.verbundId });
    expect(hook.workers[0].terminate).toHaveBeenCalledOnce();
    expect(hook.result.current.current).toBe(false);
    await hook.tick();
    hook.rerender({ source: PROFILE.source, localId: 'other' as LocalId, verbundId: 'new' as VerbundId });
    expect(hook.workers[1].terminate).toHaveBeenCalledOnce();
    hook.unmount();
    await hook.tick();
    expect(hook.workers).toHaveLength(2);
  });
});
