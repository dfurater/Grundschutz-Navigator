export type BrowserEgressGuardState = {
  allowedOrigin: string;
  allowedHost: string;
};

type BrowserEgressEvent =
  | {
      kind: 'http';
      method: string;
      url: URL;
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

export function deriveCrossOriginUrl(allowedOrigin: string | URL, path: string): URL {
  const allowedUrl = new URL(allowedOrigin);
  const url = new URL(path, allowedUrl);
  const currentPort = Number(url.port);

  url.port = String(currentPort === 65_535 ? 65_534 : currentPort + 1);

  if (url.origin === allowedUrl.origin) {
    throw new Error('Es konnte keine fremde Origin für den Browser-Egress-Nachweis abgeleitet werden.');
  }

  return url;
}

export function decideBrowserEgress(
  state: BrowserEgressGuardState,
  event: BrowserEgressEvent,
): BrowserEgressDecision {
  switch (event.kind) {
    case 'http':
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
