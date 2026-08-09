import { describe, expect, it } from 'vitest';
import {
  decideBrowserEgress,
  type BrowserEgressGuardState,
} from './browserEgressDecision';
import {
  BROWSER_EGRESS_ORACLE_HEADER,
  BROWSER_EGRESS_ORACLE_VALUE,
} from './egressOracleSignal';

const state: BrowserEgressGuardState = {
  allowedOrigin: 'http://127.0.0.1:51234',
  allowedHost: '127.0.0.1:51234',
};

function differentOrigin(path: string): URL {
  const url = new URL(path, state.allowedOrigin);
  url.port = String(Number(url.port) + 1);
  return url;
}

describe('decideBrowserEgress', () => {
  it('erlaubt gleichoriginige HTTP-Anfragen ohne Oracle-Canary', () => {
    expect(decideBrowserEgress(state, {
      kind: 'http',
      method: 'GET',
      url: new URL('/browser-test', state.allowedOrigin),
      headers: {},
    })).toEqual({ action: 'allow' });
  });

  it('meldet einen gleichoriginigen HTTP-Request mit Oracle-Canary', () => {
    expect(decideBrowserEgress(state, {
      kind: 'http',
      method: 'GET',
      url: new URL('/browser-test', state.allowedOrigin),
      headers: { [BROWSER_EGRESS_ORACLE_HEADER]: BROWSER_EGRESS_ORACLE_VALUE },
    })).toEqual({
      action: 'violation',
      detail: 'Egress-Oracle GET http://127.0.0.1:51234/browser-test',
    });
  });

  it('meldet einen HTTP-Request an eine aus der erlaubten Origin abgeleitete fremde Origin', () => {
    const url = differentOrigin('/egress-proof');

    expect(decideBrowserEgress(state, {
      kind: 'http',
      method: 'GET',
      url,
      headers: {},
    })).toEqual({ action: 'violation', detail: `GET ${url.href}` });
  });

  it('erlaubt ausschließlich WebSockets am erlaubten Host', () => {
    const allowed = new URL('/socket', state.allowedOrigin);
    allowed.protocol = 'ws:';
    const blocked = differentOrigin('/socket');
    blocked.protocol = 'ws:';

    expect(decideBrowserEgress(state, { kind: 'websocket', url: allowed })).toEqual({ action: 'allow' });
    expect(decideBrowserEgress(state, { kind: 'websocket', url: blocked })).toEqual({
      action: 'violation',
      detail: `WebSocket ${blocked.href}`,
    });
  });

  it.each([
    ['aktive', 'active'],
    ['neu registrierte', 'registered'],
  ] as const)('meldet %s Service Worker als Verstoß', (_description, lifecycle) => {
    expect(decideBrowserEgress(state, {
      kind: 'service-worker',
      lifecycle,
      url: new URL('/worker.js', state.allowedOrigin),
    })).toEqual({
      action: 'violation',
      detail: lifecycle === 'active'
        ? 'Service Worker aktiv: http://127.0.0.1:51234/worker.js'
        : 'Service Worker registriert: http://127.0.0.1:51234/worker.js',
    });
  });
});
