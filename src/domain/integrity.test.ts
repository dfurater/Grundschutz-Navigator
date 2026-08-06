import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  computeSHA256,
  verifyArtifactIntegrity,
  fetchJsonDocument,
  fetchProvenance,
  fetchCatalogWithBuffer,
  ARTIFACT_FETCH_TIMEOUT_MS,
} from './integrity';
import type { CatalogProvenance, VocabularyProvenance } from './models';

/**
 * Simuliert einen Fetch, der nie settelt, bis das übergebene AbortSignal
 * feuert — genau das Verhalten eines hängenden Netzwerk-Requests.
 */
function hangUntilAborted(signal: AbortSignal | null | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
}

/* ------------------------------------------------------------------ */
/*  Test Fixtures                                                      */
/* ------------------------------------------------------------------ */

function makeProvenance(overrides: Partial<CatalogProvenance> = {}): CatalogProvenance {
  return {
    source: {
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      file: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      commit_sha: 'abc123',
      git_blob_sha: 'def456',
    },
    integrity: {
      sha256: '', // will be set per test
      size_bytes: 1000,
      fetched_at: '2026-03-16T06:00:00Z',
    },
    build: {
      workflow_run_id: '12345',
      workflow_run_url: 'https://github.com/actions/runs/12345',
      runner_environment: 'github-hosted',
    },
    ...overrides,
  };
}

function makeVocabularyProvenance(sha256: string): VocabularyProvenance {
  const namespaceUrl =
    'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_level.csv';

  return {
    source: {
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      catalogPath: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      snapshotCommitSha: 'snapshot-abc',
      snapshotCommitDate: '2026-03-15T00:00:00Z',
    },
    manifest: {
      schemaVersion: 2,
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'snapshot-abc',
      files: [
        {
          artifactKey: 'catalog-gspp',
          rootType: 'catalog',
          lifecycle: 'supported',
          path: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
          gitBlobSha: 'blob-catalog',
          contentSha256: 'hash-catalog',
        },
        {
          artifactKey: 'namespaces-bsi',
          rootType: 'vocabulary',
          lifecycle: 'supported',
          path: 'documentation/namespaces/security_level.csv',
          gitBlobSha: 'blob-security',
          contentSha256: 'csv-hash',
        },
      ],
      signatureSha256: 'signature-123',
    },
    files: [
      {
        namespace: namespaceUrl,
        path: 'documentation/namespaces/security_level.csv',
        fileName: 'security_level.csv',
        routeId: 'documentation-namespaces-security-level',
        gitBlobSha: 'blob-security',
        sha256: 'csv-hash',
        sizeBytes: 64,
      },
    ],
    integrity: {
      sha256,
      size_bytes: 128,
      fetched_at: '2026-03-16T06:00:00Z',
    },
    build: {
      workflow_run_id: '12345',
      workflow_run_url: null,
      runner_environment: 'github-hosted',
    },
  };
}

function textToBuffer(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer as ArrayBuffer;
}

/* ------------------------------------------------------------------ */
/*  computeSHA256                                                      */
/* ------------------------------------------------------------------ */

describe('computeSHA256', () => {
  it('computes correct SHA-256 for a known input', async () => {
    // SHA-256 of empty string is well-known
    const emptyBuffer = textToBuffer('');
    const hash = await computeSHA256(emptyBuffer);
    expect(hash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('computes correct SHA-256 for "hello"', async () => {
    const buffer = textToBuffer('hello');
    const hash = await computeSHA256(buffer);
    expect(hash).toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    );
  });

  it('produces 64-character hex string', async () => {
    const buffer = textToBuffer('test data');
    const hash = await computeSHA256(buffer);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different hashes for different inputs', async () => {
    const hash1 = await computeSHA256(textToBuffer('input1'));
    const hash2 = await computeSHA256(textToBuffer('input2'));
    expect(hash1).not.toBe(hash2);
  });
});

/* ------------------------------------------------------------------ */
/*  verifyArtifactIntegrity                                            */
/* ------------------------------------------------------------------ */

describe('verifyArtifactIntegrity', () => {
  it('returns valid=true when hash matches', async () => {
    const content = '{"catalog": "test"}';
    const buffer = textToBuffer(content);
    const expectedHash = await computeSHA256(buffer);

    const metadata = makeProvenance({
      integrity: {
        sha256: expectedHash,
        size_bytes: content.length,
        fetched_at: '2026-03-16T06:00:00Z',
      },
    });

    const result = await verifyArtifactIntegrity(buffer, metadata);
    expect(result.valid).toBe(true);
    expect(result.computedHash).toBe(expectedHash);
    expect(result.expectedHash).toBe(expectedHash);
    expect(result.sourceCommit).toBe('abc123');
    expect(result.fetchedAt).toBe('2026-03-16T06:00:00Z');
  });

  it('returns valid=false when hash does not match', async () => {
    const buffer = textToBuffer('original content');
    const metadata = makeProvenance({
      integrity: {
        sha256: 'aaaa' + '0'.repeat(60),
        size_bytes: 100,
        fetched_at: '2026-03-16T06:00:00Z',
      },
    });

    const result = await verifyArtifactIntegrity(buffer, metadata);
    expect(result.valid).toBe(false);
    expect(result.computedHash).not.toBe(result.expectedHash);
  });

  it('returns valid=false for tampered content', async () => {
    const originalContent = '{"data": "original"}';
    const tamperedContent = '{"data": "tampered"}';
    const originalHash = await computeSHA256(textToBuffer(originalContent));

    const metadata = makeProvenance({
      integrity: {
        sha256: originalHash,
        size_bytes: originalContent.length,
        fetched_at: '2026-03-16T06:00:00Z',
      },
    });

    const result = await verifyArtifactIntegrity(
      textToBuffer(tamperedContent),
      metadata,
    );
    expect(result.valid).toBe(false);
  });

  it('verifies vocabulary artifacts and reports the snapshot commit', async () => {
    const content = '{"sourceCommitSha":"snapshot-abc","namespaces":[]}';
    const buffer = textToBuffer(content);
    const expectedHash = await computeSHA256(buffer);

    const result = await verifyArtifactIntegrity(
      buffer,
      makeVocabularyProvenance(expectedHash),
    );

    expect(result.valid).toBe(true);
    expect(result.sourceCommit).toBe('snapshot-abc');
    expect(result.fetchedAt).toBe('2026-03-16T06:00:00Z');
  });

  it('rejects tampered vocabulary artifacts', async () => {
    const original = textToBuffer('{"namespaces":[]}');
    const expectedHash = await computeSHA256(original);

    const result = await verifyArtifactIntegrity(
      textToBuffer('{"namespaces":[{}]}'),
      makeVocabularyProvenance(expectedHash),
    );

    expect(result.valid).toBe(false);
  });

  it('preserves source metadata in result', async () => {
    const buffer = textToBuffer('data');
    const metadata = makeProvenance({
      source: {
        repository: 'https://github.com/test/repo',
        file: 'catalog.json',
        commit_sha: 'commit-xyz',
        git_blob_sha: 'blob-123',
      },
      integrity: {
        sha256: 'mismatch',
        size_bytes: 4,
        fetched_at: '2026-01-01T00:00:00Z',
      },
    });

    const result = await verifyArtifactIntegrity(buffer, metadata);
    expect(result.sourceCommit).toBe('commit-xyz');
    expect(result.fetchedAt).toBe('2026-01-01T00:00:00Z');
  });
});

/* ------------------------------------------------------------------ */
/*  fetchProvenance                                                    */
/* ------------------------------------------------------------------ */

describe('fetchProvenance', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches and parses metadata JSON', async () => {
    const metadata = makeProvenance();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(metadata), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await fetchProvenance('/data/catalog-metadata.json');
    expect(result.source.repository).toBe(
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    );
    expect(result.source.commit_sha).toBe('abc123');
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 404, statusText: 'Not Found' }),
    );

    await expect(
      fetchProvenance('/data/catalog-metadata.json'),
    ).rejects.toThrow('Failed to load catalog metadata: 404 Not Found');
  });
});

describe('fetchJsonDocument', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loads arbitrary JSON documents with a custom label', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await expect(
      fetchJsonDocument<{ ok: boolean }>('/data/vocabularies.json', 'vocabulary registry'),
    ).resolves.toEqual({ ok: true });
  });

  it('reports the custom label on HTTP failure', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 503, statusText: 'Service Unavailable' }),
    );

    await expect(
      fetchJsonDocument('/data/vocabularies.json', 'vocabulary registry'),
    ).rejects.toThrow('Failed to load vocabulary registry: 503 Service Unavailable');
  });

  it('rejects once the request exceeds the given timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => hangUntilAborted(init?.signal),
    );

    const pending = fetchJsonDocument('/data/vocabularies.json', 'vocabulary registry', 5000);
    const assertion = expect(pending).rejects.toBeDefined();

    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('defaults the timeout to ARTIFACT_FETCH_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => hangUntilAborted(init?.signal),
    );

    const pending = fetchJsonDocument('/data/vocabularies.json', 'vocabulary registry');
    const assertion = expect(pending).rejects.toBeDefined();

    await vi.advanceTimersByTimeAsync(ARTIFACT_FETCH_TIMEOUT_MS);
    await assertion;
  });

  it('clears the timeout timer after a successful fetch', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await fetchJsonDocument('/data/vocabularies.json', 'vocabulary registry');

    expect(vi.getTimerCount()).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/*  fetchCatalogWithBuffer                                             */
/* ------------------------------------------------------------------ */

describe('fetchCatalogWithBuffer', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns buffer and decoded text', async () => {
    const content = '{"catalog": "test content"}';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(content, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await fetchCatalogWithBuffer('/data/catalog.json');
    expect(result.text).toBe(content);
    expect(result.buffer).toBeInstanceOf(ArrayBuffer);
    expect(result.buffer.byteLength).toBe(new TextEncoder().encode(content).byteLength);
  });

  it('throws on HTTP error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500, statusText: 'Internal Server Error' }),
    );

    await expect(fetchCatalogWithBuffer('/data/catalog.json')).rejects.toThrow(
      'Failed to load catalog: 500 Internal Server Error',
    );
  });

  it('rejects once the request exceeds the given timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => hangUntilAborted(init?.signal),
    );

    const pending = fetchCatalogWithBuffer('/data/catalog.json', 5000);
    const assertion = expect(pending).rejects.toBeDefined();

    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it('defaults the timeout to ARTIFACT_FETCH_TIMEOUT_MS', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input, init) => hangUntilAborted(init?.signal),
    );

    const pending = fetchCatalogWithBuffer('/data/catalog.json');
    const assertion = expect(pending).rejects.toBeDefined();

    await vi.advanceTimersByTimeAsync(ARTIFACT_FETCH_TIMEOUT_MS);
    await assertion;
  });

  it('clears the timeout timer after a successful fetch', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{"catalog": "test content"}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await fetchCatalogWithBuffer('/data/catalog.json');

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('ARTIFACT_FETCH_TIMEOUT_MS', () => {
  it('is 60000 milliseconds', () => {
    expect(ARTIFACT_FETCH_TIMEOUT_MS).toBe(60_000);
  });
});
