import { afterEach, beforeEach } from 'vitest';
import { commands } from 'vitest/browser';

const runNegativeEgressProof = import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE === '1';

await commands.installBrowserEgressGuard();

beforeEach(async () => {
  try {
    await commands.assertNoBrowserEgress();
  } finally {
    await commands.resetBrowserEgressGuard();
  }
});

afterEach(async () => {
  if (!runNegativeEgressProof) {
    await commands.assertNoBrowserEgress();
  }
});
