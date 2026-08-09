import { isBrowserEgressOracleRequest } from './egressOracleSignal.ts';

export type BrowserEgressGuardState = {
  allowedOrigin: string;
  allowedHost: string;
};

type BrowserEgressEvent =
  | {
      kind: 'http';
      method: string;
      url: URL;
      headers: Readonly<Record<string, string | undefined>>;
    }
  | {
      kind: 'websocket';
      url: URL;
    }
  | {
      kind: 'service-worker';
      lifecycle: 'active' | 'registered';
      url: URL;
    };

export type BrowserEgressDecision =
  | { action: 'allow' }
  | { action: 'violation'; detail: string };

export function decideBrowserEgress(
  state: BrowserEgressGuardState,
  event: BrowserEgressEvent,
): BrowserEgressDecision {
  switch (event.kind) {
    case 'http':
      if (event.url.origin === state.allowedOrigin && isBrowserEgressOracleRequest(event.headers)) {
        return { action: 'violation', detail: `Egress-Oracle ${event.method} ${event.url.href}` };
      }
      if (event.url.origin === state.allowedOrigin) {
        return { action: 'allow' };
      }
      return { action: 'violation', detail: `${event.method} ${event.url.href}` };
    case 'websocket':
      if (event.url.host === state.allowedHost) {
        return { action: 'allow' };
      }
      return { action: 'violation', detail: `WebSocket ${event.url.href}` };
    case 'service-worker':
      return {
        action: 'violation',
        detail: event.lifecycle === 'active'
          ? `Service Worker aktiv: ${event.url.href}`
          : `Service Worker registriert: ${event.url.href}`,
      };
  }
}
