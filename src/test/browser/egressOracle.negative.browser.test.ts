import { expect, test } from 'vitest';

const runNegativeEgressProof = import.meta.env.VITE_BROWSER_EGRESS_NEGATIVE === '1';

function crossOriginLoopbackUrl(): URL {
  const url = new URL(window.location.href);
  url.port = String(Number(url.port) + 1);
  url.pathname = '/egress-proof';
  url.search = '';
  url.hash = '';
  return url;
}

test.skipIf(!runNegativeEgressProof)(
  'meldet einen Request an eine abgeleitete Loopback-Origin als Browser-Egress',
  async () => {
    await expect(fetch(crossOriginLoopbackUrl().href)).rejects.toThrow();
  },
);
