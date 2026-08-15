import { describe, expect, it, vi } from 'vitest';
import {
  EGRESS_FAILURE_MARKER,
  verifyBrowserEgress,
} from './verify-browser-egress.mjs';
import {
  NEGATIVE_EGRESS_CASES,
  type NegativeEgressCase,
} from '../src/test/browser/egressOracleContract.mjs';

function browserRun(overrides: Record<string, unknown> = {}) {
  return {
    status: 1,
    signal: null,
    stdout: 'JSON report written to /tmp/gspp-browser-egress/result.json',
    stderr: '',
    ...overrides,
  };
}

function expectedReport(
  negativeCase: NegativeEgressCase = NEGATIVE_EGRESS_CASES[0],
  overrides: Record<string, unknown> = {},
) {
  const url = `http://localhost:63316/egress-proof/${negativeCase.id}`;
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
        fullName: negativeCase.testName,
        status: 'failed',
        failureMessages: [
          `Error: ${EGRESS_FAILURE_MARKER} ${negativeCase.expectedMethod} ${url}\n    at afterEach`,
        ],
      }],
    }],
    ...overrides,
  };
}

function options(
  result: ReturnType<typeof browserRun>,
  reports = new Map(NEGATIVE_EGRESS_CASES.map((negativeCase) => [
    negativeCase.id,
    expectedReport(negativeCase),
  ])),
) {
  return {
    spawnSyncImpl: vi.fn(() => result),
    mkdtempSyncImpl: vi.fn(() => '/tmp/gspp-browser-egress'),
    readFileSyncImpl: vi.fn((path: string) => {
      const negativeCase = NEGATIVE_EGRESS_CASES.find(({ id }) => path.includes(id));
      return JSON.stringify(reports.get(negativeCase?.id ?? 'fetch'));
    }),
    rmSyncImpl: vi.fn(),
    write: vi.fn(),
  };
}

describe('verifyBrowserEgress', () => {
  it('accepts exactly one expected hook failure for fetch and sendBeacon', () => {
    const fixture = options(browserRun());

    expect(verifyBrowserEgress(fixture)).toBeUndefined();
    expect(fixture.spawnSyncImpl).toHaveBeenCalledTimes(2);
    expect(fixture.write).toHaveBeenNthCalledWith(
      1,
      `Error: ${EGRESS_FAILURE_MARKER} GET http://localhost:63316/egress-proof/fetch\n    at afterEach\n`,
    );
    expect(fixture.write).toHaveBeenNthCalledWith(
      2,
      `Error: ${EGRESS_FAILURE_MARKER} POST http://localhost:63316/egress-proof/sendBeacon\n    at afterEach\n`,
    );
    expect(fixture.spawnSyncImpl.mock.calls.map((call) => (
      call[2]?.env?.VITE_BROWSER_EGRESS_NEGATIVE
    ))).toEqual(['fetch', 'sendBeacon']);
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
    const reports = new Map(NEGATIVE_EGRESS_CASES.map((negativeCase) => [
      negativeCase.id,
      expectedReport(negativeCase),
    ]));
    reports.set('fetch', expectedReport(NEGATIVE_EGRESS_CASES[0], {
      testResults: [{
        assertionResults: [{
          fullName: NEGATIVE_EGRESS_CASES[0].testName,
          status: 'failed',
          failureMessages: ['Error: browser setup failed'],
        }],
      }],
    }));
    const fixture = options(browserRun(), reports);

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });

  it('rejects an additional browser-runner failure even when the egress marker exists', () => {
    const reports = new Map(NEGATIVE_EGRESS_CASES.map((negativeCase) => [
      negativeCase.id,
      expectedReport(negativeCase),
    ]));
    reports.set('fetch', expectedReport(NEGATIVE_EGRESS_CASES[0], { numFailedTests: 2 }));
    const fixture = options(browserRun(), reports);

    expect(() => verifyBrowserEgress(fixture)).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });

  it('rejects the wrong HTTP method for the selected lifecycle case', () => {
    const reports = new Map(NEGATIVE_EGRESS_CASES.map((negativeCase) => [
      negativeCase.id,
      expectedReport(negativeCase),
    ]));
    reports.set('fetch', expectedReport(NEGATIVE_EGRESS_CASES[0], {
      testResults: [{
        assertionResults: [{
          fullName: NEGATIVE_EGRESS_CASES[0].testName,
          status: 'failed',
          failureMessages: [
            `Error: ${EGRESS_FAILURE_MARKER} POST http://localhost:63316/egress-proof/fetch`,
          ],
        }],
      }],
    }));

    expect(() => verifyBrowserEgress(options(browserRun(), reports))).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });

  it('rejects more than one egress marker in the failure', () => {
    const reports = new Map(NEGATIVE_EGRESS_CASES.map((negativeCase) => [
      negativeCase.id,
      expectedReport(negativeCase),
    ]));
    reports.set('fetch', expectedReport(NEGATIVE_EGRESS_CASES[0], {
      testResults: [{
        assertionResults: [{
          fullName: NEGATIVE_EGRESS_CASES[0].testName,
          status: 'failed',
          failureMessages: [
            `Error: ${EGRESS_FAILURE_MARKER} GET http://localhost:63316/egress-proof/fetch; ${EGRESS_FAILURE_MARKER} GET http://localhost:63316/egress-proof/extra`,
          ],
        }],
      }],
    }));

    expect(() => verifyBrowserEgress(options(browserRun(), reports))).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });

  it('rejects an additional violation in the same marked failure', () => {
    const reports = new Map(NEGATIVE_EGRESS_CASES.map((negativeCase) => [
      negativeCase.id,
      expectedReport(negativeCase),
    ]));
    reports.set('fetch', expectedReport(NEGATIVE_EGRESS_CASES[0], {
      testResults: [{
        assertionResults: [{
          fullName: NEGATIVE_EGRESS_CASES[0].testName,
          status: 'failed',
          failureMessages: [
            `Error: ${EGRESS_FAILURE_MARKER} GET http://localhost:63316/egress-proof/fetch; GET http://localhost:63316/egress-proof/extra`,
          ],
        }],
      }],
    }));

    expect(() => verifyBrowserEgress(options(browserRun(), reports))).toThrow(
      'Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.',
    );
  });

  it.each([
    [
      'eine externe Origin',
      `Error: ${EGRESS_FAILURE_MARKER} GET https://example.com/egress-proof/fetch`,
    ],
    [
      'einen Query-String',
      `Error: ${EGRESS_FAILURE_MARKER} GET http://localhost:63316/egress-proof/fetch?leak=1`,
    ],
    [
      'ein Fragment',
      `Error: ${EGRESS_FAILURE_MARKER} GET http://localhost:63316/egress-proof/fetch#leak`,
    ],
    [
      'eine unparsbare URL',
      `Error: ${EGRESS_FAILURE_MARKER} GET keine-url`,
    ],
  ])('rejects %s in der gemeldeten Egress-URL', (_description, failureMessage) => {
    const reports = new Map(NEGATIVE_EGRESS_CASES.map((negativeCase) => [
      negativeCase.id,
      expectedReport(negativeCase),
    ]));
    reports.set('fetch', expectedReport(NEGATIVE_EGRESS_CASES[0], {
      testResults: [{
        assertionResults: [{
          fullName: NEGATIVE_EGRESS_CASES[0].testName,
          status: 'failed',
          failureMessages: [failureMessage],
        }],
      }],
    }));

    expect(() => verifyBrowserEgress(options(browserRun(), reports))).toThrow(
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
