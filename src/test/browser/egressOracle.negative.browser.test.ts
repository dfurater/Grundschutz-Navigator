import { test } from 'vitest';
import { deriveCrossOriginUrl } from './browserEgressDecision';
import { NEGATIVE_EGRESS_CASES } from './egressOracleContract.mjs';

const negativeCase = NEGATIVE_EGRESS_CASES.find(
  ({ id }) => id === import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE,
);

test.skipIf(!negativeCase)(
  negativeCase?.testName ?? 'kein negativer Browser-Egress-Fall ausgewählt',
  () => {
    if (!negativeCase) {
      throw new Error('GSPP339_NEGATIVE_EGRESS_CASE_MISSING');
    }
    const url = deriveCrossOriginUrl(
      window.location.href,
      `/egress-proof/${negativeCase.id}`,
    );

    switch (negativeCase.id) {
      case 'fetch':
        void fetch(url.href).catch(() => undefined);
        return;
      case 'sendBeacon':
        navigator.sendBeacon(url.href, 'gspp-346-egress-proof');
        return;
      default:
        throw new Error('GSPP339_UNSUPPORTED_NEGATIVE_EGRESS_CASE');
    }
  },
);
