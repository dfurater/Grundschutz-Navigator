import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach } from 'vitest';

/*
 * Gemeinsamer spawnSync-Rahmen für die CLI-Tests der fail-closed Guards
 * (GSPP-427, Muster: `scripts/githubApiFetch.mjs` aus GSPP-425).
 *
 * `scripts/sonar-token-guard.test.ts` und `scripts/ci-scope.test.ts` führten
 * je eine deckungsgleiche Kopie dieses Rahmens (Temp-Verzeichnis,
 * `GITHUB_OUTPUT`-Ablage, Prozessstart, Aufräumen); die zwei identischen
 * Blöcke kippten die Sonar-Duplikatsmessung für neuen Code. Der Rahmen steht
 * deshalb genau einmal hier. Guard-spezifische Env-Variablen und
 * Zusicherungen bleiben bewusst beim jeweiligen Test.
 */
export function createGuardCliRunner(scriptFile: string, tmpPrefix: string) {
  const script = resolve(process.cwd(), scriptFile);
  const temporaryDirectories = new Set<string>();

  afterEach(async () => {
    await Promise.all(
      [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
    );
    temporaryDirectories.clear();
  });

  async function run(
    env: Record<string, string>,
    { withGithubOutput = true }: { withGithubOutput?: boolean } = {},
  ) {
    const directory = await mkdtemp(resolve(tmpdir(), tmpPrefix));
    temporaryDirectories.add(directory);
    const githubOutput = resolve(directory, 'github-output.txt');
    const childEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH, ...env };
    if (withGithubOutput) {
      childEnv.GITHUB_OUTPUT = githubOutput;
    }

    const result = spawnSync(process.execPath, [script], {
      cwd: directory,
      encoding: 'utf8',
      env: childEnv,
    });

    return { ...result, githubOutput };
  }

  return { run };
}
