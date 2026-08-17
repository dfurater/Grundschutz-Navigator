#!/usr/bin/env node

/**
 * Netzfreies Integritäts-Gate der eingecheckten OSCAL-JSON-Schemas (GSPP-343).
 *
 * Stufe 3 des Validierungsvertrags bündelt die 30 gepinnten NIST-Schemas in
 * die Anwendung. Der Bundler transformiert diese Bytes; eine Laufzeitprüfung
 * gegen ein im selben Bundle mitgeliefertes Soll würde sich selbst bestätigen
 * und nichts beweisen. Die Integritätszusage trägt deshalb **dieser** Lauf zur
 * Bauzeit — und nur, wenn er in CI läuft.
 *
 * Er nimmt bewusst kein `fetch` in die Hand: Geprüft wird ausschließlich, was
 * im Repository liegt. Der Netzbezug gehört allein dem Wartungslauf
 * `scripts/sync-oscal-schemas.mjs` (`npm run sync-oscal-schemas`).
 *
 * Geprüft wird je Matrixzelle:
 *   1. Die Datei existiert an ihrem gepinnten Ablageort.
 *   2. SHA-256 und selbstdeklarierte `$id` treffen den Pin.
 *   3. `$schema` ist draft-07 — die Fassung, für die der Validator gebaut ist.
 * Zusätzlich über alle Zellen hinweg:
 *   4. Unter `schemas/oscal/` liegt keine Datei, die zu keinem Pin gehört.
 *      Damit sind die beiden unmöglichen `mapping-collection`-Zellen dateilos
 *      erzwungen und eine untergeschobene Datei fällt auf.
 *
 *   node scripts/verify-oscal-schemas.mjs
 */

import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  SCHEMA_VENDOR_DIRECTORY,
  listSchemaPins,
  verifySchemaArtifact,
} from '../src/domain/oscalVersionMatrix.mjs';
import { resolveSchemaVendorRoot, resolveSchemaVendorTarget } from './oscal-schema-vendor.mjs';
import { REPO_ROOT } from './security-guards.mjs';

/**
 * Die einzige zulässige JSON-Schema-Fassung. Alle 30 gepinnten NIST-Assets
 * deklarieren draft-07; der Validator wird über Ajvs Standardeinstieg genau
 * dafür gebaut. Eine andere Fassung wäre kein Detail, sondern eine stille
 * Verhaltensänderung der Prüfung.
 */
export const EXPECTED_JSON_SCHEMA_DRAFT = 'http://json-schema.org/draft-07/schema#';

export class OscalSchemaVerificationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'OscalSchemaVerificationError';
  }
}

/**
 * Prüft die Draft-Zusage eines gepinnten Schemas.
 *
 * Für die 30 echten Pins liegt diese Prüfung hinter der Hashprüfung und kann
 * dort nicht mehr zuschlagen — ein geänderter `$schema` verändert zwangsläufig
 * auch den Hash. Sie ist trotzdem eine eigene Zusage und keine Ableitung aus
 * dem Hash: Sie hält fest, **was** der Hash absichert, und schlägt zu, sobald
 * ein künftiger Pin mit einer anderen Fassung aufgenommen würde. Deshalb als
 * eigene Funktion, direkt prüfbar.
 */
export function assertPinnedSchemaDraft(document, pin) {
  if (document?.$schema !== EXPECTED_JSON_SCHEMA_DRAFT) {
    throw new OscalSchemaVerificationError(
      `Gepinntes Schema deklariert nicht draft-07: ${pin.rootKey} @ ${pin.oscalVersion} — ` +
      `erwartet ${EXPECTED_JSON_SCHEMA_DRAFT}`,
    );
  }
}

/** Alle Dateien unterhalb eines Verzeichnisses, absolut und rekursiv. */
async function listFilesRecursively(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolute)));
    } else {
      files.push(absolute);
    }
  }
  return files;
}

async function verifySchemaFile(pin, { repoRoot }) {
  const target = resolveSchemaVendorTarget(pin.vendorPath, { repoRoot });

  let buffer;
  try {
    buffer = await readFile(target);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new OscalSchemaVerificationError(
        `Gepinntes Schema fehlt: ${pin.rootKey} @ ${pin.oscalVersion} — erwartet unter ${pin.vendorPath}. ` +
        'Mit `npm run sync-oscal-schemas` beziehen.',
      );
    }
    throw error;
  }

  let document;
  try {
    document = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new OscalSchemaVerificationError(
      `Gepinntes Schema ist kein gültiges JSON: ${pin.rootKey} @ ${pin.oscalVersion} (${pin.vendorPath})`,
    );
  }

  const verification = verifySchemaArtifact({
    rootKey: pin.rootKey,
    version: pin.oscalVersion,
    sha256: createHash('sha256').update(buffer).digest('hex'),
    schemaId: document?.$id,
  });

  if (!verification.ok) {
    throw new OscalSchemaVerificationError(
      `Schema-Verifikation fehlgeschlagen [${verification.code}]: ${pin.rootKey} @ ${pin.oscalVersion}` +
      (verification.expected ? ` — erwartet ${verification.expected}` : ''),
    );
  }

  assertPinnedSchemaDraft(document, pin);

  return { pin, target, sizeBytes: buffer.length };
}

/**
 * Prüft alle gepinnten Schemadateien und schlägt bei der ersten Abweichung
 * fehl. Fail-closed: eine fehlende, veränderte oder überzählige Datei ist
 * jeweils ein Fehler, kein Hinweis.
 */
export async function verifyOscalSchemas({
  repoRoot = REPO_ROOT,
  pins = listSchemaPins(),
  logger = console,
} = {}) {
  const results = [];
  const expectedTargets = new Set();

  for (const pin of pins) {
    const result = await verifySchemaFile(pin, { repoRoot });
    expectedTargets.add(result.target);
    results.push(result);
    logger.log(`  ok  ${pin.rootKey} @ ${pin.oscalVersion}  ${pin.schemaFileName}`);
  }

  const vendorRoot = resolveSchemaVendorRoot({ repoRoot });
  const unexpected = (await listFilesRecursively(vendorRoot))
    .filter((file) => !expectedTargets.has(file))
    .map((file) => path.relative(repoRoot, file))
    .sort();

  if (unexpected.length > 0) {
    throw new OscalSchemaVerificationError(
      `Unter ${SCHEMA_VENDOR_DIRECTORY}/ liegen Dateien ohne Pin in der Versionsmatrix: ${unexpected.join(', ')}`,
    );
  }

  return results;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  console.log('OSCAL-Schema-Verifikation (eingecheckte Bytes, ohne Netzzugriff)');

  verifyOscalSchemas()
    .then((results) => {
      const totalBytes = results.reduce((sum, result) => sum + result.sizeBytes, 0);
      console.log(
        `\n${results.length} eingecheckte Schemas gegen Hash, $id und draft-07 verifiziert ` +
        `(${totalBytes} Bytes).`,
      );
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
