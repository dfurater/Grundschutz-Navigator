import { describe, expect, it, vi } from 'vitest';
import {
  EGRESS_FAILURE_MARKER,
  NEGATIVE_EGRESS_TEST_NAME,
  verifyBrowserEgress,
} from './verify-browser-egress.mjs';

function browserRun(overrides: Record<string, unknown> = {}) {
  return {
    status: 1,
    signal: null,
    stdout: 'JSON report written to /tmp/gspp-browser-egress/result.json',
    stderr: '',
    ...overrides,
  };
}

function expectedReport(overrides: Record<string, unknown> = {}) {
  return {
    numTotalTestSuites: 1,
    numPassedTestSuites: 0,
    numFailedTestSuites: 1,
    numPendingTestSuites: 0,
    numTotalTests: 1,
    numPassedTests: 0,
    numFailedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    success: false,
    testResults: [{
      assertionResults: [{
        fullName: NEGATIVE_EGRESS_TEST_NAME,
        status: 'failed',
        failureMessages: [`Error: ${EGRESS_FAILURE_MARKER} GET <loopback-origin>`],
      }],
    }],
    ...overrides,
  };
}

function options(
  result: ReturnType<typeof browserRun>,
  report = expectedReport(),
) {
  return {
    spawnSyncImpl: vi.fn(() => result),
    mkdtempSyncImpl: vi.fn(() => '/tmp/gspp-browser-egress'),
    readFileSyncImpl: vi.fn(() => JSON.stringify(report)),
    rmSyncImpl: vi.fn(),
    write: vi.fn(),
  };
}

describe('verifyBrowserEgress', () => {
  it('accepts the expected failed browser run with the egress marker', () => {
    const fixture = options(browserRun());

    expect(verifyBrowserEgress(fixture)).toBeUndefined();
    expect(fixture.write).toHaveBeenCalledWith(
      `Error: ${EGRESS_FAILURE_MARKER} GET <loopback-origin>\n`,
    );
  });

  it('propagates a spawn error instead of accepting incomplete evidence', () => {
    const spawnError = new Error('spawn EACCES');
    const fixture = options(browserRun({ error: spawnError }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(spawnError);
  });

  it('rejects an unexpectedly successful browser run', () => {
    const fixture = options(browserRun({ status: 0 }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis ist unerwartet grün.',
    );
  });

  it('rejects a failed browser run without the egress marker', () => {
    const fixture = options(browserRun(), expectedReport({
      testResults: [{
        assertionResults: [{
          fullName: NEGATIVE_EGRESS_TEST_NAME,
          status: 'failed',
          failureMessages: ['Error: browser setup failed'],
        }],
      }],
    }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });

  it('rejects an additional browser-runner failure even when the egress marker exists', () => {
    const fixture = options(browserRun(), expectedReport({ numFailedTests: 2 }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });

  it('rejects a browser-runner signal even with an otherwise expected report', () => {
    const fixture = options(browserRun({ signal: 'SIGTERM', status: null }));

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });
});
