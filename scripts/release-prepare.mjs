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
import {
  createGitHubClient,
  createGitRunner,
  formatDocumentationSection,
} from './backmerge-main-to-develop.mjs';

export const RELEASE_BASE_REF = 'main';
export const RELEASE_SOURCE_REF = 'origin/main';
export const RELEASE_INTEGRATION_REF = 'origin/develop';

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** Namensraum der Vorbereitungsbranches — Auslöser der Baumprüfung am PR. */
export const RELEASE_BRANCH_PREFIX = 'release/';

/**
 * Die Freigabemarke ordnet dem Release-PR den freigegebenen `develop`-Commit
 * zu. Sie ist nötig, weil die Baumgleichheit sonst nur einmal — im
 * Vorbereitungslauf — gälte: Bewegt sich `main` danach, verlangt die
 * Strict-Policy eine Aktualisierung des Heads, und ein konfliktfreier
 * „Update branch" trägt mains neuen Inhalt in den Head, ohne dass irgendetwas
 * den Baum erneut gegen den freigegebenen Stand prüft. Der Pull Request ließe
 * sich dann mit einem anderen Stand mergen, als er beschreibt. Mit der Marke
 * prüft `verifyReleasePullRequest` bei jedem `synchronize`-Ereignis nach.
 */
const RELEASE_MARKER_PATTERN = /<!--\s*release-source:\s*([0-9a-f]{40})\s*-->/g;

export function formatReleaseMarker(sha) {
  if (!SHA_PATTERN.test(sha)) {
    throw new ReleasePrepareError(
      `Die Freigabemarke verlangt einen 40-stelligen Kleinbuchstaben-SHA: ${sha}`,
    );
  }
  return `<!-- release-source: ${sha} -->`;
}

export function parseReleaseMarkers(body) {
  if (typeof body !== 'string') return [];
  return [...body.matchAll(RELEASE_MARKER_PATTERN)].map((match) => match[1]);
}

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

/**
 * Die Pfadmenge des Release-Pull-Requests, gerechnet wie
 * `scripts/pr-documentation-contract.mjs` sie am Pull Request rechnet:
 * Drei-Punkt-Diff gegen die Base, ohne Rename-Auflösung, mit demselben
 * Statusfilter. Beide Seiten müssen dieselbe Menge sehen — sonst deklarierte der
 * erzeugte Body etwas anderes, als der Pflichtcheck prüft.
 *
 * Am Vorbereitungshead fallen Zwei- und Drei-Punkt-Diff zusammen, weil
 * `origin/main` nachweislich Vorfahr ist; die Drei-Punkt-Form bleibt trotzdem
 * die geschriebene Form, damit die Übereinstimmung mit dem Prüfer sichtbar ist.
 */
export async function collectReleaseChangedPaths(git, { headSha, baseRef = RELEASE_SOURCE_REF }) {
  const { stdout } = await git([
    'diff', '--name-only', '--no-renames', '--diff-filter=ACMRD', '-z',
    `${baseRef}...${headSha}`, '--',
  ]);
  return stdout.split('\0').filter(Boolean);
}

export function releaseBranchName(releaseSha) {
  if (!SHA_PATTERN.test(releaseSha)) {
    throw new ReleasePrepareError(
      `Der freigegebene Stand verlangt einen 40-stelligen Kleinbuchstaben-SHA: ${releaseSha}`,
    );
  }
  return `release/${releaseSha.slice(0, 12)}`;
}

/**
 * Begründung für den Fall, dass die Freigabe keine Dokumentationsdatei bewegt.
 *
 * Der Vorbereitungsbranch schreibt keine eigene Änderung: Er trägt genau die
 * Stände, die auf `develop` bereits einzeln geprüft wurden, und jeder von ihnen
 * hat seinen Dokumentationsvertrag dort erfüllt. Die Freigabe trifft darüber
 * keine neue Aussage.
 */
export const RELEASE_NO_DOCUMENTATION_IMPACT_REASON =
  'Diese Freigabe trägt ausschließlich Stände nach `main`, deren '
  + 'Dokumentationswirkung im jeweiligen Pull Request auf `develop` bereits '
  + 'entschieden und geprüft wurde; der Vorbereitungsbranch selbst schreibt keine '
  + 'eigene Änderung.';

/**
 * `changedPaths` ist der Drei-Punkt-Diff des Vorbereitungsheads gegen
 * `main` — dieselbe Bezugsgröße, die `scripts/pr-documentation-contract.mjs` am
 * Pull Request rechnet. Ohne den daraus gebauten Vertragsblock fiele jeder
 * Release mit Produktänderung am Pflichtcheck `documentation-contract` durch,
 * denn ein Release trägt regelmäßig Änderungen unter `src/`.
 */
export function buildReleasePullRequestBody({
  releaseSha,
  releaseBranch,
  sourceSha,
  changedPaths,
}) {
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
    formatDocumentationSection({
      changedPaths,
      noImpactReason: RELEASE_NO_DOCUMENTATION_IMPACT_REASON,
    }),
    '',
    '## Freigabe-Protokoll',
    '',
    '- [ ] Milestone-Exit erfüllt',
    '- [ ] M9-Referenzablauf grün',
    '- [ ] Lokale Abnahme durchgeführt',
    '- [ ] Gates grün (Bot-Kette, SonarQube, lint/test/build)',
    '- [ ] At-risk-Lücken in den Release-Notizen benannt',
    '- [ ] Doku-Wirkung konsistent zum Release-Stand',
    '',
    formatReleaseMarker(releaseSha),
  ].join('\n');
}

/**
 * Prüft einen Release-Pull-Request gegen seine Freigabemarke — bei jedem
 * Ereignis, das seinen Head bewegt, nicht nur bei seiner Entstehung.
 *
 * Fail-closed in jeder Richtung: Eine fehlende, mehrdeutige oder nicht auf der
 * Integrationslinie liegende Marke ist ein Fehler, kein Bestehen. Der Baum des
 * Heads muss exakt dem Baum des markierten Commits entsprechen.
 */
export async function verifyReleasePullRequest({
  baseRef,
  branch,
  headSha,
  body,
  git,
}) {
  if (baseRef !== RELEASE_BASE_REF || !branch.startsWith(RELEASE_BRANCH_PREFIX)) {
    return { checked: false };
  }

  const markers = parseReleaseMarkers(body);
  if (markers.length !== 1) {
    throw new ReleasePrepareError(
      `Ein Release-Pull-Request braucht genau eine Freigabemarke \`<!-- release-source: <sha> -->\` `
      + `im Body; gefunden: ${markers.length}. Ohne sie ist nicht überprüfbar, welchen Stand `
      + 'dieser Pull Request freigibt.',
    );
  }
  const [releaseSha] = markers;

  const onIntegrationLine = await gitSucceeds(git, [
    'merge-base', '--is-ancestor', releaseSha, RELEASE_INTEGRATION_REF,
  ]);
  if (!onIntegrationLine) {
    throw new ReleasePrepareError(
      `Der markierte Freigabestand ${releaseSha} liegt nicht auf \`${RELEASE_INTEGRATION_REF}\`.`,
    );
  }

  const headTree = await gitText(git, ['rev-parse', `${headSha}^{tree}`]);
  const releaseTree = await gitText(git, ['rev-parse', `${releaseSha}^{tree}`]);
  if (headTree !== releaseTree) {
    throw new ReleasePrepareError(
      `Der Baum des Pull-Request-Heads entspricht nicht dem Baum des freigegebenen Stands `
      + `${releaseSha} (${headTree} statt ${releaseTree}). Der Head trägt damit anderen Inhalt `
      + 'als die Freigabe benennt — typischerweise, weil `main` seither fortgeschritten ist und '
      + 'der Branch aktualisiert wurde. Die Vorbereitung ist gegen den neuen Stand zu wiederholen.',
    );
  }

  return { checked: true, releaseSha };
}

export async function runReleasePrepare({
  cwd = process.cwd(),
  git = createGitRunner({ cwd }),
  github = createGitHubClient({ repository: process.env.GITHUB_REPOSITORY }),
  releaseRef = process.env.RELEASE_DEVELOP_SHA ?? '',
  logger = console,
} = {}) {
  // Eine Freigabe ist eine Entscheidung über einen konkreten Commit, kein
  // Verweis auf eine bewegliche Linie. Ein Branchname wie `develop` würde den
  // jeweils aktuellen Head übernehmen — auch den, der nach der Freigabe
  // hinzukam. Ein leerer Wert ist deshalb kein stiller Default auf den
  // Integrationshead, sondern ein Abbruch: Der Operator benennt den Stand.
  if (!SHA_PATTERN.test(releaseRef)) {
    throw new ReleasePrepareError(
      'Die Freigabe verlangt den 40-stelligen Kleinbuchstaben-SHA des freigegebenen '
      + `\`develop\`-Commits. Ein Branchname oder eine andere Referenz wird nicht akzeptiert, `
      + 'weil sie den jeweils aktuellen Head übernähme statt des freigegebenen Stands. '
      + `Erhalten: ${releaseRef === '' ? '(leer)' : releaseRef}`,
    );
  }

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

  const changedPaths = await collectReleaseChangedPaths(git, { headSha });

  const remoteHead = await gitText(git, [
    'ls-remote', '--heads', 'origin', `refs/heads/${releaseBranch}`,
  ]);
  const remoteSha = remoteHead.split('\n')[0]?.split('\t')[0] ?? '';
  const pushArgs = SHA_PATTERN.test(remoteSha)
    ? ['push', `--force-with-lease=refs/heads/${releaseBranch}:${remoteSha}`, 'origin', `HEAD:refs/heads/${releaseBranch}`]
    : ['push', 'origin', `HEAD:refs/heads/${releaseBranch}`];
  await git(pushArgs);

  const title = `chore(release): ${releaseSha.slice(0, 12)} nach ${RELEASE_BASE_REF} freigeben`;
  const body = buildReleasePullRequestBody({ releaseSha, releaseBranch, sourceSha, changedPaths });

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

async function runCli() {
  if (process.argv[2] === '--verify-pull-request') {
    const result = await verifyReleasePullRequest({
      baseRef: process.env.PR_BASE_REF ?? '',
      branch: process.env.PR_HEAD_REF ?? '',
      headSha: process.env.PR_HEAD_SHA ?? '',
      body: process.env.PR_BODY ?? '',
      git: createGitRunner(),
    });
    console.log(
      result.checked
        ? `Release-Pull-Request geprüft: Baum entspricht dem freigegebenen Stand ${result.releaseSha}.`
        : 'Kein Release-Pull-Request; Baumprüfung nicht einschlägig.',
    );
    return;
  }

  await runReleasePrepare();
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
