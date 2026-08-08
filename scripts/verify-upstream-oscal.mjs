#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { validateManifestV2Shape } from './upstream-artifacts.mjs';
import { listOscalArtifacts } from '../src/domain/sourceRegistry.mjs';
import { OFFICIAL_BSI_REPO, readBodyWithLimit } from './security-guards.mjs';

/**
 * Gepinnter go-oscal-Korpuslauf (GSPP-336).
 *
 * Die Release-Tabelle enthält ausschließlich Plattformkombinationen, die Node
 * tatsächlich melden kann. Das plattformneutrale Darwin-Asset wird absichtlich
 * nicht geraten; macOS erhält immer sein architekturspezifisches Artefakt.
 */
export const GO_OSCAL_RELEASE = Object.freeze({
  repository: 'defenseunicorns/go-oscal',
  tag: 'v0.7.1',
  checksumsName: 'checksums.txt',
  checksumsSha256: '040d0b57da2e54aeba62ab9cb3bd6bcfe01dc7f0af54895c4f58bfbd9ca5a244',
  platforms: Object.freeze({
    'darwin-x64': Object.freeze({
      binaryName: 'go-oscal_v0.7.1_Darwin_amd64',
      binarySha256: 'b39169d1df68af440838be2d0875e339711a30539eaf2f0edc5bfc043f022e27',
      sbomName: 'sbom_go-oscal_v0.7.1_Darwin_amd64.sbom',
      sbomSha256: '705ffd39067926551fa296e0df91055f98d1c2264138b394694c142df10d9c39',
    }),
    'darwin-arm64': Object.freeze({
      binaryName: 'go-oscal_v0.7.1_Darwin_arm64',
      binarySha256: 'e5eee6cd0533a38c676f9833239addb0749c6f8b78ebea98b17e65d2fe90f684',
      sbomName: 'sbom_go-oscal_v0.7.1_Darwin_arm64.sbom',
      sbomSha256: 'b6dd77f3444f9783f242018c0dfc610d38bf1fecb6db4ff196d2af746a9eac61',
    }),
    'linux-x64': Object.freeze({
      binaryName: 'go-oscal_v0.7.1_Linux_amd64',
      binarySha256: 'e55007ee53fa11ea9830c8bc4ef7a6d2b81929983f525037c1e0b7aee5c9a6f1',
      sbomName: 'sbom_go-oscal_v0.7.1_Linux_amd64.sbom',
      sbomSha256: '7d6bc16934ae597ab7bcd8f484ea9eb55fcf341a2e1ea2b53cc2242ec43179e7',
    }),
    'linux-arm64': Object.freeze({
      binaryName: 'go-oscal_v0.7.1_Linux_arm64',
      binarySha256: '774e913a85d1fe4cd776144e93ed7edd06877b1a865ea528377adea1deebb563',
      sbomName: 'sbom_go-oscal_v0.7.1_Linux_arm64.sbom',
      sbomSha256: 'fbc2544ee841bb16d381c09442e307f4aee72d1b5ef7a639283702555bb55380',
    }),
  }),
});

export function resolveGoOscalPlatform(
  { platform = process.platform, arch = process.arch } = {},
  releaseConfig = GO_OSCAL_RELEASE,
) {
  const target = releaseConfig.platforms[`${platform}-${arch}`];
  if (!target) {
    throw new Error(
      `go-oscal v0.7.1 unterstützt diese Plattform/Architektur nicht: ${platform}/${arch}`,
    );
  }
  return target;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function parseChecksums(text) {
  if (typeof text !== 'string') {
    throw new Error('checksums.txt ist kein Text');
  }

  const checksums = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const match = /^([0-9a-f]{64})  ([A-Za-z0-9._-]+)$/.exec(line);
    if (!match || checksums.has(match[2])) {
      throw new Error('checksums.txt hat ein ungültiges Format');
    }
    checksums.set(match[2], match[1]);
  }

  if (checksums.size === 0) {
    throw new Error('checksums.txt enthält keine Prüfsummen');
  }
  return checksums;
}

function parseApiDigest(value) {
  const match = /^sha256:([0-9a-f]{64})$/.exec(value ?? '');
  if (!match) {
    throw new Error('GitHub-API-Digest hat kein erwartetes SHA-256-Format');
  }
  return match[1];
}

/** Verifiziert einen Download gegen alle drei unabhängigen Binärpins. */
export function verifyPinnedAsset({ bytes, expectedSha256, apiDigest, checksumDigest }) {
  if (!Buffer.isBuffer(bytes) || !SHA256_PATTERN.test(expectedSha256 ?? '')) {
    throw new Error('Gepinnte Asset-Prüfung erhielt ungültige Eingaben');
  }

  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error('Berechneter SHA-256 stimmt nicht mit dem Pin überein');
  }
  if (parseApiDigest(apiDigest) !== expectedSha256) {
    throw new Error('GitHub-API-Digest stimmt nicht mit dem Pin überein');
  }
  if (checksumDigest !== expectedSha256) {
    throw new Error('checksums.txt stimmt nicht mit dem Pin überein');
  }

  return actualSha256;
}

function releaseAssetUrl(releaseConfig, name) {
  return `https://github.com/${releaseConfig.repository}/releases/download/${releaseConfig.tag}/${name}`;
}

function pinnedReleaseAsset(assets, name, expectedSha256, releaseConfig) {
  const matches = assets.filter((asset) => asset?.name === name);
  const asset = matches[0];
  if (
    matches.length !== 1 ||
    asset?.browser_download_url !== releaseAssetUrl(releaseConfig, name) ||
    asset?.digest !== `sha256:${expectedSha256}`
  ) {
    throw new Error('GitHub-Release-Metadaten widersprechen dem statischen Pin');
  }
  return asset;
}

/**
 * Prüft Release-Tag, Namen, direkte Download-URLs und API-Digests, bevor
 * irgendein Release-Byte verarbeitet wird.
 */
export function getReleaseAssetsForPlatform(
  release,
  platformTarget,
  releaseConfig = GO_OSCAL_RELEASE,
) {
  if (release?.tag_name !== releaseConfig.tag || !Array.isArray(release?.assets)) {
    throw new Error('GitHub-Release-Metadaten widersprechen dem statischen Pin');
  }

  return Object.freeze({
    checksums: pinnedReleaseAsset(
      release.assets,
      releaseConfig.checksumsName,
      releaseConfig.checksumsSha256,
      releaseConfig,
    ),
    binary: pinnedReleaseAsset(
      release.assets,
      platformTarget.binaryName,
      platformTarget.binarySha256,
      releaseConfig,
    ),
    sbom: pinnedReleaseAsset(
      release.assets,
      platformTarget.sbomName,
      platformTarget.sbomSha256,
      releaseConfig,
    ),
  });
}

/**
 * Verbindet die signierte Manifest-Projektion mit dem Quellregister. Das
 * Manifest liefert die Content- und Blob-Pins; Root und Version stammen
 * weiterhin ausschließlich aus dem registrierten Artefaktvertrag.
 */
export function selectManifestOscalArtifacts(manifest, registry = listOscalArtifacts()) {
  validateManifestV2Shape(manifest);
  if (!Array.isArray(registry) || registry.length === 0) {
    throw new Error('OSCAL-Quellregister ist leer oder ungültig');
  }

  const manifestByPath = new Map(manifest.files.map((file) => [file.path, file]));
  const oscalArtifacts = registry.map((entry) => {
    const manifestFile = manifestByPath.get(entry.upstreamPath);
    if (
      !manifestFile ||
      manifestFile.artifactKey !== entry.artifactKey ||
      manifestFile.rootType !== entry.expectedRootType ||
      manifestFile.lifecycle !== entry.lifecycle
    ) {
      throw new Error('Manifest und OSCAL-Quellregister stimmen nicht überein');
    }

    return Object.freeze({
      artifactKey: entry.artifactKey,
      rootType: entry.expectedRootType,
      oscalVersion: entry.oscalVersion,
      lifecycle: entry.lifecycle,
      upstreamPath: entry.upstreamPath,
      contentSha256: manifestFile.contentSha256,
      gitBlobSha: manifestFile.gitBlobSha,
    });
  });

  const vocabularyArtifacts = manifest.files.filter((file) => file.rootType === 'vocabulary');
  const versionCoverage = Object.fromEntries(
    [...new Set(oscalArtifacts.map((artifact) => artifact.oscalVersion))]
      .sort()
      .map((version) => [
        version,
        oscalArtifacts.filter((artifact) => artifact.oscalVersion === version).length,
      ]),
  );

  return Object.freeze({
    oscalArtifacts: Object.freeze(oscalArtifacts),
    vocabularyArtifacts: Object.freeze(vocabularyArtifacts),
    versionCoverage: Object.freeze(versionCoverage),
  });
}

const RELEASE_ASSET_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
]);
const MAX_RELEASE_BINARY_BYTES = 16 * 1024 * 1024;
const MAX_SBOM_BYTES = 1024 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECT_HOPS = 5;
export const GO_OSCAL_EXECUTION_TIMEOUT_MS = 60_000;
const execFileAsync = promisify(execFile);
const SAFE_ARTIFACT_KEY = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

function createVerificationToolError(code, artifactKey) {
  const toolError = new Error(code);
  toolError.code = code;
  if (SAFE_ARTIFACT_KEY.test(artifactKey ?? '')) toolError.artifactKey = artifactKey;
  return toolError;
}

export function formatVerificationFailure(error) {
  const code = typeof error?.code === 'string' ? error.code : 'GO_OSCAL_VERIFICATION_FAILED';
  return SAFE_ARTIFACT_KEY.test(error?.artifactKey ?? '')
    ? `${code} artifact=${error.artifactKey}`
    : code;
}

/**
 * go-oscal 0.7.1 rejects a standard OSCAL `$schema` directive before it reaches
 * its JSON-Schema validator because its model detector requires one top-level
 * key. The directive never selects a schema here; metadata.oscal-version does.
 * Remove only a string directive from the ephemeral tool input, never from the
 * verified upstream bytes or the manifest.
 */
export function prepareGoOscalInput(bytes, artifactKey) {
  let document;
  try {
    document = JSON.parse(Buffer.from(bytes).toString('utf8'));
  } catch {
    throw createVerificationToolError('GO_OSCAL_INPUT_INVALID', artifactKey);
  }

  if (!document || Array.isArray(document) || typeof document !== 'object') {
    throw createVerificationToolError('GO_OSCAL_INPUT_INVALID', artifactKey);
  }
  if (!Object.hasOwn(document, '$schema')) return bytes;
  if (typeof document.$schema !== 'string') {
    throw createVerificationToolError('GO_OSCAL_SCHEMA_DIRECTIVE_INVALID', artifactKey);
  }

  const { $schema: _schemaDirective, ...withoutSchemaDirective } = document;
  return Buffer.from(JSON.stringify(withoutSchemaDirective));
}

function encodeRepoPath(repoPath) {
  return repoPath.split('/').map(encodeURIComponent).join('/');
}

function verifyApiPinnedAsset(bytes, expectedSha256, apiDigest) {
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== expectedSha256) {
    throw new Error('Berechneter SHA-256 stimmt nicht mit dem Pin überein');
  }
  if (parseApiDigest(apiDigest) !== expectedSha256) {
    throw new Error('GitHub-API-Digest stimmt nicht mit dem Pin überein');
  }
}

function assertAllowedReleaseRedirect(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error('Release-Asset-Redirect ist ungültig');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    !RELEASE_ASSET_HOSTS.has(url.host)
  ) {
    throw new Error('Release-Asset-Redirect liegt außerhalb der erlaubten Lieferkette');
  }
  return url.toString();
}

async function fetchReleaseAsset(asset, fetchImpl, maxBytes) {
  let url = assertAllowedReleaseRedirect(asset.browser_download_url);

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const response = await fetchImpl(url, { redirect: 'manual' });
    if (response.status < 300 || response.status > 399) {
      if (!response.ok) throw new Error('Release-Asset-Download fehlgeschlagen');
      return readBodyWithLimit(response, { maxBytes, label: 'Release-Asset' });
    }
    const location = response.headers?.get?.('location');
    if (!location) throw new Error('Release-Asset-Redirect hat kein Ziel');
    url = assertAllowedReleaseRedirect(new URL(location, url).toString());
  }

  throw new Error('Release-Asset-Download überschreitet die Redirect-Grenze');
}

async function fetchReleaseMetadata(releaseConfig, fetchImpl) {
  const url = `https://api.github.com/repos/${releaseConfig.repository}/releases/tags/${releaseConfig.tag}`;
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
  });
  if (!response.ok) throw new Error('GitHub-Release-Metadaten konnten nicht geladen werden');
  try {
    return await response.json();
  } catch {
    throw new Error('GitHub-Release-Metadaten sind kein gültiges JSON');
  }
}

function bsiRawUrl(manifest, artifact) {
  if (manifest.repository !== `https://github.com/${OFFICIAL_BSI_REPO}`) {
    throw new Error('Manifest verweist nicht auf das offizielle BSI-Repository');
  }
  return `https://raw.githubusercontent.com/${OFFICIAL_BSI_REPO}/${manifest.snapshotCommitSha}/${encodeRepoPath(artifact.upstreamPath)}`;
}

function computeGitBlobSha(contents) {
  return createHash('sha1')
    .update(`blob ${contents.length}\0`)
    .update(contents)
    .digest('hex');
}

async function fetchVerifiedBsiArtifact(manifest, artifact, fetchImpl) {
  const response = await fetchImpl(bsiRawUrl(manifest, artifact), { redirect: 'error' });
  if (!response.ok) throw new Error('BSI-Artefakt-Download fehlgeschlagen');
  const bytes = await readBodyWithLimit(response, {
    maxBytes: MAX_DOCUMENT_BYTES,
    label: 'BSI-OSCAL-Artefakt',
  });
  if (createHash('sha256').update(bytes).digest('hex') !== artifact.contentSha256) {
    throw new Error('BSI-Artefakt verletzt den Manifest-Inhaltspin');
  }
  if (computeGitBlobSha(bytes) !== artifact.gitBlobSha) {
    throw new Error('BSI-Artefakt verletzt den Manifest-Blobpin');
  }
  return bytes;
}

export async function executeGoOscal(
  { binaryPath, inputPath, resultPath, artifactKey },
  { execFileImpl = execFileAsync } = {},
) {
  try {
    await execFileImpl(
      binaryPath,
      ['validate', '--input-file', inputPath, '--validation-result', resultPath],
      {
        maxBuffer: 1024 * 1024,
        timeout: GO_OSCAL_EXECUTION_TIMEOUT_MS,
        windowsHide: true,
      },
    );
  } catch (error) {
    // Exit 1 ist der dokumentierte Schemafehlerpfad. Timeout, Spawn- und
    // sonstige Werkzeugfehler dürfen weder lokale Pfade noch Dokumentwerte
    // aus stderr in die CI-Ausgabe übernehmen.
    if (error?.code !== 1) {
      throw createVerificationToolError('GO_OSCAL_TOOL_EXECUTION_FAILED', artifactKey);
    }
  }
}

const defaultExecuteTool = executeGoOscal;

export function classifyValidationResult(validationResult) {
  if (!validationResult || typeof validationResult.valid !== 'boolean') {
    throw createVerificationToolError('GO_OSCAL_VALIDATION_RESULT_INVALID');
  }
  return validationResult.valid ? 'passed' : 'failed';
}

async function readValidationResult(resultPath, artifactKey) {
  try {
    return classifyValidationResult(JSON.parse(await readFile(resultPath, 'utf8')));
  } catch (error) {
    if (error?.code === 'GO_OSCAL_VALIDATION_RESULT_INVALID') {
      throw createVerificationToolError('GO_OSCAL_VALIDATION_RESULT_INVALID', artifactKey);
    }
    throw createVerificationToolError('GO_OSCAL_VALIDATION_RESULT_UNAVAILABLE', artifactKey);
  }
}

export function evaluateArtifactExpectation(artifact, schemaStatus) {
  if (schemaStatus !== 'passed' && schemaStatus !== 'failed') {
    throw new Error('Schema status is invalid');
  }

  const expectedSchemaStatus = artifact.lifecycle === 'blocked-by-upstream' ? 'failed' : 'passed';
  const verificationPassed = schemaStatus === expectedSchemaStatus;
  const outcome = verificationPassed
    ? expectedSchemaStatus === 'failed'
      ? 'expected-blocked-schema-failure'
      : 'expected-schema-success'
    : expectedSchemaStatus === 'failed'
      ? 'unblock-candidate'
      : 'unexpected-schema-failure';

  return Object.freeze({
    artifactKey: artifact.artifactKey,
    lifecycle: artifact.lifecycle,
    rootType: artifact.rootType,
    oscalVersion: artifact.oscalVersion,
    expectedSchemaStatus,
    schemaStatus,
    outcome,
    verificationPassed,
  });
}

export function formatVerifyUpstreamOscalSummary({ snapshotCommitSha, selection, artifactResults }) {
  const versionLines = Object.entries(selection.versionCoverage)
    .map(([version, count]) => `  ${version}: ${count}`)
    .join('\n');
  const artifactLines = [...artifactResults]
    .sort((left, right) => left.artifactKey.localeCompare(right.artifactKey))
    .map(
      (artifact) =>
        `  ${artifact.artifactKey}: lifecycle=${artifact.lifecycle}; expected=${artifact.expectedSchemaStatus}; schema=${artifact.schemaStatus}; result=${artifact.outcome}`,
    )
    .join('\n');

  return [
    'go-oscal@0.7.1 — Upstream-OSCAL-Schemaprüfung',
    `Snapshot: ${snapshotCommitSha}`,
    `OSCAL: ${artifactResults.length} geprüft`,
    `vocabulary: ${selection.vocabularyArtifacts.length} übersprungen (kein OSCAL-Root-Modell)`,
    'Versionen:',
    versionLines,
    'Artefakte:',
    artifactLines,
  ].join('\n');
}

export function resolveSbomOutputPath(
  configuredPath,
  target,
  runnerTempDirectory = process.env.RUNNER_TEMP,
) {
  if (configuredPath === undefined || configuredPath === '') return null;
  const outputPath = path.resolve(configuredPath);
  if (path.basename(outputPath) !== target.sbomName) {
    throw new Error('GO_OSCAL_SBOM_OUTPUT muss den plattformgleichen SBOM-Dateinamen verwenden');
  }
  if (typeof runnerTempDirectory !== 'string' || runnerTempDirectory.length === 0) {
    throw new Error('GO_OSCAL_SBOM_OUTPUT benötigt einen CI-Temporärbereich');
  }
  if (path.dirname(outputPath) !== path.resolve(runnerTempDirectory)) {
    throw new Error('GO_OSCAL_SBOM_OUTPUT muss innerhalb des CI-Temporärbereichs liegen');
  }
  return outputPath;
}

/** Führt den vollständigen, nur gegen feste Quellen erlaubten Korpuslauf aus. */
export async function runVerifyUpstreamOscal({
  repoRoot = process.cwd(),
  registry = listOscalArtifacts(),
  fetchImpl = fetch,
  executeTool = defaultExecuteTool,
  platform = process.platform,
  arch = process.arch,
  releaseConfig = GO_OSCAL_RELEASE,
  sbomOutputPath = process.env.GO_OSCAL_SBOM_OUTPUT,
  runnerTempDirectory = process.env.RUNNER_TEMP,
} = {}) {
  const manifestPath = path.join(repoRoot, 'upstream-manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    throw new Error('Upstream-Manifest kann nicht gelesen werden');
  }

  const selection = selectManifestOscalArtifacts(manifest, registry);
  const target = resolveGoOscalPlatform({ platform, arch }, releaseConfig);
  const release = await fetchReleaseMetadata(releaseConfig, fetchImpl);
  const assets = getReleaseAssetsForPlatform(release, target, releaseConfig);
  const checksumsBytes = await fetchReleaseAsset(assets.checksums, fetchImpl, MAX_SBOM_BYTES);
  verifyApiPinnedAsset(checksumsBytes, releaseConfig.checksumsSha256, assets.checksums.digest);
  const checksums = parseChecksums(checksumsBytes.toString('utf8'));
  const binaryBytes = await fetchReleaseAsset(assets.binary, fetchImpl, MAX_RELEASE_BINARY_BYTES);
  verifyPinnedAsset({
    bytes: binaryBytes,
    expectedSha256: target.binarySha256,
    apiDigest: assets.binary.digest,
    checksumDigest: checksums.get(target.binaryName),
  });
  const sbomBytes = await fetchReleaseAsset(assets.sbom, fetchImpl, MAX_SBOM_BYTES);
  verifyPinnedAsset({
    bytes: sbomBytes,
    expectedSha256: target.sbomSha256,
    apiDigest: assets.sbom.digest,
    checksumDigest: checksums.get(target.sbomName),
  });

  const outputPath = resolveSbomOutputPath(sbomOutputPath, target, runnerTempDirectory);
  if (outputPath) await writeFile(outputPath, sbomBytes, { mode: 0o600 });

  const tempDirectory = await mkdtemp(path.join(tmpdir(), 'gspp-go-oscal-'));
  try {
    const binaryPath = path.join(tempDirectory, 'go-oscal');
    await writeFile(binaryPath, binaryBytes, { mode: 0o700 });
    await chmod(binaryPath, 0o700);

    const artifactResults = [];
    for (const [index, artifact] of selection.oscalArtifacts.entries()) {
      const inputPath = path.join(tempDirectory, `document-${index}.json`);
      const resultPath = path.join(tempDirectory, `result-${index}.json`);
      const verifiedBytes = await fetchVerifiedBsiArtifact(manifest, artifact, fetchImpl);
      await writeFile(inputPath, prepareGoOscalInput(verifiedBytes, artifact.artifactKey));
      await executeTool({ binaryPath, inputPath, resultPath, artifactKey: artifact.artifactKey });
      artifactResults.push(
        evaluateArtifactExpectation(
          artifact,
          await readValidationResult(resultPath, artifact.artifactKey),
        ),
      );
    }

    const summary = formatVerifyUpstreamOscalSummary({
      snapshotCommitSha: manifest.snapshotCommitSha,
      selection,
      artifactResults,
    });
    return Object.freeze({
      summary,
      selection,
      artifactResults: Object.freeze(artifactResults),
      verificationPassed: artifactResults.every((artifact) => artifact.verificationPassed),
    });
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const isDirectExecution = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runVerifyUpstreamOscal()
    .then((result) => {
      console.log(result.summary);
      if (!result.verificationPassed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(formatVerificationFailure(error));
      process.exitCode = 1;
    });
}
