/*
 * Gemeinsamer Prüfbefehl für eine veröffentlichte Datei (GSPP-465).
 *
 * Der Deploy attestiert ausschließlich `SHA256SUMS`, zweimal getrennt:
 * SLSA-Provenance und CycloneDX-SBOM. Eine einzelne Live-Datei ist deshalb
 * in zwei Schritten zu prüfen: Erst belegt `gh attestation verify`, dass das
 * Manifest aus dem Deploy-Workflow dieses Repositoriums für genau den
 * erwarteten `main`-Commit stammt, dann belegt SHA-256, dass die Datei im
 * Manifest steht. Dieser Befehl führt beides zusammen aus.
 *
 * Die Manifestbytes werden genau einmal gelesen und in eine private
 * temporäre Kopie geschrieben. Beide Attestierungsprüfungen und die
 * Auswertung arbeiten auf diesen Bytes; ein nachträglich verändertes Original
 * kann die Prüfung nicht unterlaufen. Exit 0 erst nach allen Prüfungen.
 */

import { execFile } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  CHECKSUMS_FILE,
  assertSafeRelativePath,
  parseChecksumsManifest,
  readRegularFileNoFollow,
  sha256Hex,
} from './deployChecksums.mjs';

export const REPOSITORY = 'dfurater/Grundschutz-Navigator';
export const SIGNER_WORKFLOW = `${REPOSITORY}/.github/workflows/deploy.yml`;
export const SOURCE_REF = 'refs/heads/main';
export const PREDICATE_TYPES = [
  'https://slsa.dev/provenance/v1',
  'https://cyclonedx.org/bom',
];
export const GH_TIMEOUT_MS = 60_000;

const OPTIONS = new Set(['--manifest', '--file', '--path', '--source-sha']);
const USAGE =
  'Aufruf: verify:deployment -- --manifest <SHA256SUMS> --file <datei> --path <pfad-im-manifest> --source-sha <40-stellige-commit-sha>';

export class DeploymentVerificationError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'DeploymentVerificationError';
    this.exitCode = exitCode;
  }
}

export function parseVerifyArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!OPTIONS.has(option)) {
      throw new DeploymentVerificationError(`Unbekannte Option ${JSON.stringify(option)}. ${USAGE}`, 2);
    }
    if (values.has(option)) {
      throw new DeploymentVerificationError(`Option ${option} doppelt angegeben. ${USAGE}`, 2);
    }
    if (value === undefined || value === '' || value.startsWith('--')) {
      throw new DeploymentVerificationError(`Option ${option} ohne Wert. ${USAGE}`, 2);
    }
    values.set(option, value);
  }
  for (const option of OPTIONS) {
    if (!values.has(option)) {
      throw new DeploymentVerificationError(`Option ${option} fehlt. ${USAGE}`, 2);
    }
  }
  const sourceSha = values.get('--source-sha');
  if (!/^[0-9a-f]{40}$/.test(sourceSha)) {
    throw new DeploymentVerificationError('--source-sha muss eine 40-stellige Commit-SHA in Kleinbuchstaben sein.', 2);
  }
  const path = values.get('--path');
  try {
    assertSafeRelativePath(path);
  } catch (error) {
    throw new DeploymentVerificationError(error.message, 2);
  }
  return { manifest: values.get('--manifest'), file: values.get('--file'), path, sourceSha };
}

function readRegularFile(path, label) {
  try {
    return readRegularFileNoFollow(path, label);
  } catch (error) {
    throw new DeploymentVerificationError(error.message);
  }
}

/** Startet `gh` ohne Shell; Fehler, Exit ≠ 0 und Timeout werden zu einem Ergebnis. */
export function runGh(args, { ghBinary = 'gh', timeoutMs = GH_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise) => {
    execFile(ghBinary, args, { shell: false, timeout: timeoutMs, killSignal: 'SIGKILL' }, (error, stdout, stderr) => {
      if (!error) {
        resolvePromise({ ok: true, stdout, stderr });
        return;
      }
      let reason = `Exit ${error.code}`;
      if (error.code === 'ENOENT') reason = `${ghBinary} nicht gefunden`;
      else if (error.killed) reason = `Zeitüberschreitung nach ${timeoutMs} ms`;
      resolvePromise({ ok: false, reason, stdout, stderr });
    });
  });
}

export function attestationArgs(manifestCopy, predicateType, sourceSha) {
  return [
    'attestation', 'verify', manifestCopy,
    '--repo', REPOSITORY,
    '--signer-workflow', SIGNER_WORKFLOW,
    '--source-ref', SOURCE_REF,
    '--source-digest', sourceSha,
    '--predicate-type', predicateType,
  ];
}

/**
 * Führt die komplette Prüfung aus. `run` ist injizierbar, damit Tests den
 * `gh`-Aufruf kontrollieren; der Default startet das echte `gh`.
 */
export async function verifyDeployment(options, { run = runGh, log = console.log } = {}) {
  const manifestBytes = readRegularFile(options.manifest, 'Manifest');
  const workDir = mkdtempSync(join(tmpdir(), 'gspp-verify-deployment-'));
  try {
    chmodSync(workDir, 0o700);
    const manifestCopy = join(workDir, CHECKSUMS_FILE);
    writeFileSync(manifestCopy, manifestBytes, { mode: 0o600 });

    for (const predicateType of PREDICATE_TYPES) {
      const result = await run(attestationArgs(manifestCopy, predicateType, options.sourceSha));
      if (!result.ok) {
        const detail = (result.stderr ?? '').trim();
        const message = [`Attestierung ${predicateType} nicht bestätigt: ${result.reason}`, detail]
          .filter(Boolean)
          .join('\n');
        throw new DeploymentVerificationError(message);
      }
      log(`Attestierung bestätigt: ${predicateType}`);
    }

    const manifestText = readFileSync(manifestCopy, 'utf8');
    let entries;
    try {
      entries = parseChecksumsManifest(manifestText);
    } catch (error) {
      throw new DeploymentVerificationError(`Manifest ungültig: ${error.message}`);
    }

    const fileBytes = readRegularFile(options.file, 'Datei');
    if (options.path === CHECKSUMS_FILE) {
      if (!fileBytes.equals(manifestBytes)) {
        throw new DeploymentVerificationError(`${options.file} stimmt nicht mit dem attestierten Manifest überein.`);
      }
    } else {
      const expected = entries.get(options.path);
      if (expected === undefined) {
        throw new DeploymentVerificationError(`${options.path} steht nicht im attestierten Manifest.`);
      }
      const actual = sha256Hex(fileBytes);
      if (actual !== expected) {
        throw new DeploymentVerificationError(
          `SHA-256 von ${options.file} weicht ab: erwartet ${expected}, gefunden ${actual}.`,
        );
      }
    }
    log(`Verifiziert: ${options.path} gehört zum Deploy von ${options.sourceSha}.`);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  await verifyDeployment(parseVerifyArgs(argv), deps);
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof DeploymentVerificationError ? error.exitCode : 1;
  }
}
