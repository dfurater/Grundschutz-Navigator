/// <reference lib="dom" />

import { defineBrowserCommand } from '@vitest/browser-playwright';
import type { BrowserContext, Frame, Page, Request } from 'playwright';
import {
  decideBrowserEgress,
  type BrowserEgressDecision,
  type BrowserEgressGuardState,
} from './browserEgressDecision.ts';

const EGRESS_FAILURE_MARKER = '[BROWSER_EGRESS_BLOCKED]';
const WEBSOCKET_GUARD_STATE_KEY = '__gsppBrowserEgressWebSocketGuard';

type EgressGuardState = BrowserEgressGuardState & {
  violations: string[];
  httpAborts: number;
};

type WebSocketGuardState = {
  violations: string[];
  webSocketCloses: number;
};

const guardStates = new WeakMap<BrowserContext, EgressGuardState>();
const webSocketGuardFrames = new WeakMap<Frame, EgressGuardState>();
const monitoredWebSocketGuardPages = new WeakSet<Page>();

function recordViolation(state: EgressGuardState, detail: string): void {
  state.violations.push(detail);
}

function recordEgressDecision(state: EgressGuardState, decision: BrowserEgressDecision): boolean {
  if (decision.action === 'allow') {
    return false;
  }

  recordViolation(state, decision.detail);
  return true;
}

function assertNoViolations(state: EgressGuardState): void {
  if (state.violations.length > 0) {
    throw new Error(`${EGRESS_FAILURE_MARKER} ${state.violations.join('; ')}`);
  }
}

function violationFailureMessage(state: EgressGuardState): string | undefined {
  try {
    assertNoViolations(state);
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    throw error;
  }

  return undefined;
}

function monitorWebSocketGuardNavigations(page: Page): void {
  if (monitoredWebSocketGuardPages.has(page)) {
    return;
  }

  monitoredWebSocketGuardPages.add(page);
  page.on('framenavigated', (navigatedFrame) => {
    const state = webSocketGuardFrames.get(navigatedFrame);
    if (state) {
      recordViolation(state, 'Browser-Testframe navigiert; der WebSocket-Egress-Guard wurde entfernt.');
    }
  });
}

async function installWebSocketEgressGuard(frame: Frame, allowedHost: string): Promise<void> {
  await frame.evaluate(({ allowedHost: allowedWebSocketHost, stateKey }) => {
    const windowWithGuard = window as typeof window & Record<string, WebSocketGuardState | undefined>;
    if (windowWithGuard[stateKey]) {
      return;
    }

    windowWithGuard[stateKey] = { violations: [], webSocketCloses: 0 };
    const policy = document.createElement('meta');
    policy.httpEquiv = 'Content-Security-Policy';
    policy.content = `connect-src http: https: ws://${allowedWebSocketHost} wss://${allowedWebSocketHost}`;
    document.head.append(policy);

    document.addEventListener('securitypolicyviolation', (event) => {
      if (event.violatedDirective !== 'connect-src') {
        return;
      }

      const url = new URL(event.blockedURI);
      if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
        return;
      }

      const state = windowWithGuard[stateKey];
      if (!state) {
        return;
      }
      state.violations.push(`WebSocket ${url.href}`);
      state.webSocketCloses += 1;
    });
  }, { allowedHost, stateKey: WEBSOCKET_GUARD_STATE_KEY });
}

async function getWebSocketEgressGuardState(frame: Frame): Promise<WebSocketGuardState> {
  return frame.evaluate((stateKey) => {
    const state = (window as typeof window & Record<string, WebSocketGuardState | undefined>)[stateKey];
    if (!state) {
      throw new Error('Browser-Egress-WebSocket-Guard wurde nicht installiert.');
    }
    return { violations: [...state.violations], webSocketCloses: state.webSocketCloses };
  }, WEBSOCKET_GUARD_STATE_KEY);
}

async function resetWebSocketEgressGuard(frame: Frame): Promise<void> {
  await frame.evaluate((stateKey) => {
    const state = (window as typeof window & Record<string, WebSocketGuardState | undefined>)[stateKey];
    if (!state) {
      throw new Error('Browser-Egress-WebSocket-Guard wurde nicht installiert.');
    }
    state.violations.length = 0;
    state.webSocketCloses = 0;
  }, WEBSOCKET_GUARD_STATE_KEY);
}

export const installBrowserEgressGuard = defineBrowserCommand(async ({ context, frame, page }) => {
  const existingState = guardStates.get(context);
  const testServerUrl = new URL(page.url());
  const state = existingState ?? {
    allowedOrigin: testServerUrl.origin,
    allowedHost: testServerUrl.host,
    violations: [],
    httpAborts: 0,
  };

  if (!existingState) {
    guardStates.set(context, state);
    const abortedHttpRequests = new WeakSet<Request>();

    context.on('requestfailed', (request) => {
      if (
        abortedHttpRequests.has(request)
        && request.failure()?.errorText.includes('ERR_BLOCKED_BY_CLIENT')
      ) {
        state.httpAborts += 1;
      }
    });

    for (const serviceWorker of context.serviceWorkers()) {
      recordEgressDecision(state, decideBrowserEgress(state, {
        kind: 'service-worker',
        lifecycle: 'active',
        url: new URL(serviceWorker.url()),
      }));
    }
    context.on('serviceworker', (serviceWorker) => {
      recordEgressDecision(state, decideBrowserEgress(state, {
        kind: 'service-worker',
        lifecycle: 'registered',
        url: new URL(serviceWorker.url()),
      }));
    });

    await context.route('**/*', async (route) => {
      const request = route.request();
      const decision = decideBrowserEgress(state, {
        kind: 'http',
        method: request.method(),
        url: new URL(request.url()),
      });

      if (!recordEgressDecision(state, decision)) {
        await route.continue();
        return;
      }

      abortedHttpRequests.add(request);
      await route.abort('blockedbyclient');
    });
  }

  monitorWebSocketGuardNavigations(page);
  const browserTestFrame = await frame();
  webSocketGuardFrames.set(browserTestFrame, state);
  await installWebSocketEgressGuard(browserTestFrame, state.allowedHost);
});

export const resetBrowserEgressGuard = defineBrowserCommand(async ({ context, frame }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }

  state.violations.length = 0;
  state.httpAborts = 0;
  await resetWebSocketEgressGuard(await frame());
});

export const getBrowserEgressEnforcements = defineBrowserCommand(async ({ context, frame }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }
  const webSocketState = await getWebSocketEgressGuardState(await frame());

  return {
    httpAborts: state.httpAborts,
    webSocketCloses: webSocketState.webSocketCloses,
    violations: [...state.violations, ...webSocketState.violations],
  };
});

export const assertNoBrowserEgress = defineBrowserCommand(async ({ context, frame }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }

  const nodeFailureMessage = violationFailureMessage(state);
  if (nodeFailureMessage) {
    return nodeFailureMessage;
  }

  const webSocketState = await getWebSocketEgressGuardState(await frame());
  return violationFailureMessage({
    ...state,
    violations: [...state.violations, ...webSocketState.violations],
  });
});
