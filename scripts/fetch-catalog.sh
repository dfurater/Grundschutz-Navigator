#!/bin/bash
# =============================================================================
# fetch-catalog.sh — Einstiegspunkt fuer den Build-Fetch
#
# Delegiert Download-/Parsing-Logik an das testbare Node-Skript und schreibt die
# fest benannten Artefakte anschliessend nach public/data.
# =============================================================================
set -euo pipefail

ARTIFACT_PAYLOAD_FILE="$(mktemp "${RUNNER_TEMP:-/tmp}/fetch-catalog-artifacts.XXXXXX.json")"
trap 'rm -f "$ARTIFACT_PAYLOAD_FILE"' EXIT

node scripts/fetch-catalog.mjs >"$ARTIFACT_PAYLOAD_FILE"

node --input-type=module - "$ARTIFACT_PAYLOAD_FILE" <<'EOF'
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const payloadPath = process.argv[2];
const outputDir = path.join(process.cwd(), 'public', 'data');
const allowedFileNames = new Set([
  'catalog.json',
  'catalog-metadata.json',
  'vocabularies.json',
  'upstream-sources-metadata.json',
]);

const payload = JSON.parse(await readFile(payloadPath, 'utf8'));
if (!Array.isArray(payload.artifacts) || !payload.summary) {
  throw new Error('fetch-catalog payload is missing required sections');
}

await mkdir(outputDir, { recursive: true });

const seenFiles = new Set();
for (const artifact of payload.artifacts) {
  if (
    !artifact ||
    typeof artifact.fileName !== 'string' ||
    typeof artifact.contentsBase64 !== 'string'
  ) {
    throw new Error('fetch-catalog payload contains an invalid artifact record');
  }

  if (!allowedFileNames.has(artifact.fileName)) {
    throw new Error(`fetch-catalog payload contains an unexpected file: ${artifact.fileName}`);
  }

  if (seenFiles.has(artifact.fileName)) {
    throw new Error(`fetch-catalog payload contains a duplicate file: ${artifact.fileName}`);
  }
  seenFiles.add(artifact.fileName);

  const filePath = path.join(outputDir, artifact.fileName);
  await writeFile(filePath, Buffer.from(artifact.contentsBase64, 'base64'));
}

for (const fileName of allowedFileNames) {
  if (!seenFiles.has(fileName)) {
    throw new Error(`fetch-catalog payload omitted expected file: ${fileName}`);
  }
}

console.error('[5/5] Fertig.');
console.error(`  Katalog:             ${payload.summary.catalogFilePath}`);
console.error(`  Katalog-Metadaten:   ${payload.summary.catalogMetadataFilePath}`);
console.error(`  Vokabulare:          ${payload.summary.vocabulariesFilePath}`);
console.error(`  Upstream-Metadaten:  ${payload.summary.upstreamSourcesMetadataFilePath}`);
console.error(`  Snapshot:            ${payload.summary.snapshotCommitSha}`);
console.error(`  Manifest-Signatur:   ${payload.summary.manifestSignature}`);
console.error('================================================');
EOF
