import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeProfileInWorker, deriveVerbundViewInWorker, exportProfileInWorker, PROFILE_WORKBENCH_TIMEOUT_MS } from '@/adapters/profileWorkbench';
import { FakeWorker, installWorker } from '@/test/fakeWorker';
import type { ProfileAnalysisSnapshot } from '@/state/workspaceProfileAnalysis';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const SNAPSHOT = { localId: 'l', source: {}, members: [], bindings: [], class1Artifacts: [] } as unknown as ProfileAnalysisSnapshot;
const DOCUMENT = { documentState: 'export-ready' as const, rootType: 'profile', source: { profile: {} } };

describe('Worker-Client der Profile-Station', () => {
  it('übergibt Schnappschuss und Exportquelle und beendet den Worker nach der Antwort', async () => {
    const analysis = { schema: { status: 'passed' } };
    const worker = new FakeWorker((self, message) => {
      const request = message as { type: string };
      self.emitMessage(request.type === 'analyze' ? { type: 'analysis', analysis } : { type: 'exported', result: { ok: true, json: '{}' } });
    });
    installWorker(worker);
    expect(await analyzeProfileInWorker(SNAPSHOT)).toEqual(analysis);
    expect(await exportProfileInWorker({ ...DOCUMENT, localId: 'nicht übertragen' } as never)).toEqual({ ok: true, json: '{}' });
    expect(worker.postMessage.mock.calls[1][0]).toEqual({ type: 'export', document: DOCUMENT });
    expect(worker.terminate).toHaveBeenCalledTimes(2);
  });

  it('endet bei Fehler, unbekanntem Frame und Fristablauf fail-closed', async () => {
    const failing = new FakeWorker((self) => self.emitEvent('error'));
    installWorker(failing);
    expect(await analyzeProfileInWorker(SNAPSHOT)).toBeNull();
    installWorker(new FakeWorker((self) => self.emitMessage({ type: 'unbekannt' })));
    expect(await exportProfileInWorker(DOCUMENT)).toEqual({ ok: false, code: 'OSCAL_EXPORT_WORKER_FAILURE', path: '/' });
    vi.useFakeTimers();
    const silent = new FakeWorker();
    installWorker(silent);
    const pending = analyzeProfileInWorker(SNAPSHOT);
    await vi.advanceTimersByTimeAsync(PROFILE_WORKBENCH_TIMEOUT_MS);
    expect(await pending).toBeNull();
    expect(silent.terminate).toHaveBeenCalledOnce();
  });

  it('leitet ohne Worker-API im Prozess ab', async () => {
    vi.stubGlobal('Worker', undefined);
    const verbund = { verbundId: 'v', name: 'V', createdAt: 'x', savedAt: 'x' };
    expect(await deriveVerbundViewInWorker({ verbund, members: [], bindings: [], class1Artifacts: [] } as never)).toMatchObject({ verbund, documents: [] });
  });

  it('meldet einen nicht startbaren Worker als Ausfall', async () => {
    vi.stubGlobal('Worker', vi.fn(function fail() { throw new Error('blockiert'); }));
    expect(await analyzeProfileInWorker(SNAPSHOT)).toBeNull();
  });
});
