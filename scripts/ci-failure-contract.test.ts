import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

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

const MANIFEST_WORKFLOWS = ['validate.yml', 'sonar.yml', 'deploy.yml'] as const;
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
const MANIFEST_FAILURE_CASES = MANIFEST_WORKFLOWS.flatMap((workflowName) =>
  INVALID_MANIFEST_CASES.map((testCase) => ({ workflowName, ...testCase })),
);
const temporaryDirectories = new Set<string>();

async function workflow(name: string): Promise<string> {
  return readFile(resolve(process.cwd(), '.github/workflows', name), 'utf8');
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

function namedStep(workflowContent: string, name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = workflowContent.indexOf(marker);
  if (start < 0) throw new Error(`Workflow step not found: ${name}`);

  const next = workflowContent.indexOf('\n      - name:', start + marker.length);
  return workflowContent.slice(start, next < 0 ? workflowContent.length : next);
}

function runScript(step: string): string {
  const marker = '        run: |\n';
  const start = step.indexOf(marker);
  if (start < 0) throw new Error('Multiline run block not found');

  return step
    .slice(start + marker.length)
    .split('\n')
    .map((line) => line.replace(/^\x20{10}/, ''))
    .join('\n');
}

afterEach(async () => {
  await Promise.all(
    [...temporaryDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
  );
  temporaryDirectories.clear();
});

describe('CI failure visibility contract', () => {
  it('limits every job in all nine workflows to 20 minutes', async () => {
    let jobCount = 0;

    for (const name of WORKFLOW_NAMES) {
      const scopes = jobScopes(await workflow(name));
      expect(scopes.size, `${name} must contain at least one job`).toBeGreaterThan(0);
      jobCount += scopes.size;

      for (const [job, scope] of scopes) {
        expect(scope, `${name}:${job}`).toMatch(/^\x20{4}timeout-minutes: 20$/m);
      }
    }

    // GSPP-418 bettet zizmor als Schritte in den `validate`-Job ein (kein
    // eigener Job — ein neuer Jobname wäre ein neuer Check-Kontext außerhalb
    // beider Rulesets): 12 Jobs wie vor GSPP-418.
    expect(jobCount).toBe(12);
  });

  // Der Token-Guard war bis GSPP-416 der fuenfte Eintrag. Er ist seither kein
  // Shell-Block mehr, sondern scripts/sonar-token-guard.mjs; sein
  // Fehlverhalten deckt scripts/sonar-token-guard.test.ts ab.
  it('enables fail-fast shell handling in all four multiline target steps', async () => {
    const targets = [
      ['validate.yml', 'Read pinned snapshot SHA from manifest'],
      ['sonar.yml', 'Read pinned snapshot SHA from manifest'],
      ['deploy.yml', 'Read pinned snapshot SHA from manifest'],
      ['verify-catalog-merge.yml', 'Dispatch verified fallback deploy'],
    ] as const;

    for (const [name, stepName] of targets) {
      expect(runScript(namedStep(await workflow(name), stepName)), `${name}:${stepName}`).toMatch(
        /^set -euo pipefail$/m,
      );
    }
  });

  it.each(MANIFEST_FAILURE_CASES)(
    'fails the manifest-reading step in $workflowName for $name',
    async ({ workflowName, contents, error }) => {
      const directory = await mkdtemp(resolve(tmpdir(), 'gspp-manifest-step-'));
      temporaryDirectories.add(directory);
      if (contents !== undefined) {
        await writeFile(resolve(directory, 'upstream-manifest.json'), contents, 'utf8');
      }
      const githubOutput = resolve(directory, 'github-output.txt');
      const script = runScript(
        namedStep(await workflow(workflowName), 'Read pinned snapshot SHA from manifest'),
      );

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
});
