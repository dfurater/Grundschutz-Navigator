import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import {
  FORK_SKIP_MESSAGE,
  MISSING_TOKEN_MESSAGE,
  SonarTokenGuardError,
  resolveAnalysisAvailability,
} from './sonar-token-guard.mjs';
import { createGuardCliRunner } from './guard-cli-test-helper';

const { run } = createGuardCliRunner(
  'scripts/sonar-token-guard.mjs',
  'gspp-sonar-token-guard-',
);

describe('resolveAnalysisAvailability', () => {
  it('enables the analysis whenever the token is reported as available', () => {
    expect(resolveAnalysisAvailability({ tokenAvailable: 'true', isFork: 'true' })).toEqual({
      available: true,
    });
  });

  it('skips the analysis for a fork contribution without a token', () => {
    expect(resolveAnalysisAvailability({ tokenAvailable: 'false', isFork: 'true' })).toEqual({
      available: false,
      notice: FORK_SKIP_MESSAGE,
    });
  });

  // Fail-closed: Alles, was nicht ausdrücklich als Fork-Lauf gemeldet ist,
  // gilt als eigenes Repository mit defekter Konfiguration.
  it.each([undefined, '', 'false', 'TRUE', 'yes'])(
    'fails without a token when IS_FORK is %j',
    (isFork) => {
      expect(() => resolveAnalysisAvailability({ tokenAvailable: 'false', isFork })).toThrow(
        SonarTokenGuardError,
      );
    },
  );

  // Fail-closed auch auf der Tokenseite: Nur die ausdrückliche Zeichenkette
  // `true` schaltet die Analyse frei.
  it.each([undefined, '', 'false', 'TRUE', 'yes'])(
    'treats %j as no available token',
    (tokenAvailable) => {
      expect(resolveAnalysisAvailability({ tokenAvailable, isFork: 'true' })).toEqual({
        available: false,
        notice: FORK_SKIP_MESSAGE,
      });
    },
  );
});

describe('sonar-token-guard CLI', () => {
  it('writes available=true and emits no annotation when the token is present', async () => {
    const result = await run({ SONAR_TOKEN_AVAILABLE: 'true', IS_FORK: 'false' });

    expect(result.status).toBe(0);
    expect(await readFile(result.githubOutput, 'utf8')).toBe('available=true\n');
    expect(result.stdout).not.toContain('::notice::');
  });

  it('writes available=false and reports the skip visibly for a fork run', async () => {
    const result = await run({ SONAR_TOKEN_AVAILABLE: 'false', IS_FORK: 'true' });

    expect(result.status).toBe(0);
    expect(await readFile(result.githubOutput, 'utf8')).toBe('available=false\n');
    expect(result.stdout).toContain(`::notice::${FORK_SKIP_MESSAGE}`);
  });

  it('fails without writing an output when the token is missing outside a fork', async () => {
    const result = await run({ SONAR_TOKEN_AVAILABLE: 'false', IS_FORK: 'false' });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`::error::${MISSING_TOKEN_MESSAGE}`);
    await expect(readFile(result.githubOutput, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails when GITHUB_OUTPUT is not set', async () => {
    const result = await run({ SONAR_TOKEN_AVAILABLE: 'true' }, { withGithubOutput: false });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GITHUB_OUTPUT ist nicht gesetzt');
  });
});
