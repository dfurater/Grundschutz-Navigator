#!/usr/bin/env node

/*
 * Prüft den Toolchain-Vertrag der Browser-Testlane (GSPP-443).
 *
 * `docs/ARCHITECTURE.md` nennt im Abschnitt „Browser-Testlane" keine
 * Versionsliterale mehr, sondern nur Pin-Eigenschaften. Der Guard bleibt
 * Pflichtschritt, wechselt aber das Prüfobjekt: statt Doku-Kopie gegen
 * Original prüft er den Vertrag am installierten Stand. Beide Seiten jedes
 * Vergleichs bewegen sich damit bei einem Bump gemeinsam — ein Dependabot-PR
 * braucht keinen Doku-Nachzug mehr.
 *
 * Vertragspunkte:
 *   1. Jedes in der Tabelle genannte Paket trägt in `package.json` einen
 *      exakten Pin (positiv definiert, Default fail-closed).
 *   2. `vitest`, `@vitest/coverage-v8` und `@vitest/browser-playwright`
 *      tragen identische Pins.
 *   3. Die von `playwright` aufgelöste `playwright-core`-Installation trägt
 *      dieselbe Version wie der `playwright`-Pin, und ihr `browsers.json`
 *      führt einen Chromium-Eintrag mit `revision` und `browserVersion`.
 *   4. Im geprüften Dokumentationsabschnitt steht kein Versionsliteral.
 *
 * Der Guard ist netzfrei und fail-closed: nicht auffindbare
 * Abschnittsüberschrift, nicht auffindbare Tabellenkopfzeile, nicht
 * auswertbare Tabellenzeile und nicht auffindbare Satzform des
 * Chromium-Absatzes lassen ihn ebenso fehlschlagen wie ein verletzter
 * Vertragspunkt — sonst ließe eine Umformulierung der Doku die Prüfung
 * stillschweigend leerlaufen.
 */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DOCUMENTATION_PATH = 'docs/ARCHITECTURE.md';
const PACKAGE_MANIFEST_PATH = 'package.json';
const SECTION_HEADING = '## Browser-Testlane';
const SECTION_END_PREFIX = '## ';

const DEPENDENCY_TABLE_HEADER = '| Abhängigkeit | Pin | Lizenz | Zweck |';

/*
 * Der Chromium-Absatz in neuer Form: Er nennt keine Version mehr, sondern die
 * Bindung — die Revision steht im `browsers.json` der aufgelösten
 * `playwright-core`-Installation. Das Muster toleriert den Zeilenumbruch an
 * jeder Wortgrenze, damit eine reine Neuformatierung keinen Fehlalarm auslöst
 * — jede inhaltliche Änderung dagegen schon.
 */
const CHROMIUM_PARAGRAPH_SENTENCE =
  'Die Versionen stehen in `package.json`, `package-lock.json` bindet sie samt '
  + 'Integritätshashes. Chromium ist an den gepinnten `playwright`-Stand gebunden: '
  + 'Der CI-Schritt lädt ausschließlich die Revision, die das `browsers.json` der '
  + 'von `playwright` aufgelösten `playwright-core`-Installation nennt; einen '
  + 'unversionierten Browser-Download gibt es nicht.';

/*
 * Exakter Pin, positiv definiert: drei numerische Stellen, optional gefolgt
 * von Vorab- oder Build-Anhang. Jede andere Form ist damit ein Verstoß, ohne
 * dass sie aufgezählt werden müsste — der Default ist fail-closed. Das Muster
 * kommt ohne `semver` aus, das keine direkte Abhängigkeit des Repositoriums
 * ist.
 */
const EXACT_PIN_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/;

/*
 * Versionsliteral: ein in Backticks gesetztes Token, das mit einer Ziffer
 * beginnt und ausschließlich aus Ziffern und Punkten besteht. Zahlen ohne
 * Backticks (etwa Portnummern oder Coverage-Schwellen) sind keine Literale
 * und bleiben unberührt.
 */
const VERSION_LITERAL_CONTENT_PATTERN = /^[0-9][0-9.]*$/;

const VITEST_TRIO = ['vitest', '@vitest/coverage-v8', '@vitest/browser-playwright'];
const PLAYWRIGHT_PACKAGE = 'playwright';
const PLAYWRIGHT_CORE_PACKAGE = 'playwright-core';
const CHROMIUM_BROWSER_NAME = 'chromium';

const TRIO_PIN_PROPERTY = 'exakt, für alle drei identisch';
const SINGLE_PIN_PROPERTY = 'exakt';

/*
 * Die Tabelle in der heute dokumentierten Form. Der Parser ist an sie
 * gebunden und ändert sich mit: Eine fehlende, zusätzliche oder inhaltlich
 * abweichende Zeile lässt den Guard fehlschlagen, damit keine geprüfte
 * Zusage stillschweigend entfällt.
 */
const EXPECTED_TABLE_ROWS = [
  {
    packages: ['vitest', '@vitest/coverage-v8', '@vitest/browser-playwright'],
    pinProperty: TRIO_PIN_PROPERTY,
  },
  { packages: [PLAYWRIGHT_PACKAGE], pinProperty: SINGLE_PIN_PROPERTY },
];

export class ToolchainContractError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ToolchainContractError';
  }
}

/**
 * Übersetzt einen Klartextsatz aus der Dokumentation in ein Muster, das
 * Zeilenumbrüche an Wortgrenzen toleriert.
 */
function buildClaimPattern(sentence) {
  const source = sentence
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
    .join(String.raw`\s+`);

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
 * Grenzt den geprüften Abschnitt ab: ab der Überschrift
 * `## Browser-Testlane` bis ausschließlich zur nächsten Zeile, die mit
 * `## ` beginnt. Fehlt die Überschrift, schlägt der Guard fehl, statt einen
 * leeren Abschnitt als sauber zu melden.
 */
export function parseSection(documentation) {
  const lines = documentation.split('\n');
  const startIndex = lines.findIndex((line) => line.trim() === SECTION_HEADING);

  if (startIndex === -1) {
    throw new ToolchainContractError(
      `${DOCUMENTATION_PATH}: Die Abschnittsüberschrift "${SECTION_HEADING}" ist nicht mehr auffindbar.`,
    );
  }

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith(SECTION_END_PREFIX)) {
      endIndex = index;
      break;
    }
  }

  return { startLine: startIndex + 1, endLine: endIndex, lines: lines.slice(startIndex, endIndex) };
}

/**
 * Liest die Pin-Tabelle als Zusagen: erste Zelle die Paketnamen (eine Zeile
 * darf mehrere nennen, die sich eine Pin-Eigenschaft teilen), zweite Zelle
 * die zugesagte Pin-Eigenschaft statt einer Zahl.
 */
export function parseDependencyClaims(documentation) {
  const headerIndex = documentation.indexOf(DEPENDENCY_TABLE_HEADER);
  if (headerIndex === -1) {
    throw new ToolchainContractError(
      `${DOCUMENTATION_PATH}: Die Pin-Tabelle mit der Kopfzeile `
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
    const pinProperty = (cells[1] ?? '').trim();

    /*
     * Jede Zeile der Tabelle ist eine Zusage, keine Prosa — eine, die sich
     * nicht auswerten lässt, ist deshalb ein Fehler und kein Grund zum
     * Weitergehen. Würde hier übersprungen, verlöre genau das Paket seine
     * Prüfung, dessen Zeile umformatiert wurde.
     */
    if (packages.length === 0) {
      throw new ToolchainContractError(
        `${DOCUMENTATION_PATH}:${index + 1}: Die Tabellenzeile nennt kein in Backticks `
        + 'gesetztes Paket und ist damit nicht auswertbar.',
      );
    }

    if (pinProperty === '') {
      throw new ToolchainContractError(
        `${DOCUMENTATION_PATH}:${index + 1}: Die Tabellenzeile nennt `
        + `${packages.join(', ')}, aber keine auswertbare Pin-Eigenschaft.`,
      );
    }

    claims.push({ line: index + 1, packages, pinProperty });
  }

  if (claims.length === 0) {
    throw new ToolchainContractError(
      `${DOCUMENTATION_PATH}:${headerLine}: Die Pin-Tabelle enthält keine auswertbare Zeile.`,
    );
  }

  return claims;
}

/**
 * Fordert die Tabelle in genau der dokumentierten Form: weder eine Zeile
 * weniger (verlorene Prüfung) noch eine mehr oder anders (ungeprüfte Zusage).
 */
export function assertExpectedTable(claims) {
  if (claims.length !== EXPECTED_TABLE_ROWS.length) {
    throw new ToolchainContractError(
      `${DOCUMENTATION_PATH}: Die Pin-Tabelle trägt ${claims.length} statt der erwarteten `
      + `${EXPECTED_TABLE_ROWS.length} Zeilen — geprüfte Zusagen dürfen weder entfallen noch hinzukommen.`,
    );
  }

  for (let index = 0; index < EXPECTED_TABLE_ROWS.length; index += 1) {
    const expected = EXPECTED_TABLE_ROWS[index];
    const claim = claims[index];
    const packagesMatch =
      claim.packages.length === expected.packages.length &&
      expected.packages.every((packageName) => claim.packages.includes(packageName));

    if (!packagesMatch || claim.pinProperty !== expected.pinProperty) {
      throw new ToolchainContractError(
        `${DOCUMENTATION_PATH}:${claim.line}: Die Tabellenzeile weicht von der geprüften Form ab. `
        + `Erwartet wird "| ${expected.packages.map((packageName) => `\`${packageName}\``).join(' + ')} | ${expected.pinProperty} | …".`,
      );
    }
  }
}

/**
 * Fordert den Chromium-Absatz in seiner Satzform: Er belegt die Bindung der
 * Revision an die aufgelöste `playwright-core`-Installation, ohne eine Zahl
 * zu wiederholen.
 */
export function assertChromiumParagraph(documentation) {
  const match = buildClaimPattern(CHROMIUM_PARAGRAPH_SENTENCE).exec(documentation);
  if (match === null) {
    throw new ToolchainContractError(
      `${DOCUMENTATION_PATH}: Der Absatz zur Chromium-Bindung ist nicht mehr auffindbar. `
      + `Erwartet wird die Satzform: "${CHROMIUM_PARAGRAPH_SENTENCE}" (Zeilenumbrüche an Wortgrenzen sind zulässig).`,
    );
  }

  return { line: lineNumberAt(documentation, match.index) };
}

/**
 * Sammelt alle Versionsliterale im geprüften Abschnitt mit ihren Zeilen. Eine
 * leere Liste bedeutet: Der Abschnitt trägt keine aus den Manifesten
 * abgeschriebene Zahl mehr.
 */
export function findVersionLiterals(documentation, section = parseSection(documentation)) {
  const lines = documentation.split('\n');
  const literals = [];

  for (let index = section.startLine - 1; index < section.endLine; index += 1) {
    for (const match of lines[index].matchAll(/`([^`]+)`/g)) {
      if (VERSION_LITERAL_CONTENT_PATTERN.test(match[1])) {
        literals.push({ line: index + 1, value: match[1] });
      }
    }
  }

  return literals;
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

function findChromium(browsersManifest, manifestPath) {
  const entry = browsersManifest?.browsers?.find(
    (browser) => browser?.name === CHROMIUM_BROWSER_NAME,
  );

  if (entry === undefined) {
    throw new ToolchainContractError(
      `${manifestPath}: Kein Eintrag mit name "${CHROMIUM_BROWSER_NAME}" gefunden.`,
    );
  }

  return entry;
}

/**
 * Löst `playwright-core` ausgehend von der `playwright`-Installation auf,
 * statt über einen festen Wurzelpfad: Bei verschachtelter npm-Auflösung
 * trifft `node_modules/playwright-core/browsers.json` nicht zwingend den
 * Core, den `playwright` tatsächlich lädt.
 *
 * Aufgelöst wird das Paketverzeichnis, gelesen wird weiterhin über den
 * Dateipfad — `playwright-core` führt `./browsers.json` nicht in seinem
 * `exports`-Feld, ein direkter Import scheitert mit
 * ERR_PACKAGE_PATH_NOT_EXPORTED.
 */
function resolvePlaywrightCore() {
  let playwrightDirectory;
  try {
    const playwrightPackageUrl = import.meta.resolve('playwright/package.json');
    playwrightDirectory = path.dirname(fileURLToPath(playwrightPackageUrl));
  } catch {
    throw new ToolchainContractError(
      `${PLAYWRIGHT_PACKAGE}: Das Paket ist nicht auflösbar — der Guard setzt installierte Abhängigkeiten voraus (npm ci).`,
    );
  }

  const requireFromModule = createRequire(import.meta.url);
  let corePackagePath;
  try {
    corePackagePath = requireFromModule.resolve(`${PLAYWRIGHT_CORE_PACKAGE}/package.json`, {
      paths: [playwrightDirectory],
    });
  } catch {
    throw new ToolchainContractError(
      `${PLAYWRIGHT_CORE_PACKAGE}: Ausgehend von der ${PLAYWRIGHT_PACKAGE}-Installation `
      + `(${playwrightDirectory}) nicht auflösbar — der Guard setzt installierte Abhängigkeiten voraus (npm ci).`,
    );
  }

  const coreDirectory = path.dirname(corePackagePath);
  const corePackage = readJsonFile(corePackagePath);
  const browsersManifest = readJsonFile(
    path.join(coreDirectory, 'browsers.json'),
    'Der Guard setzt installierte Abhängigkeiten voraus (npm ci).',
  );

  return {
    name: PLAYWRIGHT_CORE_PACKAGE,
    version: corePackage?.version,
    manifestPath: path.join(coreDirectory, 'browsers.json'),
    packagePath: corePackagePath,
    browsersManifest,
  };
}

/**
 * Prüft die vier Vertragspunkte und gibt die Verletzungen zurück. Eine leere
 * Liste bedeutet: Der Vertrag gilt am installierten Stand. Nicht auffindbare
 * Abschnittsüberschrift, Tabellenkopfzeile, Tabellenzeile oder Satzform
 * werfen stattdessen — sie lassen den Guard fehlschlagen, statt ihn
 * stillschweigend leerlaufen zu lassen.
 */
export function collectContractViolations({ documentation, packageManifest, playwrightCore }) {
  const violations = [];

  const section = parseSection(documentation);
  const claims = parseDependencyClaims(documentation);
  assertExpectedTable(claims);
  const chromiumParagraph = assertChromiumParagraph(documentation);

  for (const claim of claims) {
    for (const packageName of claim.packages) {
      const pinned = readPin(packageManifest, packageName);

      if (pinned === null) {
        violations.push({
          line: claim.line,
          subject: packageName,
          expected: 'exakter Pin',
          measured: 'im Manifest nicht vorhanden',
          source: `${PACKAGE_MANIFEST_PATH} → dependencies/devDependencies`,
        });
        continue;
      }

      if (!EXACT_PIN_PATTERN.test(pinned.pin)) {
        violations.push({
          line: claim.line,
          subject: packageName,
          expected: 'exakter Pin',
          measured: pinned.pin,
          source: `${PACKAGE_MANIFEST_PATH} → ${pinned.section}`,
        });
      }
    }
  }

  const trioPins = VITEST_TRIO.map((packageName) => readPin(packageManifest, packageName)?.pin ?? null);
  if (new Set(trioPins).size !== 1) {
    violations.push({
      line: claims[0].line,
      subject: 'Vitest-Trio',
      expected: 'identische Pins für alle drei',
      measured: VITEST_TRIO.map((packageName, index) => `${packageName} ${trioPins[index] ?? 'fehlt'}`).join(', '),
      source: `${PACKAGE_MANIFEST_PATH} → dependencies/devDependencies`,
    });
  }

  const playwrightPin = readPin(packageManifest, PLAYWRIGHT_PACKAGE);
  if (playwrightPin !== null && playwrightCore?.version !== playwrightPin.pin) {
    violations.push({
      line: chromiumParagraph.line,
      subject: PLAYWRIGHT_CORE_PACKAGE,
      expected: playwrightPin.pin,
      measured: playwrightCore?.version ?? 'nicht auflösbar',
      source: `${playwrightCore?.packagePath ?? PLAYWRIGHT_CORE_PACKAGE} → version`,
    });
  }

  const chromium = findChromium(playwrightCore?.browsersManifest, playwrightCore?.manifestPath);
  for (const field of ['revision', 'browserVersion']) {
    if (typeof chromium[field] !== 'string' || chromium[field] === '') {
      violations.push({
        line: chromiumParagraph.line,
        subject: `Chromium-${field}`,
        expected: 'belegter Eintrag',
        measured: 'fehlt',
        source: `${playwrightCore.manifestPath} → browsers[name=${CHROMIUM_BROWSER_NAME}].${field}`,
      });
    }
  }

  for (const literal of findVersionLiterals(documentation, section)) {
    violations.push({
      line: literal.line,
      subject: `Versionsliteral \`${literal.value}\``,
      expected: 'kein Versionsliteral',
      measured: literal.value,
      source: `${DOCUMENTATION_PATH} → Abschnitt "${SECTION_HEADING}"`,
    });
  }

  return violations;
}

export function formatViolations(violations) {
  return violations
    .map(
      (entry) =>
        `${DOCUMENTATION_PATH}:${entry.line} — ${entry.subject}: `
        + `erwartet "${entry.expected}", gemessen "${entry.measured}" `
        + `(Quelle: ${entry.source})`,
    )
    .join('\n');
}

function readTextFile(path, hint) {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    const suffix = hint ? ` ${hint}` : '';
    throw new ToolchainContractError(`${path} ist nicht lesbar.${suffix}`);
  }
}

function readJsonFile(path, hint) {
  const raw = readTextFile(path, hint);

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new ToolchainContractError(
      `${path} ist kein gültiges JSON: ${error instanceof Error ? error.message : error}`,
    );
  }
}

export function readRepositoryState() {
  return {
    documentation: readTextFile(DOCUMENTATION_PATH),
    packageManifest: readJsonFile(PACKAGE_MANIFEST_PATH),
    playwrightCore: resolvePlaywrightCore(),
  };
}

function main() {
  const violations = collectContractViolations(readRepositoryState());

  if (violations.length > 0) {
    throw new ToolchainContractError(
      `Der Toolchain-Vertrag ist verletzt:\n${formatViolations(violations)}`,
    );
  }

  console.log(`Der Toolchain-Vertrag in ${DOCUMENTATION_PATH} deckt sich mit dem installierten Stand.`);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Vertragsprüfung fehlgeschlagen.');
    process.exitCode = 1;
  }
}
