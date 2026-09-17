import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { vi } from 'vitest';
import { createGitRunner } from './backmerge-main-to-develop.mjs';
import { TRACKED_MANIFEST_PATH } from './catalog-sync-guard.mjs';

/**
 * Gemeinsame Testvorlage für die Übernahme- und die Release-Lane.
 *
 * Beide rechnen gegen Remote-Tracking-Refs, pushen und lesen `ls-remote`. Ein
 * gemocktes git würde genau die Eigenschaften nicht prüfen, auf die es dabei
 * ankommt — Merge-Basen, Ancestry, Baum-Identität. Die Vorlage legt deshalb
 * zwei echte Repositories an: ein bare `origin` und einen Arbeitsbaum mit den
 * Linien `main` und `develop`.
 */

const execFileAsync = promisify(execFile);

/**
 * Unter GitHub Actions ist `RUNNER_TEMP` das für den Lauf vorgesehene und am
 * Ende aufgeräumte Verzeichnis; lokal ist es das Systemtemp.
 */
export function getAllowedTempRoot() {
  return process.env.RUNNER_TEMP ?? tmpdir();
}

export interface BranchLineFixture {
  root: string;
  work: string;
  origin: string;
  git: ReturnType<typeof createGitRunner>;
  /** Führt git im Arbeitsbaum aus und gibt die getrimmte Ausgabe zurück. */
  run: (...args: string[]) => Promise<string>;
  /** Committet alles Vorliegende und gibt den neuen HEAD-SHA zurück. */
  commit: (message: string) => Promise<string>;
  /** Schreibt ein Manifest mit dem angegebenen Snapshot in den Arbeitsbaum. */
  writeManifest: (snapshotCommitSha: string) => Promise<void>;
}

/**
 * Sammelt die angelegten Wurzeln, damit ein `afterEach` sie wieder entfernen
 * kann, ohne dass jeder Test das selbst führen muss.
 */
export function createFixtureRegistry() {
  const roots: string[] = [];
  return {
    register(root: string) {
      roots.push(root);
    },
    async cleanup() {
      while (roots.length > 0) {
        const root = roots.pop();
        if (root) await rm(root, { recursive: true, force: true });
      }
    },
  };
}

export async function createBranchLineFixture(
  registry?: { register: (root: string) => void },
): Promise<BranchLineFixture> {
  const root = await mkdtemp(join(getAllowedTempRoot(), 'branch-lines-'));
  registry?.register(root);
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');

  await execFileAsync('git', ['init', '--quiet', '--bare', '--initial-branch=main', origin]);
  await execFileAsync('git', ['init', '--quiet', '--initial-branch=main', work]);

  const run = async (...args: string[]) =>
    (await execFileAsync('git', ['-C', work, ...args], { encoding: 'utf8' })).stdout.trim();

  await run('config', 'user.email', 'branch-line-test@example.invalid');
  await run('config', 'user.name', 'Branch Line Test');
  await run('config', 'commit.gpgsign', 'false');
  await run('remote', 'add', 'origin', origin);

  const commit = async (message: string) => {
    await run('add', '--all');
    await run('commit', '--quiet', '--allow-empty', '--message', message);
    return run('rev-parse', 'HEAD');
  };

  const writeManifest = async (snapshotCommitSha: string) => {
    await writeFile(
      join(work, TRACKED_MANIFEST_PATH),
      `${JSON.stringify({ schemaVersion: 2, snapshotCommitSha, files: [] }, null, 2)}\n`,
      'utf8',
    );
  };

  return { root, work, origin, git: createGitRunner({ cwd: work }), run, commit, writeManifest };
}

/** Gemeinsamer Ausgangsstand: `main` und `develop` auf demselben Commit. */
export async function seedBothLines(fixture: BranchLineFixture, snapshotCommitSha?: string) {
  if (snapshotCommitSha !== undefined) await fixture.writeManifest(snapshotCommitSha);
  await writeFile(join(fixture.work, 'README.md'), '# Fixture\n', 'utf8');
  await fixture.commit('chore: Ausgangsstand');
  await fixture.run('branch', 'develop');
  await fixture.run('push', '--quiet', 'origin', 'main', 'develop');
}

/**
 * Legt einen Commit auf der genannten Linie an und pusht ihn. Gibt den SHA
 * zurück — meist der Stand, gegen den der Test anschließend prüft.
 */
export async function commitOnLine(
  fixture: BranchLineFixture,
  line: string,
  { path, contents, message }: { path: string; contents: string; message: string },
) {
  await fixture.run('switch', '--quiet', line);
  const target = join(fixture.work, path);
  // Pfade in Unterverzeichnissen sind der Regelfall, sobald ein Test echten
  // Produktcode nachstellt (`src/…`) — `writeFile` legt sie nicht selbst an.
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
  const sha = await fixture.commit(message);
  await fixture.run('push', '--quiet', 'origin', line);
  return sha;
}

/** Die vier Aufrufe, die beide Lanes gegen GitHub absetzen. */
export function createGitHubStub(overrides: Record<string, unknown> = {}) {
  return {
    listMergedPullRequests: vi.fn(async () => [] as { number: number; body: string }[]),
    findOpenPullRequest: vi.fn(async () => null as number | null),
    createPullRequest: vi.fn(async () => 'https://example.invalid/pull/1'),
    updatePullRequest: vi.fn(async ({ number }: { number: number }) => number),
    ...overrides,
  };
}

/** Hält die Testausgabe frei von den Fortschrittsmeldungen der Läufe. */
export const silentLogger = { log: () => {}, error: () => {} };
