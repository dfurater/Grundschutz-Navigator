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
const MAX_REDIRECT_HOPS = 5;

/**
 * GitHub liefert Release-Assets nicht selbst aus, sondern leitet auf einen
 * eigenen Asset-Host mit signierter Query weiter. Diese Hosts gehören deshalb
 * zur Lieferkette und müssen erlaubt sein — aber ausschließlich als
 * Redirect-Ziel, nie als Startpunkt.
 *
 * `release-assets.githubusercontent.com` ist der am 2026-08-01 beobachtete
 * Zielhost; `objects.githubusercontent.com` ist der zuvor von GitHub genutzte.
 * Ein dritter Host lässt den Wartungslauf bewusst fail-closed scheitern und
 * benennt den unerwarteten Host, statt still zu folgen.
 */
const GITHUB_RELEASE_ASSET_HOSTS = Object.freeze([
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);

function parseUrl(rawUrl, label) {
  try {
    return new URL(rawUrl);
  } catch {
    throw new Error(`${label} ist keine gültige URL: ${rawUrl}`);
  }
}

/**
 * Härtet die Bezugs-URL gegen eine manipulierte Matrix: nur HTTPS, nur der
 * offizielle NIST-Release-Pfad, keine Query und keine Credentials.
 */
export function assertOfficialSchemaUrl(rawUrl) {
  const url = parseUrl(rawUrl, 'Schema-URL');

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

/**
 * Prüft ein Redirect-Ziel. Erlaubt ist entweder erneut die strenge
 * NIST-Release-Form oder ein GitHub-Asset-Host; letzterer darf die signierte
 * Query tragen, aber keine Credentials.
 */
export function assertAllowedRedirectTarget(rawUrl) {
  const url = parseUrl(rawUrl, 'Redirect-Ziel');

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`Redirect-Ziel ist nicht vertrauenswürdig: ${url.origin}${url.pathname}`);
  }

  if (url.host === NIST_RELEASE_HOST) {
    return assertOfficialSchemaUrl(url.toString());
  }

  if (!GITHUB_RELEASE_ASSET_HOSTS.includes(url.host)) {
    throw new Error(
      `Schema-Download folgt einem Redirect auf einen nicht freigegebenen Host: ${url.host}`,
    );
  }

  return url.toString();
}

/**
 * Folgt Redirects selbst und validiert **jeden** Hop. `redirect: 'follow'`
 * würde die Host-Grenze zwar nicht für den Startpunkt, wohl aber für alle
 * weiteren Sprünge aushebeln: ein Redirect von der freigegebenen
 * Release-URL auf einen fremden Host bliebe unbemerkt, solange die Bytes
 * ihre Pins treffen. Die Hashprüfung schützt den Inhalt, nicht die
 * Netzgrenze.
 */
export async function fetchSchemaWithValidatedRedirects(startUrl, fetchImpl) {
  let currentUrl = assertOfficialSchemaUrl(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await fetchImpl(currentUrl, { redirect: 'manual' });

    if (response.status < 300 || response.status > 399) {
      return { response, finalUrl: currentUrl };
    }

    const location = response.headers?.get?.('location');
    if (!location) {
      throw new Error(`Schema-Download meldet Redirect ${response.status} ohne Ziel`);
    }

    currentUrl = assertAllowedRedirectTarget(new URL(location, currentUrl).toString());
  }

  throw new Error(`Schema-Download überschreitet ${MAX_REDIRECT_HOPS} Redirects`);
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

/**
 * Liest den Antwortkörper strombasiert und bricht ab, **sobald** das Limit
 * überschritten ist.
 *
 * `response.arrayBuffer()` würde die vollständige Antwort erst puffern und
 * das Limit danach prüfen — eine übergroße Antwort wäre dann bereits
 * vollständig im Speicher. Die Grenze wäre damit nur eine Nachkontrolle,
 * kein Schutz.
 */
export async function readBodyWithLimit(response, {
  maxBytes = MAX_SCHEMA_BYTES,
  label = 'Schema',
} = {}) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // Kein Stream verfügbar: weiterhin begrenzen, aber ohne Frühabbruch.
    const buffered = Buffer.from(await response.arrayBuffer());
    if (buffered.length > maxBytes) {
      throw new Error(`${label} überschreitet das Limit von ${maxBytes} Bytes.`);
    }
    return buffered;
  }

  const reader = body.getReader();
  const chunks = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    receivedBytes += value.byteLength;
    if (receivedBytes > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error(`${label} überschreitet das Limit von ${maxBytes} Bytes.`);
    }
    chunks.push(Buffer.from(value));
  }

  return Buffer.concat(chunks);
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
    const { response } = await fetchSchemaWithValidatedRedirects(pin.releaseUrl, fetchImpl);
    if (!response.ok) {
      throw new Error(
        `Schema-Download fehlgeschlagen: ${pin.rootKey} @ ${pin.oscalVersion} — HTTP ${response.status}`,
      );
    }

    const buffer = await readBodyWithLimit(response, {
      maxBytes: MAX_SCHEMA_BYTES,
      label: `Schema ${pin.rootKey} @ ${pin.oscalVersion}`,
    });

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
