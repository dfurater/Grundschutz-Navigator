import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleProfileWorkbenchRequest } from '@/workers/profileWorkbenchRequests';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

const handle = vi.hoisted(() => vi.fn());

describe('Worker der Profile-Station', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.resetModules(); vi.doUnmock('@/workers/profileWorkbenchRequests'); handle.mockReset(); });

  async function setup() {
    vi.doMock('@/workers/profileWorkbenchRequests', () => ({ handleProfileWorkbenchRequest: handle }));
    let receive: (event: { data: unknown; origin: string }) => void = () => { };
    const postMessage = vi.fn();
    vi.stubGlobal('addEventListener', (_: string, listener: typeof receive) => { receive = listener; });
    vi.stubGlobal('postMessage', postMessage);
    await import('@/workers/profileWorkbench.worker');
    return { receive, postMessage };
  }

  it('beantwortet genau eine Anfrage und danach nur noch mit failure', async () => {
    handle.mockResolvedValue({ type: 'analysis', analysis: {} });
    const { receive, postMessage } = await setup();
    receive({ data: { type: 'analyze', snapshot: {} }, origin: globalThis.location.origin });
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith({ type: 'analysis', analysis: {} }));
    receive({ data: { type: 'analyze', snapshot: {} }, origin: '' });
    expect(postMessage.mock.lastCall?.[0]).toEqual({ type: 'failure' });
    expect(handle).toHaveBeenCalledOnce();
  });

  it('liest bei fremdem Origin keine Daten und meldet eine Ausnahme als failure', async () => {
    const foreign = await setup();
    const readData = vi.fn(() => ({ type: 'analyze' }));
    foreign.receive({ origin: 'https://foreign.example', get data() { return readData(); } });
    expect(foreign.postMessage).toHaveBeenCalledExactlyOnceWith({ type: 'failure' });
    expect(readData).not.toHaveBeenCalled();

    vi.resetModules();
    handle.mockRejectedValue(new Error('intern'));
    const failing = await setup();
    failing.receive({ data: { type: 'view', snapshot: {} }, origin: '' });
    await vi.waitFor(() => expect(failing.postMessage).toHaveBeenCalledWith({ type: 'failure' }));
  });
});

describe('Anfragen des Workers', () => {
  it('leitet Verbundansicht und Export ab und weist Unbekanntes ab', async () => {
    const verbund = { verbundId: 'v', name: 'V', createdAt: 'x', savedAt: 'x' };
    const view = await handleProfileWorkbenchRequest({ type: 'view', snapshot: { verbund, members: [], bindings: [], class1Artifacts: [] } });
    expect(view).toMatchObject({ type: 'view', view: { verbund, documents: [], diagnostics: [] } });
    const exported = await handleProfileWorkbenchRequest({ type: 'export', document: { documentState: 'draft', rootType: 'profile', source: makeSchemaValidOscalDocument('profile', '1.1.3') } });
    expect(exported).toEqual({ type: 'exported', result: { ok: false, code: 'OSCAL_EXPORT_NOT_READY', path: '/' } });
    expect(await handleProfileWorkbenchRequest({ type: 'lesen' })).toEqual({ type: 'failure' });
    expect(await handleProfileWorkbenchRequest(null)).toEqual({ type: 'failure' });
  });
});
