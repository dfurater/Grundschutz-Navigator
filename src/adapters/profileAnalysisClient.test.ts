import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProfileAnalysisClient } from '@/adapters/profileAnalysisClient';
import { PROFILE_WORKBENCH_TIMEOUT_MS } from '@/adapters/profileWorkbench';
import { FakeWorker } from '@/test/fakeWorker';
import type { ProfileAnalysisBasis, ProfileAnalysisInput } from '@/state/workspaceProfileAnalysis';
import { deriveProfileAnalysis, withProfileAnalysisInput } from '@/state/workspaceProfileAnalysis';

const BASIS: ProfileAnalysisBasis = { members: [], bindings: [], class1Artifacts: [], delivery: new Map() };
const INPUT = { localId: 'p', verbundId: 'v', source: {}, bindings: [] } as unknown as ProfileAnalysisInput;
const ANALYSIS = { schema: { status: 'passed' }, hints: [], imports: [], targets: new Map(), resolution: { status: 'not-evaluable' } };

function workers(reply = true) {
  const created: FakeWorker[] = [];
  vi.stubGlobal('Worker', vi.fn(function create() {
    const worker = new FakeWorker((self, message) => {
      const { requestId } = message as { requestId: number };
      if (reply) self.emitMessage({ type: 'analysis', requestId, analysis: ANALYSIS });
    });
    created.push(worker);
    return worker;
  }));
  return created;
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Wiederverwendbarer Profilanalyse-Client', () => {
  it('liefert ohne Worker dieselbe Ableitung und verwirft abgebrochene Ergebnisse', async () => {
    vi.stubGlobal('Worker', undefined);
    const client = createProfileAnalysisClient();
    expect(await client.analyze(BASIS, INPUT)).toEqual(await deriveProfileAnalysis(withProfileAnalysisInput(BASIS, INPUT)));
    const controller = new AbortController();
    const pending = client.analyze(BASIS, INPUT, controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    client.dispose();
  });

  it.each([null, {}, { requestId: 2, type: 'analysis', analysis: ANALYSIS }])('weist ungültige Antwortframes ab: %j', async (frame) => {
    const created = workers(false);
    const client = createProfileAnalysisClient();
    const pending = client.analyze(BASIS, INPUT);
    created[0].emitMessage(frame);
    expect(await pending).toBeNull();
    expect(created[0].terminate).toHaveBeenCalledOnce();
    client.dispose();
  });

  it('verwendet einen Worker und überträgt die Basis einmal je Generation', async () => {
    const created = workers();
    const client = createProfileAnalysisClient();
    expect(await client.analyze(BASIS, INPUT)).toEqual(ANALYSIS);
    expect(await client.analyze(BASIS, { ...INPUT, source: { changed: true } })).toEqual(ANALYSIS);
    expect(created).toHaveLength(1);
    const requests = created[0].postMessage.mock.calls.map(([message]) => message);
    expect(requests[0]).toMatchObject({ type: 'analyze-session', basis: BASIS, input: INPUT });
    expect(requests[1]).not.toHaveProperty('basis');
    expect(created[0].terminate).not.toHaveBeenCalled();
    await client.analyze({ ...BASIS }, INPUT);
    expect(created[0].postMessage.mock.lastCall?.[0]).toHaveProperty('basis');
    client.dispose();
    expect(created[0].terminate).toHaveBeenCalledOnce();
  });

  it('bricht sofort ab, ignoriert alte Antworten und überträgt die Basis an den Ersatz', async () => {
    const created = workers(false);
    const client = createProfileAnalysisClient();
    const controller = new AbortController();
    const first = client.analyze(BASIS, INPUT, controller.signal);
    controller.abort();
    expect(await first).toBeNull();
    expect(created[0].terminate).toHaveBeenCalledOnce();
    const second = client.analyze(BASIS, INPUT);
    expect(created).toHaveLength(2);
    const request = created[1].postMessage.mock.lastCall?.[0] as { requestId: number };
    expect(request).toHaveProperty('basis', BASIS);
    created[0].emitMessage({ type: 'analysis', requestId: request.requestId, analysis: ANALYSIS });
    created[1].emitMessage({ type: 'analysis', requestId: request.requestId - 1, analysis: ANALYSIS });
    created[1].emitMessage({ type: 'analysis', requestId: request.requestId, analysis: ANALYSIS });
    expect(await second).toEqual(ANALYSIS);
    client.dispose();
  });

  it('beendet eine überholte Anfrage vor dem nächsten Start und schließt offene Anfragen beim Dispose', async () => {
    const created = workers(false);
    const client = createProfileAnalysisClient();
    const first = client.analyze(BASIS, INPUT);
    const second = client.analyze(BASIS, INPUT);
    expect(await first).toBeNull();
    expect(created[0].terminate).toHaveBeenCalledOnce();
    client.dispose();
    expect(await second).toBeNull();
    expect(created[1].terminate).toHaveBeenCalledOnce();
    expect(created[1].removeEventListener).toHaveBeenCalledTimes(3);
  });

  it.each(['error', 'messageerror', 'invalid', 'failure', 'postMessage', 'timeout'])('endet bei %s fail-closed und erholt sich bei einer neuen Anfrage', async (failure) => {
    vi.useFakeTimers();
    const created = workers(false);
    const client = createProfileAnalysisClient();
    const first = client.analyze(BASIS, INPUT);
    const request = created[0].postMessage.mock.lastCall?.[0] as { requestId: number };
    if (failure === 'timeout') await vi.advanceTimersByTimeAsync(PROFILE_WORKBENCH_TIMEOUT_MS);
    else if (failure === 'invalid') created[0].emitMessage({ type: 'analysis', requestId: request.requestId, analysis: {} });
    else if (failure === 'failure') created[0].emitMessage({ type: 'failure', requestId: request.requestId });
    else if (failure === 'postMessage') {
      created[0].emitMessage({ type: 'analysis', requestId: request.requestId, analysis: ANALYSIS });
      await first;
      created[0].postMessage.mockImplementationOnce(() => { throw new Error('private'); });
      expect(await client.analyze(BASIS, INPUT)).toBeNull();
    } else created[0].emitEvent(failure);
    if (failure !== 'postMessage') expect(await first).toBeNull();
    expect(created[0].terminate).toHaveBeenCalledOnce();
    const next = client.analyze(BASIS, INPUT);
    expect(created).toHaveLength(2);
    client.dispose();
    expect(await next).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('startet bei vorherigem Abbruch keinen Worker; ein Startfehler bleibt ein Ausfall', async () => {
    const created = workers();
    const client = createProfileAnalysisClient();
    expect(await client.analyze(BASIS, INPUT, AbortSignal.abort())).toBeNull();
    expect(created).toHaveLength(0);
    vi.stubGlobal('Worker', vi.fn(function fail() { throw new Error('private'); }));
    expect(await client.analyze(BASIS, INPUT)).toBeNull();
    client.dispose();
  });
});
