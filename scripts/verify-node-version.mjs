#!/usr/bin/env node

/*
 * Hält die Node-Version an genau einer Stelle (GSPP-419).
 *
 * Vor diesem Guard stand `node-version: 22` siebenmal in den Workflows, während
 * `package.json` `engines.node` mit `>=22.22.0` eine zweite, unabhängige Angabe
 * führte. Beide konnten auseinanderlaufen, ohne dass etwas es meldete:
 * Dependabot pflegt die gepinnten Action-SHAs, nicht die handgeschriebenen
 * Blöcke darum herum.
 *
 * Seither ist `.nvmrc` die einzige Quelle, und jedes Setup liest sie über
 * `node-version-file`. Dieser Guard sichert beide Hälften der Zusage:
 *
 *   1. `.nvmrc` und `engines.node` sind miteinander vereinbar.
 *   2. Kein Workflow und keine Action bringt die Version als Literal zurück.
 *
 * Netzfrei und fail-closed: Eine unlesbare `.nvmrc`, eine nicht interpretierbare
 * `engines.node`-Angabe und ein unerwartetes Setup-Format lassen ihn ebenso
 * fehlschlagen wie eine echte Abweichung. Eine Lockerung dieser Zusage muss
 * sichtbar geschehen, nicht dadurch, dass die Prüfung ihren Gegenstand verliert.
 */

import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { listDefinitionFiles, stepRange } from './workflowDefinitions.mjs';

const NVMRC_PATH = '.nvmrc';
const PACKAGE_MANIFEST_PATH = 'package.json';

/*
 * `.nvmrc` trägt eine reine Versionsangabe: Major, optional Minor und Patch.
 * Bereichsangaben, Aliasse wie `lts/*` und `v`-Präfixe sind hier bewusst nicht
 * zugelassen — sie ließen sich gegen `engines.node` nicht mehr eindeutig
 * vergleichen.
 */
const NVMRC_PATTERN = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

/*
 * `engines.node` führt die untere Schranke als `>=X.Y.Z`. Jede andere Form —
 * ein Bereich, eine Caret-Angabe, mehrere Klauseln — bleibt ungeprüft und ist
 * deshalb ein Fehler statt einer stillen Ausnahme.
 */
const ENGINES_PATTERN = /^>=\s*(\d+)\.(\d+)\.(\d+)$/;

const SETUP_NODE_MARKER = 'uses: actions/setup-node@';
const VERSION_FILE_LINE = `node-version-file: ${NVMRC_PATH}`;
const VERSION_LITERAL_PATTERN = /^\s*node-version:\s*\S/;

export class NodeVersionError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NodeVersionError';
  }
}

/**
 * Liest `.nvmrc` und gibt die Versionskomponenten zurück. Ein fehlender Minor
 * oder Patch bleibt `undefined`; `.nvmrc` mit `22` heißt „neuestes 22.x".
 */
export function parseNvmrc(contents) {
  const value = contents.trim();
  const match = NVMRC_PATTERN.exec(value);
  if (!match) {
    throw new NodeVersionError(
      `${NVMRC_PATH} muss eine reine Versionsangabe tragen (z. B. 22 oder 22.22.0), gefunden: ${JSON.stringify(value)}`,
    );
  }

  return {
    value,
    major: Number(match[1]),
    minor: match[2] === undefined ? undefined : Number(match[2]),
    patch: match[3] === undefined ? undefined : Number(match[3]),
  };
}

/**
 * Liest die untere Schranke aus `engines.node`.
 */
export function parseEnginesNode(engines) {
  const value = typeof engines === 'string' ? engines.trim() : '';
  const match = ENGINES_PATTERN.exec(value);
  if (!match) {
    throw new NodeVersionError(
      `${PACKAGE_MANIFEST_PATH} engines.node muss die Form ">=X.Y.Z" haben, gefunden: ${JSON.stringify(value)}`,
    );
  }

  return { value, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Prüft, ob die `.nvmrc`-Angabe die untere Schranke aus `engines.node` erfüllen
 * kann.
 *
 * `.nvmrc` mit bloßem Major benennt keine konkrete Version, sondern die
 * jeweils neueste Veröffentlichung dieser Zeile. Vereinbar ist sie genau dann,
 * wenn der Major dem der Schranke entspricht: Ein kleinerer Major kann die
 * Schranke nie erfüllen, ein größerer verließe die zugesagte Zeile
 * stillschweigend. Trägt `.nvmrc` Minor oder Patch, wird komponentenweise
 * verglichen.
 */
export function assertNvmrcSatisfiesEngines(nvmrc, engines) {
  if (nvmrc.major !== engines.major) {
    throw new NodeVersionError(
      `${NVMRC_PATH} (${nvmrc.value}) und ${PACKAGE_MANIFEST_PATH} engines.node (${engines.value}) nennen verschiedene Major-Versionen.`,
    );
  }

  if (nvmrc.minor === undefined) return;
  if (nvmrc.minor < engines.minor) {
    throw new NodeVersionError(
      `${NVMRC_PATH} (${nvmrc.value}) unterschreitet ${PACKAGE_MANIFEST_PATH} engines.node (${engines.value}).`,
    );
  }
  if (nvmrc.minor > engines.minor) return;

  if (nvmrc.patch !== undefined && nvmrc.patch < engines.patch) {
    throw new NodeVersionError(
      `${NVMRC_PATH} (${nvmrc.value}) unterschreitet ${PACKAGE_MANIFEST_PATH} engines.node (${engines.value}).`,
    );
  }
}

/**
 * Meldet jede Stelle, die die Node-Version erneut als Literal führt, und jeden
 * `actions/setup-node`-Schritt, der `.nvmrc` nicht liest.
 *
 * Der Schritt reicht bis zum nächsten Listeneintrag derselben Ebene. Ein
 * `uses:`-Eintrag ohne `with:`-Block zählt als Schritt ohne
 * `node-version-file` und fällt damit auf.
 */
export function findVersionSourceViolations(files, root = process.cwd()) {
  const violations = [];

  for (const file of files) {
    const label = relative(root, file);
    const lines = readFileSync(file, 'utf8').split('\n');

    lines.forEach((line, index) => {
      if (line.trimStart().startsWith('#')) return;
      if (VERSION_LITERAL_PATTERN.test(line)) {
        violations.push(
          `${label}:${index + 1} führt die Node-Version als Literal: ${line.trim()} — ${NVMRC_PATH} ist die einzige Quelle.`,
        );
      }
    });

    for (let index = 0; index < lines.length; index += 1) {
      if (lines[index].trimStart().startsWith('#')) continue;
      if (!lines[index].includes(SETUP_NODE_MARKER)) continue;

      const [start, end] = stepRange(lines, index);

      if (!lines.slice(start, end).some((line) => line.includes(VERSION_FILE_LINE))) {
        violations.push(
          `${label}:${index + 1} richtet Node ohne "${VERSION_FILE_LINE}" ein.`,
        );
      }
    }
  }

  return violations;
}

export function verifyNodeVersion(root = process.cwd()) {
  const nvmrc = parseNvmrc(readFileSync(resolve(root, NVMRC_PATH), 'utf8'));
  const manifest = JSON.parse(readFileSync(resolve(root, PACKAGE_MANIFEST_PATH), 'utf8'));
  const engines = parseEnginesNode(manifest.engines?.node);

  assertNvmrcSatisfiesEngines(nvmrc, engines);

  const violations = findVersionSourceViolations(listDefinitionFiles(root), root);
  if (violations.length > 0) {
    throw new NodeVersionError(
      ['Die Node-Version steht nicht mehr an genau einer Stelle:', ...violations].join('\n  '),
    );
  }

  return { nvmrc: nvmrc.value, engines: engines.value };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { nvmrc, engines } = verifyNodeVersion();
    console.log(
      `Node-Version einquellig: ${NVMRC_PATH} führt ${nvmrc} und erfüllt ${PACKAGE_MANIFEST_PATH} engines.node ${engines}.`,
    );
  } catch (error) {
    console.error(error instanceof NodeVersionError ? error.message : error);
    process.exitCode = 1;
  }
}
