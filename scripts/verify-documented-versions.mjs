#!/usr/bin/env node

/*
 * Vergleicht die in `docs/ARCHITECTURE.md` zugesagten Versionsangaben mit dem
 * tatsächlich installierten Stand (GSPP-399).
 *
 * Der PR-Dokumentationsvertrag in `scripts/pr-documentation-contract.mjs`
 * greift nur bei Änderungen unter `src/`. Dependency-PRs fallen deshalb aus
 * ihm heraus — ausgerechnet die Klasse von Änderungen, die dokumentierte
 * Versions- und Lieferkettenangaben ungültig macht. Dieser Guard schließt die
 * Lücke auf einer zweiten, maschinellen Achse: netzfrei, ohne Beteiligung des
 * PR-Bodies und fail-closed. Wo eine dokumentierte Angabe nicht mehr
 * auffindbar ist, schlägt er ebenso fehl wie bei einer abweichenden — sonst
 * ließe eine Umformulierung der Doku die Prüfung stillschweigend leerlaufen.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DOCUMENTATION_PATH = 'docs/ARCHITECTURE.md';
const PACKAGE_MANIFEST_PATH = 'package.json';
const BROWSERS_MANIFEST_PATH = 'node_modules/playwright-core/browsers.json';

const DEPENDENCY_TABLE_HEADER = '| Abhängigkeit | Exakte Version | Lizenz | Zweck |';

/*
 * Der Absatz steht in der Dokumentation über drei Zeilen umbrochen. Das Muster
 * toleriert den Umbruch an jeder Wortgrenze, damit eine reine Neuformatierung
 * keinen Fehlalarm auslöst — jede inhaltliche Änderung dagegen schon.
 */
const BROWSER_CLAIM_SENTENCE =
  'Die exakte `playwright`-Version {version} liefert laut ihrem mitinstallierten '
  + '`browsers.json` Chromium-Revision {version} als Chrome for Testing {version}';

const VERSION_PLACEHOLDER = '{version}';
const CHROMIUM_BROWSER_NAME = 'chromium';

export class DocumentedVersionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DocumentedVersionError';
  }
}

/**
 * Übersetzt einen Klartextsatz aus der Dokumentation in ein Muster, das
 * Zeilenumbrüche an Wortgrenzen toleriert. Jedes `{version}` wird zu einer
 * Capture-Gruppe auf einen in Backticks gesetzten Wert.
 */
function buildClaimPattern(sentence) {
  const source = sentence
    .trim()
    .split(/\s+/)
    .map((word) =>
      word === VERSION_PLACEHOLDER
        ? '`([^`]+)`'
        : word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('\\s+');

  return new RegExp(source, 'd');
}

function lineNumberAt(content, index) {
  let line = 1;
  for (let position = 0; position < index; position += 1) {
    if (content[position] === '\n') {
      line += 1;
    }
  }

  return line;
}

function splitTableRow(row) {
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function extractBacktickValues(cell) {
  return [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
}

/**
 * Liest die Abhängigkeitstabelle als Sollwerte: erste Zelle die Paketnamen
 * (eine Zeile darf mehrere nennen, die sich eine Version teilen), zweite Zelle
 * die zugesagte Version.
 */
export function parseDependencyClaims(documentation) {
  const headerIndex = documentation.indexOf(DEPENDENCY_TABLE_HEADER);
  if (headerIndex === -1) {
    throw new DocumentedVersionError(
      `${DOCUMENTATION_PATH}: Die Abhängigkeitstabelle mit der Kopfzeile `
      + `"${DEPENDENCY_TABLE_HEADER}" ist nicht mehr auffindbar.`,
    );
  }

  const lines = documentation.split('\n');
  const headerLine = lineNumberAt(documentation, headerIndex);
  const claims = [];

  // Kopfzeile und die darauf folgende Trennzeile überspringen.
  for (let index = headerLine + 1; index < lines.length; index += 1) {
    const row = lines[index];
    if (!row.startsWith('|')) {
      break;
    }

    const cells = splitTableRow(row);
    const packages = extractBacktickValues(cells[0] ?? '');
    const versions = extractBacktickValues(cells[1] ?? '');

    if (packages.length === 0 || versions.length !== 1) {
      continue;
    }

    claims.push({ line: index + 1, packages, version: versions[0] });
  }

  if (claims.length === 0) {
    throw new DocumentedVersionError(
      `${DOCUMENTATION_PATH}:${headerLine}: Die Abhängigkeitstabelle enthält keine auswertbare Zeile.`,
    );
  }

  return claims;
}

/**
 * Liest den Absatz zur Browser-Lieferkette als Sollwerte: die dort wiederholte
 * `playwright`-Version sowie Chromium-Revision und Chrome-for-Testing-Version.
 */
export function parseBrowserClaim(documentation) {
  const match = buildClaimPattern(BROWSER_CLAIM_SENTENCE).exec(documentation);
  if (match === null) {
    throw new DocumentedVersionError(
      `${DOCUMENTATION_PATH}: Der Absatz zur Chromium-Herkunft ist nicht mehr auffindbar. `
      + 'Erwartet wird die Satzform: '
      + `"${BROWSER_CLAIM_SENTENCE.replaceAll(VERSION_PLACEHOLDER, '`<Wert>`')}".`,
    );
  }

  const [playwrightVersion, revision, browserVersion] = match.slice(1);
  const [playwrightAt, revisionAt, browserVersionAt] = match.indices.slice(1);

  return {
    playwrightVersion,
    playwrightLine: lineNumberAt(documentation, playwrightAt[0]),
    revision,
    revisionLine: lineNumberAt(documentation, revisionAt[0]),
    browserVersion,
    browserVersionLine: lineNumberAt(documentation, browserVersionAt[0]),
  };
}

function readPin(packageManifest, packageName) {
  const sections = ['dependencies', 'devDependencies'];
  for (const section of sections) {
    const pin = packageManifest?.[section]?.[packageName];
    if (pin !== undefined) {
      return { pin, section };
    }
  }

  return null;
}

function findChromium(browsersManifest) {
  const entry = browsersManifest?.browsers?.find(
    (browser) => browser?.name === CHROMIUM_BROWSER_NAME,
  );

  if (entry === undefined) {
    throw new DocumentedVersionError(
      `${BROWSERS_MANIFEST_PATH}: Kein Eintrag mit name "${CHROMIUM_BROWSER_NAME}" gefunden.`,
    );
  }

  return entry;
}

/**
 * Vergleicht alle dokumentierten Angaben mit dem installierten Stand und gibt
 * die Abweichungen zurück. Eine leere Liste bedeutet: Die Dokumentation deckt
 * sich mit dem Repository.
 */
export function collectVersionDrift({ documentation, packageManifest, browsersManifest }) {
  const drift = [];

  for (const claim of parseDependencyClaims(documentation)) {
    for (const packageName of claim.packages) {
      const pinned = readPin(packageManifest, packageName);

      if (pinned === null) {
        drift.push({
          line: claim.line,
          subject: packageName,
          documented: claim.version,
          measured: 'im Manifest nicht vorhanden',
          source: `${PACKAGE_MANIFEST_PATH} → dependencies/devDependencies`,
        });
        continue;
      }

      if (pinned.pin !== claim.version) {
        drift.push({
          line: claim.line,
          subject: packageName,
          documented: claim.version,
          measured: pinned.pin,
          source: `${PACKAGE_MANIFEST_PATH} → ${pinned.section}`,
        });
      }
    }
  }

  const browserClaim = parseBrowserClaim(documentation);
  const chromium = findChromium(browsersManifest);
  const playwrightPin = readPin(packageManifest, 'playwright');

  if (playwrightPin === null) {
    drift.push({
      line: browserClaim.playwrightLine,
      subject: 'playwright',
      documented: browserClaim.playwrightVersion,
      measured: 'im Manifest nicht vorhanden',
      source: `${PACKAGE_MANIFEST_PATH} → dependencies/devDependencies`,
    });
  } else if (playwrightPin.pin !== browserClaim.playwrightVersion) {
    drift.push({
      line: browserClaim.playwrightLine,
      subject: 'playwright',
      documented: browserClaim.playwrightVersion,
      measured: playwrightPin.pin,
      source: `${PACKAGE_MANIFEST_PATH} → ${playwrightPin.section}`,
    });
  }

  if (chromium.revision !== browserClaim.revision) {
    drift.push({
      line: browserClaim.revisionLine,
      subject: 'Chromium-Revision',
      documented: browserClaim.revision,
      measured: chromium.revision,
      source: `${BROWSERS_MANIFEST_PATH} → browsers[name=${CHROMIUM_BROWSER_NAME}].revision`,
    });
  }

  if (chromium.browserVersion !== browserClaim.browserVersion) {
    drift.push({
      line: browserClaim.browserVersionLine,
      subject: 'Chrome for Testing',
      documented: browserClaim.browserVersion,
      measured: chromium.browserVersion,
      source: `${BROWSERS_MANIFEST_PATH} → browsers[name=${CHROMIUM_BROWSER_NAME}].browserVersion`,
    });
  }

  return drift;
}

export function formatDrift(drift) {
  return drift
    .map(
      (entry) =>
        `${DOCUMENTATION_PATH}:${entry.line} — ${entry.subject}: `
        + `dokumentiert "${entry.documented}", gemessen "${entry.measured}" `
        + `(Quelle: ${entry.source})`,
    )
    .join('\n');
}

function readJsonFile(path, hint) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    throw new DocumentedVersionError(`${path} ist nicht lesbar.${hint ? ` ${hint}` : ''}`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new DocumentedVersionError(
      `${path} ist kein gültiges JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export function readRepositoryState() {
  return {
    documentation: readFileSync(DOCUMENTATION_PATH, 'utf8'),
    packageManifest: readJsonFile(PACKAGE_MANIFEST_PATH),
    /*
     * Über den Dateipfad, nicht über die Modulauflösung: `playwright-core`
     * führt `./browsers.json` nicht in seinem `exports`-Feld, ein
     * `require('playwright-core/browsers.json')` scheitert mit
     * ERR_PACKAGE_PATH_NOT_EXPORTED.
     */
    browsersManifest: readJsonFile(
      BROWSERS_MANIFEST_PATH,
      'Der Guard setzt installierte Abhängigkeiten voraus (npm ci).',
    ),
  };
}

function main() {
  const drift = collectVersionDrift(readRepositoryState());

  if (drift.length > 0) {
    throw new DocumentedVersionError(
      `Die Dokumentation weicht vom installierten Stand ab:\n${formatDrift(drift)}`,
    );
  }

  console.log(`Dokumentierte Versionsangaben in ${DOCUMENTATION_PATH} decken sich mit dem installierten Stand.`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Versionsprüfung fehlgeschlagen.');
    process.exitCode = 1;
  }
}
