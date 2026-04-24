#!/usr/bin/env node

import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildUpstreamManifest,
  buildVocabularyNamespaceData,
  extractReferencedNamespaceUrls,
  namespaceUrlToRepoPath,
  sha256Hex,
} from './vocabulary-utils.mjs';
import {
  DEFAULT_ARTIFACTS_DIR,
  OFFICIAL_BSI_REPO,
  OFFICIAL_CATALOG_PATH,
  assertAllowedGitHubRef,
  assertAllowedUpstreamRepoPath,
  resolveOptionalSnapshotSha,
} from './security-guards.mjs';

const REPO = OFFICIAL_BSI_REPO;
const CATALOG_PATH = OFFICIAL_CATALOG_PATH;
const OUTPUT_DIR = DEFAULT_ARTIFACTS_DIR;
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';

const PINNED_SHA = resolveOptionalSnapshotSha();

const CATALOG_FILE_NAME = 'catalog.json';
const CATALOG_METADATA_FILE_NAME = 'catalog-metadata.json';
const VOCABULARIES_FILE_NAME = 'vocabularies.json';
const UPSTREAM_SOURCES_METADATA_FILE_NAME = 'upstream-sources-metadata.json';
const CATALOG_FILE = join(OUTPUT_DIR, CATALOG_FILE_NAME);
const CATALOG_METADATA_FILE = join(OUTPUT_DIR, CATALOG_METADATA_FILE_NAME);
const VOCABULARIES_FILE = join(OUTPUT_DIR, VOCABULARIES_FILE_NAME);
const UPSTREAM_SOURCES_METADATA_FILE = join(OUTPUT_DIR, UPSTREAM_SOURCES_METADATA_FILE_NAME);
const MAX_CATALOG_ARTIFACT_BYTES = 10 * 1024 * 1024;

function githubHeaders() {
  return {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Grundschutz-Navigator/fetch-catalog',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
  };
}

function encodeRepoPath(path) {
  return path.split('/').map(encodeURIComponent).join('/');
}

async function fetchGitHubJson(pathname) {
  const response = await fetch(`https://api.github.com${pathname}`, {
    headers: githubHeaders(),
  });

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`GitHub API ${pathname} fehlgeschlagen: ${response.status} ${response.statusText} ${details}`.trim());
  }

  return response.json();
}

async function resolveSnapshot(logger = console) {
  if (PINNED_SHA) {
    try {
      const commitInfo = await fetchGitHubJson(`/repos/${REPO}/commits/${PINNED_SHA}`);
      return {
        defaultBranch: 'pinned',
        snapshotCommitSha: PINNED_SHA,
        snapshotCommitDate: commitInfo?.commit?.committer?.date ?? 'unknown',
      };
    } catch (error) {
      logger.warn(
        `Warnung: Konnte Commit-Metadaten für gepinnten SHA ${PINNED_SHA} nicht laden. ${error instanceof Error ? error.message : String(error)}`,
      );
      return {
        defaultBranch: 'pinned',
        snapshotCommitSha: PINNED_SHA,
        snapshotCommitDate: 'unknown',
      };
    }
  }

  try {
    const repoInfo = await fetchGitHubJson(`/repos/${REPO}`);
    const defaultBranch = assertAllowedGitHubRef(repoInfo.default_branch ?? 'main', 'GitHub default branch');
    const branchInfo = await fetchGitHubJson(`/repos/${REPO}/branches/${encodeURIComponent(defaultBranch)}`);
    if (typeof branchInfo.commit?.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(branchInfo.commit.sha)) {
      throw new Error(`GitHub branch ${defaultBranch} enthält keine gültige Commit-SHA.`);
    }

    const snapshotCommitSha = branchInfo.commit.sha.toLowerCase();
    let snapshotCommitDate = 'unknown';
    try {
      const commitInfo = await fetchGitHubJson(`/repos/${REPO}/commits/${snapshotCommitSha}`);
      snapshotCommitDate = commitInfo?.commit?.committer?.date ?? 'unknown';
    } catch (error) {
      logger.warn(
        `Warnung: Konnte Commit-Metadaten für aufgelösten Snapshot ${snapshotCommitSha} nicht laden. ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return {
      defaultBranch,
      snapshotCommitSha,
      snapshotCommitDate,
    };
  } catch (error) {
    throw new Error(
      `Konnte Upstream-Snapshot nicht exakt über die GitHub API auflösen. Build abgebrochen, damit nicht ungepinnt von main geladen wird. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function fetchFileInfo(path, ref, logger = console) {
  const allowedPath = assertAllowedUpstreamRepoPath(path);
  const allowedRef = assertAllowedGitHubRef(ref, 'GitHub fetch ref');

  try {
    const fileInfo = await fetchGitHubJson(
      `/repos/${REPO}/contents/${encodeRepoPath(allowedPath)}?ref=${encodeURIComponent(allowedRef)}`,
    );

    if (typeof fileInfo?.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(fileInfo.sha)) {
      throw new Error(`GitHub contents response für ${path} enthält keine gültige Blob-SHA.`);
    }

    return {
      gitBlobSha: fileInfo.sha.toLowerCase(),
      sizeBytes: fileInfo.size ?? null,
    };
  } catch (error) {
    logger.warn(
      `Warnung: Konnte Provenance für ${path} nicht exakt auflösen. ${error instanceof Error ? error.message : String(error)}`,
    );

    throw new Error(
      `Konnte Provenance für ${path} nicht exakt auflösen. Build abgebrochen, damit keine unvollständige Blob-SHA in die Artefakte geschrieben wird. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function fetchRawFile(path, ref) {
  const allowedPath = assertAllowedUpstreamRepoPath(path);
  const allowedRef = assertAllowedGitHubRef(ref, 'GitHub fetch ref');
  const url = `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(allowedRef)}/${encodeRepoPath(allowedPath)}`;
  const response = await fetch(url, TOKEN
    ? {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    : undefined);

  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen für ${path}: ${response.status} ${response.statusText}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  return {
    buffer,
    text: buffer.toString('utf8'),
  };
}

function buildBuildMetadata() {
  const workflowRunId = process.env.GITHUB_RUN_ID ?? 'local';
  const workflowRunUrl =
    process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  return {
    workflowRunId,
    workflowRunUrl,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT ?? 'local',
  };
}

function assertJsonObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} muss ein JSON-Objekt sein.`);
  }

  return value;
}

function serializeJsonArtifact(value, label) {
  const serializedBody = JSON.stringify(value, null, 2);
  if (typeof serializedBody !== 'string') {
    throw new Error(`${label} konnte nicht als JSON serialisiert werden.`);
  }

  const serialized = `${serializedBody}\n`;
  return serialized;
}

function validateFetchedCatalogArtifact(catalogBuffer) {
  if (catalogBuffer.length > MAX_CATALOG_ARTIFACT_BYTES) {
    throw new Error(
      `Katalog überschreitet das erlaubte Artefaktlimit von ${MAX_CATALOG_ARTIFACT_BYTES} Bytes.`,
    );
  }

  let parsedCatalog;
  try {
    parsedCatalog = JSON.parse(catalogBuffer.toString('utf8'));
  } catch {
    throw new Error('Katalog enthält kein gültiges JSON.');
  }

  const catalogDocument = assertJsonObject(parsedCatalog, 'Katalog');
  assertJsonObject(catalogDocument.catalog, 'Katalogwurzel');

  return {
    json: catalogDocument,
    buffer: catalogBuffer,
  };
}

function buildJsonArtifactBuffer(value, label) {
  return Buffer.from(serializeJsonArtifact(value, label), 'utf8');
}

async function buildFetchArtifacts(logger = console) {
  logger.log('================================================');
  logger.log('  Grundschutz++ Katalog + Vokabulare Fetch');
  logger.log('================================================');
  logger.log(`Repository: ${REPO}`);
  logger.log(`Katalog:    ${CATALOG_PATH}`);

  const snapshot = await resolveSnapshot(logger);
  const fetchRef = assertAllowedGitHubRef(snapshot.snapshotCommitSha, 'Snapshot commit SHA');

  logger.log(`[1/5] Lade Katalog aus Snapshot ${fetchRef} ...`);
  const catalogInfo = await fetchFileInfo(CATALOG_PATH, fetchRef, logger);
  const catalogRaw = await fetchRawFile(CATALOG_PATH, fetchRef);
  const catalogArtifact = validateFetchedCatalogArtifact(catalogRaw.buffer);
  const catalogJson = catalogArtifact.json;

  logger.log('[2/5] Ermittle referenzierte offizielle Namespace-Dateien ...');
  const namespaceUrls = extractReferencedNamespaceUrls(catalogJson, REPO);
  const namespaceRefs = namespaceUrls.map((namespaceUrl) => {
    const path = namespaceUrlToRepoPath(namespaceUrl, REPO);
    if (!path) {
      throw new Error(`Namespace-URL konnte nicht auf einen Repository-Pfad abgebildet werden: ${namespaceUrl}`);
    }
    return { namespaceUrl, path };
  });

  logger.log(`  ${namespaceRefs.length} referenzierte Namespace-Dateien gefunden.`);

  logger.log('[3/5] Lade und parse Namespace-Dateien ...');
  const namespaceArtifacts = await Promise.all(namespaceRefs.map(async (namespaceRef) => {
    logger.log(`  - ${namespaceRef.path}`);
    const [fileInfo, rawFile] = await Promise.all([
      fetchFileInfo(namespaceRef.path, fetchRef, logger),
      fetchRawFile(namespaceRef.path, fetchRef),
    ]);

    const vocabularyNamespace = buildVocabularyNamespaceData({
      namespaceUrl: namespaceRef.namespaceUrl,
      repository: REPO,
      path: namespaceRef.path,
      gitBlobSha: fileInfo.gitBlobSha,
      csvText: rawFile.text,
    });

    return {
      vocabularyNamespace,
      vocabularyFile: {
        namespace: vocabularyNamespace.source.namespace,
        path: vocabularyNamespace.source.path,
        fileName: vocabularyNamespace.source.fileName,
        routeId: vocabularyNamespace.source.routeId,
        gitBlobSha: vocabularyNamespace.source.gitBlobSha,
        sha256: sha256Hex(rawFile.buffer),
        sizeBytes: rawFile.buffer.length,
      },
    };
  }));
  const vocabularyNamespaces = namespaceArtifacts.map((artifact) => artifact.vocabularyNamespace);
  const vocabularyFiles = namespaceArtifacts.map((artifact) => artifact.vocabularyFile);

  const registryData = {
    sourceCommitSha: snapshot.snapshotCommitSha,
    namespaces: vocabularyNamespaces,
  };

  const manifest = buildUpstreamManifest({
    repository: REPO,
    snapshotCommitSha: snapshot.snapshotCommitSha,
    catalogPath: CATALOG_PATH,
    catalogGitBlobSha: catalogInfo.gitBlobSha,
    namespaces: vocabularyNamespaces,
  });

  const fetchedAt = new Date().toISOString();
  const buildMetadata = buildBuildMetadata();

  logger.log('[4/5] Bereite generierte Artefakte vor ...');
  const vocabulariesArtifact = buildJsonArtifactBuffer(
    registryData,
    'Vokabular-Registry',
  );
  const upstreamSourcesMetadataArtifact = buildJsonArtifactBuffer({
    source: {
      repository: `https://github.com/${REPO}`,
      catalogPath: CATALOG_PATH,
      snapshotCommitSha: snapshot.snapshotCommitSha,
      snapshotCommitDate: snapshot.snapshotCommitDate,
    },
    manifest,
    files: vocabularyFiles,
    integrity: {
      fetchedAt,
    },
    build: buildMetadata,
  }, 'Upstream-Metadaten');

  const catalogMetadataArtifact = buildJsonArtifactBuffer({
    source: {
      repository: `https://github.com/${REPO}`,
      file: CATALOG_PATH,
      commit_sha: snapshot.snapshotCommitSha,
      commit_date: snapshot.snapshotCommitDate,
      git_blob_sha: catalogInfo.gitBlobSha,
      upstream_sha256: sha256Hex(catalogRaw.buffer),
      upstream_size_bytes: catalogRaw.buffer.length,
    },
    integrity: {
      sha256: sha256Hex(catalogArtifact.buffer),
      size_bytes: catalogArtifact.buffer.length,
      fetched_at: fetchedAt,
    },
    build: {
      workflow_run_id: buildMetadata.workflowRunId,
      workflow_run_url: buildMetadata.workflowRunUrl,
      runner_environment: buildMetadata.runnerEnvironment,
    },
  }, 'Katalog-Metadaten');

  return {
    artifacts: [
      {
        fileName: CATALOG_FILE_NAME,
        contentsBase64: catalogArtifact.buffer.toString('base64'),
      },
      {
        fileName: CATALOG_METADATA_FILE_NAME,
        contentsBase64: catalogMetadataArtifact.toString('base64'),
      },
      {
        fileName: VOCABULARIES_FILE_NAME,
        contentsBase64: vocabulariesArtifact.toString('base64'),
      },
      {
        fileName: UPSTREAM_SOURCES_METADATA_FILE_NAME,
        contentsBase64: upstreamSourcesMetadataArtifact.toString('base64'),
      },
    ],
    summary: {
      catalogFilePath: CATALOG_FILE,
      catalogMetadataFilePath: CATALOG_METADATA_FILE,
      vocabulariesFilePath: VOCABULARIES_FILE,
      upstreamSourcesMetadataFilePath: UPSTREAM_SOURCES_METADATA_FILE,
      snapshotCommitSha: snapshot.snapshotCommitSha,
      manifestSignature: manifest.signatureSha256,
    },
  };
}

export {
  buildFetchArtifacts,
  validateFetchedCatalogArtifact,
  resolveOptionalSnapshotSha,
  serializeJsonArtifact,
};

const isDirectExecution =
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  const stderrLogger = {
    log: (...args) => console.error(...args),
    warn: (...args) => console.error(...args),
  };

  buildFetchArtifacts(stderrLogger)
    .then((payload) => {
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
