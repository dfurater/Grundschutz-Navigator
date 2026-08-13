#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  buildVocabularyNamespaceData,
  extractReferencedNamespaceUrls,
  materializeVocabularyCollectionMembers,
  sha256Hex,
} from './vocabulary-utils.mjs';
import {
  DEFAULT_ARTIFACTS_DIR,
  OFFICIAL_BSI_REPO,
  OFFICIAL_BSI_REPOSITORY_URL,
  OFFICIAL_CATALOG_PATH,
  assertAllowedGitHubRef,
  assertRegisteredUpstreamRepoPath,
  readBodyWithLimit,
  resolveOptionalSnapshotSha,
} from './security-guards.mjs';
import {
  MONITORED_UPSTREAM_ROOTS,
  SOURCE_REGISTRY,
  SUPPORTED_CATALOG,
} from '../src/domain/sourceRegistry.mjs';
import { resolveSchemaBinding } from '../src/domain/oscalVersionMatrix.mjs';
import {
  buildUpstreamManifest,
  normalizeGitTree,
} from './upstream-artifacts.mjs';
import {
  analyzePracticeVocabularyIntegrity,
  analyzeTopicVocabularyCoverage,
  assertPracticeVocabularyIntegrity,
  assertTopicVocabularyCoverage,
} from './taxonomy-coverage.mjs';

const REPO = OFFICIAL_BSI_REPO;
const CATALOG_PATH = OFFICIAL_CATALOG_PATH;
const OUTPUT_DIR = DEFAULT_ARTIFACTS_DIR;
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';

const PINNED_SHA = resolveOptionalSnapshotSha();

const CATALOG_FILE_NAME = 'catalog.json';
const CATALOG_METADATA_FILE_NAME = 'catalog-metadata.json';
const VOCABULARIES_FILE_NAME = 'vocabularies.json';
const UPSTREAM_SOURCES_METADATA_FILE_NAME = 'upstream-sources-metadata.json';
const OUTPUT_ARTIFACT_FILE_NAMES = Object.freeze([
  CATALOG_FILE_NAME,
  CATALOG_METADATA_FILE_NAME,
  VOCABULARIES_FILE_NAME,
  UPSTREAM_SOURCES_METADATA_FILE_NAME,
]);
const ALLOWED_OUTPUT_ARTIFACT_FILE_NAMES = new Set(OUTPUT_ARTIFACT_FILE_NAMES);
const CATALOG_FILE = join(OUTPUT_DIR, CATALOG_FILE_NAME);
const CATALOG_METADATA_FILE = join(OUTPUT_DIR, CATALOG_METADATA_FILE_NAME);
const VOCABULARIES_FILE = join(OUTPUT_DIR, VOCABULARIES_FILE_NAME);
const UPSTREAM_SOURCES_METADATA_FILE = join(OUTPUT_DIR, UPSTREAM_SOURCES_METADATA_FILE_NAME);
const MAX_CATALOG_ARTIFACT_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETRY_DELAYS_MS = [1000, 3000];
const MAX_ERROR_BODY_CHARS = 280;

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

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function truncateResponseBody(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= MAX_ERROR_BODY_CHARS) {
    return normalized;
  }
  return `${normalized.slice(0, MAX_ERROR_BODY_CHARS)} [gekürzt, ${text.length} Zeichen insgesamt]`;
}

async function writeArtifacts(payload, outputDir = OUTPUT_DIR) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.artifacts) ||
    !payload.summary ||
    typeof payload.summary !== 'object' ||
    Array.isArray(payload.summary)
  ) {
    throw new Error('fetch-catalog payload is missing required sections');
  }

  const seenFiles = new Set();
  const artifactsToWrite = payload.artifacts.map((artifact) => {
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      typeof artifact.fileName !== 'string' ||
      typeof artifact.contentsBase64 !== 'string'
    ) {
      throw new Error('fetch-catalog payload contains an invalid artifact record');
    }

    if (!ALLOWED_OUTPUT_ARTIFACT_FILE_NAMES.has(artifact.fileName)) {
      throw new Error(`fetch-catalog payload contains an unexpected file: ${artifact.fileName}`);
    }

    if (seenFiles.has(artifact.fileName)) {
      throw new Error(`fetch-catalog payload contains a duplicate file: ${artifact.fileName}`);
    }
    seenFiles.add(artifact.fileName);

    return {
      fileName: artifact.fileName,
      contents: Buffer.from(artifact.contentsBase64, 'base64'),
    };
  });

  for (const fileName of OUTPUT_ARTIFACT_FILE_NAMES) {
    if (!seenFiles.has(fileName)) {
      throw new Error(`fetch-catalog payload omitted expected file: ${fileName}`);
    }
  }

  await mkdir(outputDir, { recursive: true });
  for (const artifact of artifactsToWrite) {
    await writeFile(join(outputDir, artifact.fileName), artifact.contents);
  }
}

async function fetchWithTransientRetry(url, init, retryDelaysMs) {
  for (let attempt = 0; ; attempt += 1) {
    const isLastAttempt = attempt >= retryDelaysMs.length;
    try {
      const response = await fetch(url, init);
      if (response.status < 500 || isLastAttempt) {
        return response;
      }
    } catch (error) {
      if (isLastAttempt) {
        throw error;
      }
    }
    await sleep(retryDelaysMs[attempt]);
  }
}

async function fetchGitHubJson(pathname, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
  const response = await fetchWithTransientRetry(
    `https://api.github.com${pathname}`,
    { headers: githubHeaders() },
    retryDelaysMs,
  );

  if (!response.ok) {
    const details = truncateResponseBody(await response.text());
    throw new Error(`GitHub API ${pathname} fehlgeschlagen: ${response.status} ${response.statusText} ${details}`.trim());
  }

  return response.json();
}

async function resolveSnapshot(logger = console, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
  if (PINNED_SHA) {
    try {
      const commitInfo = await fetchGitHubJson(`/repos/${REPO}/commits/${PINNED_SHA}`, retryDelaysMs);
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
    const repoInfo = await fetchGitHubJson(`/repos/${REPO}`, retryDelaysMs);
    const defaultBranch = assertAllowedGitHubRef(repoInfo.default_branch ?? 'main', 'GitHub default branch');
    const branchInfo = await fetchGitHubJson(`/repos/${REPO}/branches/${encodeURIComponent(defaultBranch)}`, retryDelaysMs);
    if (typeof branchInfo.commit?.sha !== 'string' || !/^[0-9a-f]{40}$/i.test(branchInfo.commit.sha)) {
      throw new Error(`GitHub branch ${defaultBranch} enthält keine gültige Commit-SHA.`);
    }

    const snapshotCommitSha = branchInfo.commit.sha.toLowerCase();
    let snapshotCommitDate = 'unknown';
    try {
      const commitInfo = await fetchGitHubJson(`/repos/${REPO}/commits/${snapshotCommitSha}`, retryDelaysMs);
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

/**
 * Begrenzung des Downloads (GSPP-324).
 *
 * Steht die Dateigröße aus dem BSI-Tree fest, ist sie die engere Schranke: ein
 * Artefakt darf nie mehr Bytes liefern, als der Tree für seinen Blob ausweist.
 * Die Diagnose bleibt dabei bewusst dieselbe wie beim nachgelagerten exakten
 * Größenabgleich — die Prüfung wandert nur nach vorn, die Aussage ändert sich
 * nicht. Ohne bekannte Größe greift das allgemeine Artefaktlimit.
 */
function resolveDownloadLimit(path, expectedSizeBytes) {
  if (Number.isSafeInteger(expectedSizeBytes) && expectedSizeBytes >= 0) {
    return {
      maxBytes: Math.max(expectedSizeBytes, 1),
      limitMessage: `Dateigröße stimmt nicht mit dem BSI-Tree überein: ${path}`,
    };
  }
  return {
    maxBytes: MAX_CATALOG_ARTIFACT_BYTES,
    limitMessage: `Artefakt überschreitet das erlaubte Artefaktlimit von ${MAX_CATALOG_ARTIFACT_BYTES} Bytes: ${path}`,
  };
}

async function fetchRawRegisteredFile(
  path,
  ref,
  materializedNamespacePaths,
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  expectedSizeBytes = null,
) {
  const allowedPath = assertRegisteredUpstreamRepoPath(path, { materializedNamespacePaths });
  const allowedRef = assertAllowedGitHubRef(ref, 'GitHub fetch ref');
  const url = `https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(allowedRef)}/${encodeRepoPath(allowedPath)}`;
  const response = await fetchWithTransientRetry(url, TOKEN
    ? {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
        },
      }
    : undefined, retryDelaysMs);

  if (!response.ok) {
    throw new Error(`Download fehlgeschlagen für ${path}: ${response.status} ${response.statusText}`);
  }

  const buffer = await readBodyWithLimit(
    response,
    resolveDownloadLimit(allowedPath, expectedSizeBytes),
  );
  return {
    buffer,
    text: buffer.toString('utf8'),
  };
}

async function fetchSnapshotTree(ref, retryDelaysMs = DEFAULT_RETRY_DELAYS_MS) {
  const allowedRef = assertAllowedGitHubRef(ref, 'GitHub tree ref');
  const response = await fetchGitHubJson(
    `/repos/${REPO}/git/trees/${encodeURIComponent(allowedRef)}?recursive=1`,
    retryDelaysMs,
  );
  return {
    response,
    files: normalizeGitTree(response, { monitoredRoots: MONITORED_UPSTREAM_ROOTS }),
  };
}

function computeGitBlobSha(contents) {
  return createHash('sha1')
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest('hex');
}

function buildBuildMetadata() {
  const workflowRunId = process.env.GITHUB_RUN_ID ?? 'local';
  const workflowRunUrl =
    process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
      ? `${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null;

  return {
    workflow_run_id: workflowRunId,
    workflow_run_url: workflowRunUrl,
    runner_environment: process.env.RUNNER_ENVIRONMENT ?? 'local',
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

const OSCAL_ROOT_TYPE_LABELS = {
  catalog: { artifact: 'Katalog', root: 'Katalogwurzel' },
  profile: { artifact: 'Profil', root: 'Profilwurzel' },
  'mapping-collection': { artifact: 'Mapping-Collection', root: 'Mapping-Collection-Wurzel' },
  'component-definition': { artifact: 'Component-Definition', root: 'Component-Definition-Wurzel' },
};

const KNOWN_OSCAL_ROOT_TYPES = Object.freeze(Object.keys(OSCAL_ROOT_TYPE_LABELS));

/**
 * Fail-closed Versionsprüfung gegen die Matrix (GSPP-283).
 *
 * `metadata.oscal-version` ist alleinige Versionsautorität. Der optionale
 * Top-Level-`$schema`-Direktivwert ist laut NIST-Schema ausdrücklich erlaubt,
 * aber weder Pflichtfeld noch wertbeschränkt — er wird deshalb nur als
 * Kreuzprobe herangezogen, nie zur Auswahl. Bei Widerspruch wird abgelehnt.
 *
 * Die Diagnose nennt Artefaktkontext, erwartete und gefundene Version, aber
 * keine Dokumentinhalte.
 */
function assertDeclaredOscalVersion(artifactDocument, descriptor, labels) {
  const { rootType, artifactKey, expectedOscalVersion } = descriptor;
  const declaredVersion = artifactDocument[rootType]?.metadata?.['oscal-version'];
  const context = `${labels.artifact} (${artifactKey})`;

  const binding = resolveSchemaBinding({
    rootType,
    oscalVersion: declaredVersion,
    schemaDirective: artifactDocument.$schema,
  });

  if (!binding.ok) {
    throw new Error(
      `${context}: OSCAL-Versionsprüfung fehlgeschlagen [${binding.code}] — ` +
      `Root ${rootType}, gefunden ${JSON.stringify(binding.oscalVersion)}` +
      (binding.expected ? `, erwartet ${binding.expected}` : '') + '.',
    );
  }

  if (expectedOscalVersion !== undefined && declaredVersion !== expectedOscalVersion) {
    throw new Error(
      `${context}: Deklarierte OSCAL-Version weicht vom Quellregister ab — ` +
      `erwartet ${expectedOscalVersion}, gefunden ${declaredVersion}. ` +
      'Quellregister und Versionsmatrix manuell gegen den BSI-Snapshot prüfen; ' +
      'keine automatische Übernahme.',
    );
  }

  return binding.pin;
}

function validateFetchedOscalArtifact(artifactBuffer, expectedRootType, versionContext) {
  const labels = OSCAL_ROOT_TYPE_LABELS[expectedRootType];
  if (!labels) {
    throw new Error(`Unbekannter OSCAL-Root-Typ: ${expectedRootType}`);
  }

  if (artifactBuffer.length > MAX_CATALOG_ARTIFACT_BYTES) {
    throw new Error(
      `${labels.artifact} überschreitet das erlaubte Artefaktlimit von ${MAX_CATALOG_ARTIFACT_BYTES} Bytes.`,
    );
  }

  let parsedArtifact;
  try {
    parsedArtifact = JSON.parse(artifactBuffer.toString('utf8'));
  } catch {
    throw new Error(`${labels.artifact} enthält kein gültiges JSON.`);
  }

  const artifactDocument = assertJsonObject(parsedArtifact, labels.artifact);
  assertJsonObject(artifactDocument[expectedRootType], labels.root);

  const presentOscalRoots = KNOWN_OSCAL_ROOT_TYPES.filter(
    (rootType) => artifactDocument[rootType] !== undefined,
  );
  if (
    presentOscalRoots.length !== 1 ||
    presentOscalRoots[0] !== expectedRootType
  ) {
    throw new Error(
      `${labels.artifact} enthält widersprüchliche OSCAL-Wurzeln: ${presentOscalRoots.join(', ') || 'keine'}.`,
    );
  }

  const schemaPin = assertDeclaredOscalVersion(
    artifactDocument,
    {
      rootType: expectedRootType,
      artifactKey: versionContext?.artifactKey ?? expectedRootType,
      expectedOscalVersion: versionContext?.expectedOscalVersion,
    },
    labels,
  );

  return {
    json: artifactDocument,
    buffer: artifactBuffer,
    schemaPin,
  };
}

function collectRawControls(container, controls = []) {
  for (const control of container?.controls ?? []) {
    controls.push(control);
    collectRawControls(control, controls);
  }
  for (const group of container?.groups ?? []) {
    collectRawControls(group, controls);
  }
  return controls;
}

export function validateCatalogControlIdentities(catalogDocument, artifactKey = 'catalog') {
  const catalog = assertJsonObject(catalogDocument?.catalog, 'Katalogwurzel');
  const controls = collectRawControls(catalog);
  const seenAltIdentifiers = new Map();

  for (const control of controls) {
    const controlId = typeof control?.id === 'string' && control.id.trim()
      ? control.id.trim()
      : '<ohne ID>';
    const altIdentifier = control?.props?.find(
      (prop) => prop?.name === 'alt-identifier' && typeof prop.value === 'string',
    )?.value?.trim();

    if (!altIdentifier) {
      throw new Error(
        `Datenqualitätsfehler in ${artifactKey}: Control ${controlId} hat keinen alt-identifier.`,
      );
    }

    if (seenAltIdentifiers.has(altIdentifier)) {
      const previousControlId = seenAltIdentifiers.get(altIdentifier);
      throw new Error(
        `Datenqualitätsfehler in ${artifactKey}: alt-identifier ${altIdentifier} ist für ${previousControlId} und ${controlId} doppelt.`,
      );
    }
    seenAltIdentifiers.set(altIdentifier, controlId);
  }

  return { controlCount: controls.length, findings: [] };
}

function validateFetchedCatalogArtifact(catalogBuffer) {
  return validateFetchedOscalArtifact(catalogBuffer, 'catalog');
}

function buildJsonArtifactBuffer(value, label) {
  return Buffer.from(serializeJsonArtifact(value, label), 'utf8');
}

function matchesVocabularyCollection(entry, repoPath) {
  const prefix = `${entry.upstreamDirectory}/`;
  return (
    repoPath.startsWith(prefix) &&
    repoPath.endsWith(entry.fileSuffix) &&
    !repoPath.slice(prefix.length).includes('/')
  );
}

function materializeRegistryFiles({ registryEntries, treeFiles, namespaceRefs }) {
  const treeFileByPath = new Map(treeFiles.map((file) => [file.path, file]));
  const descriptors = [];

  for (const entry of registryEntries) {
    if (entry.kind !== 'oscal') continue;
    const treeFile = treeFileByPath.get(entry.upstreamPath);
    if (!treeFile) {
      throw new Error(
        `Registriertes Artefakt fehlt im vollständigen BSI-Tree: ${entry.upstreamPath}. ` +
        'Quellregister manuell gegen den gepinnten BSI-Snapshot prüfen; ' +
        'keine automatische Pfadfreigabe.',
      );
    }
    descriptors.push({
      artifactKey: entry.artifactKey,
      rootType: entry.expectedRootType,
      lifecycle: entry.lifecycle,
      path: entry.upstreamPath,
      gitBlobSha: treeFile.gitBlobSha,
      sizeBytes: treeFile.sizeBytes,
      registryEntry: entry,
    });
  }

  for (const namespaceRef of namespaceRefs) {
    const collection = registryEntries.find(
      (entry) => entry.kind === 'vocabulary-collection' && matchesVocabularyCollection(entry, namespaceRef.path),
    );
    if (!collection) {
      throw new Error(`Namespace-Pfad ist nicht durch das Quellregister materialisiert: ${namespaceRef.path}`);
    }
    const treeFile = treeFileByPath.get(namespaceRef.path);
    if (!treeFile) {
      throw new Error(`Referenziertes Namespace-Artefakt fehlt im vollständigen BSI-Tree: ${namespaceRef.path}`);
    }
    descriptors.push({
      artifactKey: collection.artifactKey,
      rootType: 'vocabulary',
      lifecycle: collection.lifecycle,
      path: namespaceRef.path,
      gitBlobSha: treeFile.gitBlobSha,
      sizeBytes: treeFile.sizeBytes,
      namespaceUrl: namespaceRef.namespaceUrl,
      registryEntry: collection,
    });
  }

  const seenPaths = new Set();
  for (const descriptor of descriptors) {
    if (seenPaths.has(descriptor.path)) {
      throw new Error(`Quellregister materialisiert einen Pfad mehrfach: ${descriptor.path}`);
    }
    seenPaths.add(descriptor.path);
  }

  return descriptors.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

async function buildFetchArtifacts(logger = console, {
  retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
  registryEntries = SOURCE_REGISTRY,
  treeResponse: providedTreeResponse,
} = {}) {
  logger.log('================================================');
  logger.log('  Grundschutz++ Katalog + Vokabulare Fetch');
  logger.log('================================================');
  logger.log(`Repository: ${REPO}`);
  logger.log(`Katalog:    ${CATALOG_PATH}`);

  const snapshot = await resolveSnapshot(logger, retryDelaysMs);
  const fetchRef = assertAllowedGitHubRef(snapshot.snapshotCommitSha, 'Snapshot commit SHA');

  logger.log(`[1/5] Lade vollständigen BSI-Tree für Snapshot ${fetchRef} ...`);
  const tree = providedTreeResponse
    ? {
        response: providedTreeResponse,
        files: normalizeGitTree(providedTreeResponse, { monitoredRoots: MONITORED_UPSTREAM_ROOTS }),
      }
    : await fetchSnapshotTree(fetchRef, retryDelaysMs);

  const catalogTreeFile = tree.files.find((file) => file.path === CATALOG_PATH);
  if (!catalogTreeFile) {
    throw new Error(`Unterstützter Katalog fehlt im vollständigen BSI-Tree: ${CATALOG_PATH}`);
  }

  logger.log('[2/5] Lade unterstützten Katalog und ermittle Namespace-Mitglieder ...');
  const catalogRaw = await fetchRawRegisteredFile(
    CATALOG_PATH,
    fetchRef,
    [],
    retryDelaysMs,
    catalogTreeFile.sizeBytes,
  );
  if (computeGitBlobSha(catalogRaw.buffer) !== catalogTreeFile.gitBlobSha) {
    throw new Error(`Git-Blob-SHA stimmt nicht mit dem BSI-Tree überein: ${CATALOG_PATH}`);
  }
  const catalogArtifact = validateFetchedOscalArtifact(
    catalogRaw.buffer,
    SUPPORTED_CATALOG.expectedRootType,
    {
      artifactKey: SUPPORTED_CATALOG.artifactKey,
      expectedOscalVersion: SUPPORTED_CATALOG.oscalVersion,
    },
  );
  const catalogJson = catalogArtifact.json;
  const catalogQuality = validateCatalogControlIdentities(catalogJson, SUPPORTED_CATALOG.artifactKey);

  const referencedNamespaceUrls = extractReferencedNamespaceUrls(catalogJson, REPO);
  const vocabularyCollection = registryEntries.find(
    (entry) => entry.kind === 'vocabulary-collection' && entry.lifecycle === 'supported',
  );
  if (!vocabularyCollection) {
    throw new Error('Quellregister enthält keine unterstützte Vokabularsammlung.');
  }
  const namespaceRefs = materializeVocabularyCollectionMembers({
    collection: vocabularyCollection,
    treeFiles: tree.files,
    referencedNamespaceUrls,
    repository: REPO,
  });

  logger.log(`  ${namespaceRefs.length} freigegebene Namespace-Dateien gefunden.`);

  const materializedNamespacePaths = namespaceRefs.map((namespaceRef) => namespaceRef.path);
  const registryFiles = materializeRegistryFiles({
    registryEntries,
    treeFiles: tree.files,
    namespaceRefs,
  });

  logger.log(`[3/5] Validiere ${registryFiles.length} registrierte Artefakte ...`);
  const rawFileByPath = new Map([[CATALOG_PATH, catalogRaw]]);
  const inspectedArtifacts = await Promise.all(registryFiles.map(async (descriptor) => {
    let rawFile = rawFileByPath.get(descriptor.path);
    if (!rawFile) {
      logger.log(`  - ${descriptor.path} (${descriptor.lifecycle})`);
      rawFile = await fetchRawRegisteredFile(
        descriptor.path,
        fetchRef,
        materializedNamespacePaths,
        retryDelaysMs,
        descriptor.sizeBytes,
      );
      rawFileByPath.set(descriptor.path, rawFile);
    }

    if (descriptor.sizeBytes !== null && rawFile.buffer.length !== descriptor.sizeBytes) {
      throw new Error(`Dateigröße stimmt nicht mit dem BSI-Tree überein: ${descriptor.path}`);
    }
    if (computeGitBlobSha(rawFile.buffer) !== descriptor.gitBlobSha) {
      throw new Error(`Git-Blob-SHA stimmt nicht mit dem BSI-Tree überein: ${descriptor.path}`);
    }

    if (descriptor.rootType !== 'vocabulary') {
      validateFetchedOscalArtifact(rawFile.buffer, descriptor.rootType, {
        artifactKey: descriptor.artifactKey,
        expectedOscalVersion: descriptor.registryEntry?.oscalVersion,
      });
    }

    return {
      descriptor,
      rawFile,
      manifestFile: {
        artifactKey: descriptor.artifactKey,
        rootType: descriptor.rootType,
        lifecycle: descriptor.lifecycle,
        path: descriptor.path,
        gitBlobSha: descriptor.gitBlobSha,
        contentSha256: sha256Hex(rawFile.buffer),
      },
    };
  }));

  const inspectedByPath = new Map(
    inspectedArtifacts.map((artifact) => [artifact.descriptor.path, artifact]),
  );
  const namespaceArtifacts = namespaceRefs.map((namespaceRef) => {
    const inspected = inspectedByPath.get(namespaceRef.path);
    if (!inspected) {
      throw new Error(`Namespace-Artefakt wurde nicht validiert: ${namespaceRef.path}`);
    }

    const vocabularyNamespace = buildVocabularyNamespaceData({
      namespaceUrl: namespaceRef.namespaceUrl,
      repository: REPO,
      path: namespaceRef.path,
      gitBlobSha: inspected.descriptor.gitBlobSha,
      csvText: inspected.rawFile.text,
    });

    return {
      vocabularyNamespace,
      vocabularyFile: {
        namespace: vocabularyNamespace.source.namespace,
        path: vocabularyNamespace.source.path,
        fileName: vocabularyNamespace.source.fileName,
        routeId: vocabularyNamespace.source.routeId,
        gitBlobSha: vocabularyNamespace.source.gitBlobSha,
        sha256: inspected.manifestFile.contentSha256,
        sizeBytes: inspected.rawFile.buffer.length,
      },
    };
  });
  const vocabularyNamespaces = namespaceArtifacts.map((artifact) => artifact.vocabularyNamespace);
  const vocabularyFiles = namespaceArtifacts.map((artifact) => artifact.vocabularyFile);
  const practicesNamespace = vocabularyNamespaces.find(
    (namespace) => namespace.source.fileName === 'practices.csv',
  );
  const practiceIntegrity = practicesNamespace
    ? analyzePracticeVocabularyIntegrity(catalogJson, practicesNamespace)
    : null;
  assertPracticeVocabularyIntegrity(
    snapshot.snapshotCommitSha,
    practiceIntegrity,
  );
  const topicsNamespace = vocabularyNamespaces.find(
    (namespace) => namespace.source.fileName === 'topics.csv',
  );
  const topicCoverage = topicsNamespace
    ? analyzeTopicVocabularyCoverage(catalogJson, topicsNamespace)
    : null;
  assertTopicVocabularyCoverage(snapshot.snapshotCommitSha, topicCoverage);
  if (topicCoverage) {
    logger.log(
      `   Topic-Coverage: ${topicCoverage.matchedCatalogTopicCount}/${topicCoverage.catalogTopicCount} Katalogthemen, ${topicCoverage.csvEntryCount} CSV-Einträge, ${topicCoverage.orphanCsvEntryCount} verwaist`,
    );
  }

  const registryData = {
    sourceCommitSha: snapshot.snapshotCommitSha,
    namespaces: vocabularyNamespaces,
  };

  const manifest = buildUpstreamManifest({
    repository: OFFICIAL_BSI_REPOSITORY_URL,
    snapshotCommitSha: snapshot.snapshotCommitSha,
    files: inspectedArtifacts.map((artifact) => artifact.manifestFile),
  });

  const fetchedAt = new Date().toISOString();
  const buildMetadata = buildBuildMetadata();

  logger.log('[4/5] Bereite generierte Artefakte vor ...');
  const vocabulariesArtifact = buildJsonArtifactBuffer(
    registryData,
    'Vokabular-Registry',
  );
  const upstreamSourcesMetadataArtifact = buildJsonArtifactBuffer({
    artifactKey: 'namespaces-bsi',
    source: {
      repository: OFFICIAL_BSI_REPOSITORY_URL,
      catalogPath: CATALOG_PATH,
      snapshotCommitSha: snapshot.snapshotCommitSha,
      snapshotCommitDate: snapshot.snapshotCommitDate,
    },
    manifest,
    files: vocabularyFiles,
    dataQualityFindings: catalogQuality.findings,
    taxonomyCoverage: {
      topics: topicCoverage,
      practices: practiceIntegrity,
    },
    integrity: {
      sha256: sha256Hex(vocabulariesArtifact),
      size_bytes: vocabulariesArtifact.length,
      fetched_at: fetchedAt,
    },
    build: buildMetadata,
  }, 'Upstream-Metadaten');

  const catalogMetadataArtifact = buildJsonArtifactBuffer({
    artifactKey: SUPPORTED_CATALOG.artifactKey,
    source: {
      repository: OFFICIAL_BSI_REPOSITORY_URL,
      file: CATALOG_PATH,
      commit_sha: snapshot.snapshotCommitSha,
      commit_date: snapshot.snapshotCommitDate,
      git_blob_sha: catalogTreeFile.gitBlobSha,
      upstream_sha256: sha256Hex(catalogRaw.buffer),
      upstream_size_bytes: catalogRaw.buffer.length,
    },
    integrity: {
      sha256: sha256Hex(catalogArtifact.buffer),
      size_bytes: catalogArtifact.buffer.length,
      fetched_at: fetchedAt,
    },
    build: buildMetadata,
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
  validateFetchedOscalArtifact,
  resolveOptionalSnapshotSha,
  serializeJsonArtifact,
  writeArtifacts,
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
    .then(async (payload) => {
      await writeArtifacts(payload);
      console.error('[5/5] Fertig.');
      console.error(`  Katalog:             ${payload.summary.catalogFilePath}`);
      console.error(`  Katalog-Metadaten:   ${payload.summary.catalogMetadataFilePath}`);
      console.error(`  Vokabulare:          ${payload.summary.vocabulariesFilePath}`);
      console.error(`  Upstream-Metadaten:  ${payload.summary.upstreamSourcesMetadataFilePath}`);
      console.error(`  Snapshot:            ${payload.summary.snapshotCommitSha}`);
      console.error(`  Manifest-Signatur:   ${payload.summary.manifestSignature}`);
      console.error('================================================');
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
