#!/usr/bin/env node

/**
 * Wartungslauf für die gepinnten OSCAL-JSON-Schemas (GSPP-283).
 *
 * Bezieht die in `src/domain/oscalVersionMatrix.mjs` gepinnten Schema-Assets
 * aus den offiziellen NIST-Releases, prüft jedes gegen seinen SHA-256 und seine
 * selbstdeklarierte `$id` und legt es unter `schemas/oscal/v<VERSION>/` ab.
 *
 * Bewusst **kein** Bestandteil von `npm run build` oder des Fetch-Laufs: die
 * Validierungskette liest ausschließlich lokale Bytes. Dieses Skript ist der
 * einzige Ort, an dem ein Schema über das Netz bezogen werden darf, und es
 * läuft nur auf ausdrückliche Anforderung.
 *
 * Ohne `--write` prüft es nur (Verify-Modus) und schreibt nichts.
 *
 *   node scripts/sync-oscal-schemas.mjs            # nur prüfen
 *   node scripts/sync-oscal-schemas.mjs --write    # prüfen und ablegen
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SCHEMA_VENDOR_DIRECTORY,
  listSchemaPins,
  verifySchemaArtifact,
} from '../src/domain/oscalVersionMatrix.mjs';
import { REPO_ROOT } from './security-guards.mjs';

const NIST_RELEASE_HOST = 'github.com';
const NIST_RELEASE_PATH_PREFIX = '/usnistgov/OSCAL/releases/download/';
const MAX_SCHEMA_BYTES = 1024 * 1024;

/**
 * Härtet die Bezugs-URL gegen eine manipulierte Matrix: nur HTTPS, nur der
 * offizielle NIST-Release-Pfad. Kein Redirect auf einen fremden Host.
 */
export function assertOfficialSchemaUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Schema-URL ist keine gültige URL: ${rawUrl}`);
  }

  if (
    url.protocol !== 'https:' ||
    url.host !== NIST_RELEASE_HOST ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(NIST_RELEASE_PATH_PREFIX)
  ) {
    throw new Error(`Schema-URL liegt außerhalb der offiziellen NIST-Releases: ${rawUrl}`);
  }

  return url.toString();
}

/** Hält die Ablage innerhalb des reservierten Schema-Verzeichnisses. */
export function resolveSchemaVendorTarget(vendorPath, { repoRoot = REPO_ROOT } = {}) {
  const vendorRoot = path.resolve(repoRoot, SCHEMA_VENDOR_DIRECTORY);
  const target = path.resolve(repoRoot, vendorPath);
  const relative = path.relative(vendorRoot, target);

  if (relative.startsWith('..') || path.isAbsolute(relative) || relative === '') {
    throw new Error(`Schema-Ablageort liegt außerhalb von ${SCHEMA_VENDOR_DIRECTORY}: ${vendorPath}`);
  }

  return target;
}

export async function syncOscalSchemas({
  write = false,
  logger = console,
  fetchImpl = fetch,
  repoRoot = REPO_ROOT,
  pins = listSchemaPins(),
} = {}) {
  const results = [];

  for (const pin of pins) {
    const url = assertOfficialSchemaUrl(pin.releaseUrl);
    const response = await fetchImpl(url, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(
        `Schema-Download fehlgeschlagen: ${pin.rootKey} @ ${pin.oscalVersion} — HTTP ${response.status}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_SCHEMA_BYTES) {
      throw new Error(
        `Schema überschreitet das Limit von ${MAX_SCHEMA_BYTES} Bytes: ${pin.rootKey} @ ${pin.oscalVersion}`,
      );
    }

    let schemaId;
    try {
      schemaId = JSON.parse(buffer.toString('utf8'))?.$id;
    } catch {
      throw new Error(`Schema ist kein gültiges JSON: ${pin.rootKey} @ ${pin.oscalVersion}`);
    }

    const verification = verifySchemaArtifact({
      rootKey: pin.rootKey,
      version: pin.oscalVersion,
      sha256: createHash('sha256').update(buffer).digest('hex'),
      schemaId,
    });

    if (!verification.ok) {
      throw new Error(
        `Schema-Verifikation fehlgeschlagen [${verification.code}]: ${pin.rootKey} @ ${pin.oscalVersion}` +
        (verification.expected ? ` — erwartet ${verification.expected}` : ''),
      );
    }

    if (write) {
      const target = resolveSchemaVendorTarget(pin.vendorPath, { repoRoot });
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, buffer);
    }

    logger.log(`  ok  ${pin.rootKey} @ ${pin.oscalVersion}  ${pin.schemaFileName}`);
    results.push({ pin, sizeBytes: buffer.length, written: write });
  }

  return results;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const write = process.argv.includes('--write');
  console.log(`OSCAL-Schema-Sync (${write ? 'prüfen und ablegen' : 'nur prüfen'})`);

  syncOscalSchemas({ write })
    .then((results) => {
      console.log(`\n${results.length} Schemas gegen Hash und $id verifiziert.`);
      if (write) {
        console.log(`Abgelegt unter ${SCHEMA_VENDOR_DIRECTORY}/.`);
      }
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
