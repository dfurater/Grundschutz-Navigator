// =============================================================================
// Runtime Integrity Verification
//
// Verifies that the loaded catalog matches the SHA-256 hash recorded at
// build time. Uses the Web Crypto API for hash computation.
// =============================================================================

import type {
  CatalogProvenance,
  VerificationResult,
  VocabularyProvenance,
} from './models';

type IntegrityMetadata = CatalogProvenance | VocabularyProvenance;

/**
 * Zeitlimit je Artefakt-Fetch (Antwort + Body-Lesen). Schützt vor einem
 * hängenden Request, der sonst den Ladepfad dauerhaft im Ladezustand hält
 * (GSPP-331). Bemessen an der ausgelieferten Artefaktgröße mit reichlich
 * Spielraum gegenüber einer schlechten Mobilverbindung, siehe Issue.
 */
export const ARTIFACT_FETCH_TIMEOUT_MS = 60_000;

/**
 * Compute the SHA-256 hash of an ArrayBuffer using the Web Crypto API.
 *
 * @param buffer - The raw bytes to hash
 * @returns Hex-encoded SHA-256 hash string
 */
export async function computeSHA256(buffer: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function verifyArtifactIntegrity(
  artifactBuffer: ArrayBuffer,
  metadata: IntegrityMetadata,
): Promise<VerificationResult> {
  const computedHash = await computeSHA256(artifactBuffer);
  const sourceCommit =
    'commit_sha' in metadata.source
      ? metadata.source.commit_sha
      : metadata.source.snapshotCommitSha;

  return {
    valid: computedHash === metadata.integrity.sha256,
    computedHash,
    expectedHash: metadata.integrity.sha256,
    sourceCommit,
    fetchedAt: metadata.integrity.fetched_at,
  };
}

/**
 * Fetch the catalog provenance metadata from the server.
 *
 * @param metadataUrl - URL of the catalog-metadata.json file
 * @returns Parsed provenance metadata
 * @throws Error if the metadata cannot be loaded or parsed
 */
export async function fetchProvenance(
  metadataUrl: string,
): Promise<CatalogProvenance> {
  return fetchJsonDocument<CatalogProvenance>(
    metadataUrl,
    'catalog metadata',
  );
}

export async function fetchVocabularyProvenance(
  metadataUrl: string,
): Promise<VocabularyProvenance> {
  return fetchJsonDocument<VocabularyProvenance>(
    metadataUrl,
    'vocabulary metadata',
  );
}

export async function fetchJsonDocument<T>(
  url: string,
  label = 'JSON document',
  timeoutMs = ARTIFACT_FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out loading ${label} after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Failed to load ${label}: ${response.status} ${response.statusText}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Load a catalog file as an ArrayBuffer for integrity verification.
 *
 * @param catalogUrl - URL of the catalog.json file
 * @returns Raw ArrayBuffer, which callers can transfer without a copy
 * @throws Error if the catalog cannot be loaded
 */
export async function fetchCatalogBuffer(
  catalogUrl: string,
  timeoutMs = ARTIFACT_FETCH_TIMEOUT_MS,
): Promise<ArrayBuffer> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Timed out loading catalog after ${timeoutMs}ms`)),
    timeoutMs,
  );
  try {
    const response = await fetch(catalogUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(
        `Failed to load catalog: ${response.status} ${response.statusText}`,
      );
    }
    const buffer = await response.arrayBuffer();
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Lädt Bytes und dekodiert sie für Aufrufer, die den Text direkt brauchen
 * (heute: die Vokabular-Registry). Der Katalogpfad verwendet dagegen
 * `fetchCatalogBuffer()` und dekodiert erst im Parser-Worker.
 */
export async function fetchCatalogWithBuffer(
  catalogUrl: string,
  timeoutMs = ARTIFACT_FETCH_TIMEOUT_MS,
): Promise<{ buffer: ArrayBuffer; text: string }> {
  const buffer = await fetchCatalogBuffer(catalogUrl, timeoutMs);
  return { buffer, text: new TextDecoder('utf-8').decode(buffer) };
}
