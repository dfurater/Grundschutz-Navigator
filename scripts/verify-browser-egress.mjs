import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const vitestEntryPoint = resolve('node_modules/vitest/vitest.mjs');
const negativeTestPath = 'src/test/browser/egressOracle.negative.browser.test.ts';
const result = spawnSync(
  process.execPath,
  [vitestEntryPoint, 'run', '--config', 'vitest.browser.config.ts', negativeTestPath],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      VITE_BROWSER_EGRESS_NEGATIVE: '1',
    },
  },
);
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;

process.stdout.write(output);

if (result.error) {
  throw result.error;
}
if (result.status === 0) {
  throw new Error('Der negative Browser-Egress-Nachweis ist unerwartet grün.');
}
if (!output.includes('[BROWSER_EGRESS_BLOCKED]')) {
  throw new Error('Der negative Browser-Egress-Nachweis scheiterte nicht am Egress-Oracle.');
}
