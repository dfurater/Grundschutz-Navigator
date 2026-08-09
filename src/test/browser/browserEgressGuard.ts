import { defineBrowserCommand } from '@vitest/browser-playwright';
import type { BrowserContext } from 'playwright';
import {
  decideBrowserEgress,
  type BrowserEgressDecision,
  type BrowserEgressGuardState,
} from './browserEgressDecision.ts';

const EGRESS_FAILURE_MARKER = '[BROWSER_EGRESS_BLOCKED]';

type BrowserEgressEnforcementCounts = {
  httpAborts: number;
  webSocketCloses: number;
};

type EgressGuardState = BrowserEgressGuardState & BrowserEgressEnforcementCounts & {
  violations: string[];
};

const guardStates = new WeakMap<BrowserContext, EgressGuardState>();

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

export const installBrowserEgressGuard = defineBrowserCommand(async ({ context, page }) => {
  if (guardStates.has(context)) {
    return;
  }

  const testServerUrl = new URL(page.url());
  const state: EgressGuardState = {
    allowedOrigin: testServerUrl.origin,
    allowedHost: testServerUrl.host,
    violations: [],
    httpAborts: 0,
    webSocketCloses: 0,
  };
  guardStates.set(context, state);

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

    await route.abort('blockedbyclient');
    state.httpAborts += 1;
  });

  await context.routeWebSocket('**/*', async (webSocket) => {
    const decision = decideBrowserEgress(state, {
      kind: 'websocket',
      url: new URL(webSocket.url()),
    });

    if (!recordEgressDecision(state, decision)) {
      webSocket.connectToServer();
      return;
    }

    await webSocket.close({ code: 1008, reason: 'Browser-Egress ist im Test nicht erlaubt.' });
    state.webSocketCloses += 1;
  });
});

export const resetBrowserEgressGuard = defineBrowserCommand(async ({ context }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }

  state.violations.length = 0;
  state.httpAborts = 0;
  state.webSocketCloses = 0;
});

export const getBrowserEgressEnforcements = defineBrowserCommand(async ({ context }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }

  return {
    httpAborts: state.httpAborts,
    webSocketCloses: state.webSocketCloses,
  };
});

export const assertNoBrowserEgress = defineBrowserCommand(async ({ context }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }

  assertNoViolations(state);
});
