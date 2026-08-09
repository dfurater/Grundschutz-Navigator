import { expect, test } from 'vitest';
import { createBlockedLoopbackUrl } from './egressOracleTarget';

const runNegativeEgressProof = import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE === '1';

test.skipIf(!runNegativeEgressProof)(
  'meldet einen bewusst ausgelösten Loopback-Request auf einer anderen Origin als Browser-Egress',
  async () => {
    await expect(fetch(createBlockedLoopbackUrl(window.location.href))).rejects.toThrow();
  },
);
