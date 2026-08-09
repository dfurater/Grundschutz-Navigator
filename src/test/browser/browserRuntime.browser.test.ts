import { expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { deriveCrossOriginUrl } from './browserEgressDecision';

test('läuft in Chromium', () => {
  expect(navigator.userAgent).toContain('Chrome');
});

test('legt den Egress-Guard ohne ausgeführte Durchsetzung an', async () => {
  await expect(commands.getBrowserEgressEnforcements()).resolves.toEqual({
    httpAborts: 0,
    webSocketCloses: 0,
    violations: [],
  });
});

test('schließt einen fremden WebSocket vor dem Netzwerkzugriff', async () => {
  const url = deriveCrossOriginUrl(window.location.href, '/egress-websocket');
  url.protocol = 'ws:';
  const socket = new WebSocket(url.href);

  try {
    await expect.poll(async () => commands.getBrowserEgressEnforcements()).toEqual({
      httpAborts: 0,
      webSocketCloses: 1,
      violations: [`WebSocket ${url.href}`],
    });
    expect(socket.readyState).toBe(WebSocket.CLOSED);
  } finally {
    socket.close();
    await commands.resetBrowserEgressGuard();
  }
});
