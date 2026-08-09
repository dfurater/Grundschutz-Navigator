import { expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { deriveCrossOriginUrl } from './browserEgressDecision';
import { NEGATIVE_EGRESS_TEST_NAME } from './egressOracleContract.mjs';

const runNegativeEgressProof = import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE === '1';

test.skipIf(!runNegativeEgressProof)(
  NEGATIVE_EGRESS_TEST_NAME,
  async () => {
    const url = deriveCrossOriginUrl(window.location.href, '/egress-proof');
    await expect(fetch(url.href)).rejects.toThrow();
    await expect(commands.getBrowserEgressEnforcements()).resolves.toEqual({
      httpAborts: 1,
      webSocketCloses: 0,
      violations: [`GET ${url.href}`],
    });
  },
);
