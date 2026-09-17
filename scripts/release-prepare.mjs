#!/usr/bin/env node

/**
 * Release-Vorbereitung: erzeugt aus einem freigegebenen `develop`-Stand den
 * Pull Request nach `main`.
 *
 * Der Release-PR kommt aus einem kurzlebigen Vorbereitungsbranch statt direkt
 * aus `develop`. Der Grund ist die Strict-Policy: Beide Rulesets tragen
 * `strict_required_status_checks_policy: true`, der Head muss also auf Stand
 * der Base sein. Ein Branch, der aus aktuellem `origin/main` hervorgeht und den
 * freigegebenen Stand hineinmergt, erfüllt das per Konstruktion — `develop`
 * selbst erfüllt es nur im schmalen Fenster direkt nach einem Release-Merge.
 *
 * Zwei Bedingungen gelten vor dem Pull Request:
 *
 * 1. `git merge-base --is-ancestor origin/main <head>` — die Strict-Policy.
 * 2. Der resultierende Baum entspricht exakt dem Baum des freigegebenen
 *    `develop`-SHA.
 *
 * Die zweite ist die wirksame Absicherung. Sie ist genau dann erfüllt, wenn die
 * Übernahme-Lane (`scripts/backmerge-main-to-develop.mjs`) vorher gelaufen ist.
 * Trägt `main` noch Inhalt, den `develop` nicht hat, weichen die Bäume ab und
 * die Freigabe stoppt, statt unbemerkt etwas anderes auszuliefern. Bewegt sich
 * `main` während der Freigabe, werden Vorbereitung und Prüfung wiederholt.
 *
 * Nach dem Release gibt es keinen Historien-Rückfluss: Der Inhalt erreicht
 * `develop` über die Übernahme-Lane, nicht über einen Merge der Freigabelinie.
 *
 * Dieses Skript mergt nicht und löscht keine Branches.
 */

import { pathToFileURL } from 'node:url';
import { createGitHubClient, createGitRunner } from './backmerge-main-to-develop.mjs';

export const RELEASE_BASE_REF = 'main';
export const RELEASE_SOURCE_REF = 'origin/main';
export const RELEASE_INTEGRATION_REF = 'origin/develop';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

export class ReleasePrepareError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleasePrepareError';
  }
}

async function gitText(git, args) {
  const { stdout } = await git(args);
  return stdout.trim();
}

async function gitSucceeds(git, args) {
  const { code } = await git(args, { allowFailure: true });
  return code === 0;
}

export function releaseBranchName(releaseSha) {
  if (!SHA_PATTERN.test(releaseSha)) {
    throw new ReleasePrepareError(
      `Der freigegebene Stand verlangt einen 40-stelligen Kleinbuchstaben-SHA: ${releaseSha}`,
    );
  }
  return `release/${releaseSha.slice(0, 12)}`;
}

export function buildReleasePullRequestBody({ releaseSha, releaseBranch, sourceSha }) {
  return [
    '## Zusammenfassung',
    '',
    `Release-Vorbereitung: Freigabe des \`develop\`-Stands \`${releaseSha}\` nach \`${RELEASE_BASE_REF}\`.`,
    '',
    `**Freigegebener \`develop\`-Stand:** \`${releaseSha}\``,
    `**Ausgangsstand \`${RELEASE_BASE_REF}\`:** \`${sourceSha}\``,
    `**Vorbereitungsbranch:** \`${releaseBranch}\``,
    '',
    '**Erforderliche Merge-Methode:** Merge-Commit',
    '',
    'Jeder Merge auf `main` deployt automatisch auf GitHub Pages. Der Merge erfolgt erst',
    'nach dem vollständigen Freigabe-Protokoll (Milestone-Exit plus M9-Referenzablauf).',
    '',
    '## Validierung',
    '',
    `Zwei maschinell geprüfte Bedingungen liegen vor: \`${RELEASE_SOURCE_REF}\` ist Vorfahr`,
    'des Heads, und der resultierende Baum entspricht exakt dem Baum des freigegebenen',
    '`develop`-Stands. Die zweite Bedingung belegt zugleich, dass die Inhalts-Übernahme',
    '`main` → `develop` vollständig gelaufen ist.',
    '',
    '## Freigabe-Protokoll',
    '',
    '- [ ] Milestone-Exit erfüllt',
    '- [ ] M9-Referenzablauf grün',
    '- [ ] Lokale Abnahme durchgeführt',
    '- [ ] Gates grün (Bot-Kette, SonarQube, lint/test/build)',
    '- [ ] At-risk-Lücken in den Release-Notizen benannt',
    '- [ ] Doku-Wirkung konsistent zum Release-Stand',
  ].join('\n');
}

export async function runReleasePrepare({
  cwd = process.cwd(),
  git = createGitRunner({ cwd }),
  github = createGitHubClient({ repository: process.env.GITHUB_REPOSITORY }),
  releaseRef = process.env.RELEASE_DEVELOP_SHA || RELEASE_INTEGRATION_REF,
  logger = console,
} = {}) {
  await git([
    'fetch', '--no-tags', 'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    '+refs/heads/develop:refs/remotes/origin/develop',
  ]);

  const releaseSha = await gitText(git, ['rev-parse', `${releaseRef}^{commit}`]);
  const sourceSha = await gitText(git, ['rev-parse', RELEASE_SOURCE_REF]);
  logger.log(`Freigegebener Stand ${releaseSha}, Ausgangsstand ${RELEASE_SOURCE_REF}=${sourceSha}.`);

  const onIntegrationLine = await gitSucceeds(git, [
    'merge-base', '--is-ancestor', releaseSha, RELEASE_INTEGRATION_REF,
  ]);
  if (!onIntegrationLine) {
    throw new ReleasePrepareError(
      `Der freigegebene Stand ${releaseSha} liegt nicht auf \`${RELEASE_INTEGRATION_REF}\`. `
      + 'Es entsteht kein Pull Request.',
    );
  }

  const releaseBranch = releaseBranchName(releaseSha);
  await git(['switch', '--force-create', releaseBranch, RELEASE_SOURCE_REF]);

  const merge = await git(
    ['merge', '--no-ff', '-m', `chore(release): ${releaseSha.slice(0, 12)} freigeben`, releaseSha],
    { allowFailure: true },
  );
  if (merge.code !== 0) {
    await git(['merge', '--abort'], { allowFailure: true });
    throw new ReleasePrepareError(
      `Der Merge des freigegebenen Stands in \`${RELEASE_SOURCE_REF}\` kollidiert. `
      + `Es entsteht kein Pull Request; nichts wurde überschrieben.\n${merge.stdout}${merge.stderr}`,
    );
  }

  const headSha = await gitText(git, ['rev-parse', 'HEAD']);

  const strictPolicySatisfied = await gitSucceeds(git, [
    'merge-base', '--is-ancestor', RELEASE_SOURCE_REF, headSha,
  ]);
  if (!strictPolicySatisfied) {
    throw new ReleasePrepareError(
      `Verletzte Bedingung: \`${RELEASE_SOURCE_REF}\` ist kein Vorfahr des Vorbereitungsheads `
      + `${headSha}. Die Strict-Policy wäre nicht erfüllt; es entsteht kein Pull Request.`,
    );
  }

  const headTree = await gitText(git, ['rev-parse', `${headSha}^{tree}`]);
  const releaseTree = await gitText(git, ['rev-parse', `${releaseSha}^{tree}`]);
  if (headTree !== releaseTree) {
    throw new ReleasePrepareError(
      'Verletzte Bedingung: Der Baum des Vorbereitungsheads entspricht nicht dem Baum des '
      + `freigegebenen \`develop\`-Stands (${headTree} statt ${releaseTree}). \`${RELEASE_BASE_REF}\` `
      + 'trägt damit Inhalt, den `develop` nicht hat — die Inhalts-Übernahme `main` → `develop` '
      + 'ist noch nicht vollständig gelaufen. Es entsteht kein Pull Request.',
    );
  }

  const remoteHead = await gitText(git, [
    'ls-remote', '--heads', 'origin', `refs/heads/${releaseBranch}`,
  ]);
  const remoteSha = remoteHead.split('\n')[0]?.split('\t')[0] ?? '';
  const pushArgs = SHA_PATTERN.test(remoteSha)
    ? ['push', `--force-with-lease=refs/heads/${releaseBranch}:${remoteSha}`, 'origin', `HEAD:refs/heads/${releaseBranch}`]
    : ['push', 'origin', `HEAD:refs/heads/${releaseBranch}`];
  await git(pushArgs);

  const title = `chore(release): ${releaseSha.slice(0, 12)} nach ${RELEASE_BASE_REF} freigeben`;
  const body = buildReleasePullRequestBody({ releaseSha, releaseBranch, sourceSha });

  const existing = await github.findOpenPullRequest(releaseBranch, RELEASE_BASE_REF);
  if (existing) {
    await github.updatePullRequest({ number: existing, title, body, base: RELEASE_BASE_REF });
    logger.log(`Release-Pull-Request #${existing} aktualisiert.`);
    return { pullRequest: existing, releaseSha, releaseBranch };
  }

  const url = await github.createPullRequest({
    head: releaseBranch,
    base: RELEASE_BASE_REF,
    title,
    body,
  });
  logger.log(`Release-Pull-Request erstellt: ${url}`);
  return { pullRequest: url, releaseSha, releaseBranch };
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await runReleasePrepare();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
