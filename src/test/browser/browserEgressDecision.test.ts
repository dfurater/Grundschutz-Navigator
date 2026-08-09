import { describe, expect, it } from 'vitest';
import {
  decideBrowserEgress,
  deriveCrossOriginUrl,
  type BrowserEgressGuardState,
} from './browserEgressDecision';

const state: BrowserEgressGuardState = {
  allowedOrigin: 'http://127.0.0.1:51234',
  allowedHost: '127.0.0.1:51234',
};

describe('decideBrowserEgress', () => {
  it('erlaubt gleichoriginige HTTP-Anfragen ohne Oracle-Canary', () => {
    expect(decideBrowserEgress(state, {
      kind: 'http',
      method: 'GET',
      url: new URL('/browser-test', state.allowedOrigin),
    })).toEqual({ action: 'allow' });
  });

  it('meldet einen HTTP-Request an eine aus der erlaubten Origin abgeleitete fremde Origin', () => {
    const url = deriveCrossOriginUrl(state.allowedOrigin, '/egress-proof');

    expect(decideBrowserEgress(state, {
      kind: 'http',
      method: 'GET',
      url,
    })).toEqual({ action: 'violation', detail: `GET ${url.href}` });
  });

  it('leitet auch von Port 65535 eine fremde Origin ab', () => {
    const allowedOrigin = 'http://127.0.0.1:65535';
    const url = deriveCrossOriginUrl(allowedOrigin, '/egress-proof');

    expect(url.origin).not.toBe(allowedOrigin);
    expect(url.port).toBe('65534');
  });

  it('erlaubt ausschließlich WebSockets am erlaubten Host', () => {
    const allowed = new URL('/socket', state.allowedOrigin);
    allowed.protocol = 'ws:';
    const blocked = deriveCrossOriginUrl(state.allowedOrigin, '/socket');
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
