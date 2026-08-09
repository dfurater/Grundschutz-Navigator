import { expect, test } from 'vitest';
import { commands } from 'vitest/browser';

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
