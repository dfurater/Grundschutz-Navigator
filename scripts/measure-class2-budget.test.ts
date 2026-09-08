import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocked = vi.hoisted(() => ({ createServer: vi.fn(), launch: vi.fn(), render: vi.fn(() => ''), build: vi.fn() }));
vi.mock('vite', () => ({ createServer: mocked.createServer }));
vi.mock('playwright', () => ({ chromium: { launch: mocked.launch } }));
vi.mock('node:child_process', async (original) => ({ ...await original<typeof import('node:child_process')>(), execFileSync: (_cmd: string, args: string[]) => args[0] === 'ls-files' ? 'src/fake.ts\0' : 'a'.repeat(40) }));
vi.mock('node:fs', async (original) => ({ ...await original<typeof import('node:fs')>(), readFileSync: () => 'source', writeFileSync: vi.fn() }));
vi.mock('./measureClass2Timing.mjs', async (original) => ({ ...await original<typeof import('./measureClass2Timing.mjs')>(), buildTimingInput: mocked.build }));
vi.mock('./measureClass2BudgetReport.mjs', async (original) => ({
  ...await original<typeof import('./measureClass2BudgetReport.mjs')>(),
  parseArguments: () => ({ throttleRates: [4], repeat: 1, scaleNodes: null, skipGlob: true, jsonPath: null }),
  summarizeSamples: (samples: unknown[]) => samples[0], renderReport: mocked.render,
}));

type Route = { abort: ReturnType<typeof vi.fn>; fulfill: ReturnType<typeof vi.fn> };
type RouteHandler = (route: Route) => Promise<unknown>;
let calls: string[];
let contexts: ReturnType<typeof makeContext>[];
let routes: Route[];
const route = (): Route => ({ abort: vi.fn(), fulfill: vi.fn() });

function makeContext(name: string) {
  let handler: RouteHandler;
  const harness = new Proxy({}, { get: (_target, key: string) => async () => {
    calls.push(`${name}:${key}`);
    if (key === 'prepareBytes') {
      const request = route(); routes.push(request); await handler(request);
    }
    if (key === 'environment') return { userAgent: name };
    if (key === 'usedBytes') return 100;
    if (key === 'prepare' || key === 'prepareBytes') return { bytes: 3 };
    if (key === 'assertLongTaskObservability') return { probeMs: 120, observedMs: 120 };
    if (key === 'assertMemoryObservability') return { probeBytes: 100, observedBytes: 100 };
    return { ok: true, code: null, ms: 1, longTasks: [], submitMs: 1, blockingMs: 0, longestTaskMs: 0 };
  } });
  const page = {
    on: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn(),
    route: vi.fn(async (_url: string, callback: RouteHandler) => { handler = callback; const request = route(); routes.push(request); await callback(request); }),
    evaluate: vi.fn(async (fn: (args: unknown) => unknown, args?: unknown) => {
      vi.stubGlobal('__gspp382', harness); return fn(args);
    }),
  };
  const session = { send: vi.fn() };
  return { name, page, session, newPage: vi.fn(async () => page), newCDPSession: vi.fn(async () => session), close: vi.fn(), checkUnset: async () => { const request = route(); await handler(request); return request; } };
}

let browser: { newContext: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; version: () => string };
let server: { listen: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; resolvedUrls: { local: string[] } };

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); calls = []; routes = []; contexts = [];
  mocked.build.mockReturnValue({ bytes: new Uint8Array([1, 2, 3]), metadata: { bytes: 3 } });
  browser = { newContext: vi.fn(async () => { const context = makeContext(contexts.length === 0 ? 'direct' : 'worker'); contexts.push(context); return context; }), close: vi.fn(), version: () => 'test' };
  server = { listen: vi.fn(), close: vi.fn(), resolvedUrls: { local: ['http://localhost:1234/'] } };
  mocked.launch.mockResolvedValue(browser); mocked.createServer.mockResolvedValue(server);
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('measurement driver isolation', () => {
  it('uses separate contexts, binary routes and the worker observation surface', async () => {
    await import('./measure-class2-budget.mjs');
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(calls).toContain('worker:assertLongTaskObservability');
    expect(calls).not.toContain('worker:stage1');
    expect(calls).not.toContain('worker:objectChain');
    expect(calls).not.toContain('worker:prepare');
    expect(calls).not.toContain('worker:warmUp');
    expect(calls.indexOf('worker:endToEnd')).toBeLessThan(calls.indexOf('direct:stage1'));
    expect(mocked.render.mock.calls[0][0].runs[0].environment.userAgent).toBe('worker');
    for (const context of contexts) {
      expect(context.session.send).toHaveBeenCalledWith('Emulation.setCPUThrottlingRate', { rate: 4 });
      expect(context.close).toHaveBeenCalledOnce();
      expect((await context.checkUnset()).abort).toHaveBeenCalledOnce();
    }
    expect(routes.slice(0, 2).every((request) => request.abort.mock.calls.length === 1)).toBe(true);
    for (const request of routes.slice(2)) expect(request.fulfill).toHaveBeenCalledWith({ status: 200, contentType: 'application/octet-stream', body: Buffer.from([1, 2, 3]) });
  });

  it('rejects worker page errors and closes both contexts without publishing a report', async () => {
    const failure = new Error('worker page failed');
    browser.newContext.mockImplementation(async () => {
      const context = makeContext(contexts.length === 0 ? 'direct' : 'worker');
      if (context.name === 'worker') {
        context.page.on.mockImplementation((event, listener) => {
          if (event === 'pageerror') listener(failure);
        });
      }
      contexts.push(context);
      return context;
    });
    await expect(import('./measure-class2-budget.mjs')).rejects.toThrow('worker page failed');
    for (const context of contexts) expect(context.close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
    expect(mocked.render).not.toHaveBeenCalled();
  });

  it('closes an existing context if creating the second context fails', async () => {
    browser.newContext.mockImplementationOnce(async () => { const context = makeContext('direct'); contexts.push(context); return context; }).mockRejectedValueOnce(new Error('context failed'));
    await expect(import('./measure-class2-budget.mjs')).rejects.toThrow('context failed');
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
  });

  it('still closes the direct context and process resources if worker cleanup fails', async () => {
    browser.newContext.mockImplementation(async () => {
      const context = makeContext(contexts.length === 0 ? 'direct' : 'worker');
      if (contexts.length === 1) context.close.mockRejectedValue(new Error('close failed'));
      contexts.push(context); return context;
    });
    await expect(import('./measure-class2-budget.mjs')).rejects.toThrow('close failed');
    expect(contexts[0].close).toHaveBeenCalledOnce();
    expect(browser.close).toHaveBeenCalledOnce();
    expect(server.close).toHaveBeenCalledOnce();
  });
});
