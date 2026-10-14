/**
 * Visuelle Regression (`src/test/browser/visualRegression.browser.test.ts`)
 * im Playwright-Linux-Container. Referenzbilder entstehen und werden geprüft
 * im selben, per Digest gepinnten Image: Chromium rendert Schrift abhängig von
 * der Systemumgebung, ein Vergleich gegen den GitHub-Runner wäre nicht
 * pixelgleich.
 *
 *   node scripts/visual-regression.mjs --check    # Vergleich, CI-Schritt
 *   node scripts/visual-regression.mjs --update   # Referenzen neu schreiben
 *
 * Der Container liest den Checkout nur lesend und installiert die
 * Abhängigkeiten in einer eigenen Kopie. Nur `--update` bindet das
 * Referenzverzeichnis beschreibbar ein; `--check` schreibt bei einem
 * Fehlschlag die Ist- und Differenzbilder nach `.vitest/visual-regression/`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Gepinntes Image; die Version muss der `playwright`-Version in `package-lock.json` entsprechen. */
export const PLAYWRIGHT_IMAGE = {
  version: '1.64.0',
  digest: 'sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f',
};

const TEST_FILE = 'src/test/browser/visualRegression.browser.test.ts';
const SCREENSHOT_DIR = 'src/test/browser/__screenshots__';
const REFERENCE_DIR = `${SCREENSHOT_DIR}/visualRegression.browser.test.ts`;
/** Fehlerbilder eines `--check`-Laufs (gitignoriert wie das übrige `.vitest/`). */
export const FAILURE_DIR = '.vitest/visual-regression';

/** Feste Installationsorte des Docker-Clients; `PATH` wird nicht durchsucht. */
export const DOCKER_CANDIDATES = ['/usr/bin/docker', '/usr/local/bin/docker', '/opt/homebrew/bin/docker'];

export function resolveDocker(exists = existsSync, candidates = DOCKER_CANDIDATES) {
  const found = candidates.find((candidate) => exists(candidate));
  if (!found) throw new Error(`Docker-Client nicht gefunden unter: ${candidates.join(', ')}`);
  return found;
}

/** Liefert die Image-Referenz mit Digest oder wirft, wenn Lockfile und Pin auseinanderlaufen. */
export function resolvePlaywrightImage(lock, pin = PLAYWRIGHT_IMAGE) {
  const version = lock?.packages?.['node_modules/playwright']?.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error('Playwright-Version fehlt in package-lock.json.');
  }
  if (version !== pin.version) {
    throw new Error(
      `package-lock.json führt playwright ${version}, scripts/visual-regression.mjs pinnt ${pin.version}; ` +
      'Version und Digest von PLAYWRIGHT_IMAGE nachziehen und die Referenzen mit --update neu erzeugen.',
    );
  }
  return `mcr.microsoft.com/playwright:v${pin.version}-noble@${pin.digest}`;
}

/** Shell-Skript, das im Container läuft. */
export function containerScript(mode) {
  if (mode !== 'check' && mode !== 'update') throw new Error(`Unbekannter Modus: ${mode}`);
  const vitest = `GSPP_VISUAL_REGRESSION=1 CI=1 npx vitest run ${TEST_FILE} --config vitest.browser.config.ts`;
  return [
    'set -euo pipefail',
    'tar -C /src --exclude=./node_modules --exclude=./dist --exclude=./coverage --exclude=./.git --exclude=./.vitest --exclude=./.worktrees -cf - . | tar -xf -',
    'npm ci --ignore-scripts --no-audit --no-fund',
    ...(mode === 'update'
      ? [`rm -rf ${REFERENCE_DIR}`, `${vitest} --update`, 'rm -rf /out/visualRegression.browser.test.ts', `cp -R ${REFERENCE_DIR} /out/`]
      : [`${vitest} || { status=$?; cp -R .vitest/. /failures/ 2>/dev/null || true; exit "$status"; }`]),
  ].join('\n');
}

/** Argumente für `docker run`. */
export function dockerArgs({ mode, root, image }) {
  const mounts = ['-v', `${root}:/src:ro`];
  if (mode === 'update') mounts.push('-v', `${resolve(root, SCREENSHOT_DIR)}:/out`);
  if (mode === 'check') mounts.push('-v', `${resolve(root, FAILURE_DIR)}:/failures`);
  return ['run', '--rm', '--init', ...mounts, '-w', '/work', image, 'bash', '-c', containerScript(mode)];
}

/** Exitstatus des Containerlaufs; ein durch Signal beendeter Lauf zählt als Fehler. */
export function exitCodeOf(result) {
  return typeof result?.status === 'number' ? result.status : 1;
}

export function parseMode(argv) {
  const flags = argv.filter((arg) => arg.startsWith('--'));
  if (flags.length !== 1 || !['--check', '--update'].includes(flags[0])) {
    throw new Error('Aufruf: node scripts/visual-regression.mjs --check | --update');
  }
  return flags[0].slice(2);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const mode = parseMode(process.argv.slice(2));
  const image = resolvePlaywrightImage(JSON.parse(readFileSync(resolve(root, 'package-lock.json'), 'utf8')));
  if (mode === 'update') mkdirSync(resolve(root, SCREENSHOT_DIR), { recursive: true });
  if (mode === 'check') {
    rmSync(resolve(root, FAILURE_DIR), { recursive: true, force: true });
    mkdirSync(resolve(root, FAILURE_DIR), { recursive: true });
  }
  process.exit(exitCodeOf(spawnSync(resolveDocker(), dockerArgs({ mode, root, image }), { stdio: 'inherit' })));
}
