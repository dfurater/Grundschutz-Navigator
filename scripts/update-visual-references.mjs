/**
 * Erzeugt die Referenzbilder der visuellen Regression
 * (`src/test/browser/visualRegression.browser.test.ts`) im
 * Playwright-Linux-Container. Die CI-Browserlane läuft auf `ubuntu-latest`,
 * Vitest sucht dort `…-chromium-linux.png`; das Image trägt dieselbe
 * Playwright-Version wie `package-lock.json` und damit dasselbe Chromium.
 *
 * Der Container liest den Checkout nur lesend, installiert die Abhängigkeiten
 * in einer eigenen Kopie (die macOS-`node_modules` laufen unter Linux nicht)
 * und schreibt ausschließlich nach `src/test/browser/__screenshots__/`.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const lock = JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8'));
const version = lock.packages['node_modules/playwright']?.version;
if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
  throw new Error('Playwright-Version fehlt in package-lock.json.');
}

const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const screenshots = resolve(root, 'src/test/browser/__screenshots__');
mkdirSync(screenshots, { recursive: true });

const inner = [
  'set -euo pipefail',
  'tar -C /src --exclude=./node_modules --exclude=./dist --exclude=./coverage --exclude=./.git --exclude=./.worktrees -cf - . | tar -xf -',
  'npm ci --ignore-scripts --no-audit --no-fund',
  'npx vitest run src/test/browser/visualRegression.browser.test.ts --config vitest.browser.config.ts --update',
  'rm -rf /out/visualRegression.browser.test.ts',
  'cp -R src/test/browser/__screenshots__/visualRegression.browser.test.ts /out/',
].join('\n');

const result = spawnSync('docker', [
  'run', '--rm', '--init',
  '-v', `${root}:/src:ro`,
  '-v', `${screenshots}:/out`,
  '-w', '/work',
  image,
  'bash', '-c', inner,
], { stdio: 'inherit' });

process.exit(result.status ?? 1);
