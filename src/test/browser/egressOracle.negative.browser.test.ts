import { expect, test } from 'vitest';

const runNegativeEgressProof = import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE === '1';

test.skipIf(!runNegativeEgressProof)(
  'meldet einen bewusst ausgelösten externen Request als Browser-Egress',
  async () => {
    await expect(fetch('https://example.invalid/egress-proof')).rejects.toThrow();
  },
);
