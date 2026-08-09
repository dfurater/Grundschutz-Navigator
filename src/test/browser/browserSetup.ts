import { afterEach, beforeEach } from 'vitest';
import { commands } from 'vitest/browser';

await commands.installBrowserEgressGuard();

beforeEach(async () => {
  await commands.assertNoBrowserEgress();
  await commands.resetBrowserEgressGuard();
});

afterEach(async () => {
  await commands.assertNoBrowserEgress();
});
