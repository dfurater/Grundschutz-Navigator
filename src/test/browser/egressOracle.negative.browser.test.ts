import { test } from 'vitest';
import { deriveCrossOriginUrl } from './browserEgressDecision';
import { NEGATIVE_EGRESS_CASES } from './egressOracleContract.mjs';

const negativeCase = NEGATIVE_EGRESS_CASES.find(
  ({ id }) => id === import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE,
);

test.skipIf(!negativeCase)(
  negativeCase?.testName ?? 'kein negativer Browser-Egress-Fall ausgewählt',
  () => {
    const url = deriveCrossOriginUrl(
      window.location.href,
      `/egress-proof/${negativeCase?.id ?? 'inactive'}`,
    );

    if (negativeCase?.id === 'fetch') {
      void fetch(url.href).catch(() => undefined);
      return;
    }

    navigator.sendBeacon(url.href, 'gspp-340-egress-proof');
  },
);
