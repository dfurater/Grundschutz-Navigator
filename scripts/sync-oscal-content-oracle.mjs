// =============================================================================
// Wartungssync des NIST-Orakelkorpus (GSPP-291, Commit B)
//
// Lädt die vier SP 800-53 rev5 Baseline-Profile und ihre von NIST selbst
// aufgelösten Vergleichskataloge aus usnistgov/oscal-content am statisch
// gepinnten Tag v1.5.0 (Commit 78650f02ad9321bb7b817846f8fbd4f2bcd620de)
// und legt sie mit SHA-256-Manifest unter src/test/fixtures/ ab. Die
// committeten Dateien machen den NIST-Orakelvergleich offline deterministisch;
// dies ist der EINZIGE Netzpfad dieses Nachweises (Wartung, kein Testpfad).
//
// Aufruf: npm run sync-oscal-content-oracle [-- --force]
// =============================================================================

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REPOSITORY_COMMIT = '78650f02ad9321bb7b817846f8fbd4f2bcd620de';
const RAW_BASE = `https://raw.githubusercontent.com/usnistgov/oscal-content/${REPOSITORY_COMMIT}`;
const DIRECTORY_PREFIX = 'nist.gov/SP800-53/rev5/json/';
const TARGET_DIRECTORY = 'src/test/fixtures/oscal-content-v1.5.0';

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

async function fetchArtifact(artifact) {
  const url = `${RAW_BASE}/${artifact.remotePath}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} für ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const force = process.argv.includes('--force');
  const manifestPath = join(TARGET_DIRECTORY, 'ORACLE_MANIFEST.json');

  let previousManifest = null;
  try {
    previousManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    // Erstlauf ohne bestehendes Manifest.
  }
  if (previousManifest !== null && !force) {
    throw new Error(
      'ORACLE_MANIFEST.json existiert bereits. Der Sync ist ein Wartungspfad — ' +
        'bei bewusster Auffrischung mit --force ausführen.',
    );
  }

  await mkdir(TARGET_DIRECTORY, { recursive: true });

  const entries = [];
  for (const artifact of ARTIFACTS) {
    process.stdout.write(`Lädt ${artifact.remotePath} ... `);
    const buffer = await fetchArtifact(artifact);
    await writeFile(join(TARGET_DIRECTORY, artifact.fileName), buffer);
    console.log(`${buffer.length} Byte, sha256 ${sha256Hex(buffer).slice(0, 16)}…`);
    entries.push({
      artifactKey: artifact.artifactKey,
      role: artifact.role,
      fileName: artifact.fileName,
      remotePath: artifact.remotePath,
      sizeBytes: buffer.length,
      sha256: sha256Hex(buffer),
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
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Manifest geschrieben: ${manifestPath} (${entries.length} Artefakte)`);
}

await main();
