/*
 * Prüfsummen-Manifest der GitHub-Pages-Auslieferung (GSPP-465).
 *
 * `actions/attest` zählt die Dateien eines `subject-path` vor jeder
 * Deduplizierung und bricht oberhalb von 1.024 ab. Seit GSPP-449 liegen in
 * `dist/` über tausend statische Routen-Einstiege, deshalb attestiert der
 * Deploy nicht mehr jede Datei einzeln, sondern genau eine: `dist/SHA256SUMS`.
 * Dieses Manifest bindet über SHA-256 jede veröffentlichte Datei, und die
 * Subject-Zahl bleibt eins, gleich wie viele Routen oder Assets hinzukommen.
 *
 * Die Dateimenge folgt der Packregel des gepinnten
 * `actions/upload-pages-artifact`: Namen mit führendem Punkt fallen samt
 * Unterbaum heraus. Symlinks und andere nicht reguläre Dateitypen brechen ab,
 * statt still mitzulaufen — der Uploader würde sie dereferenzieren und damit
 * Bytes veröffentlichen, die das Manifest nicht sieht.
 *
 * Das Modul läuft ohne Vite und ohne `@/`-Alias: `vite.config.ts` ruft den
 * Schreiber im Build auf, die CLI prüft das fertige `dist/` in CI.
 */

import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CHECKSUMS_FILE = 'SHA256SUMS';

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const MANIFEST_LINE = /^([0-9a-f]{64}) {2}(.+)$/;

export class DeploymentManifestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DeploymentManifestError';
  }
}

/**
 * Relativer POSIX-Pfad aus erlaubten Zeichen, ohne leere, `.`- oder
 * `..`-Segmente. Ein führender Schrägstrich erzeugt ein leeres Segment und
 * fällt damit ebenfalls heraus.
 */
export function assertSafeRelativePath(path) {
  if (typeof path !== 'string' || !SAFE_PATH.test(path)) {
    throw new DeploymentManifestError(`Unzulässiger Pfad: ${JSON.stringify(path)}`);
  }
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.' || segment === '..') {
      throw new DeploymentManifestError(`Unzulässiges Pfadsegment in ${JSON.stringify(path)}`);
    }
  }
  return path;
}

// Standard-Stringsortierung: UTF-16-Codeunits, unabhängig von der Locale.
function byCodeUnit(a, b) {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** Alle veröffentlichten regulären Dateien unter `distDir`, relativ und sortiert. */
export function collectDeployedFiles(distDir) {
  const root = resolve(distDir);
  const files = [];
  const walk = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      assertSafeRelativePath(relativePath);
      if (entry.isSymbolicLink()) {
        throw new DeploymentManifestError(`Symlink in der Auslieferung: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        walk(join(directory, entry.name), relativePath);
      } else if (entry.isFile()) {
        files.push(relativePath);
      } else {
        throw new DeploymentManifestError(`Kein regulärer Dateityp in der Auslieferung: ${relativePath}`);
      }
    }
  };
  walk(root, '');
  return files.sort(byCodeUnit);
}

/**
 * Liest eine reguläre Datei ohne Prüf-/Lese-Lücke: `O_NOFOLLOW` lehnt einen
 * Symlink am Pfad ab, und Typprüfung wie Lesen laufen über denselben
 * Dateideskriptor. `O_NONBLOCK` verhindert, dass eine FIFO das Öffnen
 * blockiert, bevor `fstat` sie ablehnen kann.
 */
export function readRegularFileNoFollow(path, label = 'Datei') {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  } catch (error) {
    if (error.code === 'ELOOP') {
      throw new DeploymentManifestError(`${label} ist keine reguläre Datei (Symlink): ${path}`);
    }
    if (error.code === 'ENOENT') {
      throw new DeploymentManifestError(`${label} fehlt: ${path}`);
    }
    throw new DeploymentManifestError(`${label} nicht lesbar: ${path} (${error.code ?? error.message})`);
  }
  try {
    if (!fstatSync(fd).isFile()) {
      throw new DeploymentManifestError(`${label} ist keine reguläre Datei: ${path}`);
    }
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Kanonisches Manifest: `<64 hex>  <pfad>\n` je Datei, ohne Selbsteintrag. */
export function buildChecksumsManifest(distDir) {
  const root = resolve(distDir);
  const files = collectDeployedFiles(root).filter((path) => path !== CHECKSUMS_FILE);
  if (files.length === 0) {
    throw new DeploymentManifestError(`Keine veröffentlichten Dateien unter ${root}`);
  }
  return files
    .map((path) => `${sha256Hex(readRegularFileNoFollow(join(root, path), path))}  ${path}\n`)
    .join('');
}

/** Schreibt `SHA256SUMS`; muss der letzte Schreibschritt des Builds sein. */
export function writeChecksumsManifestFile(distDir) {
  const manifest = buildChecksumsManifest(distDir);
  writeFileSync(resolve(distDir, CHECKSUMS_FILE), manifest);
  return manifest;
}

/**
 * Strikter Parser des kanonischen Formats. Liefert die Einträge in
 * Manifestreihenfolge als Map von Pfad auf Hash.
 */
export function parseChecksumsManifest(text) {
  if (text === '' || !text.endsWith('\n')) {
    throw new DeploymentManifestError('Manifest ist leer oder endet nicht mit LF.');
  }
  if (text.includes('\r')) {
    throw new DeploymentManifestError('Manifest enthält CR-Zeichen.');
  }
  const entries = new Map();
  let previous;
  for (const line of text.slice(0, -1).split('\n')) {
    const match = MANIFEST_LINE.exec(line);
    if (!match) {
      throw new DeploymentManifestError(`Ungültige Manifestzeile: ${JSON.stringify(line)}`);
    }
    const [, hash, path] = match;
    assertSafeRelativePath(path);
    if (path === CHECKSUMS_FILE) {
      throw new DeploymentManifestError('Manifest enthält einen Selbsteintrag.');
    }
    if (previous !== undefined && byCodeUnit(previous, path) >= 0) {
      throw new DeploymentManifestError(`Manifestpfade nicht eindeutig sortiert bei ${path}`);
    }
    entries.set(path, hash);
    previous = path;
  }
  return entries;
}

function describeDrift(actualText, expectedText) {
  let actual;
  try {
    actual = parseChecksumsManifest(actualText);
  } catch (error) {
    return `vorhandenes Manifest ist nicht kanonisch (${error.message})`;
  }
  const expected = parseChecksumsManifest(expectedText);
  const missing = [...expected.keys()].filter((path) => !actual.has(path));
  const extra = [...actual.keys()].filter((path) => !expected.has(path));
  const changed = [...expected.keys()].filter(
    (path) => actual.has(path) && actual.get(path) !== expected.get(path),
  );
  return [
    missing.length > 0 ? `nicht im Manifest: ${missing.join(', ')}` : '',
    extra.length > 0 ? `nicht mehr ausgeliefert: ${extra.join(', ')}` : '',
    changed.length > 0 ? `Inhalt geändert: ${changed.join(', ')}` : '',
  ].filter(Boolean).join('; ');
}

/**
 * Vergleicht das vorhandene Manifest bytegenau mit der aus dem aktuellen
 * Dateibestand neu berechneten Fassung. Repariert nichts.
 */
export function assertChecksumsManifest(distDir) {
  const root = resolve(distDir);
  const actualText = readRegularFileNoFollow(join(root, CHECKSUMS_FILE), CHECKSUMS_FILE).toString('utf8');
  const expectedText = buildChecksumsManifest(root);
  if (actualText !== expectedText) {
    throw new DeploymentManifestError(
      `${CHECKSUMS_FILE} passt nicht zur Auslieferung: ${describeDrift(actualText, expectedText)}`,
    );
  }
  return { fileCount: parseChecksumsManifest(expectedText).size + 1, subjectCount: 1 };
}

export function parseCheckArgs(argv) {
  if (argv.length !== 2 || argv[0] !== '--dist' || argv[1] === '') {
    throw new DeploymentManifestError('Aufruf: check:deployment-manifest -- --dist <verzeichnis>');
  }
  return { distDir: argv[1] };
}

export function main(argv = process.argv.slice(2)) {
  const { distDir } = parseCheckArgs(argv);
  const { fileCount, subjectCount } = assertChecksumsManifest(distDir);
  console.log(
    `${CHECKSUMS_FILE} bindet die Auslieferung: ${fileCount} Dateien einschließlich Manifest, ${subjectCount} Attestierungs-Subject.`,
  );
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
