import { expect, test } from 'vitest';
import { commands } from 'vitest/browser';
import { deriveCrossOriginUrl } from './browserEgressDecision';

const runNegativeEgressProof = import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE === '1';

test.skipIf(!runNegativeEgressProof)(
  'meldet einen Request an eine abgeleitete Loopback-Origin als Browser-Egress',
  async () => {
    const url = deriveCrossOriginUrl(window.location.href, '/egress-proof');
    await expect(fetch(url.href)).rejects.toThrow();
    await expect(commands.getBrowserEgressEnforcements()).resolves.toEqual({
      httpAborts: 1,
      webSocketCloses: 0,
      violations: [`GET ${url.href}`],
    });
    throw new Error(`[BROWSER_EGRESS_BLOCKED] GET ${url.href}`);
  },
);
