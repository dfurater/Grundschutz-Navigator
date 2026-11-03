#!/usr/bin/env node

/**
 * Cherry-Pick-Lane: bringt einzelne, auf `develop` gemergte Commits ohne
 * Release nach `main`.
 *
 * Der Vorbereitungslauf baut `cherry-pick/<issue>-<sha12>` aus aktuellem
 * `origin/main`, wendet je Quelle `git cherry-pick -x` an und stellt den Pull
 * Request erst, wenn alle Picks konfliktfrei sind und der Head die Prüfung von
 * `verifyCherryPickHead` besteht. Dieselbe Prüfung läuft im Pflichtcheck
 * `catalog-sync-guard` bei jedem Ereignis, das den Head bewegt.
 *
 * Nach dem Squash-Merge verbindet die Übernahme-Lane
 * (`scripts/backmerge-main-to-develop.mjs`, Klasse „Cherry-Pick") die Historie
 * per `-s ours` mit `develop`; danach greift die Release-Vorbereitung
 * unverändert.
 *
 * Dieses Skript mergt nicht und löscht keine Branches.
 */

import { pathToFileURL } from 'node:url';
import {
  createGitHubClient,
  createGitRunner,
  formatDocumentationSection,
  gitText,
  pushBranchWithLease,
} from './backmerge-main-to-develop.mjs';
import {
  CHERRY_PICK_BRANCH_PREFIX,
  CherryPickError,
  formatCherryPickMarker,
  parseCherryPickMarkers,
  verifyCherryPickHead,
  verifySources,
} from './cherry-pick-verify.mjs';
import {
  RELEASE_BASE_REF,
  RELEASE_INTEGRATION_REF,
  RELEASE_SOURCE_REF,
  collectReleaseChangedPaths,
} from './release-prepare.mjs';

export { CherryPickError, verifyCherryPickHead };

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const ISSUE_PATTERN = /^[A-Z][A-Z\d]*-[1-9]\d*$/;

/** Liest die Quellen als Liste vollständiger SHAs; Trenner sind Leerraum und Kommas. */
export function parseSourceList(input) {
  const sources = String(input ?? '').split(/[\s,]+/).filter(Boolean);
  if (sources.length === 0) {
    throw new CherryPickError('Der Cherry-Pick verlangt mindestens einen `develop`-Commit.');
  }
  for (const sha of sources) {
    if (!SHA_PATTERN.test(sha)) {
      throw new CherryPickError(
        `Jede Quelle muss ein 40-stelliger Kleinbuchstaben-SHA sein; erhalten: ${sha}`,
      );
    }
  }
  return sources;
}

export function cherryPickBranchName(issue, firstSource) {
  if (!ISSUE_PATTERN.test(issue)) {
    throw new CherryPickError(`Das Issue muss die Form \`GSPP-123\` haben; erhalten: ${issue || '(leer)'}`);
  }
  return `${CHERRY_PICK_BRANCH_PREFIX}${issue.toLowerCase()}-${firstSource.slice(0, 12)}`;
}

/** Prüft einen Pull Request im Namensraum `cherry-pick/` gegen seine Marken. */
export async function verifyCherryPickPullRequest({ baseRef, branch, headSha, body, git }) {
  if (baseRef !== RELEASE_BASE_REF || !branch.startsWith(CHERRY_PICK_BRANCH_PREFIX)) {
    return { checked: false };
  }
  const sources = parseCherryPickMarkers(body);
  if (sources.length === 0) {
    throw new CherryPickError(
      'Ein Cherry-Pick-Pull-Request braucht je Quelle eine Marke `<!-- cherry-pick-source: <sha> -->`.',
    );
  }
  await verifyCherryPickHead(git, { sources, headSha });
  return { checked: true, sources };
}

export const CHERRY_PICK_NO_DOCUMENTATION_IMPACT_REASON =
  'Dieser Cherry-Pick trägt ausschließlich Commits nach `main`, deren Dokumentationswirkung '
  + 'im jeweiligen Pull Request auf `develop` bereits entschieden und geprüft wurde; der '
  + 'Vorbereitungsbranch selbst schreibt keine eigene Änderung.';

export function buildCherryPickPullRequestBody({ issue, branch, sourceSha, sources, changedPaths }) {
  return [
    '## Zusammenfassung',
    '',
    `Cherry-Pick nach \`${RELEASE_BASE_REF}\` für ${issue}: ${sources.length} \`develop\`-Commit(s) ohne Release.`,
    '',
    `**Ausgangsstand \`${RELEASE_BASE_REF}\`:** \`${sourceSha}\``,
    `**Vorbereitungsbranch:** \`${branch}\``,
    '',
    '**Erforderliche Merge-Methode:** Squash',
    '',
    'Jeder Merge auf `main` deployt automatisch auf GitHub Pages. Nach dem Merge stellt die '
    + 'Übernahme-Lane einen Historien-PR der Klasse „Cherry-Pick" nach `develop`.',
    '',
    '### Quellen',
    '',
    ...sources.map((sha) => `- \`${sha}\``),
    '',
    '## Lieferung',
    '',
    '<!--',
    'Was dieser Cherry-Pick ausliefert und warum er nicht auf das nächste Release wartet.',
    '-->',
    '',
    '## Validierung',
    '',
    `\`catalog-sync-guard\` prüft bei jedem Head-Ereignis: jede Quelle liegt auf \`${RELEASE_INTEGRATION_REF}\`, `
    + `\`${RELEASE_SOURCE_REF}\` ist Vorfahr des Heads, jeder Commit über \`${RELEASE_SOURCE_REF}\` trägt in `
    + 'Markenreihenfolge denselben Patch wie seine Quelle (ohne Zeilennummern und `index`-Zeilen), und ein '
    + '„Update branch" ist ein konfliktfreier Merge ohne eigenen Inhalt.',
    '',
    formatDocumentationSection({ changedPaths, noImpactReason: CHERRY_PICK_NO_DOCUMENTATION_IMPACT_REASON }),
    '',
    ...sources.map((sha) => formatCherryPickMarker(sha)),
  ].join('\n');
}

export async function runCherryPickPrepare({
  cwd = process.cwd(),
  git = createGitRunner({ cwd }),
  github = createGitHubClient({ repository: process.env.GITHUB_REPOSITORY }),
  sourceInput = process.env.CHERRY_PICK_SHAS ?? '',
  issue = process.env.CHERRY_PICK_ISSUE ?? '',
  logger = console,
} = {}) {
  const sources = parseSourceList(sourceInput);
  const branch = cherryPickBranchName(issue, sources[0]);

  await git([
    'fetch', '--no-tags', 'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/develop:refs/remotes/origin/develop',
  ]);
  await verifySources(git, sources);

  const sourceSha = await gitText(git, ['rev-parse', RELEASE_SOURCE_REF]);
  await git(['switch', '--detach', RELEASE_SOURCE_REF]);

  for (const sha of sources) {
    const pick = await git(['cherry-pick', '-x', sha], { allowFailure: true });
    if (pick.code !== 0) {
      await git(['cherry-pick', '--abort'], { allowFailure: true });
      throw new CherryPickError(
        `Der Cherry-Pick von ${sha} auf \`${RELEASE_SOURCE_REF}\` ist nicht konfliktfrei. Es entsteht `
        + 'weder Branch noch Pull Request. Nachbar-Commits mitnehmen oder mit dem Release liefern.\n'
        + `${pick.stdout}${pick.stderr}`,
      );
    }
  }

  const headSha = await gitText(git, ['rev-parse', 'HEAD']);
  await verifyCherryPickHead(git, { sources, headSha });
  const changedPaths = await collectReleaseChangedPaths(git, { headSha });

  await pushBranchWithLease(git, branch);

  const title = `chore(cherry-pick): ${issue} nach ${RELEASE_BASE_REF} (${sources[0].slice(0, 12)})`;
  const body = buildCherryPickPullRequestBody({ issue, branch, sourceSha, sources, changedPaths });

  const existing = await github.findOpenPullRequest(branch, RELEASE_BASE_REF);
  if (existing) {
    await github.updatePullRequest({ number: existing, title, body, base: RELEASE_BASE_REF });
    logger.log(`Cherry-Pick-Pull-Request #${existing} aktualisiert.`);
    return { pullRequest: existing, branch, headSha };
  }
  const url = await github.createPullRequest({ head: branch, base: RELEASE_BASE_REF, title, body });
  logger.log(`Cherry-Pick-Pull-Request erstellt: ${url}`);
  return { pullRequest: url, branch, headSha };
}

async function runCli() {
  if (process.argv[2] === '--verify-pull-request') {
    const result = await verifyCherryPickPullRequest({
      baseRef: process.env.PR_BASE_REF ?? '',
      branch: process.env.PR_HEAD_REF ?? '',
      headSha: process.env.PR_HEAD_SHA ?? '',
      body: process.env.PR_BODY ?? '',
      git: createGitRunner(),
    });
    console.log(
      result.checked
        ? `Cherry-Pick-Pull-Request geprüft: ${result.sources.length} Quelle(n) mit gleichem Patch.`
        : 'Kein Cherry-Pick-Pull-Request; Prüfung nicht einschlägig.',
    );
    return;
  }
  await runCherryPickPrepare();
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
