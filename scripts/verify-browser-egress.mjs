import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NEGATIVE_EGRESS_TEST_NAME } from '../src/test/browser/egressOracleContract.mjs';

export const EGRESS_FAILURE_MARKER = '[BROWSER_EGRESS_BLOCKED]';
export const NEGATIVE_EGRESS_TEST_PATH = 'src/test/browser/egressOracle.negative.browser.test.ts';
export { NEGATIVE_EGRESS_TEST_NAME };

function expectedEgressFailure(report) {
  if (!report || typeof report !== 'object') {
    return undefined;
  }

  const expectedCounts = [
    ['numTotalTestSuites', 1],
    ['numPassedTestSuites', 0],
    ['numFailedTestSuites', 1],
    ['numPendingTestSuites', 0],
    ['numTotalTests', 1],
    ['numPassedTests', 0],
    ['numFailedTests', 1],
    ['numPendingTests', 0],
    ['numTodoTests', 0],
  ];

  if (report.success !== false || expectedCounts.some(([field, value]) => report[field] !== value)) {
    return undefined;
  }

  const [testResult] = report.testResults ?? [];
  const [assertion] = testResult?.assertionResults ?? [];
  const [failureMessage] = assertion?.failureMessages ?? [];
  if (
    report.testResults?.length !== 1
    || testResult?.assertionResults?.length !== 1
    || assertion?.fullName !== NEGATIVE_EGRESS_TEST_NAME
    || assertion?.status !== 'failed'
    || assertion?.failureMessages?.length !== 1
    || typeof failureMessage !== 'string'
    || !failureMessage.includes(EGRESS_FAILURE_MARKER)
  ) {
    return undefined;
  }

  return failureMessage;
}

export function verifyBrowserEgress({
  spawnSyncImpl = spawnSync,
  mkdtempSyncImpl = mkdtempSync,
  readFileSyncImpl = readFileSync,
  rmSyncImpl = rmSync,
  write = (output) => process.stdout.write(output),
} = {}) {
  const vitestEntryPoint = resolve('node_modules/vitest/vitest.mjs');
  const reportDirectory = mkdtempSyncImpl(join(tmpdir(), 'gspp-browser-egress-'));
  const reportPath = join(reportDirectory, 'result.json');

  try {
    const result = spawnSyncImpl(
      process.execPath,
      [
        vitestEntryPoint,
        'run',
        '--config',
        'vitest.browser.config.ts',
        NEGATIVE_EGRESS_TEST_PATH,
        '--reporter=json',
        `--outputFile=${reportPath}`,
      ],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          VITE_BROWSER_EGRESS_NEGATIVE: '1',
        },
      },
    );

    if (result.error) {
      throw result.error;
    }
    if (result.status === 0) {
      throw new Error('Der negative Browser-Egress-Nachweis ist unerwartet grün.');
    }
    if (result.status !== 1 || result.signal) {
      throw new Error('Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.');
    }

    const failureMessage = expectedEgressFailure(JSON.parse(readFileSyncImpl(reportPath, 'utf8')));
    if (!failureMessage) {
      throw new Error('Der negative Browser-Egress-Nachweis entspricht nicht dem erwarteten Testergebnisvertrag.');
    }

    write(`${failureMessage}\n`);
  } finally {
    rmSyncImpl(reportDirectory, { force: true, recursive: true });
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    verifyBrowserEgress();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
