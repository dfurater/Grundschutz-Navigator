import { describe, expect, it, vi } from 'vitest';

import { GitChangedFilesError, getChangedFiles, validateGitSha } from './git-changed-files.mjs';

/*
 * Kolokierte Suite zur gemeinsamen NUL-basierten, SHA-validierten
 * Diff-Ermittlung (GSPP-427, Greptile-P2 auf PR #273): Die Logik steht genau
 * einmal in `scripts/git-changed-files.mjs` und wird vom
 * Dokumentationsvertrag wie vom Scope-Entscheider gelesen — ihre
 * Verzweigungen gehören neben die Datei, nicht in die Suites der Verwender.
 */

describe('validateGitSha', () => {
  it('accepts a full Git SHA', () => {
    expect(validateGitSha('a'.repeat(40), 'PR_BASE_SHA')).toBe('a'.repeat(40));
  });

  it('accepts uppercase hex SHAs', () => {
    const sha = 'F'.repeat(40);

    expect(validateGitSha(sha, 'PR_HEAD_SHA')).toBe(sha);
  });

  it.each(['', 'abc123', 'g'.repeat(40), 'a'.repeat(39)])(
    'rejects an unsafe or incomplete Git SHA: %s',
    (sha) => {
      expect(() => validateGitSha(sha, 'PR_HEAD_SHA')).toThrow(/PR_HEAD_SHA/);
    },
  );

  it('rejects a missing SHA as a GitChangedFilesError', () => {
    expect(() => validateGitSha(undefined as unknown as string, 'PR_BASE_SHA')).toThrow(
      GitChangedFilesError,
    );
  });
});

describe('getChangedFiles', () => {
  it('passes validated SHAs directly to git without a shell and parses NUL-separated paths', () => {
    const baseSha = 'a'.repeat(40);
    const headSha = 'b'.repeat(40);
    const execFile = vi.fn(() => 'src/domain/models.ts\0docs/DOMAIN_MODELS.md\0');

    expect(getChangedFiles({ baseSha, headSha, execFile })).toEqual([
      'src/domain/models.ts',
      'docs/DOMAIN_MODELS.md',
    ]);
    expect(execFile).toHaveBeenCalledWith(
      'git',
      [
        'diff',
        '--name-only',
        '--no-renames',
        '--diff-filter=ACMRD',
        '-z',
        `${baseSha}...${headSha}`,
        '--',
      ],
      { encoding: 'utf8' },
    );
  });

  it('drops empty entries and reports no changes as an empty list', () => {
    const execFile = vi.fn(() => '\0');

    expect(
      getChangedFiles({ baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), execFile }),
    ).toEqual([]);
  });

  it('rejects an unsafe SHA before reaching git', () => {
    const execFile = vi.fn();

    expect(() =>
      getChangedFiles({ baseSha: 'abc123', headSha: 'b'.repeat(40), execFile }),
    ).toThrow(/PR_BASE_SHA/);
    expect(execFile).not.toHaveBeenCalled();
  });
});
