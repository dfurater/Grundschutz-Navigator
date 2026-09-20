import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  SCOPE_DOCS_ONLY,
  SCOPE_FULL,
  SCOPE_MANIFEST_ONLY,
  classifyChangedFiles,
  determineScope,
  fetchScopeCommits,
} from './ci-scope.mjs';
import { createGuardCliRunner } from './guard-cli-test-helper';
import { namedStep } from './workflowDefinitions.mjs';

const VALIDATE_WORKFLOW_PATH = resolve(process.cwd(), '.github/workflows/validate.yml');

const { run } = createGuardCliRunner('scripts/ci-scope.mjs', 'gspp-ci-scope-');

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

describe('fetchScopeCommits', () => {
  // Der flache Checkout (Merge-Commit ohne Historie) enthält weder das
  // Base- noch das Head-Objekt; ohne beide fände der Drei-Punkt-Diff keine
  // Merge-Basis und fiele stets auf `full` zurück (Greptile-P2 auf PR #273).
  it('fetches base and head commits with history and without tags', () => {
    const baseSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const execFile = vi.fn();

    fetchScopeCommits({ baseSha, headSha, execFile });

    expect(execFile).toHaveBeenCalledTimes(2);
    expect(execFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', '--no-tags', 'origin', baseSha],
      { encoding: 'utf8' },
    );
    expect(execFile).toHaveBeenNthCalledWith(
      2,
      'git',
      ['fetch', '--no-tags', 'origin', headSha],
      { encoding: 'utf8' },
    );
  });

  it('rejects an unsafe SHA before reaching git', () => {
    const execFile = vi.fn();

    expect(() => fetchScopeCommits({ baseSha: 'abc123', headSha: 'b'.repeat(40), execFile }))
      .toThrow(/PR_BASE_SHA/);
    expect(() => fetchScopeCommits({ baseSha: 'a'.repeat(40), headSha: 'xyz', execFile }))
      .toThrow(/PR_HEAD_SHA/);
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
    expect(fetchFn).toHaveBeenCalledWith({ baseSha, headSha });
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

  it('keeps browser cache, chromium, browser tests and egress on the full scope only', () => {
    for (const step of [
      'Restore Playwright browser cache',
      'Install pinned Chromium for browser tests',
      'Run Chromium browser tests',
      'Verify browser egress oracle',
    ]) {
      expect(namedStep(workflow(), step), step).toContain(
        "if: steps.scope.outputs.scope == 'full'",
      );
    }
  });

  // Greptile-P1 auf PR #273: Bei `manifest_only` wechselt der Pin, und erst
  // der Build beweist, dass die neuen Bytes kompilieren und bündeln — nur
  // Browser-Tests und Egress-Nachweis dürfen dort entfallen.
  it('still builds, resolves profiles and verifies upstream on the manifest pin', () => {
    for (const step of [
      'Resolve all BSI profiles deterministically (mandatory build-time corpus)',
      'Verify upstream OSCAL schemas with go-oscal',
      'Archive go-oscal SBOM',
      'Build application',
    ]) {
      expect(namedStep(workflow(), step), step).toContain(
        "if: steps.scope.outputs.scope != 'docs_only'",
      );
    }
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
