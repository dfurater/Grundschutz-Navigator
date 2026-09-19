import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { namedStep, readDefinitions, runScript } from './workflowDefinitions.mjs';

const WORKFLOW_NAMES = [
  'backmerge-main-to-develop.yml',
  'ci.yml',
  'deploy.yml',
  'greptile-review-nudge.yml',
  'release-prepare.yml',
  'sonar.yml',
  'update-catalog.yml',
  'validate.yml',
  'verify-catalog-merge.yml',
] as const;

/*
 * Bis GSPP-419 stand der manifestlesende Block wortgleich in validate.yml,
 * sonar.yml und deploy.yml, und diese Datei führte ihn dreimal gegen dieselben
 * sechs Fehlerfälle aus. Seither trägt ihn $/.github/actions/fetch-pinned-catalog
 * einmal; die Verhaltensprüfung läuft entsprechend einmal gegen die gemeinsame
 * Quelle. Damit die Zusammenführung nicht stillschweigend zurückfällt, prüft
 * `keeps the manifest block in exactly one place` zusätzlich, dass keine
 * Workflow-Datei wieder eine eigene Kopie führt.
 */
const MANIFEST_ACTION = '.github/actions/fetch-pinned-catalog/action.yml';
const MANIFEST_STEP = 'Read pinned snapshot SHA from manifest';

const INVALID_MANIFEST_CASES = [
  {
    name: 'missing file',
    contents: undefined,
    error: 'upstream-manifest.json ist nicht lesbar oder enthält keine snapshotCommitSha.',
  },
  {
    name: 'malformed JSON',
    contents: '{ invalid json\n',
    error: 'upstream-manifest.json ist nicht lesbar oder enthält keine snapshotCommitSha.',
  },
  {
    name: 'missing snapshotCommitSha',
    contents: '{}\n',
    error: 'upstream-manifest.json ist nicht lesbar oder enthält keine snapshotCommitSha.',
  },
  {
    name: 'non-string snapshotCommitSha',
    contents: '{"snapshotCommitSha": 123}\n',
    error: 'upstream-manifest.json ist nicht lesbar oder enthält keine snapshotCommitSha.',
  },
  {
    name: 'empty snapshotCommitSha',
    contents: '{"snapshotCommitSha": ""}\n',
    error: 'upstream-manifest.json enthält keine gültige 40-stellige snapshotCommitSha.',
  },
  {
    name: 'short snapshotCommitSha',
    contents: '{"snapshotCommitSha": "abc"}\n',
    error: 'upstream-manifest.json enthält keine gültige 40-stellige snapshotCommitSha.',
  },
] as const;

const temporaryDirectories = new Set<string>();

async function workflow(name: string): Promise<string> {
  return readFile(resolve(process.cwd(), '.github/workflows', name), 'utf8');
}

async function definition(path: string): Promise<string> {
  return readFile(resolve(process.cwd(), path), 'utf8');
}

function jobScopes(workflowContent: string): Map<string, string> {
  const [, jobs = ''] = workflowContent.split('\njobs:\n');
  const headers = [...jobs.matchAll(/^\x20{2}([\w-]+):\n/gm)];

  return new Map(
    headers.map((header, index) => [
      header[1],
      jobs.slice(header.index, headers[index + 1]?.index ?? jobs.length),
    ]),
  );
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

describe('CI failure visibility contract', () => {
  // GSPP-423 staffelt die Job-Timeouts nach Schrittinventar statt uniform 20:
  // 5 min für den Sekunden-Job (ein API-Read, ein Kommentar-Write, Node-Guard),
  // 10 min für `npm ci` + kurze Node-Skripte ohne Build/Browser, 20 min für
  // Suite/Build/Scan bzw. Netz-Varianz beim Upstream-Fetch (bewusst nicht
  // verschärft ohne Laufzeitmessung), 30 min für `verify-catalog-merge`
  // (16-min-Budget aus scripts/verify-catalog-deploy.mjs plus Puffer für
  // Checkout, Verify und Dispatch).
  it('enforces the staggered job timeouts across all nine workflows', async () => {
    const expectedTimeouts: Record<string, Record<string, number>> = {
      'backmerge-main-to-develop.yml': { backmerge: 10 },
      'ci.yml': { 'documentation-contract': 10, 'catalog-sync-guard': 10 },
      'deploy.yml': { idempotency_guard: 20, 'build-and-deploy': 20 },
      'greptile-review-nudge.yml': { 'greptile-review-nudge': 5 },
      'release-prepare.yml': { prepare: 10 },
      'sonar.yml': { sonarqube: 20 },
      'update-catalog.yml': { 'check-and-sync': 20 },
      'validate.yml': { validate: 20, sonarqube: 20 },
      'verify-catalog-merge.yml': { 'verify-catalog-merge': 30 },
    };
    let jobCount = 0;

    for (const name of WORKFLOW_NAMES) {
      const scopes = jobScopes(await workflow(name));
      const expectedJobs = expectedTimeouts[name];
      expect(scopes.size, `${name} must contain at least one job`).toBeGreaterThan(0);
      // Fail-closed bei neuen oder entfernten Jobs: Der Schlüsselsatz muss
      // exakt der Staffel-Map entsprechen, sonst meldet der Test statt
      // stillschweigend ein uniformes Limit zu prüfen.
      expect([...scopes.keys()].sort(), `${name} job set`).toEqual(Object.keys(expectedJobs).sort());
      jobCount += scopes.size;

      for (const [job, scope] of scopes) {
        const limit = expectedJobs[job];
        expect(scope, `${name}:${job}`).toMatch(
          new RegExp(`^\\x20{4}timeout-minutes: ${limit}$`, 'm'),
        );
      }
    }

    // GSPP-418 bettet zizmor als Schritte in den `validate`-Job ein (kein
    // eigener Job — ein neuer Jobname wäre ein neuer Check-Kontext außerhalb
    // beider Rulesets): 12 Jobs wie vor GSPP-418. GSPP-419 verschiebt Schritte
    // in Composite Actions, ohne einen Job anzulegen oder aufzulösen.
    expect(jobCount).toBe(12);
  });

  // Der Token-Guard war bis GSPP-416 der fuenfte Eintrag. Er ist seither kein
  // Shell-Block mehr, sondern scripts/sonar-token-guard.mjs; sein
  // Fehlverhalten deckt scripts/sonar-token-guard.test.ts ab. Seit GSPP-419
  // tragen die drei manifestlesenden Vorkommen eine gemeinsame Quelle, sodass
  // zwei mehrzeilige Ziele bleiben.
  it('enables fail-fast shell handling in both multiline target steps', async () => {
    const targets = [
      [MANIFEST_ACTION, MANIFEST_STEP],
      ['.github/workflows/verify-catalog-merge.yml', 'Dispatch verified fallback deploy'],
    ] as const;

    for (const [path, stepName] of targets) {
      expect(runScript(namedStep(await definition(path), stepName)), `${path}:${stepName}`).toMatch(
        /^set -euo pipefail$/m,
      );
    }
  });

  // Fail-closed gegen einen Rückfall in die Duplikation: Wer den Block in einen
  // Workflow zurückkopiert, entzieht ihn der oben geprüften Fassung, ohne dass
  // ein anderer Test es meldete.
  it('keeps the manifest block in exactly one place', () => {
    const carriers = readDefinitions()
      .filter(({ content }) => content.includes("jq -er '.snapshotCommitSha | strings'"))
      .map(({ label }) => label);

    expect(carriers).toEqual([MANIFEST_ACTION]);
  });

  it('reaches the shared action from every job that builds against the pinned snapshot', async () => {
    for (const name of ['validate.yml', 'sonar.yml', 'deploy.yml'] as const) {
      expect(await workflow(name), name).toContain('uses: $/.github/actions/fetch-pinned-catalog');
    }
  });

  it.each(INVALID_MANIFEST_CASES)(
    'fails the shared manifest-reading step for $name',
    async ({ contents, error }) => {
      const directory = await mkdtemp(resolve(tmpdir(), 'gspp-manifest-step-'));
      temporaryDirectories.add(directory);
      if (contents !== undefined) {
        await writeFile(resolve(directory, 'upstream-manifest.json'), contents, 'utf8');
      }
      const githubOutput = resolve(directory, 'github-output.txt');
      const script = runScript(namedStep(await definition(MANIFEST_ACTION), MANIFEST_STEP));

      const result = spawnSync('bash', ['-c', script], {
        cwd: directory,
        encoding: 'utf8',
        env: { ...process.env, GITHUB_OUTPUT: githubOutput },
      });

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(error);
      await expect(readFile(githubOutput, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    },
  );

  // `required: true` ist bei einer Composite Action nur Dokumentation. Ohne
  // diesen Guard liefe der Fetch mit leerem GH_TOKEN unauthentifiziert weiter
  // und schlüge erst am API-Ratenlimit fehl. Der Erfolgspfad ist hier nicht
  // prüfbar — er führt einen Netzabruf aus.
  it('refuses the catalog fetch without a token', async () => {
    const step = namedStep(await definition(MANIFEST_ACTION), 'Fetch BSI catalog from pinned snapshot');

    const result = spawnSync('bash', ['-c', runScript(step)], {
      encoding: 'utf8',
      env: { ...process.env, GH_TOKEN: '' },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('fetch-pinned-catalog wurde ohne github-token aufgerufen.');
  });

  it('writes the snapshot SHA to the step output on a valid manifest', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'gspp-manifest-step-'));
    temporaryDirectories.add(directory);
    const sha = 'a'.repeat(40);
    await writeFile(
      resolve(directory, 'upstream-manifest.json'),
      `{"snapshotCommitSha": "${sha}"}\n`,
      'utf8',
    );
    const githubOutput = resolve(directory, 'github-output.txt');
    const script = runScript(namedStep(await definition(MANIFEST_ACTION), MANIFEST_STEP));

    const result = spawnSync('bash', ['-c', script], {
      cwd: directory,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_OUTPUT: githubOutput },
    });

    expect(result.status).toBe(0);
    await expect(readFile(githubOutput, 'utf8')).resolves.toBe(`sha=${sha}\n`);
  });
});
