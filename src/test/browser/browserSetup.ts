import { afterEach, beforeEach } from 'vitest';
import { commands } from 'vitest/browser';

await commands.installBrowserEgressGuard();

beforeEach(async () => {
  try {
    await commands.assertNoBrowserEgress();
  } finally {
    await commands.resetBrowserEgressGuard();
  }
});

afterEach(async () => {
  await commands.assertNoBrowserEgress();
});
