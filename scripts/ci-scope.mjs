#!/usr/bin/env node

/*
 * Scope-Entscheider für Step-Skips im Job `validate` (GSPP-427).
 *
 * Genau ein früher Step schreibt genau einen Wert nach `GITHUB_OUTPUT`:
 * `full`, `docs_only` oder `manifest_only`. Danach bleiben die Bedingungen
 * klein und überprüfbar (Codex-Empfehlung zu GSPP-427):
 *
 * - Profilauflösung, go-oscal und Build: `scope != 'docs_only'`
 * - Browser-Cache, Chromium, Browser-Tests und Egress-Nachweis:
 *   `scope == 'full'`
 * - Fetch, Coverage, Lint, Schema-, Policy-, Versions- und zizmor-Gates: immer
 *
 * Prädikate (entschieden, keine Implementierungsfrage mehr):
 *
 * - `docs_only`: nicht-leere Änderung, vollständig in
 *   `{README.md, docs/**, LICENSE, NOTICE}` — go-oscal und
 *   Profilauflösung verifizieren Upstream-Bytes gegen Manifest + Register,
 *   von denen sich keines ändert.
 * - `manifest_only`: exakt `{upstream-manifest.json}` — der Pin wechselt,
 *   also messen Fetch, Profilauflösung, go-oscal und Build gegen den neuen
 *   Pin; nur Browser-Tests und Egress-Nachweis entfallen.
 * - sonst: `full` (Volllauf).
 *
 * Base-/Head-Fetch und Diff laufen innerhalb dieses Entscheiders: Schlüge
 * einer davon in einem separaten Step fehl, bräche der Job vor dem verlangten
 * Volllauf ab. Hier setzt der Entscheider stattdessen `scope=full` und läuft
 * weiter — fail-closed (Volllauf statt Skip) bei jedem Fetch-/Diff-Fehler.
 * Der `validate`-Checkout ist flach (Depth 1, Merge-Commit ohne Historie),
 * deshalb ist der explizite Fetch Pflichtbestandteil — und er holt Base- wie
 * Head-Commit samt Historie: Ohne das Head-Objekt und ohne begehbare
 * Vorfahren fände der Drei-Punkt-Diff keine Merge-Basis und fiele stets auf
 * `full` zurück (Greptile-P2 auf PR #273, T-Rex-verifiziert). Beide Fetches
 * laufen ohne Credentials wie in `ci.yml` (öffentlicher Lesegriff).
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { getChangedFiles, validateGitSha } from './git-changed-files.mjs';

export const SCOPE_FULL = 'full';
export const SCOPE_DOCS_ONLY = 'docs_only';
export const SCOPE_MANIFEST_ONLY = 'manifest_only';

const MANIFEST_PATH = 'upstream-manifest.json';

function isDocsOnlyPath(file) {
  return (
    file === 'README.md' ||
    file === 'LICENSE' ||
    file === 'NOTICE' ||
    file.startsWith('docs/')
  );
}

export function classifyChangedFiles(changedFiles) {
  if (!Array.isArray(changedFiles) || changedFiles.length === 0) {
    return SCOPE_FULL;
  }

  if (changedFiles.length === 1 && changedFiles[0] === MANIFEST_PATH) {
    return SCOPE_MANIFEST_ONLY;
  }

  if (changedFiles.every(isDocsOnlyPath)) {
    return SCOPE_DOCS_ONLY;
  }

  return SCOPE_FULL;
}

export function fetchScopeCommits({ baseSha, headSha, execFile = execFileSync }) {
  const validatedBaseSha = validateGitSha(baseSha, 'PR_BASE_SHA');
  const validatedHeadSha = validateGitSha(headSha, 'PR_HEAD_SHA');
  for (const sha of [validatedBaseSha, validatedHeadSha]) {
    execFile('git', ['fetch', '--no-tags', 'origin', sha], {
      encoding: 'utf8',
    });
  }
}

export function determineScope({
  baseSha,
  headSha,
  fetchFn = fetchScopeCommits,
  diffFn = ({ baseSha: base, headSha: head }) => getChangedFiles({ baseSha: base, headSha: head }),
} = {}) {
  try {
    fetchFn({ baseSha, headSha });
    const changedFiles = diffFn({ baseSha, headSha });
    return { scope: classifyChangedFiles(changedFiles), fallback: false };
  } catch (error) {
    return {
      scope: SCOPE_FULL,
      fallback: true,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function main() {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error(
      'GITHUB_OUTPUT ist nicht gesetzt; der Entscheider kann sein Ergebnis nicht weitergeben.',
    );
  }

  const { scope, fallback, message } = determineScope({
    baseSha: process.env.PR_BASE_SHA,
    headSha: process.env.PR_HEAD_SHA,
  });

  appendFileSync(outputPath, `scope=${scope}\n`, 'utf8');
  if (fallback) {
    console.log(`::notice::Scope-Klassifikation fehlgeschlagen, Volllauf statt Skip: ${message}`);
  }
  console.log(`CI scope: ${scope}.`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'CI-Scope konnte nicht bestimmt werden.');
    process.exitCode = 1;
  }
}
