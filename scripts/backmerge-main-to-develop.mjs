#!/usr/bin/env node

/**
 * Inhalts-Übernahme von der Freigabelinie `main` auf die Integrationslinie
 * `develop`.
 *
 * Seit dem Release-Branch-Modell (2026-09-12) nimmt `main` Commits auf, die
 * `develop` nicht kennt: den Release-Merge, die Manifest-Syncs der
 * Catalog-Lane und direkte Hotfixes. Die Lane auf `main` läuft bewusst
 * unabhängig von `develop` weiter — ein Katalog-Update darf keine Bruchstücke
 * aus der Integrationslinie in die Produktion ziehen. Der Rückfluss ist
 * deshalb ein eigener Vorgang, und er ist Vorbedingung jeder Freigabe: Solange
 * `main` Inhalt trägt, den `develop` nicht hat, weichen die Bäume ab und die
 * Release-Vorbereitung (`scripts/release-prepare.mjs`) stoppt.
 *
 * Übertragen wird die **Änderung**, nicht der Zustand. Ein greifendes
 * Migrationsprädikat beweist nur, dass der Zielzustand ein zulässiger Übergang
 * ist, nicht dass er die Änderung aus `main` trägt: Stehen im gemeinsamen
 * Ausgangsstand zwei Kataloge auf `preview` und `supported`, bewegt `main` den
 * einen auf `supported` und `develop` unabhängig den anderen auf `preview`, so
 * setzt eine vollständige Kopie des `main`-Manifests beide auf `supported` —
 * und der Lifecycle-Vertrag akzeptiert das, obwohl develops Änderung
 * zurückgenommen wurde. Jede Inhaltsklasse hat deshalb ihre eigene, benannte
 * Bezugsgröße:
 *
 * - **M1** (nur das Manifest) übernimmt wholesale aus `main`, aber nur unter
 *   der Vorbedingung, dass develops aktuelles Manifest byte-identisch mit dem
 *   Manifest an irgendeinem von `origin/main` erreichbaren Commit ist. Dann
 *   stammt develops Stand nachweislich aus `main`. Übernommen wird immer der
 *   Sprung auf `main`s aktuellen Stand, nie ein Einzelschritt. Weil die
 *   Vorbedingung inhaltsbasiert ist, braucht M1 keine Historie und darf
 *   gesquasht werden.
 * - **M2** (Manifest und Quellregister) und **M3** (Inhalt ohne Manifestpfad)
 *   nutzen einen Drei-Wege-Merge gegen `git merge-base origin/main
 *   origin/develop`. Beide tragen gewöhnlichen Quellcode, den beide Linien
 *   bewegen dürfen; dort ist Gits Merge-Semantik das richtige Werkzeug und ein
 *   Konflikt eine echte Aussage. Damit diese Basis gültig bleibt, müssen M2
 *   und M3 als Merge-Commit gemergt werden — ein Squash ließe die Merge-Basis
 *   zurückfallen.
 *
 * **Betriebsgrenze M1-Squash vor M2.** Weil M1 gesquasht werden darf, schreibt
 * es die gemeinsame Basis nicht fort. Der Manifestpfad in der Basis veraltet
 * dadurch, während `develop` den neuen Inhalt bereits trägt. Ein anschließender
 * M2-Merge rechnet dann gegen den alten Manifeststand und kollidiert, obwohl
 * die Inhalte längst abgeglichen sind. Der Abbruch behandelt das sicher —
 * nichts wird überschrieben —, aber die Auflösung ist dann Handarbeit. Ein
 * sichtbarer Fehlschlag ist hier das gewünschte Verhalten.
 *
 * Dieses Skript mergt nicht und löscht keine Branches.
 */

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CATALOG_IMPORT_BASE_REF,
  CATALOG_IMPORT_BRANCH,
  CATALOG_IMPORT_SOURCE_REF,
  TRACKED_MANIFEST_PATH,
  isRegistryLifecycleOnlyMigration,
  isRegistryOscalVersionMigration,
  isRegistryPreviewArtifactExpansion,
  loadSourceRegistryAtRef,
  parseNameStatusDiff,
} from './catalog-sync-guard.mjs';

/** Quellregister-Pfad — Unterscheidungsmerkmal zwischen M1 und M2. */
export const REGISTRY_PATH = 'src/domain/sourceRegistry.mjs';

/**
 * Namensraum der Merge-Commit-Klassen. Bewusst neutral: Er darf weder das
 * Sync-Präfix `chore/catalog-sync-` noch den M1-Namen tragen, weil beide im
 * `catalog-sync-guard` einen eigenen Vertrag auslösen.
 */
export const BACKMERGE_BRANCH = 'chore/backmerge-main-to-develop';

export const INTEGRATION_REF = 'origin/develop';
export const SOURCE_REF = CATALOG_IMPORT_SOURCE_REF;

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/**
 * Die Quellmarke ordnet einem Übernahme-PR ausdrücklich den `main`-Stand zu,
 * den er trägt. Sie steht im PR-Body und wird nicht aus der Commit-Struktur
 * erschlossen: Eine Ableitung über den zweiten Elternteil des Heads wäre
 * unzuverlässig, weil ein späterer Merge des neueren `develop` in den Branch —
 * etwa über GitHubs „Update branch" — genau diesen Elternteil überschreibt.
 */
const SOURCE_MARKER_PATTERN = /<!--\s*backmerge-source:\s*([0-9a-f]{40})\s*-->/g;

const CONTRACT_START = '<!-- documentation-contract:start -->';
const CONTRACT_END = '<!-- documentation-contract:end -->';
const FILES_START = '<!-- documentation-files:start -->';
const FILES_END = '<!-- documentation-files:end -->';
const REASON_START = '<!-- no-documentation-impact:start -->';
const REASON_END = '<!-- no-documentation-impact:end -->';

/** Obergrenze der auf Ancestry geprüften abgeschlossenen Übernahmen. */
const MERGED_PR_LOOKBACK = 20;

export class BackmergeError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BackmergeError';
  }
}

function compareStringsByCodeUnit(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/**
 * Prozessaufruf mit stdin-Unterstützung. `git cat-file --batch-check` liest
 * seine Anfragen ausschließlich von stdin, weshalb `execFile` hier nicht
 * genügt.
 */
export async function runProcess(command, args, { input, encoding = 'utf8', allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutChunks = [];
    const stderrChunks = [];
    child.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => {
      const stdout = Buffer.concat(stdoutChunks);
      const stderr = Buffer.concat(stderrChunks).toString('utf8');
      const result = {
        code,
        stdout: encoding === 'buffer' ? stdout : stdout.toString(encoding),
        stderr,
      };
      if (code !== 0 && !allowFailure) {
        const error = new Error(
          `${command} ${args.join(' ')} failed with exit code ${code}: ${stderr.trim()}`,
        );
        error.result = result;
        reject(error);
        return;
      }
      resolve(result);
    });
    child.stdin.end(input ?? '');
  });
}

/** Standard-git-Runner; in Tests durch einen Runner auf ein temporäres Repo ersetzbar. */
export function createGitRunner({ cwd } = {}) {
  return async (args, options = {}) => {
    const gitArgs = cwd ? ['-C', cwd, ...args] : args;
    return runProcess('git', gitArgs, options);
  };
}

async function gitText(git, args) {
  const { stdout } = await git(args);
  return stdout.trim();
}

async function gitSucceeds(git, args) {
  const { code } = await git(args, { allowFailure: true });
  return code === 0;
}

export function formatSourceMarker(sha) {
  if (!SHA_PATTERN.test(sha)) {
    throw new BackmergeError(`Quellmarke verlangt einen 40-stelligen Kleinbuchstaben-SHA: ${sha}`);
  }
  return `<!-- backmerge-source: ${sha} -->`;
}

/**
 * Liest alle Quellmarken eines PR-Bodys. Eine leere Liste ist ein Befund, kein
 * Bestehen — der Aufrufer behandelt sie als Fehler.
 */
export function parseSourceMarkers(body) {
  if (typeof body !== 'string') return [];
  return [...body.matchAll(SOURCE_MARKER_PATTERN)].map((match) => match[1]);
}

/**
 * Ordnet den Unterschied zwischen `main` und der gemeinsamen Basis einer
 * Inhaltsklasse zu. Bezugsgröße ist, was `main` seit der Merge-Basis bewegt
 * hat — nicht der Zustandsunterschied beider Linien, denn den erzeugt auch
 * normale Entwicklungsarbeit auf `develop`.
 *
 * `snapshotAdvances` bezeichnet ausschließlich, dass sich `snapshotCommitSha`
 * überhaupt bewegt. Ob der neue Snapshot dem alten tatsächlich **voraus** ist,
 * beantwortet allein `verifySnapshotProgress` gegen die GitHub-Compare-API;
 * das läuft am Pull Request im `catalog-sync-guard` und wird hier nicht
 * vorweggenommen.
 */
export function classifyBackmerge({ changedPaths, snapshotAdvances }) {
  const paths = [...new Set(changedPaths)].sort(compareStringsByCodeUnit);
  if (paths.length === 0) {
    return { klasse: 'idle', reason: '`main` hat seit der gemeinsamen Basis nichts bewegt.' };
  }

  if (!paths.includes(TRACKED_MANIFEST_PATH)) {
    return {
      klasse: 'M3',
      reason: `Inhalt ohne Manifestpfad (${paths.length} Pfad(e)).`,
    };
  }

  if (paths.includes(REGISTRY_PATH)) {
    return {
      klasse: 'M2',
      reason: `${TRACKED_MANIFEST_PATH} und ${REGISTRY_PATH} gemeinsam bewegt.`,
    };
  }

  if (paths.length !== 1) {
    const companions = paths.filter((path) => path !== TRACKED_MANIFEST_PATH);
    return {
      klasse: 'conflict',
      reason:
        `${TRACKED_MANIFEST_PATH} wurde zusammen mit ${companions.join(', ')} bewegt, `
        + `aber ohne ${REGISTRY_PATH}. Für diese Kombination greift kein Übernahmevertrag.`,
    };
  }

  if (!snapshotAdvances) {
    return {
      klasse: 'conflict',
      reason:
        `${TRACKED_MANIFEST_PATH} wurde bewegt, ohne dass sich snapshotCommitSha ändert. `
        + 'Eine Manifest-Übernahme ohne Snapshotwechsel passiert den Guard nicht.',
    };
  }

  return { klasse: 'M1', reason: `Ausschließlich ${TRACKED_MANIFEST_PATH} bewegt.` };
}

/** M1 kopiert das Manifest; alle übrigen Klassen laufen über einen Merge-Commit. */
export function selectBranch({ klasse, repairRequired }) {
  return !repairRequired && klasse === 'M1' ? CATALOG_IMPORT_BRANCH : BACKMERGE_BRANCH;
}

/**
 * Sammelt jeden Blob, den `upstream-manifest.json` über die gesamte von
 * `origin/main` erreichbare Historie je getragen hat.
 *
 * Die Aufzählung läuft bewusst über **alle** erreichbaren Commits und nicht
 * über `git rev-list <ref> -- <pfad>`: Letzteres vereinfacht die Historie an
 * Merges und kann dabei Zustände auslassen, die der Pfad tatsächlich hatte.
 * `git cat-file --batch-check` beantwortet die gesamte Menge in einem einzigen
 * Prozess; fehlende Pfade meldet es als `missing`, was hier folgenlos ist.
 */
export async function collectManifestBlobsOnSource(git, { sourceRef = SOURCE_REF } = {}) {
  const revisions = await gitText(git, ['rev-list', sourceRef]);
  if (revisions.length === 0) return new Set();

  const requests = revisions
    .split('\n')
    .map((sha) => `${sha}:${TRACKED_MANIFEST_PATH}\n`)
    .join('');
  const { stdout } = await git(['cat-file', '--batch-check=%(objectname) %(objecttype)'], {
    input: requests,
  });

  const blobs = new Set();
  for (const line of stdout.split('\n')) {
    const [objectName, objectType] = line.trim().split(' ');
    if (objectType === 'blob' && SHA_PATTERN.test(objectName)) {
      blobs.add(objectName);
    }
  }
  return blobs;
}

/**
 * Die M1-Vorbedingung: develops Manifest muss nachweislich aus `main` stammen.
 * Trifft das zu, darf es durch den neueren Stand ersetzt werden, unabhängig
 * davon, wie viele Sync-Schritte dazwischenliegen.
 */
export async function manifestOriginatesFromSource(git, { sourceRef = SOURCE_REF, integrationRef = INTEGRATION_REF } = {}) {
  const integrationBlob = await gitText(git, [
    'rev-parse',
    `${integrationRef}:${TRACKED_MANIFEST_PATH}`,
  ]);
  const sourceBlobs = await collectManifestBlobsOnSource(git, { sourceRef });
  return sourceBlobs.has(integrationBlob);
}

/**
 * Prüft die Ancestry abgeschlossener M2- und M3-Übernahmen. Das ist die erste
 * Handlung jedes Laufs, vor dem Leerlauftest: Nach einem Squash liegt der
 * Inhalt vollständig vor, und der Leerlauftest würde den Lauf sonst erfolgreich
 * beenden, während die Ancestry fehlt.
 *
 * Zweistufig und fail-closed. Eine fehlende oder von der PR-Spitze nicht
 * erreichbare Marke ist ungültig und ein harter Fehler — sie beweist nichts
 * und darf deshalb auch nichts durchwinken. Erst danach wird gefragt, ob der
 * markierte Stand Vorfahr von `develop` geworden ist.
 */
export async function checkCompletedImportAncestry(git, { pullRequests, integrationRef = INTEGRATION_REF }) {
  const invalid = [];
  const missing = [];

  for (const pullRequest of pullRequests) {
    const markers = parseSourceMarkers(pullRequest.body);
    if (markers.length === 0) {
      invalid.push({
        number: pullRequest.number,
        reason: 'Der PR-Body trägt keine Quellmarke `<!-- backmerge-source: <sha> -->`.',
      });
      continue;
    }

    const prTipRef = `refs/backmerge-pr/${pullRequest.number}`;
    const tipAvailable = await gitSucceeds(git, ['rev-parse', '--verify', '--quiet', `${prTipRef}^{commit}`]);
    if (!tipAvailable) {
      invalid.push({
        number: pullRequest.number,
        reason: `Die PR-Spitze ist nicht abrufbar (${prTipRef}); die Marke ist damit nicht überprüfbar.`,
      });
      continue;
    }

    for (const marker of markers) {
      const markerKnown = await gitSucceeds(git, ['rev-parse', '--verify', '--quiet', `${marker}^{commit}`]);
      if (!markerKnown) {
        invalid.push({
          number: pullRequest.number,
          reason: `Der markierte Commit ${marker} existiert im Repository nicht.`,
        });
        continue;
      }

      const reachableFromTip = await gitSucceeds(git, ['merge-base', '--is-ancestor', marker, prTipRef]);
      if (!reachableFromTip) {
        invalid.push({
          number: pullRequest.number,
          reason: `Der markierte Commit ${marker} ist von der PR-Spitze nicht erreichbar.`,
        });
        continue;
      }

      const ancestorOfIntegration = await gitSucceeds(git, [
        'merge-base',
        '--is-ancestor',
        marker,
        integrationRef,
      ]);
      if (!ancestorOfIntegration) {
        missing.push({ number: pullRequest.number, sha: marker });
      }
    }
  }

  return { invalid, missing };
}

function formatDocumentationSection({ changedPaths }) {
  const documentationFiles = changedPaths
    .filter((path) => path === 'README.md' || path.startsWith('docs/'))
    .sort(compareStringsByCodeUnit);

  if (documentationFiles.length > 0) {
    const declared = documentationFiles.map((path) => `\`${path}\``).join(', ');
    return [
      CONTRACT_START,
      '## Dokumentationsauswirkung',
      '',
      '- [x] **Dokumentation aktualisiert**',
      `  Betroffene Dateien: ${FILES_START} ${declared} ${FILES_END}`,
      '- [ ] **Keine Dokumentationsauswirkung**',
      `  Begründung: ${REASON_START} Konkrete Begründung eintragen. ${REASON_END}`,
      CONTRACT_END,
    ].join('\n');
  }

  const reason =
    'Diese Übernahme trägt ausschließlich Inhalte nach `develop`, die auf der '
    + 'Freigabelinie bereits geprüft und dokumentiert wurden; die zugehörige '
    + 'Dokumentation wurde im ursprünglichen Pull Request geführt und ändert sich hier nicht.';
  return [
    CONTRACT_START,
    '## Dokumentationsauswirkung',
    '',
    '- [ ] **Dokumentation aktualisiert**',
    `  Betroffene Dateien: ${FILES_START} \`docs/DATEI.md\` oder \`README.md\` ${FILES_END}`,
    '- [x] **Keine Dokumentationsauswirkung**',
    `  Begründung: ${REASON_START} ${reason} ${REASON_END}`,
    CONTRACT_END,
  ].join('\n');
}

export function buildPullRequestBody({
  klasse,
  reason,
  sourceSha,
  changedPaths,
  repairSources = [],
  mergeMethod,
}) {
  const paths = [...changedPaths].sort(compareStringsByCodeUnit);
  const lines = [
    '## Zusammenfassung',
    '',
    `Automatische Inhalts-Übernahme \`main\` → \`develop\`, Klasse **${klasse}**. ${reason}`,
    '',
    `**Quellstand \`main\`:** \`${sourceSha}\``,
    '',
    `**Erforderliche Merge-Methode:** ${mergeMethod}`,
    '',
  ];

  if (mergeMethod === 'Merge-Commit') {
    lines.push(
      'Ein Squash ließe die gemeinsame Merge-Basis zurückfallen; die nächste Übernahme '
      + 'rechnete dann gegen einen veralteten Stand. Der Folgelauf erkennt einen Squash '
      + 'an der fehlenden Ancestry und stellt einen wiederherstellenden Pull Request.',
      '',
    );
  } else {
    lines.push(
      'Diese Klasse trägt eine inhaltsbasierte Vorbedingung statt einer Patch-Basis und '
      + 'darf deshalb gesquasht werden.',
      '',
    );
  }

  if (repairSources.length > 0) {
    lines.push(
      '### Wiederherstellung fehlender Ancestry',
      '',
      'Die folgenden abgeschlossenen Übernahmen liegen inhaltlich vor, sind aber nicht '
      + 'Vorfahr von `develop` — ihr Pull Request wurde gesquasht:',
      '',
      ...repairSources.map(
        (entry) => `- Pull Request #${entry.number}, Quellstand \`${entry.sha}\``,
      ),
      '',
    );
  }

  lines.push(
    '### Übernommene Pfade',
    '',
    ...(paths.length > 0
      ? paths.map((path) => `- \`${path}\``)
      : ['Keine — der Inhalt liegt auf `develop` bereits vollständig vor. Dieser Pull '
        + 'Request stellt ausschließlich die Ancestry wieder her.']),
    '',
    '## Validierung',
    '',
    'Der Lauf klassifiziert die Übernahme, prüft die Vorbedingung der Klasse und bricht '
    + 'ohne Pull Request ab, wenn kein Vertrag greift. Die inhaltliche Prüfung des '
    + 'Manifests gegen die BSI-API führt `catalog-sync-guard` an diesem Pull Request aus.',
    '',
    formatDocumentationSection({ changedPaths: paths }),
    '',
    formatSourceMarker(sourceSha),
  );

  if (repairSources.length > 0) {
    lines.push(...repairSources.map((entry) => formatSourceMarker(entry.sha)));
  }

  return lines.join('\n');
}

async function readManifestAtRef(git, ref) {
  const { stdout } = await git(['show', `${ref}:${TRACKED_MANIFEST_PATH}`], { allowFailure: true });
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

/**
 * Prüft für M2, ob der **resultierende Zielzustand** einen der drei
 * Registry-Migrationsverträge erfüllt. Greift keiner, entsteht kein Pull
 * Request: Der `catalog-sync-guard` würde ihn ohnehin ablehnen, und ein roter
 * Pull Request wäre ein schlechterer Befund als ein roter Lauf mit genannten
 * Zuständen.
 */
export async function migrationContractHolds(git, { integrationRef, resultRef, cwd }) {
  const previousManifest = await readManifestAtRef(git, integrationRef);
  const nextManifest = await readManifestAtRef(git, resultRef);
  if (!previousManifest || !nextManifest) return { holds: false, contract: null };

  const diffOutput = await gitText(git, [
    'diff',
    '--name-status',
    '--no-renames',
    integrationRef,
    resultRef,
    '--',
  ]);
  const diffEntries = parseNameStatusDiff(diffOutput);

  if (isRegistryLifecycleOnlyMigration({ diffEntries, previousManifest, nextManifest })) {
    return { holds: true, contract: 'isRegistryLifecycleOnlyMigration' };
  }
  if (isRegistryPreviewArtifactExpansion({ diffEntries, previousManifest, nextManifest })) {
    return { holds: true, contract: 'isRegistryPreviewArtifactExpansion' };
  }

  // Ein nicht ladbarer Registerstand ist kein „vielleicht": Er lässt den
  // Vertrag nicht greifen, genau wie im Guard, wo ein fehlender Vorstand auf
  // den regulären Sync-Pfad zurückfällt. Der Aufrufer meldet daraufhin beide
  // Zustände — eine verständlichere Aussage als ein Modulauflösungsfehler.
  let previousSourceRegistry;
  let nextSourceRegistry;
  try {
    previousSourceRegistry = await loadSourceRegistryAtRef(
      await gitText(git, ['rev-parse', integrationRef]),
      { cwd },
    );
    nextSourceRegistry = await loadSourceRegistryAtRef(
      await gitText(git, ['rev-parse', resultRef]),
      { cwd },
    );
  } catch {
    return { holds: false, contract: null };
  }

  if (isRegistryOscalVersionMigration({
    diffEntries,
    previousManifest,
    nextManifest,
    previousSourceRegistry,
    nextSourceRegistry,
  })) {
    return { holds: true, contract: 'isRegistryOscalVersionMigration' };
  }

  return { holds: false, contract: null };
}

/**
 * Baut den Übernahme-Branch neu aus `origin/develop` auf und berechnet das
 * Ergebnis der Klasse. Gibt den resultierenden Tree zurück, ohne zu committen —
 * der Leerlauftest entscheidet danach, ob überhaupt ein Commit entsteht.
 */
async function buildImport(git, { klasse, branch, repairSources, cwd }) {
  await git(['switch', '--force-create', branch, INTEGRATION_REF]);

  for (const entry of repairSources) {
    const merge = await git(
      ['merge', '--no-ff', '-m', `chore(sync): Ancestry von #${entry.number} wiederherstellen`, entry.sha],
      { allowFailure: true },
    );
    if (merge.code !== 0) {
      await git(['merge', '--abort'], { allowFailure: true });
      throw new BackmergeError(
        `Der Wiederherstellungs-Merge für Pull Request #${entry.number} (${entry.sha}) `
        + `kollidiert mit \`develop\` und wurde abgebrochen. Nichts wurde überschrieben; `
        + `die Auflösung ist Handarbeit.\n${merge.stdout}${merge.stderr}`,
      );
    }
  }

  if (klasse === 'M1') {
    // Wholesale, byteweise: Das Manifest ist eine kanonisch erzeugte Datei mit
    // eigener Signatur; ein zeilenweiser Patch hätte hier keine Bedeutung.
    const { stdout } = await git(['show', `${SOURCE_REF}:${TRACKED_MANIFEST_PATH}`], {
      encoding: 'buffer',
    });
    await writeFile(join(cwd, TRACKED_MANIFEST_PATH), stdout);
    await git(['add', '--', TRACKED_MANIFEST_PATH]);
    return { mergePending: false };
  }

  const merge = await git(['merge', '--no-ff', '--no-commit', SOURCE_REF], { allowFailure: true });
  if (merge.code !== 0) {
    await git(['merge', '--abort'], { allowFailure: true });
    throw new BackmergeError(
      `Der Drei-Wege-Merge gegen \`git merge-base ${SOURCE_REF} ${INTEGRATION_REF}\` `
      + `schlägt fehl, weil die Ausgangszustände auseinandergelaufen sind. Es entsteht `
      + `kein Pull Request; nichts wurde überschrieben.\n${merge.stdout}${merge.stderr}`,
    );
  }

  const mergePending = await gitSucceeds(git, ['rev-parse', '--verify', '--quiet', 'MERGE_HEAD']);
  return { mergePending };
}

export function createGitHubClient({ repository, run = runProcess } = {}) {
  const repositoryArgs = repository ? ['--repo', repository] : [];
  return {
    async listMergedPullRequests(headBranch, base = CATALOG_IMPORT_BASE_REF) {
      const { stdout } = await run('gh', [
        'pr', 'list',
        ...repositoryArgs,
        '--state', 'merged',
        '--base', base,
        '--head', headBranch,
        '--limit', String(MERGED_PR_LOOKBACK),
        '--json', 'number,body',
      ]);
      return JSON.parse(stdout);
    },
    async findOpenPullRequest(headBranch, base = CATALOG_IMPORT_BASE_REF) {
      const { stdout } = await run('gh', [
        'pr', 'list',
        ...repositoryArgs,
        '--state', 'open',
        '--base', base,
        '--head', headBranch,
        '--json', 'number',
        '--jq', '.[0].number // empty',
      ]);
      const number = stdout.trim();
      return number.length > 0 ? Number(number) : null;
    },
    async createPullRequest({ head, base = CATALOG_IMPORT_BASE_REF, title, body }) {
      const { stdout } = await run('gh', [
        'pr', 'create',
        ...repositoryArgs,
        '--base', base,
        '--head', head,
        '--title', title,
        '--body', body,
      ]);
      return stdout.trim();
    },
    async updatePullRequest({ number, base, title, body }) {
      await run('gh', [
        'pr', 'edit', String(number),
        ...repositoryArgs,
        ...(base ? ['--base', base] : []),
        '--title', title,
        '--body', body,
      ]);
      return number;
    },
  };
}

/**
 * Holt die Spitzen aller geprüften Pull Requests in einem einzigen Fetch nach
 * `refs/backmerge-pr/<nummer>`. GitHub hält `refs/pull/<n>/head` auch nach dem
 * Merge vor, weshalb ein gesquashter Branch die Prüfung nicht verhindert.
 */
async function fetchPullRequestTips(git, pullRequests) {
  if (pullRequests.length === 0) return;
  const refspecs = pullRequests.map(
    (pullRequest) => `+refs/pull/${pullRequest.number}/head:refs/backmerge-pr/${pullRequest.number}`,
  );
  await git(['fetch', '--no-tags', 'origin', ...refspecs], { allowFailure: true });
}

export async function runBackmerge({
  cwd = process.cwd(),
  git = createGitRunner({ cwd }),
  github = createGitHubClient({ repository: process.env.GITHUB_REPOSITORY }),
  logger = console,
} = {}) {
  // Explizite Refspecs: Ein `git fetch origin main develop` aktualisiert nur
  // FETCH_HEAD, nicht die Remote-Tracking-Refs, gegen die hier gerechnet wird.
  await git([
    'fetch', '--no-tags', 'origin',
    '+refs/heads/main:refs/remotes/origin/main',
    `+refs/heads/${CATALOG_IMPORT_BASE_REF}:refs/remotes/origin/${CATALOG_IMPORT_BASE_REF}`,
  ]);

  const sourceSha = await gitText(git, ['rev-parse', SOURCE_REF]);
  const integrationSha = await gitText(git, ['rev-parse', INTEGRATION_REF]);
  logger.log(`Quellstand ${SOURCE_REF}=${sourceSha}, Integrationsstand ${INTEGRATION_REF}=${integrationSha}.`);

  // Erste Handlung: Ancestry vor dem Leerlauftest.
  const mergedPullRequests = await github.listMergedPullRequests(BACKMERGE_BRANCH);
  await fetchPullRequestTips(git, mergedPullRequests);
  const { invalid, missing } = await checkCompletedImportAncestry(git, {
    pullRequests: mergedPullRequests,
  });

  if (invalid.length > 0) {
    throw new BackmergeError(
      'Mindestens eine abgeschlossene Übernahme trägt keine überprüfbare Quellmarke:\n'
      + invalid.map((entry) => `- Pull Request #${entry.number}: ${entry.reason}`).join('\n'),
    );
  }

  const repairRequired = missing.length > 0;
  if (repairRequired) {
    logger.error(
      'Fehlende Ancestry abgeschlossener Übernahmen:\n'
      + missing.map((entry) => `- Pull Request #${entry.number}, Quellstand ${entry.sha}`).join('\n'),
    );
  }

  const mergeBase = await gitText(git, ['merge-base', SOURCE_REF, INTEGRATION_REF]);
  const diffOutput = await gitText(git, [
    'diff', '--name-status', '--no-renames', mergeBase, SOURCE_REF, '--',
  ]);
  const changedPaths = parseNameStatusDiff(diffOutput).map((entry) => entry.path);

  const sourceManifest = await readManifestAtRef(git, SOURCE_REF);
  const integrationManifest = await readManifestAtRef(git, INTEGRATION_REF);
  const snapshotAdvances =
    sourceManifest?.snapshotCommitSha !== undefined
    && sourceManifest.snapshotCommitSha !== integrationManifest?.snapshotCommitSha;

  const { klasse, reason } = classifyBackmerge({ changedPaths, snapshotAdvances });
  logger.log(`Klasse ${klasse}: ${reason}`);

  if (klasse === 'conflict') {
    throw new BackmergeError(
      `Es entsteht kein Pull Request. ${reason}\n`
      + `Zustand ${SOURCE_REF}=${sourceSha}, Zustand ${INTEGRATION_REF}=${integrationSha}, `
      + `gemeinsame Basis ${mergeBase}.`,
    );
  }

  if (klasse === 'idle' && !repairRequired) {
    logger.log('Kein Übernahmebedarf und intakte Ancestry — Lauf endet ohne Pull Request.');
    return { created: false, klasse, repairRequired };
  }

  if (klasse === 'M1' && !repairRequired) {
    const originates = await manifestOriginatesFromSource(git);
    if (!originates) {
      throw new BackmergeError(
        `Die M1-Vorbedingung ist verletzt: Das Manifest auf \`${INTEGRATION_REF}\` kommt an `
        + `keinem von \`${SOURCE_REF}\` erreichbaren Commit vor. Der Stand stammt damit nicht `
        + 'nachweislich aus der Freigabelinie und wird nicht wholesale ersetzt. Es entsteht '
        + 'kein Pull Request.',
      );
    }
  }

  // Nur ein Merge-Commit stellt eine fehlende Ancestry wieder her. Steht die
  // Reparatur an, verlässt der Lauf deshalb auch für eine reine
  // Manifestbewegung den Squash-fähigen M1-Pfad.
  const effectiveKlasse = repairRequired && klasse !== 'M2' ? 'M3' : klasse;
  const effectiveReason = repairRequired
    ? `${reason} Der Lauf stellt zusätzlich die Ancestry abgeschlossener Übernahmen wieder her `
      + 'und läuft deshalb über einen Merge-Commit.'
    : reason;
  const branch = selectBranch({ klasse: effectiveKlasse, repairRequired });
  const { mergePending } = await buildImport(git, {
    klasse: effectiveKlasse,
    branch,
    repairSources: repairRequired ? missing : [],
    cwd,
  });

  const resultTree = await gitText(git, ['write-tree']);
  const integrationTree = await gitText(git, ['rev-parse', `${INTEGRATION_REF}^{tree}`]);

  // Der Leerlauftest vergleicht das ERGEBNIS der Übernahme mit develops Baum,
  // nicht die Bäume von main und develop: Letztere unterscheiden sich schon
  // durch normale Entwicklungsarbeit, während das Ergebnis genau dann develops
  // Baum ergibt, wenn nichts zu übernehmen ist.
  if (!repairRequired && resultTree === integrationTree) {
    if (mergePending) await git(['merge', '--abort'], { allowFailure: true });
    logger.log(
      'Die berechnete Übernahme ändert den `develop`-Baum nicht — Lauf endet ohne Pull Request.',
    );
    return { created: false, klasse: effectiveKlasse, repairRequired };
  }

  if (mergePending) {
    await git(['commit', '--no-edit']);
  } else if (effectiveKlasse === 'M1') {
    await git([
      'commit',
      '-m',
      `chore(sync): BSI-Manifest aus ${SOURCE_REF} nach ${CATALOG_IMPORT_BASE_REF} übernehmen`,
    ]);
  }

  const mergeMethod = effectiveKlasse === 'M1' ? 'Squash' : 'Merge-Commit';
  const title =
    effectiveKlasse === 'M1'
      ? `chore(sync): BSI-Manifest nach ${CATALOG_IMPORT_BASE_REF} übernehmen`
      : `chore(sync): Inhalt von main nach ${CATALOG_IMPORT_BASE_REF} übernehmen (${effectiveKlasse})`;

  if (effectiveKlasse === 'M2') {
    const head = await gitText(git, ['rev-parse', 'HEAD']);
    const { holds, contract } = await migrationContractHolds(git, {
      integrationRef: INTEGRATION_REF,
      resultRef: head,
      cwd,
    });
    if (!holds) {
      throw new BackmergeError(
        'Der resultierende Zielzustand erfüllt keinen der drei Registry-Migrationsverträge. '
        + 'Es entsteht kein Pull Request.\n'
        + `Zustand ${SOURCE_REF}=${sourceSha}, Zustand ${INTEGRATION_REF}=${integrationSha}, `
        + `berechnetes Ergebnis ${head}.`,
      );
    }
    logger.log(`Migrationsvertrag ${contract} greift gegen den Zielzustand.`);
  }

  // `--force-with-lease` gegen den zuvor gelesenen Remote-Stand: Der Branch
  // wird bei jedem Lauf neu aus `develop` aufgebaut, darf dabei aber keinen
  // fremden Push überschreiben, der zwischen Lesen und Schreiben landete.
  const remoteHead = await gitText(git, ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
  const remoteSha = remoteHead.split('\n')[0]?.split('\t')[0] ?? '';
  const pushArgs = SHA_PATTERN.test(remoteSha)
    ? ['push', `--force-with-lease=refs/heads/${branch}:${remoteSha}`, 'origin', `HEAD:refs/heads/${branch}`]
    : ['push', 'origin', `HEAD:refs/heads/${branch}`];
  await git(pushArgs);

  const body = buildPullRequestBody({
    klasse: effectiveKlasse,
    reason: effectiveReason,
    sourceSha,
    changedPaths,
    repairSources: repairRequired ? missing : [],
    mergeMethod,
  });

  const existing = await github.findOpenPullRequest(branch);
  if (existing) {
    await github.updatePullRequest({ number: existing, title, body });
    logger.log(`Übernahme-Pull-Request #${existing} aktualisiert.`);
  } else {
    const url = await github.createPullRequest({ head: branch, title, body });
    logger.log(`Übernahme-Pull-Request erstellt: ${url}`);
  }

  if (repairRequired) {
    throw new BackmergeError(
      'Der wiederherstellende Pull Request steht. Der Lauf endet trotzdem mit einem Fehler, '
      + 'weil die Ancestry abgeschlossener Übernahmen bis zu seinem Merge verletzt bleibt.',
    );
  }

  return { created: true, klasse: effectiveKlasse, repairRequired };
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await runBackmerge();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
