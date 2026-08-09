import { describe, expect, it } from 'vitest';
import { createBlockedLoopbackUrl } from './egressOracleTarget';

describe('createBlockedLoopbackUrl', () => {
  it('creates a loopback URL on a different origin than the test server', () => {
    const testServerUrl = new URL('http://localhost:63315/__vitest_test__/');
    const blockedUrl = new URL(createBlockedLoopbackUrl(testServerUrl.href));

    expect(blockedUrl.hostname).toBe('127.0.0.1');
    expect(blockedUrl.port).toBe('1');
    expect(blockedUrl.pathname).toBe('/egress-proof');
    expect(blockedUrl.origin).not.toBe(testServerUrl.origin);
  });
});
