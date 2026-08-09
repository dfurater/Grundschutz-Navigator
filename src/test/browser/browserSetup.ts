import { afterEach, beforeEach } from 'vitest';
import { commands } from 'vitest/browser';

await commands.installBrowserEgressGuard();

async function assertNoBrowserEgress(): Promise<void> {
  const failureMessage = await commands.assertNoBrowserEgress();
  if (failureMessage) {
    // Browser-Commands übertragen Fehlertexte nicht zuverlässig; der Guard liefert den von ihm erzeugten Marker zurück.
    throw new Error(failureMessage);
  }
}

beforeEach(async () => {
  try {
    await assertNoBrowserEgress();
  } finally {
    await commands.resetBrowserEgressGuard();
  }
});

afterEach(async () => {
  await assertNoBrowserEgress();
});
