/**
 * Prüfung der Cherry-Pick-Lane, geteilt von Guard, Vorbereitung
 * (`scripts/cherry-pick-prepare.mjs`) und Übernahme-Lauf
 * (`scripts/backmerge-main-to-develop.mjs`). Das Modul importiert keines der
 * beiden Lane-Skripte: Die Übernahme lädt es unter ihrem Top-Level-`await`,
 * und ein Rückimport bildete einen Zyklus, den Node nie auflöst.
 */

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SOURCE_REF = 'origin/main';
const INTEGRATION_REF = 'origin/develop';

export class CherryPickError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CherryPickError';
  }
}

/** Namensraum der Cherry-Pick-PRs nach `main` (`scripts/cherry-pick-prepare.mjs`). */
export const CHERRY_PICK_BRANCH_PREFIX = 'cherry-pick/';

/**
 * Je übernommenem `develop`-Commit eine Marke, in `develop`-Reihenfolge. Guard
 * und Übernahme-Lauf lesen die Quellen aus dem Body, nicht aus den
 * Commit-Nachrichten: `-x` schreibt die Quelle nur bei konfliktfreien Picks.
 */
const CHERRY_PICK_MARKER_PATTERN = /<!--\s*cherry-pick-source:\s*([0-9a-f]{40})\s*-->/g;

export function formatCherryPickMarker(sha) {
  if (!SHA_PATTERN.test(sha)) {
    throw new CherryPickError(`Die Cherry-Pick-Marke verlangt einen 40-stelligen Kleinbuchstaben-SHA: ${sha}`);
  }
  return `<!-- cherry-pick-source: ${sha} -->`;
}

export function parseCherryPickMarkers(body) {
  if (typeof body !== 'string') return [];
  return [...body.matchAll(CHERRY_PICK_MARKER_PATTERN)].map((match) => match[1]);
}

async function gitText(git, args) {
  return (await git(args)).stdout.trim();
}

async function gitSucceeds(git, args) {
  return (await git(args, { allowFailure: true })).code === 0;
}

/**
 * Der Patch eines Commits ohne `index`-Zeilen und ohne die Zeilennummern und
 * Funktionskontexte der Hunk-Köpfe. Jedes Zeichen der geänderten und der
 * Kontextzeilen bleibt erhalten, auch Leerraum — `git patch-id --stable`
 * verwirft Leerraum innerhalb von Zeilen und ließe `"A B"` statt `"AB"` durch.
 */
async function normalizedPatchOf(git, sha) {
  const { stdout } = await git([
    'diff-tree', '--patch', '--binary', '--no-color', '--no-ext-diff', '--no-textconv', `${sha}^`, sha,
  ]);
  return stdout
    .split('\n')
    .filter((line) => !line.startsWith('index '))
    .map((line) => (line.startsWith('@@ ') ? '@@' : line))
    .join('\n');
}

async function parentsOf(git, sha) {
  return (await gitText(git, ['rev-list', '--parents', '-n', '1', sha])).split(' ').slice(1);
}

/**
 * Prüft die Quellen: eindeutig, jede ein Nicht-Merge-Commit auf
 * `origin/develop`, jede Vorfahr der nächsten (`develop`-Reihenfolge).
 */
export async function verifySources(git, sources) {
  if (new Set(sources).size !== sources.length) {
    throw new CherryPickError('Eine Quelle ist mehrfach genannt.');
  }
  for (const [index, sha] of sources.entries()) {
    if (!await gitSucceeds(git, ['merge-base', '--is-ancestor', sha, INTEGRATION_REF])) {
      throw new CherryPickError(`Die Quelle ${sha} ist von \`${INTEGRATION_REF}\` nicht erreichbar.`);
    }
    if ((await parentsOf(git, sha)).length !== 1) {
      throw new CherryPickError(`Die Quelle ${sha} ist ein Merge- oder Wurzel-Commit.`);
    }
    const next = sources[index + 1];
    if (next && !await gitSucceeds(git, ['merge-base', '--is-ancestor', sha, next])) {
      throw new CherryPickError(
        `Die Quellen stehen nicht in \`develop\`-Reihenfolge: ${sha} ist kein Vorfahr von ${next}.`,
      );
    }
  }
}

/**
 * Die Bedingungen eines Cherry-Pick-Heads, fail-closed:
 *
 * - Quellen wie in `verifySources`.
 * - `origin/main` ist Vorfahr des Heads.
 * - Jeder Merge-Commit in `origin/main..<head>` (ein „Update branch") hat zwei
 *   Eltern und trägt exakt den Baum, den `git merge-tree --write-tree` ohne
 *   Konflikt aus ihnen errechnet; er bringt also keinen eigenen Inhalt mit.
 * - Die Nicht-Merge-Commits in `origin/main..<head>` entsprechen den Quellen
 *   in Anzahl und Reihenfolge, je Paar mit gleichem `normalizedPatchOf`. Ein
 *   Pick mit anderem Kontext als die Quelle besteht deshalb nicht.
 */
export async function verifyCherryPickHead(git, { sources, headSha, baseRef = SOURCE_REF }) {
  await verifySources(git, sources);

  if (!await gitSucceeds(git, ['merge-base', '--is-ancestor', baseRef, headSha])) {
    throw new CherryPickError(`\`${baseRef}\` ist kein Vorfahr des Heads ${headSha}.`);
  }

  const range = `${baseRef}..${headSha}`;
  const merges = (await gitText(git, ['rev-list', '--merges', range])).split('\n').filter(Boolean);
  for (const merge of merges) {
    const parents = await parentsOf(git, merge);
    const result = parents.length === 2
      ? await git(['merge-tree', '--write-tree', ...parents], { allowFailure: true })
      : { code: 1, stdout: '' };
    const mergeTree = await gitText(git, ['rev-parse', `${merge}^{tree}`]);
    if (result.code !== 0 || result.stdout.split('\n')[0] !== mergeTree) {
      throw new CherryPickError(
        `Der Merge-Commit ${merge} ist kein konfliktfreier Merge seiner zwei Eltern; `
        + 'er trägt eigenen Inhalt.',
      );
    }
  }

  const picks = (await gitText(git, ['rev-list', '--no-merges', '--topo-order', '--reverse', range]))
    .split('\n').filter(Boolean);
  if (picks.length !== sources.length) {
    throw new CherryPickError(
      `Der Head trägt ${picks.length} Commit(s) über \`${baseRef}\`, die Marken nennen ${sources.length}.`,
    );
  }
  for (const [index, pick] of picks.entries()) {
    const source = sources[index];
    const pickPatch = await normalizedPatchOf(git, pick);
    if (pickPatch.length === 0 || pickPatch !== await normalizedPatchOf(git, source)) {
      throw new CherryPickError(
        `Der Commit ${pick} entspricht nicht der Quelle ${source}: Der Patch weicht ab `
        + '(geänderte Zeilen, Kontextzeilen oder Leerraum).',
      );
    }
  }
}
