// =============================================================================
// Korpus-Cache für den verpflichtenden Bauzeitlauf (GSPP-291, Commit B)
//
// `fetch-catalog.mjs` hat die größen- und blob-verifizierten Rohbytes aller
// registrierten Artefakte bereits im Speicher. Dieser Modul schreibt daraus
// die für die Profile Resolution benötigten Dokumente in einen
// gitignorierten Cache (`CORPUS_CACHE_DIRECTORY`) — außerhalb von
// `public/data/`, denn die `preview`-Profile werden nicht ausgeliefert.
//
// Vertrag des Bauzeitlaufs: kein zweiter Fetch, keine Env-Variablen-Pfade,
// kein Überspringen. Die Korpus-Suite scheitert hart, wenn der Cache fehlt
// oder ein Hash abweicht.
// =============================================================================

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Gitignoriertes Cache-Verzeichnis relativ zum Repo-Root. */
export const CORPUS_CACHE_DIRECTORY = '.cache/upstream-corpus';

export const CORPUS_CACHE_SCHEMA_VERSION = 1;

/**
 * Bestimmt die Artefaktschlüssel des Korpus: alle Profile und Importziele
 * der Lineages plus die drei ausgelieferten resolved_catalogs als
 * Vergleichsorakel-Seite.
 */
export function corpusArtifactKeys(lineages) {
  const keys = new Set();
  for (const lineage of lineages) {
    keys.add(lineage.profileArtifactKey);
    for (const imported of lineage.imports) {
      keys.add(imported.artifactKey);
    }
    // Die BSI-Orakelseite trägt denselben catalogKey wie die Lineage und
    // ist als unterstützter Anwenderkatalog registriert.
    keys.add(`catalog-${lineage.catalogKey}`);
  }
  return [...keys].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Baut die Cache-Dateien: je Artefakt die exakten verifizierten Rohbytes
 * plus ein Begleitmanifest mit SHA-256 je Datei. Es wird nichts neu geholt
 * und nichts gefiltert — die Bytes sind genau die, deren Größe und
 * Git-Blob-SHA soeben gegen den BSI-Tree geprüft wurden.
 */
export function buildCorpusCachePayload({
  inspectedArtifacts,
  lineages,
  snapshotCommitSha,
}) {
  const wantedKeys = new Set(corpusArtifactKeys(lineages));
  const byArtifactKey = new Map(
    inspectedArtifacts.map((artifact) => [artifact.descriptor.artifactKey, artifact]),
  );

  const files = [];
  const missingKeys = [];
  for (const artifactKey of wantedKeys) {
    const artifact = byArtifactKey.get(artifactKey);
    if (!artifact?.rawFile) {
      // Bewusst kein Wurf: Der Schreibweg bleibt auch mit Teilbeständen
      // benutzbar (etwa in Testfixtures); die verpflichtende Vollständig-
      // keit prüft die Korpus-Suite hart gegen das Begleitmanifest.
      missingKeys.push(artifactKey);
      continue;
    }
    files.push({
      fileName: `${artifactKey}.json`,
      contentsBase64: artifact.rawFile.buffer.toString('base64'),
      manifestEntry: {
        artifactKey,
        path: artifact.descriptor.path,
        sha256: createHash('sha256').update(artifact.rawFile.buffer).digest('hex'),
        sizeBytes: artifact.rawFile.buffer.length,
        gitBlobSha: artifact.descriptor.gitBlobSha,
      },
    });
  }

  return {
    artifacts: files.map(({ fileName, contentsBase64 }) => ({ fileName, contentsBase64 })),
    cacheManifest: {
      schemaVersion: CORPUS_CACHE_SCHEMA_VERSION,
      snapshotCommitSha,
      files: files.map(({ manifestEntry }) => manifestEntry),
    },
    missingKeys,
  };
}

/** Schreibt Cache-Dokumente und Begleitmanifest. */
export async function writeCorpusCache(payload, directory = CORPUS_CACHE_DIRECTORY) {
  await mkdir(directory, { recursive: true });
  await Promise.all([
    ...payload.artifacts.map((artifact) =>
      writeFile(join(directory, artifact.fileName), Buffer.from(artifact.contentsBase64, 'base64')),
    ),
    writeFile(
      join(directory, 'corpus-manifest.json'),
      `${JSON.stringify(payload.cacheManifest, null, 2)}\n`,
      'utf8',
    ),
  ]);
}
