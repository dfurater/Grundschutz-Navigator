#!/usr/bin/env node

/**
 * Bootstrap-Script für frische Checkouts und Worktrees (GSPP-369).
 *
 * `npm run test` scheitert in einem frischen Arbeitsverzeichnis am
 * Freshness-Gate (`globalSetup` in vite.config.ts, siehe
 * scripts/check-catalog-freshness.mjs): Ohne vorherigen Katalog-Fetch fehlen
 * die lokalen Katalog-Metadaten. Ein blosses `npm run fetch-catalog` reicht
 * dafür nicht — `resolveSnapshot()` in fetch-catalog.mjs löst ohne gesetztes
 * `BSI_SNAPSHOT_SHA` den HEAD des BSI-Default-Branch auf, während das
 * Freshness-Gate gegen die im Repository eingecheckte `upstream-manifest.json`
 * prüft. Ist der BSI-Upstream seit dem letzten Sync-PR weitergelaufen, bleibt
 * das Gate rot. Dieses Script pinnt deshalb dieselbe Snapshot-SHA wie der
 * `jq`-Schritt in .github/workflows/ci.yml — nur über das bereits vorhandene
 * `readTrackedManifest` statt eines externen Tools.
 *
 * Ablauf (spiegelt die `validate`-Lane aus ci.yml):
 *   1. npm ci --ignore-scripts   — Parität zum in
 *      scripts/ci-supply-chain-hardening.test.ts gepinnten CI-Vertrag
 *   2. verify-oscal-schemas.mjs  — offline, bewusst vor jedem Netzschritt
 *   3. Freshness-Check           — bei `fresh` ohne --force entfällt Schritt 4
 *   4. fetch-catalog.mjs         — mit BSI_SNAPSHOT_SHA aus dem Manifest
 *   5. erneuter Freshness-Check  — muss danach `fresh` sein
 *   6. .env.local-Hinweis        — nur Hinweis, kein Abbruch
 *   7. Abschlusszusammenfassung
 */

import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  checkCatalogFreshness,
  formatCatalogFreshnessMessage,
} from './check-catalog-freshness.mjs';
import { readTrackedManifest } from './sync-upstream-manifest.mjs';
import { REPO_ROOT, resolveTrackedManifestPath } from './security-guards.mjs';

export class BootstrapError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BootstrapError';
  }
}

/**
 * npm wird über `npm_execpath` gestartet (unter `npm run` immer gesetzt), mit
 * `process.execPath` statt eines Shell-Aufrufs — kein `shell: true`, kein
 * PATH-Lookup. Ausserhalb von `npm run` (z. B. ein direkter
 * `node scripts/bootstrap.mjs`) fällt der Aufruf auf den `npm`-Befehl zurück.
 */
function resolveNpmInvocation(env) {
  const npmExecPath = env.npm_execpath;
  if (typeof npmExecPath === 'string' && npmExecPath.length > 0) {
    return { command: process.execPath, args: [npmExecPath] };
  }
  return { command: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: [] };
}

async function defaultRun(command, args, { cwd, env } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise(code ?? 1));
  });
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function printHelp(log) {
  log('Verwendung: npm run setup -- [--force] [--help]');
  log('');
  log('Stellt aus einem frischen Checkout eine grüne Testbasis her: npm ci');
  log('--ignore-scripts, Offline-Schemaverifikation, Katalog-Fetch gegen die im');
  log('Manifest gepinnte Snapshot-SHA, erneute Freshness-Prüfung.');
  log('');
  log('  --force   Katalog-Fetch auch bei bereits frischem lokalen Stand erzwingen');
  log('  --help    diese Hilfe anzeigen und beenden');
}

export function parseArgs(argv) {
  return {
    force: argv.includes('--force'),
    help: argv.includes('--help'),
  };
}

/**
 * @param {object} [options]
 * @param {string} [options.rootDir] Projektwurzel; Default deckt den realen Lauf ab.
 * @param {boolean} [options.force] Fetch auch bei bereits frischem Katalog erzwingen.
 * @param {NodeJS.ProcessEnv} [options.env] Umgebung für Kindprozesse (durchgereicht, u. a. GH_TOKEN/GITHUB_TOKEN).
 * @param {typeof defaultRun} [options.run] Injizierbarer Prozessrunner (Tests ersetzen ihn, statt echte Kindprozesse zu starten).
 * @param {(message: string) => void} [options.log] Injizierbarer Logger.
 * @param {typeof checkCatalogFreshness} [options.freshness] Injizierbare Freshness-Prüfung.
 */
export async function runBootstrap({
  rootDir = REPO_ROOT,
  force = false,
  env = process.env,
  run = defaultRun,
  log = console.log,
  freshness = checkCatalogFreshness,
} = {}) {
  log('[1/7] npm ci --ignore-scripts ...');
  const npmInvocation = resolveNpmInvocation(env);
  const installExitCode = await run(
    npmInvocation.command,
    [...npmInvocation.args, 'ci', '--ignore-scripts'],
    { cwd: rootDir, env },
  );
  if (installExitCode !== 0) {
    throw new BootstrapError(`npm ci --ignore-scripts fehlgeschlagen (Exit ${installExitCode}).`);
  }

  log('[2/7] Verifiziere eingecheckte OSCAL-Schemas (offline, vor jedem Netzschritt) ...');
  const verifyExitCode = await run(
    process.execPath,
    [join(rootDir, 'scripts', 'verify-oscal-schemas.mjs')],
    { cwd: rootDir, env },
  );
  if (verifyExitCode !== 0) {
    throw new BootstrapError(`Schema-Verifikation fehlgeschlagen (Exit ${verifyExitCode}).`);
  }

  log('[3/7] Prüfe lokalen Katalog-Frischestand ...');
  const initialFreshness = await freshness();
  const needsFetch = force || initialFreshness.state !== 'fresh';

  if (!needsFetch) {
    log(`  ${formatCatalogFreshnessMessage(initialFreshness)}`);
    log('  Katalog bereits aktuell, Fetch übersprungen (--force erzwingt ihn).');
  } else {
    log('[4/7] Lade BSI-Katalog ...');
    // Pin auf die eingecheckte Snapshot-SHA (siehe Kopfkommentar): ohne ihn
    // würde fetch-catalog.mjs ungepinnt vom BSI-Default-Branch-HEAD laden.
    const manifestPath = resolveTrackedManifestPath(join(rootDir, 'upstream-manifest.json'), {
      repoRoot: rootDir,
    });
    let manifest;
    try {
      manifest = await readTrackedManifest(manifestPath);
    } catch (error) {
      throw new BootstrapError(
        `Eingecheckte upstream-manifest.json ist ungültig: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!manifest) {
      throw new BootstrapError(
        'Eingecheckte upstream-manifest.json fehlt. Ohne gepinnte Snapshot-SHA würde ' +
        'fetch-catalog.mjs ungepinnt vom BSI-Default-Branch-HEAD laden — Repository-Zustand wiederherstellen.',
      );
    }

    const pinnedSha = manifest.snapshotCommitSha;
    // Ein bereits gesetztes BSI_SNAPSHOT_SHA (z. B. von CI oder einem Nutzer
    // gesetzt) hat Vorrang und bleibt unangetastet.
    const fetchEnv = {
      ...env,
      BSI_SNAPSHOT_SHA: env.BSI_SNAPSHOT_SHA || pinnedSha,
    };
    log(`  Gepinnte Snapshot-SHA (aus upstream-manifest.json): ${pinnedSha}`);
    if (env.BSI_SNAPSHOT_SHA) {
      log(`  Vorgesetztes BSI_SNAPSHOT_SHA bleibt unangetastet: ${env.BSI_SNAPSHOT_SHA}`);
    }

    const fetchExitCode = await run(
      process.execPath,
      [join(rootDir, 'scripts', 'fetch-catalog.mjs')],
      { cwd: rootDir, env: fetchEnv },
    );
    if (fetchExitCode !== 0) {
      throw new BootstrapError(`Katalog-Fetch fehlgeschlagen (Exit ${fetchExitCode}).`);
    }

    log('[5/7] Prüfe Katalog-Frischestand erneut ...');
    const postFetchFreshness = await freshness();
    if (postFetchFreshness.state !== 'fresh') {
      throw new BootstrapError(formatCatalogFreshnessMessage(postFetchFreshness));
    }
    log(`  ${formatCatalogFreshnessMessage(postFetchFreshness)}`);
  }

  log('[6/7] Prüfe lokale Umgebungsvariablen ...');
  const hasEnvLocal = await fileExists(join(rootDir, '.env.local'));
  if (!hasEnvLocal) {
    log(
      '  Hinweis: .env.local fehlt. Nur für die Impressum-/Datenschutzseite im lokalen ' +
      'Dev-Server relevant (siehe .env.local.example) — im Deployment kommen die Werte ' +
      'aus GitHub Secrets. npm run test und npm run build laufen ohne sie durch.',
    );
  }

  log('[7/7] Fertig.');
  log('  npm run dev                                              — Dev-Server unter http://localhost:5173');
  log('  npm run test                                             — Vitest');
  log('  npx playwright install chromium && npm run test:browser  — Chromium-Browsertests');

  return {
    fetchSkipped: !needsFetch,
    envLocalPresent: hasEnvLocal,
  };
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const { force, help } = parseArgs(process.argv.slice(2));
  if (help) {
    printHelp(console.log);
  } else {
    try {
      await runBootstrap({ force });
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
