// @vitest-environment node
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Die Direct-Execution-Zweige der S7785-umgebauten Skripte laufen nur, wenn das
 * Skript als CLI gestartet wird (`isDirectExecution`); Import-Tests sehen diesen
 * Pfad nie. Diese Suite startet die Skripte deshalb in echten Node-Kindprozessen
 * und pinnt die Exit-Code-Verträge:
 *
 *   - check-deploy-idempotency: fail-open (Exit 0 — deployen statt abbrechen)
 *   - verify-oscal-schemas:     fail-closed (Exit 0 bei Erfolg, Exit 1 bei Befund)
 *   - verify-catalog-deploy:    fail-closed (Exit 1 bei Verifikationsversagen)
 *
 * `sync-oscal-schemas` ist bewusst nicht darunter: Sein CLI-Pfad ruft ohne
 * Netzzugriff nichts Sinnvolles auf (es werden immer die 30 Upstream-Schemas
 * geholt); die Kernlogik ist in `sync-oscal-schemas.test.ts` über injiziertes
 * `fetchImpl` abgedeckt, und sein try/catch ist textgleich mit dem des
 * offline getesteten `verify-oscal-schemas`.
 */
async function runScript(scriptName: string, {
  args = [],
  cwd = resolve(import.meta.dirname, '..'),
  env = {},
}: {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
} = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [resolve(import.meta.dirname, scriptName), ...args],
      { cwd, timeout: 60_000, env: { ...process.env, ...env } },
    );
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : 1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('CLI-Exit-Code-Verträge der S7785-umgebauten Skripte', () => {
  let scratchRoot: string;

  beforeAll(async () => {
    scratchRoot = await mkdtemp(resolve(tmpdir(), 'navigator-cli-contract-'));
  });

  afterAll(async () => {
    if (scratchRoot) {
      await rm(scratchRoot, { recursive: true, force: true });
    }
  });

  it('check-deploy-idempotency bleibt fail-open: ohne CI-Umgebung Exit 0 und deployen', async () => {
    const result = await runScript('check-deploy-idempotency.mjs', {
      env: {
        GITHUB_REPOSITORY: '',
        GITHUB_SHA: '',
        GITHUB_RUN_ID: '',
        GITHUB_TOKEN: '',
        GH_TOKEN: '',
        GITHUB_OUTPUT: '',
      },
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('deploying without an idempotency check');
  }, 60_000);

  it('verify-oscal-schemas verifiziert die eingecheckten Schemas mit Exit 0', async () => {
    const result = await runScript('verify-oscal-schemas.mjs');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('verifiziert');
  }, 60_000);

  it('verify-oscal-schemas schlägt mit Exit 1 fehl, wenn die Schemas fehlen', async () => {
    const result = await runScript('verify-oscal-schemas.mjs', { cwd: scratchRoot });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Gepinntes Schema fehlt');
  }, 60_000);

  it('verify-catalog-deploy failt mit Exit 1, bevor ein Netzaufruf passiert', async () => {
    const result = await runScript('verify-catalog-deploy.mjs', {
      env: {
        GITHUB_REPOSITORY: 'dfurater/Grundschutz-Navigator',
        MERGE_COMMIT_SHA: 'not-a-full-sha',
        SNAPSHOT_SHA: 'snapshot',
        SIGNATURE: 'signature',
      },
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('merge commit SHA must be a full 40-character SHA');
  }, 60_000);
});
