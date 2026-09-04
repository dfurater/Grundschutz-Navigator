#!/usr/bin/env node

/**
 * Autorenquelle der repo-internen Review-Policy (GSPP-374).
 *
 * Gitar und Greptile prüfen dieses Repository parallel. Ihre gemeinsamen
 * Reviewregeln lagen bis hierher ausschließlich außerhalb des versionierten
 * Repositoriums: in gitignorierten Dateien und in Dashboard-Einstellungen der
 * beiden Anbieter. Für Gitar hatte das eine harte Folge — es liest laut
 * Hersteller `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.cursor/rules/*`,
 * `.gitar/**`, `.claude/skills/` und `.github/skills/`, und `.gitignore`
 * schließt in diesem Repository jede einzelne dieser Quellen aus. Gitar hat
 * also ohne jede repo-seitige Anweisung gereviewt.
 *
 * Die Reviewregeln sind deshalb versioniert, und zwar in genau einer
 * Autorenquelle. Sie besteht aus zwei Dateien mit klarer Aufgabenteilung:
 *
 *   - `scripts/review-policy.rules.mjs` die Regeltabelle, reine Daten
 *   - `scripts/review-policy.mjs`       diese Datei: Generator, Drift-Guard,
 *                                       CLI und einziger Einstiegspunkt
 *
 * Der Schnitt folgt einer Messung, nicht einem Geschmack: SonarQubes
 * Copy-Paste-Erkennung meldet strukturgleiche Tabelleneinträge zwangsläufig als
 * Duplikat, und `sonar.cpd.exclusions` greift nur dateiweit. Getrennt deckt die
 * Ausnahme in `.sonarcloud.properties` genau die Tabelle ab, während die Logik
 * hier vollständig geprüft bleibt.
 *
 * Aus der Autorenquelle wird deterministisch erzeugt:
 *
 *   - `docs/REVIEW_INVARIANTS.md`    menschenlesbar, versioniert, reviewbar
 *   - `.gitar/review/invarianten.md` dünner Adapter, bindet die Doku per
 *                                    `@`-Include ein
 *   - `.greptile/config.json`        Greptile-Regeln, `id`/`rule`/`scope` aus
 *                                    derselben Tabelle
 *   - `.greptile/files.json`         Greptile-Datei-Kontexte aus derselben
 *                                    Tabelle
 *
 * Der Greptile-Zweig (`.greptile/`) ist seit GSPP-383 Teil dieser
 * Autorenquelle. Es gibt keinen Dashboard-Importzyklus mehr und keine
 * Abhängigkeit von `.claude/greptile/contexts.mjs` — beide erzeugten Dateien
 * entstehen ausschließlich aus `scripts/review-policy.rules.mjs`.
 *
 * Aufruf:
 *
 *   node scripts/review-policy.mjs --check   # Drift-Prüfung (Standard), CI-Gate
 *   node scripts/review-policy.mjs --write   # abgeleitete Dateien neu erzeugen
 *
 * Ohne Flag wird geprüft, nicht geschrieben: ein versehentlicher Aufruf darf
 * eine Abweichung nie stillschweigend wegschreiben.
 */

import { execFile } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { globalRules, scopedRules, fileContexts } from './review-policy.rules.mjs';

const execFileAsync = promisify(execFile);

/** Repository-Wurzel, unabhängig vom Arbeitsverzeichnis des Aufrufers. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {import('./review-policy.rules.mjs').ReviewRule} ReviewRule */
/** @typedef {import('./review-policy.rules.mjs').FileContext} FileContext */

// Die Regeltabelle steht in einer eigenen Datei, damit die dateiweite
// CPD-Ausnahme in `.sonarcloud.properties` ausschließlich Daten erfasst und die
// Logik dieser Datei unter voller Duplikatsprüfung bleibt. Der Re-Export hält
// `scripts/review-policy.mjs` als einzigen Einstiegspunkt für alle Verbraucher.
export { globalRules, scopedRules, fileContexts };

/** Globale und gescopte Regeln in stabiler Reihenfolge. @type {ReviewRule[]} */
export const allRules = [...globalRules, ...scopedRules];

/**
 * Der Schlüssel ist die stabile Kennung einer Regel über Gitar, Greptile und
 * Dokumentation hinweg. Er wird in Reviewkommentaren zitiert und darf sich
 * deshalb nicht ändern, wenn nur der Text geschärft wird.
 */
const RULE_KEY_PATTERN = /^[GR][1-9]\d*-[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ReviewPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReviewPolicyError';
  }
}

/** Wirft mit der übergebenen Meldung, sobald die Bedingung zutrifft. */
function reject(condition, message) {
  if (condition) throw new ReviewPolicyError(message);
}

/** Regelschlüssel und Regeltext einer einzelnen Regel. */
function assertRuleIsWellFormed(rule) {
  reject(!RULE_KEY_PATTERN.test(rule.key), `Ungültiger Regelschlüssel: ${rule.key}`);
  reject(rule.body.trim().length === 0, `Regel ohne Text: ${rule.key}`);
  reject(
    rule.body.startsWith(`${rule.key}: `),
    `Regeltext trägt den Regelschlüssel als Präfix: ${rule.key}. ` +
    'Der Schlüssel steht bereits in id (Greptile) bzw. der Überschrift (Dokumentation); ' +
    'ein Präfix im Text würde ihn doppeln.',
  );
}

/** Der Schlüssel bzw. Pfad identifiziert einen Eintrag; zweimal vergeben verdeckt einen davon. */
function assertIdentifiersAreUnique(values, label) {
  const seen = new Set();
  for (const value of values) {
    reject(seen.has(value), `${label}: ${value}`);
    seen.add(value);
  }
}

/**
 * Prüft die Autorenquelle selbst, bevor irgendetwas aus ihr erzeugt wird.
 * Fail-closed: ein doppelter Schlüssel oder eine gescopte Regel ohne Scope
 * würde sonst als still fehlerhafte Regel in beide Adapter wandern.
 */
export function assertPolicyIsWellFormed({ global = globalRules, scoped = scopedRules, files = fileContexts } = {}) {
  for (const rule of [...global, ...scoped]) assertRuleIsWellFormed(rule);
  assertIdentifiersAreUnique([...global, ...scoped].map((rule) => rule.key), 'Doppelter Regelschlüssel');

  for (const rule of global) {
    reject(rule.scopes.length > 0, `Globale Regel mit Datei-Scope: ${rule.key}`);
  }
  for (const rule of scoped) {
    reject(rule.scopes.length === 0, `Gescopte Regel ohne Datei-Scope: ${rule.key}`);
  }

  assertIdentifiersAreUnique(files.map((context) => context.path), 'Doppelter Datei-Kontext');
}

/** Kopfzeile jeder erzeugten Datei — sie sagt, wo bearbeitet wird. */
function generatedBanner() {
  return [
    '<!--',
    '  GENERIERT — nicht von Hand bearbeiten.',
    '  Regeltexte:   scripts/review-policy.rules.mjs',
    '  Generator:    scripts/review-policy.mjs',
    '  Neu erzeugen: npm run review-policy',
    '  Drift prüfen: npm run review-policy:check',
    '-->',
  ].join('\n');
}

const formatScopes = (scopes) =>
  scopes.length === 0 ? 'global' : scopes.map((scope) => `\`${scope}\``).join(', ');

/** Menschenlesbare, reviewbare Fassung der vollständigen Policy. */
export function renderInvariantsDocument({ global = globalRules, scoped = scopedRules, files = fileContexts } = {}) {
  const lines = [
    generatedBanner(),
    '',
    '# Review-Invarianten',
    '',
    'Der verbindliche Reviewvertrag dieses Repositoriums. Er gilt gleichrangig für',
    'Gitar, für Greptile und für jeden Agenten-Cross-Review.',
    '',
    'Diese Datei wird von `scripts/review-policy.mjs` erzeugt; die Regeltexte selbst',
    'stehen in `scripts/review-policy.rules.mjs`. Änderungen gehören dorthin;',
    '`npm run review-policy:check` läuft im CI-Job `validate` und schlägt bei jeder',
    'manuellen Abweichung fehl.',
    '',
    '## Globale Regeln',
    '',
    'Gelten für jeden Review, unabhängig von den geänderten Dateien.',
    '',
  ];

  for (const rule of global) {
    lines.push(`### ${rule.key}`, '', rule.body, '');
  }

  lines.push(
    '## Gescopte Invariantenregeln',
    '',
    'Gelten, sobald der Diff mindestens einen Pfad des jeweiligen Scopes berührt.',
    '',
  );

  for (const rule of scoped) {
    lines.push(`### ${rule.key}`, '', `**Scope:** ${formatScopes(rule.scopes)}`, '', rule.body, '');
  }

  lines.push(
    '## Datei-Kontexte',
    '',
    'Dokumente, die beim Review der genannten Pfade als Kontext heranzuziehen sind.',
    '',
    '| Datei | Inhalt | Scope |',
    '| --- | --- | --- |',
  );

  for (const context of files) {
    lines.push(`| \`${context.path}\` | ${context.description} | ${formatScopes(context.scopes)} |`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Gitar-Adapter. Bewusst dünn: Gitar liest jede Markdown-Datei unter
 * `.gitar/review/` und löst `@pfad`-Includes zuerst relativ zur Quelldatei und
 * ersatzweise gegen die Repository-Wurzel auf. Der Regeltext bleibt damit an
 * genau einer Stelle und wird hier nur eingebunden, nicht kopiert.
 */
export function renderGitarAdapter() {
  return [
    generatedBanner(),
    '',
    '# Review-Invarianten (Gitar)',
    '',
    'Verbindlich für jeden Review in diesem Repository. Der vollständige Regeltext',
    'steht in der versionierten Autorenquelle und wird hier eingebunden:',
    '',
    '@docs/REVIEW_INVARIANTS.md',
    '',
  ].join('\n');
}

/**
 * Greptile-Regeln. Greptile kennt kein `@`-Include und keine Markdown-Datei
 * als Regelquelle — die Wirkungsfläche ist ausschließlich `.greptile/config.json`
 * mit einem Array `rules`, je Eintrag `id`/`rule`/optional `scope`. `id` trägt
 * den Regelschlüssel, deshalb bleibt `rule` präfixfrei (keine `<key>: `-Krücke
 * mehr, siehe `assertRuleIsWellFormed`). `scope` wird nur bei nicht leerem
 * `scopes`-Array gesetzt — ein leeres Array in der Datei könnte „passt auf
 * nichts" statt „global" bedeuten, deshalb wird das Feld bei globalen Regeln
 * ganz weggelassen, nicht auf `[]` gesetzt.
 *
 * Bewusst nicht gesetzt: `severity`, `enabled`, `disabledRules`, `instructions`
 * und jede Review-Einstellung (Auto-Review, Auto-Approve, Status-Checks, …).
 * `config.json` trägt auf oberster Ebene ausschließlich den Schlüssel `rules`.
 * Diese Einstellungen bleiben Dashboard-Fläche: Anders als bei den Regeltexten
 * ist für sie herstellerseitig nicht dokumentiert, ob ein hier fehlendes Feld
 * den bestehenden Dashboard-Wert unangetastet lässt oder auf einen Greptile-
 * eigenen Default zurückfällt — und für „Use Status Checks" hängt an genau
 * dieser Unklarheit der Pflicht-Check `Greptile Review` im Branch-Ruleset.
 * Ein zu weit gefasstes `config.json` könnte diesen Check stumm abschwächen
 * oder zum Verschwinden bringen; das Risiko ist in GSPP-383 durch einen
 * Wegwerf-Probe-PR vor dem eigentlichen Merge geprüft worden.
 *
 * Kein Generierungs-Banner: JSON kennt keine Kommentare, und ein `_generated`-
 * Feld wäre selbst ein reviewsteuerndes Feld ohne Deckung in der
 * Autorenquelle — der Drift-Guard erzwingt „nicht von Hand bearbeiten" bereits
 * strukturell.
 */
export function renderGreptileConfig({ global = globalRules, scoped = scopedRules } = {}) {
  const rules = [...global, ...scoped].map((rule) => {
    const entry = { id: rule.key, rule: rule.body };
    if (rule.scopes.length > 0) entry.scope = rule.scopes;
    return entry;
  });
  return JSON.stringify({ rules }, null, 2) + '\n';
}

/**
 * Greptile-Datei-Kontexte. `.greptile/files.json` mit einem Array `files`, je
 * Eintrag `path`/`description`/optional `scope` (nur bei nicht leerem
 * `scopes`). Die 8 Datei-Kontexte hatten vor GSPP-383 keine Dashboard-
 * Entsprechung — der `type`-Enum von Greptiles Custom-Context-API kennt keinen
 * Dateiverweis, und die Dashboard-Ansicht *Custom rules* führte am 2026-09-04
 * ausschließlich Einträge vom Typ `Rule`. `.greptile/files.json` ist damit
 * keine Migration eines bestehenden Zustands, sondern die erste Stelle, an der
 * diese Kontexte für Greptile überhaupt wirksam werden können.
 */
export function renderGreptileFiles({ files = fileContexts } = {}) {
  const entries = files.map((context) => {
    const entry = { path: context.path, description: context.description };
    if (context.scopes.length > 0) entry.scope = context.scopes;
    return entry;
  });
  return JSON.stringify({ files: entries }, null, 2) + '\n';
}

/**
 * Verzeichnis der Gitar-Reviewregeln — der Ablageort des erzeugten Adapters.
 */
export const GITAR_REVIEW_DIRECTORY = '.gitar/review';

/**
 * Anweisungsflächen, die Gitar oder Greptile aus dem Repository lesen und die
 * `.gitignore` hier **nicht** ausschließt. Jede Datei darin wirkt auf den
 * jeweiligen Review; eine, die nicht aus der Autorenquelle stammt, ist eine
 * Reviewregel an ihr vorbei — genau die Umgehung, die dieser Guard verhindern
 * soll. Geprüft wird das Dateisystem: Was hier liegt, gehört entweder zur
 * Autorenquelle oder ist Drift.
 *
 * `.greptile` kam mit GSPP-383 hinzu, als Greptiles Regeln und Datei-Kontexte
 * vom Dashboard auf `.greptile/config.json` und `.greptile/files.json`
 * umgezogen sind — ein handgeschriebenes `.greptile/rules.md` oder eine
 * zusätzliche Datei irgendwo im Baum ist damit Drift.
 *
 * Bekannte Grenze: Der Scan deckt nur das Wurzelverzeichnis `.greptile/` ab,
 * kein verschachteltes `packages/.greptile/`. Das ist hinnehmbar — das
 * Repository hat keine Unterprojekte, und ein neues Verzeichnis dieser Art
 * wäre im PR-Diff sichtbar.
 */
export const REVIEW_INSTRUCTION_DIRECTORIES = ['.gitar', '.greptile', '.cursor', '.github/skills'];

/** Einzelne Anweisungsdateien ohne Verzeichnis. */
export const REVIEW_INSTRUCTION_FILES = ['.cursorrules'];

/**
 * Anweisungsflächen, die Gitar ebenfalls liest, die `.gitignore` hier aber
 * ausschließt. Sie liegen in jedem Arbeitsbaum als lokale Agentendateien und
 * dürfen dort liegen — ein Dateisystemscan würde sie deshalb dauerhaft falsch
 * melden.
 *
 * `.gitignore` verhindert allerdings kein `git add -f`: Eine dieser Dateien
 * lässt sich erzwungen versionieren und wäre dann im PR-Head, wo Gitar sie
 * liest. Für diese Flächen ist die Frage deshalb nicht „liegt sie da", sondern
 * „ist sie versioniert" — geprüft gegen den Git-Index, nicht gegen die Platte.
 */
export const GITIGNORED_INSTRUCTION_SURFACES = ['AGENTS.md', 'CLAUDE.md', '.claude/skills'];

/** Die erzeugten Dateien, relativ zur Repository-Wurzel. */
export const REVIEW_POLICY_TARGETS = [
  { path: 'docs/REVIEW_INVARIANTS.md', render: renderInvariantsDocument },
  { path: `${GITAR_REVIEW_DIRECTORY}/invarianten.md`, render: renderGitarAdapter },
  { path: '.greptile/config.json', render: renderGreptileConfig },
  { path: '.greptile/files.json', render: renderGreptileFiles },
];

/** Soll-Inhalt aller Ziele. Rein funktional, ohne Zeitstempel — zweimal aufgerufen identisch. */
export function renderReviewPolicy(policy = {}) {
  assertPolicyIsWellFormed(policy);
  return REVIEW_POLICY_TARGETS.map((target) => ({
    path: target.path,
    content: target.render(policy),
  }));
}

/**
 * Ordnet zwei Pfade über ihre Codepoints. Explizit statt über die
 * Standardsortierung oder localeCompare: Die Meldung eines Guards muss über
 * Plattformen und Locales hinweg gleich lauten, sonst lässt sich ein
 * CI-Fehlschlag nicht mit einem lokalen Lauf vergleichen.
 */
function compareRelativePaths(left, right) {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** Alle Dateien unterhalb eines Verzeichnisses, relativ zur Repository-Wurzel. */
async function listFilesBelow(repoRoot, directory) {
  let entries;
  try {
    entries = await readdir(path.join(repoRoot, directory), { withFileTypes: true, recursive: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.relative(repoRoot, path.join(entry.parentPath, entry.name)));
}

/**
 * Liest die im Git-Index geführten Pfade einer Pfadmenge.
 *
 * Fail-closed und ohne Ausnahme: Jeder Fehlschlag — kein Git-Repository, kein
 * `git` im PATH, ein defekter Index, ein Zugriffsfehler — wird zum Fehler und
 * nicht zu einem leeren Ergebnis. Ein nicht beantwortbares „ist diese Datei
 * versioniert" ist kein „nein". Ein Guard, der eine gescheiterte Abfrage als
 * bestanden verbucht, prüft genau dann nicht mehr, wenn er gebraucht wird.
 */
export async function listTrackedFilesWithGit(repoRoot, pathspecs) {
  try {
    const { stdout } = await execFileAsync('git', ['ls-files', '-z', '--', ...pathspecs], { cwd: repoRoot });
    return stdout.split('\0').filter(Boolean);
  } catch (error) {
    const detail = String(error?.stderr || error?.message || error).trim().split('\n')[0];
    throw new ReviewPolicyError(
      `Git-Index nicht lesbar, ausgeschlossene Anweisungsflächen bleiben ungeprüft: ${detail}`,
    );
  }
}

/**
 * Ausgeschlossene Anweisungsflächen, die trotzdem im Git-Index stehen — also
 * mit `git add -f` an `.gitignore` vorbei versioniert wurden.
 */
async function listForceTrackedInstructionFiles(repoRoot, listTrackedFiles) {
  const tracked = await listTrackedFiles(repoRoot, GITIGNORED_INSTRUCTION_SURFACES);
  return [...tracked].sort(compareRelativePaths);
}

/**
 * Dateien auf einer Gitar- oder Greptile-Anweisungsfläche, die zu keinem
 * erzeugten Ziel gehören. Der Scan deckt bewusst den ganzen Baum ab, nicht nur
 * die Ablageorte der Adapter: Eine Datei unter `.gitar/skills/`, ein
 * handgeschriebenes `.greptile/rules.md` oder eine `.cursorrules` würde vom
 * jeweiligen Bot genauso angewendet, ohne je aus der Autorenquelle zu stammen.
 */
async function listUnmanagedInstructionFiles(repoRoot, expected) {
  const found = [];

  for (const directory of REVIEW_INSTRUCTION_DIRECTORIES) {
    found.push(...(await listFilesBelow(repoRoot, directory)));
  }

  for (const file of REVIEW_INSTRUCTION_FILES) {
    try {
      await readFile(path.join(repoRoot, file));
      found.push(file);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  return found.filter((relative) => !expected.has(relative)).sort(compareRelativePaths);
}

/**
 * Vergleicht die abgeleiteten Dateien mit der Autorenquelle.
 *
 * Fail-closed: fehlende Datei, abweichender Inhalt und überzählige Datei unter
 * `.gitar/review/` sind je ein Fehler, kein Hinweis.
 */
export async function checkReviewPolicy({
  repoRoot = REPO_ROOT,
  policy = {},
  // Voreinstellung ist der echte Git-Index. Ein Aufrufer ohne Repository — etwa
  // eine Testfixture — muss ausdrücklich einen eigenen Leser übergeben; still
  // durchwinken kann der Guard nicht.
  listTrackedFiles = listTrackedFilesWithGit,
} = {}) {
  const rendered = renderReviewPolicy(policy);
  const problems = [];

  for (const target of rendered) {
    const absolute = path.join(repoRoot, target.path);
    let actual;
    try {
      actual = await readFile(absolute, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        problems.push(`fehlt: ${target.path}`);
        continue;
      }
      throw error;
    }
    if (actual !== target.content) {
      problems.push(`weicht von der Autorenquelle ab: ${target.path}`);
    }
  }

  const expected = new Set(rendered.map((target) => target.path));
  for (const unexpected of await listUnmanagedInstructionFiles(repoRoot, expected)) {
    problems.push(`nicht aus der Autorenquelle erzeugt: ${unexpected}`);
  }

  for (const tracked of await listForceTrackedInstructionFiles(repoRoot, listTrackedFiles)) {
    problems.push(`von .gitignore ausgeschlossen, aber versioniert: ${tracked}`);
  }

  if (problems.length > 0) {
    throw new ReviewPolicyError(
      `Review-Policy-Drift:\n  - ${problems.join('\n  - ')}\n\n` +
      'Autorenquelle sind scripts/review-policy.rules.mjs (Regeltexte) und scripts/review-policy.mjs (Generator).',
      'Mit `npm run review-policy` neu erzeugen.',
    );
  }

  return rendered;
}

/** Schreibt die abgeleiteten Dateien. Einziger Pfad, der etwas verändert. */
export async function writeReviewPolicy({ repoRoot = REPO_ROOT, policy = {} } = {}) {
  const rendered = renderReviewPolicy(policy);
  for (const target of rendered) {
    const absolute = path.join(repoRoot, target.path);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, target.content, 'utf8');
  }
  return rendered;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const flags = process.argv.slice(2);
  const unknown = flags.filter((flag) => flag !== '--check' && flag !== '--write');
  if (unknown.length > 0) {
    console.error(`Unbekannte Option: ${unknown.join(', ')} — erlaubt sind --check und --write.`);
    process.exit(2);
  }

  const write = flags.includes('--write');
  try {
    if (write) {
      const rendered = await writeReviewPolicy();
      console.log(`Review-Policy erzeugt: ${rendered.map((target) => target.path).join(', ')}`);
    } else {
      const rendered = await checkReviewPolicy();
      console.log(
        `Review-Policy deckungsgleich (${allRules.length} Regeln, ${fileContexts.length} Datei-Kontexte, ` +
        `${rendered.length} abgeleitete Dateien).`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
