import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const EGRESS_FAILURE_MARKER = '[BROWSER_EGRESS_BLOCKED]';
export const NEGATIVE_EGRESS_TEST_PATH = 'src/test/browser/egressOracle.negative.browser.test.ts';

export function verifyBrowserEgress({
  spawnSyncImpl = spawnSync,
  write = (output) => process.stdout.write(output),
} = {}) {
  const vitestEntryPoint = resolve('node_modules/vitest/vitest.mjs');
  const result = spawnSyncImpl(
    process.execPath,
    [vitestEntryPoint, 'run', '--config', 'vitest.browser.config.ts', NEGATIVE_EGRESS_TEST_PATH],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        VITE_BROWSER_EGRESS_NEGATIVE: '1',
      },
    },
  );
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

  write(output);

  if (result.error) {
    throw result.error;
  }
  if (result.status === 0) {
    throw new Error('Der negative Browser-Egress-Nachweis ist unerwartet grün.');
  }
  if (!output.includes(EGRESS_FAILURE_MARKER)) {
    throw new Error('Der negative Browser-Egress-Nachweis scheiterte nicht am Egress-Oracle.');
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
