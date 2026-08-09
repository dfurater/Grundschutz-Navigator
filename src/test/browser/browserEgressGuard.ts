import { defineBrowserCommand } from '@vitest/browser-playwright';
import type { BrowserContext } from 'playwright';
import { isBrowserEgressOracleRequest } from './egressOracleSignal.ts';

const EGRESS_FAILURE_MARKER = '[BROWSER_EGRESS_BLOCKED]';

type EgressGuardState = {
  allowedOrigin: string;
  allowedHost: string;
  violations: string[];
};

const guardStates = new WeakMap<BrowserContext, EgressGuardState>();

function recordViolation(state: EgressGuardState, detail: string): void {
  state.violations.push(detail);
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
  };
  guardStates.set(context, state);

  for (const serviceWorker of context.serviceWorkers()) {
    recordViolation(state, `Service Worker aktiv: ${serviceWorker.url()}`);
  }
  context.on('serviceworker', (serviceWorker) => {
    recordViolation(state, `Service Worker registriert: ${serviceWorker.url()}`);
  });

  await context.route('**/*', async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());

    if (
      requestUrl.origin === state.allowedOrigin
      && isBrowserEgressOracleRequest(request.headers())
    ) {
      recordViolation(state, `Egress-Oracle ${request.method()} ${requestUrl.href}`);
      await route.abort('blockedbyclient');
      return;
    }

    if (requestUrl.origin === state.allowedOrigin) {
      await route.continue();
      return;
    }

    recordViolation(state, `${request.method()} ${requestUrl.href}`);
    await route.abort('blockedbyclient');
  });

  await context.routeWebSocket('**/*', async (webSocket) => {
    const webSocketUrl = new URL(webSocket.url());

    if (webSocketUrl.host === state.allowedHost) {
      webSocket.connectToServer();
      return;
    }

    recordViolation(state, `WebSocket ${webSocketUrl.href}`);
    await webSocket.close({ code: 1008, reason: 'Browser-Egress ist im Test nicht erlaubt.' });
  });
});

export const resetBrowserEgressGuard = defineBrowserCommand(async ({ context }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }

  state.violations.length = 0;
});

export const assertNoBrowserEgress = defineBrowserCommand(async ({ context }) => {
  const state = guardStates.get(context);
  if (!state) {
    throw new Error('Browser-Egress-Guard wurde nicht installiert.');
  }

  assertNoViolations(state);
});
