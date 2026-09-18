import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

import {
  FORK_SKIP_MESSAGE,
  MISSING_TOKEN_MESSAGE,
  SonarTokenGuardError,
  resolveAnalysisAvailability,
} from './sonar-token-guard.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/sonar-token-guard.mjs');
const temporaryDirectories = new Set<string>();

async function run(
  env: Record<string, string>,
  { withGithubOutput = true }: { withGithubOutput?: boolean } = {},
) {
  const directory = await mkdtemp(resolve(tmpdir(), 'gspp-sonar-token-guard-'));
  temporaryDirectories.add(directory);
  const githubOutput = resolve(directory, 'github-output.txt');
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, ...env };
  if (withGithubOutput) {
    childEnv.GITHUB_OUTPUT = githubOutput;
  }

  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: directory,
    encoding: 'utf8',
    env: childEnv,
  });

  return { ...result, githubOutput };
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

describe('resolveAnalysisAvailability', () => {
  it('enables the analysis whenever a token is present', () => {
    expect(resolveAnalysisAvailability({ sonarToken: 'token', isFork: 'true' })).toEqual({
      available: true,
    });
  });

  it('skips the analysis for a fork contribution without a token', () => {
    expect(resolveAnalysisAvailability({ sonarToken: '', isFork: 'true' })).toEqual({
      available: false,
      notice: FORK_SKIP_MESSAGE,
    });
  });

  // Fail-closed: Alles, was nicht ausdrücklich als Fork-Lauf gemeldet ist,
  // gilt als eigenes Repository mit defekter Konfiguration.
  it.each([undefined, '', 'false', 'TRUE', 'yes'])(
    'fails without a token when IS_FORK is %j',
    (isFork) => {
      expect(() => resolveAnalysisAvailability({ sonarToken: undefined, isFork })).toThrow(
        SonarTokenGuardError,
      );
    },
  );
});

describe('sonar-token-guard CLI', () => {
  it('writes available=true and emits no annotation when the token is present', async () => {
    const result = await run({ SONAR_TOKEN: 'token', IS_FORK: 'false' });

    expect(result.status).toBe(0);
    expect(await readFile(result.githubOutput, 'utf8')).toBe('available=true\n');
    expect(result.stdout).not.toContain('::notice::');
  });

  it('writes available=false and reports the skip visibly for a fork run', async () => {
    const result = await run({ SONAR_TOKEN: '', IS_FORK: 'true' });

    expect(result.status).toBe(0);
    expect(await readFile(result.githubOutput, 'utf8')).toBe('available=false\n');
    expect(result.stdout).toContain(`::notice::${FORK_SKIP_MESSAGE}`);
  });

  it('fails without writing an output when the token is missing outside a fork', async () => {
    const result = await run({ SONAR_TOKEN: '', IS_FORK: 'false' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`::error::${MISSING_TOKEN_MESSAGE}`);
    await expect(readFile(result.githubOutput, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails when GITHUB_OUTPUT is not set', async () => {
    const result = await run({ SONAR_TOKEN: 'token' }, { withGithubOutput: false });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GITHUB_OUTPUT ist nicht gesetzt');
  });
});
