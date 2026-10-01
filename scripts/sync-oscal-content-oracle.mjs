// =============================================================================
// Wartungssync des NIST-Orakelkorpus (GSPP-291, Commit B)
//
// Lädt die vier SP 800-53 rev5 Baseline-Profile und ihre von NIST selbst
// aufgelösten Vergleichskataloge aus usnistgov/oscal-content am statisch
// gepinnten Tag v1.5.0 (Commit 78650f02ad9321bb7b817846f8fbd4f2bcd620de)
// und legt sie mit SHA-256-Manifest unter src/test/fixtures/ ab. Die
// committeten Dateien machen den NIST-Orakelvergleich offline deterministisch;
// dies ist der EINZIGE Netzpfad dieses Nachweises (Wartung, kein Testpfad).
// Bei unverändertem Commit-Pin muss der Dateisatz des bestehenden Manifests vor
// dem ersten Download exakt den Artefakten entsprechen, und neue Bytes müssen
// Hash und Größe ihres Pins treffen. Ein geänderter Pin ist ein bewusster
// Erstabgleich; seine neuen Hashes entstehen erst nach erfolgreicher Prüfung
// aller Downloads.
//
// Aufruf: npm run sync-oscal-content-oracle [-- --force]
// =============================================================================

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBodyWithLimit } from './security-guards.mjs';

const REPOSITORY_COMMIT = '78650f02ad9321bb7b817846f8fbd4f2bcd620de';
const RAW_BASE = `https://raw.githubusercontent.com/usnistgov/oscal-content/${REPOSITORY_COMMIT}`;
const DIRECTORY_PREFIX = 'nist.gov/SP800-53/rev5/json/';
const TARGET_DIRECTORY = 'src/test/fixtures/oscal-content-v1.5.0';
const MAX_ORACLE_ARTIFACT_BYTES = 10 * 1024 * 1024;

const BASELINES = ['LOW', 'MODERATE', 'HIGH', 'PRIVACY'];

const ARTIFACTS = [
  {
    // Alle vier Baselines importieren denselben Quellkatalog.
    artifactKey: 'nist-sp800-53-rev5-catalog',
    role: 'source',
    remotePath: `${DIRECTORY_PREFIX}NIST_SP-800-53_rev5_catalog-min.json`,
    fileName: 'rev5-catalog.json',
  },
  ...BASELINES.flatMap((baseline) => [
    {
      artifactKey: `nist-sp800-53-rev5-${baseline.toLowerCase()}-profile`,
    role: 'input',
    remotePath: `${DIRECTORY_PREFIX}NIST_SP-800-53_rev5_${baseline}-baseline_profile-min.json`,
    fileName: `${baseline.toLowerCase()}-profile.json`,
  },
  {
    artifactKey: `nist-sp800-53-rev5-${baseline.toLowerCase()}-resolved`,
    role: 'expected',
    remotePath: `${DIRECTORY_PREFIX}NIST_SP-800-53_rev5_${baseline}-baseline-resolved-profile_catalog-min.json`,
    fileName: `${baseline.toLowerCase()}-resolved.json`,
  },
  ]),
];

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fetchArtifact(artifact, fetchImpl) {
  const url = `${RAW_BASE}/${artifact.remotePath}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} für ${url}`);
  }
  return readBodyWithLimit(response, {
    maxBytes: MAX_ORACLE_ARTIFACT_BYTES,
    label: `Orakel ${artifact.fileName}`,
  });
}

function isValidOracleFilePin(entry) {
  return typeof entry?.fileName === 'string' && entry.fileName.length > 0 &&
    typeof entry.sha256 === 'string' && /^[0-9a-f]{64}$/.test(entry.sha256) &&
    Number.isSafeInteger(entry.sizeBytes) && entry.sizeBytes >= 0;
}

function isValidOracleManifestPins(manifest) {
  return typeof manifest?.source?.commit === 'string' &&
    /^[0-9a-f]{40}$/.test(manifest.source.commit) &&
    Array.isArray(manifest.files) && manifest.files.every(isValidOracleFilePin) &&
    new Set(manifest.files.map(entry => entry.fileName)).size === manifest.files.length;
}

async function readPreviousManifest(manifestPath, force) {
  let previousManifest;
  try {
    previousManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    // Nur ein fehlendes Manifest ist ein Erstlauf; defekte Pins bleiben Fehler.
    if (error?.code !== 'ENOENT') throw error;
  }
  if (previousManifest !== undefined && !force) {
    throw new Error(
      'ORACLE_MANIFEST.json existiert bereits. Der Sync ist ein Wartungspfad — ' +
        'bei bewusster Auffrischung mit --force ausführen.',
    );
  }
  if (previousManifest !== undefined && !isValidOracleManifestPins(previousManifest)) {
    throw new Error('Orakel-Manifest enthält keinen gültigen Commit-Pin oder Dateisatz');
  }
  return previousManifest;
}

// Bei unverändertem Commit-Pin muss der Dateisatz vor dem ersten Download exakt
// den erwarteten Artefakten entsprechen; Doppelte lehnt die Strukturprüfung ab.
function samePinFilesByName(manifest) {
  const pinsByName = new Map(manifest.files.map(entry => [entry.fileName, entry]));
  const expectedNames = ARTIFACTS.map(artifact => artifact.fileName);
  const missing = expectedNames.filter(fileName => !pinsByName.has(fileName));
  const additional = [...pinsByName.keys()].filter(fileName => !expectedNames.includes(fileName));
  if (missing.length > 0 || additional.length > 0) {
    throw new Error(
      'Orakel-Manifest: Dateisatz weicht vom erwarteten Artefaktsatz ab ' +
        `(fehlend: ${missing.join(', ') || 'keine'}; zusätzlich: ${additional.join(', ') || 'keine'})`,
    );
  }
  return pinsByName;
}

export async function syncOscalContentOracle({
  force = false,
  fetchImpl = fetch,
  targetDirectory = TARGET_DIRECTORY,
} = {}) {
  const manifestPath = join(targetDirectory, 'ORACLE_MANIFEST.json');
  const previousManifest = await readPreviousManifest(manifestPath, force);
  const samePins = previousManifest?.source?.commit === REPOSITORY_COMMIT
    ? samePinFilesByName(previousManifest)
    : undefined;
  const entries = [];
  const downloads = [];
  for (const artifact of ARTIFACTS) {
    process.stdout.write(`Lädt ${artifact.remotePath} ... `);
    const buffer = await fetchArtifact(artifact, fetchImpl);
    const sha256 = sha256Hex(buffer);
    if (samePins) {
      const pin = samePins.get(artifact.fileName);
      if (pin?.sha256 !== sha256 || pin?.sizeBytes !== buffer.length) {
        throw new Error(`Orakel-Manifest: Hash oder Größe stimmen nicht überein: ${artifact.fileName}`);
      }
    }
    downloads.push({ artifact, buffer });
    console.log(`${buffer.length} Byte, sha256 ${sha256.slice(0, 16)}…`);
    entries.push({
      artifactKey: artifact.artifactKey,
      role: artifact.role,
      fileName: artifact.fileName,
      remotePath: artifact.remotePath,
      sizeBytes: buffer.length,
      sha256,
    });
  }

  const manifest = {
    schemaVersion: 1,
    source: {
      repository: 'https://github.com/usnistgov/oscal-content',
      tag: 'v1.5.0',
      commit: REPOSITORY_COMMIT,
      variant: '-min (minifizierte Veröffentlichungsvariante, inhaltsgleich)',
    },
    files: entries,
  };
  // Erst nach allen Downloads und Pinprüfungen schreiben: ein Netz-/Prüffehler
  // darf keinen teilweise erneuerten Fixture-Satz hinterlassen.
  await mkdir(targetDirectory, { recursive: true });
  for (const { artifact, buffer } of downloads) {
    await writeFile(join(targetDirectory, artifact.fileName), buffer);
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest geschrieben: ${manifestPath} (${entries.length} Artefakte)`);
  return manifest;
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  await syncOscalContentOracle({ force: process.argv.includes('--force') });
}
