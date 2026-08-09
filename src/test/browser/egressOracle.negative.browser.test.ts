import { expect, test } from 'vitest';
import {
  BROWSER_EGRESS_ORACLE_HEADER,
  BROWSER_EGRESS_ORACLE_VALUE,
} from './egressOracleSignal';

const runNegativeEgressProof = import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE === '1';

test.skipIf(!runNegativeEgressProof)(
  'meldet einen bewusst markierten gleichoriginigen Request als Browser-Egress',
  async () => {
    await expect(
      fetch(window.location.href, {
        headers: { [BROWSER_EGRESS_ORACLE_HEADER]: BROWSER_EGRESS_ORACLE_VALUE },
      }),
    ).rejects.toThrow();
  },
);
