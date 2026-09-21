/*
 * Neutrale Ermittlung der geänderten Dateien eines Pull Requests (GSPP-427).
 *
 * Die NUL-basierte, SHA-validierte Diff-Ermittlung stand bis GSPP-427 allein in
 * `scripts/pr-documentation-contract.mjs`. Der Scope-Entscheider
 * (`scripts/ci-scope.mjs`) braucht genau dieselbe Rechnung — ein zweiter,
 * paralleler Git-Diff-Aufruf wäre die Stelle, an der beide auseinander laufen.
 * Der Kern steht deshalb genau einmal hier; Dokumentationsvertrag und
 * Scope-Entscheider lesen aus derselben Quelle (Codex-Empfehlung zu GSPP-427,
 * Muster: `scripts/githubApiFetch.mjs` aus GSPP-425).
 *
 * Fail-closed wie bisher: Beide SHAs müssen vollständige 40-stellige
 * Hex-Zeichenketten sein, bevor sie je einen `git`-Aufruf erreichen; der Aufruf
 * selbst läuft ohne Shell (`execFile`), mit Drei-Punkt-Diff gegen die
 * Merge-Basis, ohne Rename-Auflösung, mit demselben Statusfilter und
 * NUL-Trennung.
 */

import { execFileSync } from 'node:child_process';

export class GitChangedFilesError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GitChangedFilesError';
  }
}

export function validateGitSha(value, variableName) {
  if (!/^[0-9a-f]{40}$/i.test(value ?? '')) {
    throw new GitChangedFilesError(`${variableName} muss ein vollständiger Git-SHA sein.`);
  }
  return value;
}

export function getChangedFiles({ baseSha, headSha, execFile = execFileSync }) {
  const validatedBaseSha = validateGitSha(baseSha, 'PR_BASE_SHA');
  const validatedHeadSha = validateGitSha(headSha, 'PR_HEAD_SHA');
  const output = execFile(
    'git',
    [
      'diff',
      '--name-only',
      '--no-renames',
      '--diff-filter=ACMRD',
      '-z',
      `${validatedBaseSha}...${validatedHeadSha}`,
      '--',
    ],
    { encoding: 'utf8' },
  );

  return output.split('\0').filter(Boolean);
}
