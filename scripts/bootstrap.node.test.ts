// @vitest-environment node
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BootstrapError, parseArgs, runBootstrap } from './bootstrap.mjs';

const execFileAsync = promisify(execFile);

const REPO_ROOT = resolve(import.meta.dirname, '..');
const TRACKED_MANIFEST_PATH = join(REPO_ROOT, 'upstream-manifest.json');

/**
 * `runBootstrap` liest die gepinnte Snapshot-SHA aus einer echten
 * `upstream-manifest.json` im übergebenen `rootDir` (kein injizierbarer
 * Manifest-Reader — Testbarkeit läuft über `rootDir`, siehe Plan). Für die
 * Fälle, in denen der Fetch-Schritt tatsächlich läuft, kopiert diese Hilfe
 * das eingecheckte, gültige Manifest des Hauptcheckouts in ein Scratch-
 * Verzeichnis — Aufbau einer eigenen, korrekt signierten Manifest-v2-Fixture
 * von Hand wäre nur eine Kopie von computeManifestSignature() in
 * upstream-artifacts.mjs und liefe der Fixture ständig hinterher.
 */
async function withValidManifest(rootDir: string) {
  await copyFile(TRACKED_MANIFEST_PATH, join(rootDir, 'upstream-manifest.json'));
  const manifest = JSON.parse(await readFile(join(rootDir, 'upstream-manifest.json'), 'utf8'));
  return manifest.snapshotCommitSha as string;
}

type RecordedCall = {
  step: 'install' | 'verify' | 'fetch' | 'unknown';
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

function classifyCall(args: string[]): RecordedCall['step'] {
  if (args.includes('ci')) return 'install';
  if (args.some((arg) => arg.endsWith('verify-oscal-schemas.mjs'))) return 'verify';
  if (args.some((arg) => arg.endsWith('fetch-catalog.mjs'))) return 'fetch';
  return 'unknown';
}

function createStubRun(exitCodes: Partial<Record<RecordedCall['step'], number>> = {}) {
  const calls: RecordedCall[] = [];
  const run = vi.fn(async (command: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}) => {
    const step = classifyCall(args);
    calls.push({ step, command, args, env: options.env ?? {} });
    return exitCodes[step] ?? 0;
  });
  return { run, calls };
}

function freshResult() {
  return {
    state: 'fresh',
    source: 'local-metadata',
    expectedSnapshotSha: 'a'.repeat(40),
    foundSnapshotSha: 'a'.repeat(40),
    expectedSignatureSha256: 'b'.repeat(64),
    foundSignatureSha256: 'b'.repeat(64),
  };
}

function missingResult() {
  return {
    state: 'missing',
    source: 'local-metadata',
    expectedSnapshotSha: 'a'.repeat(40),
    foundSnapshotSha: null,
    expectedSignatureSha256: 'b'.repeat(64),
    foundSignatureSha256: null,
  };
}

function staleResult() {
  return {
    state: 'stale',
    source: 'local-metadata',
    expectedSnapshotSha: 'a'.repeat(40),
    foundSnapshotSha: 'c'.repeat(40),
    expectedSignatureSha256: 'b'.repeat(64),
    foundSignatureSha256: 'd'.repeat(64),
  };
}

function createSequenceFreshness(results: ReturnType<typeof freshResult>[]) {
  const queue = [...results];
  return vi.fn(async () => queue.shift() ?? freshResult());
}

describe('scripts/bootstrap.mjs — runBootstrap', () => {
  let scratchRoot: string;

  beforeEach(async () => {
    scratchRoot = await mkdtemp(resolve(tmpdir(), 'navigator-bootstrap-'));
  });

  afterEach(async () => {
    await rm(scratchRoot, { recursive: true, force: true });
  });

  it('liest die Snapshot-SHA aus dem eingecheckten Manifest und pinnt sie für den Fetch', async () => {
    const pinnedSha = await withValidManifest(scratchRoot);
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([missingResult(), freshResult()]);

    const result = await runBootstrap({
      rootDir: scratchRoot,
      env: {},
      run,
      log: () => {},
      freshness,
    });

    expect(result.fetchSkipped).toBe(false);
    const fetchCall = calls.find((call) => call.step === 'fetch');
    expect(fetchCall?.env.BSI_SNAPSHOT_SHA).toBe(pinnedSha);
  });

  it('übergibt die aus rootDir abgeleiteten Pfade an die Freshness-Prüfung statt gegen REPO_ROOT aufzulösen', async () => {
    const { run } = createStubRun();
    const freshness = createSequenceFreshness([freshResult()]);

    await runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness });

    expect(freshness).toHaveBeenCalledWith({
      manifestPath: join(scratchRoot, 'upstream-manifest.json'),
      metadataPath: join(scratchRoot, 'public', 'data', 'upstream-sources-metadata.json'),
    });
  });

  it('lässt ein bereits gesetztes BSI_SNAPSHOT_SHA unangetastet', async () => {
    await withValidManifest(scratchRoot);
    const preset = 'f'.repeat(40);
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([missingResult(), freshResult()]);

    await runBootstrap({
      rootDir: scratchRoot,
      env: { BSI_SNAPSHOT_SHA: preset },
      run,
      log: () => {},
      freshness,
    });

    const fetchCall = calls.find((call) => call.step === 'fetch');
    expect(fetchCall?.env.BSI_SNAPSHOT_SHA).toBe(preset);
  });

  it('bricht ab, wenn die eingecheckte upstream-manifest.json fehlt', async () => {
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([missingResult()]);

    await expect(
      runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness }),
    ).rejects.toThrow(BootstrapError);
    expect(calls.some((call) => call.step === 'fetch')).toBe(false);
  });

  it('bricht ab, wenn die eingecheckte upstream-manifest.json ungültig ist', async () => {
    await writeFile(join(scratchRoot, 'upstream-manifest.json'), '{ das ist kein json', 'utf8');
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([staleResult()]);

    await expect(
      runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness }),
    ).rejects.toThrow(BootstrapError);
    expect(calls.some((call) => call.step === 'fetch')).toBe(false);
  });

  it('überspringt den Fetch bei fresh ohne --force', async () => {
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([freshResult()]);

    const result = await runBootstrap({
      rootDir: scratchRoot,
      force: false,
      env: {},
      run,
      log: () => {},
      freshness,
    });

    expect(result.fetchSkipped).toBe(true);
    expect(calls.some((call) => call.step === 'fetch')).toBe(false);
    expect(freshness).toHaveBeenCalledTimes(1);
  });

  it('erzwingt den Fetch bei fresh mit --force', async () => {
    await withValidManifest(scratchRoot);
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([freshResult(), freshResult()]);

    const result = await runBootstrap({
      rootDir: scratchRoot,
      force: true,
      env: {},
      run,
      log: () => {},
      freshness,
    });

    expect(result.fetchSkipped).toBe(false);
    expect(calls.some((call) => call.step === 'fetch')).toBe(true);
  });

  it.each([
    ['missing', missingResult()],
    ['stale', staleResult()],
  ])('löst bei Zustand %s einen Fetch aus', async (_label, initialState) => {
    await withValidManifest(scratchRoot);
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([initialState, freshResult()]);

    const result = await runBootstrap({
      rootDir: scratchRoot,
      env: {},
      run,
      log: () => {},
      freshness,
    });

    expect(result.fetchSkipped).toBe(false);
    expect(calls.some((call) => call.step === 'fetch')).toBe(true);
  });

  it('bricht ab, wenn der Katalog nach dem Fetch weiterhin nicht fresh ist', async () => {
    await withValidManifest(scratchRoot);
    const { run } = createStubRun();
    const freshness = createSequenceFreshness([missingResult(), staleResult()]);

    await expect(
      runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness }),
    ).rejects.toThrow(BootstrapError);
  });

  it('hält die Reihenfolge ein: verify-oscal-schemas läuft vor jedem Netzschritt', async () => {
    await withValidManifest(scratchRoot);
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([missingResult(), freshResult()]);

    await runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness });

    const steps = calls.map((call) => call.step);
    expect(steps).toEqual(['install', 'verify', 'fetch']);
  });

  it('meldet die fehlende .env.local als Hinweis, ohne den Lauf abzubrechen', async () => {
    const { run } = createStubRun();
    const freshness = createSequenceFreshness([freshResult()]);
    const logLines: string[] = [];

    const result = await runBootstrap({
      rootDir: scratchRoot,
      env: {},
      run,
      log: (message: string) => logLines.push(message),
      freshness,
    });

    expect(result.envLocalPresent).toBe(false);
    expect(logLines.some((line) => line.includes('.env.local.example'))).toBe(true);
  });

  it('unterdrückt den Hinweis, wenn .env.local vorhanden ist', async () => {
    await writeFile(join(scratchRoot, '.env.local'), 'VITE_IMPRESSUM_NAME=Test\n', 'utf8');
    const { run } = createStubRun();
    const freshness = createSequenceFreshness([freshResult()]);
    const logLines: string[] = [];

    const result = await runBootstrap({
      rootDir: scratchRoot,
      env: {},
      run,
      log: (message: string) => logLines.push(message),
      freshness,
    });

    expect(result.envLocalPresent).toBe(true);
    expect(logLines.some((line) => line.includes('.env.local.example'))).toBe(false);
  });

  it('bricht ab, wenn npm ci --ignore-scripts fehlschlägt', async () => {
    const { run } = createStubRun({ install: 1 });
    const freshness = createSequenceFreshness([freshResult()]);

    await expect(
      runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness }),
    ).rejects.toThrow(BootstrapError);
  });

  it('bricht ab, wenn verify-oscal-schemas fehlschlägt, und lässt keinen Netzschritt mehr folgen', async () => {
    await withValidManifest(scratchRoot);
    const { run, calls } = createStubRun({ verify: 1 });
    // Freshness würde einen Fetch auslösen (missing) — genau deshalb ist dieser
    // Fall aussagekräftig: das gerissene Offline-Gate muss den Netzschritt
    // verhindern, obwohl die Schrittplanung ihn vorsehen würde.
    const freshness = createSequenceFreshness([missingResult()]);

    await expect(
      runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness }),
    ).rejects.toThrow(BootstrapError);

    expect(calls.map((call) => call.step)).toEqual(['install', 'verify']);
    expect(calls.some((call) => call.step === 'fetch')).toBe(false);
  });

  it('bricht ab, wenn der Katalog-Fetch fehlschlägt', async () => {
    await withValidManifest(scratchRoot);
    const { run, calls } = createStubRun({ fetch: 1 });
    const freshness = createSequenceFreshness([missingResult()]);

    await expect(
      runBootstrap({ rootDir: scratchRoot, env: {}, run, log: () => {}, freshness }),
    ).rejects.toThrow(BootstrapError);

    expect(calls.map((call) => call.step)).toEqual(['install', 'verify', 'fetch']);
  });

  it('startet npm über npm_execpath und process.execPath, wenn gesetzt (regulärer npm-run-Aufruf)', async () => {
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([freshResult()]);
    const npmExecPath = '/irgendwo/npm-cli.js';

    await runBootstrap({
      rootDir: scratchRoot,
      env: { npm_execpath: npmExecPath },
      run,
      log: () => {},
      freshness,
    });

    const installCall = calls.find((call) => call.step === 'install');
    expect(installCall?.command).toBe(process.execPath);
    expect(installCall?.args).toEqual([npmExecPath, 'ci', '--ignore-scripts']);
  });

  it('fällt ohne npm_execpath auf den npm-Befehl zurück', async () => {
    const { run, calls } = createStubRun();
    const freshness = createSequenceFreshness([freshResult()]);

    await runBootstrap({
      rootDir: scratchRoot,
      env: {},
      run,
      log: () => {},
      freshness,
    });

    const installCall = calls.find((call) => call.step === 'install');
    expect(installCall?.command).toBe(process.platform === 'win32' ? 'npm.cmd' : 'npm');
    expect(installCall?.args).toEqual(['ci', '--ignore-scripts']);
  });
});

describe('scripts/bootstrap.mjs — parseArgs', () => {
  it('erkennt --force und --help unabhängig voneinander', () => {
    expect(parseArgs([])).toEqual({ force: false, help: false });
    expect(parseArgs(['--force'])).toEqual({ force: true, help: false });
    expect(parseArgs(['--help'])).toEqual({ force: false, help: true });
    expect(parseArgs(['--force', '--help'])).toEqual({ force: true, help: true });
  });
});

describe('scripts/bootstrap.mjs — CLI-Vertrag', () => {
  it('node scripts/bootstrap.mjs --help beendet sich mit Exit 0 ohne Seiteneffekt', async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [resolve(import.meta.dirname, 'bootstrap.mjs'), '--help'],
      { cwd: REPO_ROOT, timeout: 15_000 },
    );
    expect(stdout).toContain('--force');
    expect(stdout).toContain('--help');
  }, 15_000);
});
