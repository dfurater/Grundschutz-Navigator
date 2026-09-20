import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SCOPE_DOCS_ONLY,
  SCOPE_FULL,
  SCOPE_MANIFEST_ONLY,
  classifyChangedFiles,
  determineScope,
  fetchBaseCommit,
} from './ci-scope.mjs';

const SCRIPT = resolve(process.cwd(), 'scripts/ci-scope.mjs');
const VALIDATE_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/validate.yml');
const temporaryDirectories = new Set<string>();

async function run(
  env: Record<string, string>,
  { withGithubOutput = true }: { withGithubOutput?: boolean } = {},
) {
  const directory = await mkdtemp(resolve(tmpdir(), 'gspp-ci-scope-'));
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

describe('classifyChangedFiles', () => {
  it.each([
    [['README.md']],
    [['docs/ARCHITECTURE.md']],
    [['docs/nested/DETAIL.md']],
    [['LICENSE']],
    [['NOTICE']],
    [['README.md', 'docs/ARCHITECTURE.md', 'LICENSE', 'NOTICE']],
  ])('classifies %j as docs_only', (changedFiles) => {
    expect(classifyChangedFiles(changedFiles)).toBe(SCOPE_DOCS_ONLY);
  });

  it('classifies the lone manifest pin change as manifest_only', () => {
    expect(classifyChangedFiles(['upstream-manifest.json'])).toBe(SCOPE_MANIFEST_ONLY);
  });

  it.each([
    [['src/domain/models.ts']],
    [['README.md', 'src/main.tsx']],
    [['upstream-manifest.json', 'README.md']],
    [['upstream-manifest.json', 'upstream-manifest.json.bak']],
    [['package.json']],
    [['scripts/ci-scope.mjs']],
    [['.github/workflows/validate.yml']],
    [['src/README.md']],
    [[]],
  ])('classifies %j as full', (changedFiles) => {
    expect(classifyChangedFiles(changedFiles)).toBe(SCOPE_FULL);
  });

  it('treats a missing or non-array input as full', () => {
    expect(classifyChangedFiles(undefined as unknown as string[])).toBe(SCOPE_FULL);
  });
});

describe('fetchBaseCommit', () => {
  it('fetches exactly the validated base commit without tags', () => {
    const baseSha = 'a'.repeat(40);
    const execFile = vi.fn();

    fetchBaseCommit({ baseSha, execFile });

    expect(execFile).toHaveBeenCalledWith(
      'git',
      ['fetch', '--no-tags', 'origin', baseSha],
      { encoding: 'utf8' },
    );
  });

  it('rejects an unsafe base SHA before reaching git', () => {
    const execFile = vi.fn();

    expect(() => fetchBaseCommit({ baseSha: 'abc123', execFile })).toThrow(/PR_BASE_SHA/);
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('determineScope', () => {
  const baseSha = 'a'.repeat(40);
  const headSha = 'b'.repeat(40);

  it('returns docs_only without fallback when every file is documentation', () => {
    const fetchFn = vi.fn();
    const diffFn = vi.fn(() => ['README.md', 'docs/ARCHITECTURE.md']);

    expect(determineScope({ baseSha, headSha, fetchFn, diffFn })).toEqual({
      scope: SCOPE_DOCS_ONLY,
      fallback: false,
    });
    expect(fetchFn).toHaveBeenCalledWith({ baseSha });
    expect(diffFn).toHaveBeenCalledWith({ baseSha, headSha });
  });

  it('returns manifest_only when the pin alone changed', () => {
    expect(
      determineScope({
        baseSha,
        headSha,
        fetchFn: vi.fn(),
        diffFn: vi.fn(() => ['upstream-manifest.json']),
      }),
    ).toEqual({ scope: SCOPE_MANIFEST_ONLY, fallback: false });
  });

  it('returns full when product code changed', () => {
    expect(
      determineScope({
        baseSha,
        headSha,
        fetchFn: vi.fn(),
        diffFn: vi.fn(() => ['src/main.tsx']),
      }),
    ).toEqual({ scope: SCOPE_FULL, fallback: false });
  });

  // Fail-closed: Jeder Fetch-/Diff-Fehler ist Volllauf statt Skip.
  it.each([
    { name: 'fetch failure', fetchThrows: true, diffThrows: false },
    { name: 'diff failure', fetchThrows: false, diffThrows: true },
  ])('falls back to full on $name', ({ fetchThrows, diffThrows }) => {
    const fetchFn = vi.fn(() => {
      if (fetchThrows) throw new Error('fetch failed');
    });
    const diffFn = vi.fn(() => {
      if (diffThrows) throw new Error('diff failed');
      return ['README.md'];
    });

    const result = determineScope({ baseSha, headSha, fetchFn, diffFn });

    expect(result.scope).toBe(SCOPE_FULL);
    expect(result.fallback).toBe(true);
  });
});

describe('ci-scope CLI', () => {
  it('writes scope=full and stays green when the SHAs are unusable', async () => {
    const result = await run({ PR_BASE_SHA: 'abc123', PR_HEAD_SHA: '' });

    expect(result.status).toBe(0);
    expect(await readFile(result.githubOutput, 'utf8')).toBe('scope=full\n');
    expect(result.stdout).toContain('::notice::');
    expect(result.stdout).toContain('CI scope: full.');
  });

  it('fails when GITHUB_OUTPUT is not set', async () => {
    const result = await run({ PR_BASE_SHA: 'a'.repeat(40) }, { withGithubOutput: false });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('GITHUB_OUTPUT ist nicht gesetzt');
  });
});

describe('validate lane scope wiring', () => {
  const workflow = () => readFileSync(VALIDATE_WORKFLOW_PATH, 'utf8');

  it('decides the scope once in an early step with the PR SHAs', () => {
    expect(workflow()).toContain('id: scope');
    expect(workflow()).toContain('run: node scripts/ci-scope.mjs');
    expect(workflow()).toContain('PR_BASE_SHA: ${{ github.event.pull_request.base.sha }}');
    expect(workflow()).toContain('PR_HEAD_SHA: ${{ github.event.pull_request.head.sha }}');
  });

  it('keeps the expensive upstream verification off docs_only', () => {
    expect(workflow()).toContain("steps.scope.outputs.scope != 'docs_only'");
  });

  it('keeps browser, egress and build on the full scope only', () => {
    const occurrences = workflow().match(/steps\.scope\.outputs\.scope == 'full'/g) ?? [];

    expect(occurrences.length).toBeGreaterThanOrEqual(3);
  });

  it('carries no workflow path filter that could suppress required runs', () => {
    const triggerStart = workflow().indexOf('\non:\n');
    const triggerEnd = workflow().indexOf('\npermissions:');

    expect(triggerStart).toBeGreaterThan(-1);
    expect(triggerEnd).toBeGreaterThan(triggerStart);

    const triggers = workflow().slice(triggerStart, triggerEnd);

    expect(triggers).not.toContain('paths');
  });
});
