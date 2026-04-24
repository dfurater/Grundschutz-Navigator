import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFetchArtifacts,
  serializeJsonArtifact,
  validateFetchedCatalogArtifact,
} from './fetch-catalog.mjs';
import {
  OFFICIAL_CATALOG_PATH,
  assertAllowedGitHubRef,
  assertAllowedUpstreamRepoPath,
  resolveOptionalSnapshotSha,
} from './security-guards.mjs';
import {
  buildUpstreamManifest,
  buildVocabularyNamespaceData,
  extractReferencedNamespaceUrls,
  namespaceUrlToRepoPath,
  parseCsv,
  parseVocabularyCsv,
  sha256Hex,
} from './vocabulary-utils.mjs';

function parseArtifactJson(payload, fileName: string) {
  const artifact = payload.artifacts.find((currentArtifact) => currentArtifact.fileName === fileName);
  expect(artifact).toBeDefined();
  return JSON.parse(Buffer.from(artifact!.contentsBase64, 'base64').toString('utf8'));
}

describe('fetch-catalog', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('accepts only full hexadecimal snapshot SHAs', () => {
    expect(resolveOptionalSnapshotSha('a'.repeat(40))).toBe('a'.repeat(40));
    expect(resolveOptionalSnapshotSha(undefined)).toBe('');
    expect(() => resolveOptionalSnapshotSha('main')).toThrow(
      'BSI_SNAPSHOT_SHA must be a 40-character hexadecimal commit SHA',
    );
  });

  it('accepts only allowed upstream repository paths', () => {
    expect(assertAllowedUpstreamRepoPath(OFFICIAL_CATALOG_PATH)).toBe(OFFICIAL_CATALOG_PATH);
    expect(assertAllowedUpstreamRepoPath('Dokumentation/namespaces/result.csv')).toBe(
      'Dokumentation/namespaces/result.csv',
    );
    expect(() => assertAllowedUpstreamRepoPath('../secret.txt')).toThrow(
      'Unsafe upstream repository path: ../secret.txt',
    );
    expect(() => assertAllowedUpstreamRepoPath('Dokumentation/readme.md')).toThrow(
      'Upstream repository path is outside the allowed BSI contract: Dokumentation/readme.md',
    );
  });

  it('accepts only safe GitHub refs', () => {
    expect(assertAllowedGitHubRef('main')).toBe('main');
    expect(assertAllowedGitHubRef('feature/catalog-sync')).toBe('feature/catalog-sync');
    expect(() => assertAllowedGitHubRef('../main')).toThrow('GitHub ref contains unsafe characters');
  });

  it('preserves the original fetched catalog bytes after validation', () => {
    const rawCatalog = Buffer.from(
      '{\n "catalog" : { "uuid":"demo","metadata":{"title":"Grundschutz++"}, "groups":[ ] }\n}\n',
      'utf8',
    );
    const artifact = validateFetchedCatalogArtifact(rawCatalog);

    expect(artifact.json).toEqual({
      catalog: {
        uuid: 'demo',
        metadata: {
          title: 'Grundschutz++',
        },
        groups: [],
      },
    });
    expect(artifact.buffer).toEqual(rawCatalog);
  });

  it('rejects fetched catalogs that are not valid JSON', () => {
    expect(() => validateFetchedCatalogArtifact(Buffer.from('{catalog:', 'utf8'))).toThrow(
      'Katalog enthält kein gültiges JSON.',
    );
  });

  it('rejects fetched catalogs without the top-level catalog object', () => {
    expect(() => validateFetchedCatalogArtifact(Buffer.from('{"controls":[]}', 'utf8'))).toThrow(
      'Katalogwurzel muss ein JSON-Objekt sein.',
    );
  });

  it('aborts when the upstream snapshot cannot be resolved', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response('Service Unavailable', {
          status: 503,
          statusText: 'Service Unavailable',
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(buildFetchArtifacts({
      log: () => {},
      warn: () => {},
    })).rejects.toThrow('Build abgebrochen, damit nicht ungepinnt von main geladen wird');

    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      'https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/main/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json',
    );
  });

  it('aborts when the default branch does not expose an exact commit SHA', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response(JSON.stringify({ default_branch: 'main' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/branches/main') {
        return new Response(JSON.stringify({ commit: { sha: 'not-a-commit' } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(buildFetchArtifacts({
      log: () => {},
      warn: () => {},
    })).rejects.toThrow('GitHub branch main enthält keine gültige Commit-SHA.');
  });

  it('continues with an unknown commit date when resolved snapshot metadata is unavailable', async () => {
    const snapshotSha = 'a'.repeat(40);
    const catalogBlobSha = 'b'.repeat(40);
    const catalogText =
      '{\n "catalog" : { "uuid":"demo","metadata":{"title":"Grundschutz++"}, "groups":[ ] }\n}\n';
    const warn = vi.fn();

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response(JSON.stringify({ default_branch: 'main' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/branches/main') {
        return new Response(JSON.stringify({ commit: { sha: snapshotSha } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/commits/${snapshotSha}`) {
        return new Response('rate limited', {
          status: 429,
          statusText: 'Too Many Requests',
        });
      }

      if (
        url ===
        `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/contents/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json?ref=${snapshotSha}`
      ) {
        return new Response(JSON.stringify({
          sha: catalogBlobSha,
          size: Buffer.byteLength(catalogText),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/${snapshotSha}/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json`
      ) {
        return new Response(catalogText);
      }

      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }));

    const payload = await buildFetchArtifacts({
      log: () => {},
      warn,
    });
    const metadata = parseArtifactJson(payload, 'catalog-metadata.json');

    expect(metadata.source.commit_sha).toBe(snapshotSha);
    expect(metadata.source.commit_date).toBe('unknown');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Commit-Metadaten für aufgelösten Snapshot ${snapshotSha} nicht laden`),
    );
  });

  it('aborts when the provenance lookup fails for the catalog file', async () => {
    const snapshotSha = 'a'.repeat(40);

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response(JSON.stringify({ default_branch: 'main' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/branches/main') {
        return new Response(JSON.stringify({ commit: { sha: snapshotSha } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/contents/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json?ref=${snapshotSha}`
      ) {
        return new Response('internal error', {
          status: 500,
          statusText: 'Internal Server Error',
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(buildFetchArtifacts({
      log: () => {},
      warn: () => {},
    })).rejects.toThrow('Konnte Provenance für Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json nicht exakt auflösen');
  });

  it('aborts when the provenance lookup succeeds without a blob SHA', async () => {
    const snapshotSha = 'a'.repeat(40);

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response(JSON.stringify({ default_branch: 'main' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/branches/main') {
        return new Response(JSON.stringify({ commit: { sha: snapshotSha } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/contents/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json?ref=${snapshotSha}`
      ) {
        return new Response(JSON.stringify({
          size: 1234,
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    await expect(buildFetchArtifacts({
      log: () => {},
      warn: () => {},
    })).rejects.toThrow('GitHub contents response für Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json enthält keine gültige Blob-SHA.');
  });

  it('emits catalog.json with the exact upstream bytes', async () => {
    const snapshotSha = 'a'.repeat(40);
    const catalogBlobSha = 'b'.repeat(40);
    const catalogText =
      '{\n "catalog" : { "uuid":"demo","metadata":{"title":"Grundschutz++"}, "groups":[ ] }\n}\n';

    vi.stubEnv('GITHUB_RUN_ID', undefined);
    vi.stubEnv('GITHUB_REPOSITORY', undefined);
    vi.stubEnv('GITHUB_SERVER_URL', undefined);

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response(JSON.stringify({ default_branch: 'main' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/branches/main') {
        return new Response(JSON.stringify({ commit: { sha: snapshotSha } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/commits/${snapshotSha}`) {
        return new Response(JSON.stringify({
          commit: {
            committer: {
              date: '2026-04-03T00:00:00.000Z',
            },
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/contents/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json?ref=${snapshotSha}`
      ) {
        return new Response(JSON.stringify({
          sha: catalogBlobSha,
          size: Buffer.byteLength(catalogText),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/${snapshotSha}/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json`
      ) {
        return new Response(catalogText);
      }

      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }));

    const payload = await buildFetchArtifacts({
      log: () => {},
      warn: () => {},
    });

    const rawCatalogBuffer = Buffer.from(catalogText, 'utf8');
    const catalogArtifact = payload.artifacts.find((artifact) => artifact.fileName === 'catalog.json');
    const metadataArtifact = payload.artifacts.find((artifact) => artifact.fileName === 'catalog-metadata.json');

    expect(catalogArtifact).toBeDefined();
    expect(metadataArtifact).toBeDefined();
    expect(Buffer.from(catalogArtifact!.contentsBase64, 'base64')).toEqual(rawCatalogBuffer);

    const metadata = JSON.parse(
      Buffer.from(metadataArtifact!.contentsBase64, 'base64').toString('utf8'),
    );

    expect(metadata.integrity.sha256).toBe(sha256Hex(rawCatalogBuffer));
    expect(metadata.integrity.size_bytes).toBe(rawCatalogBuffer.length);
    expect(metadata.source.upstream_sha256).toBe(metadata.integrity.sha256);
    expect(metadata.build.workflow_run_id).toBe('local');
    expect(metadata.build.workflow_run_url).toBeNull();
  });

  it('emits a workflow run URL only when GitHub Actions run metadata is present', async () => {
    const snapshotSha = 'a'.repeat(40);
    const catalogBlobSha = 'b'.repeat(40);
    const catalogText =
      '{\n "catalog" : { "uuid":"demo","metadata":{"title":"Grundschutz++"}, "groups":[ ] }\n}\n';

    vi.stubEnv('GITHUB_RUN_ID', '12345');
    vi.stubEnv('GITHUB_REPOSITORY', 'dfurater/Grundschutz-Navigator');
    vi.stubEnv('GITHUB_SERVER_URL', 'https://github.example.test');

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response(JSON.stringify({ default_branch: 'main' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/branches/main') {
        return new Response(JSON.stringify({ commit: { sha: snapshotSha } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/commits/${snapshotSha}`) {
        return new Response(JSON.stringify({
          commit: {
            committer: {
              date: '2026-04-03T00:00:00.000Z',
            },
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/contents/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json?ref=${snapshotSha}`
      ) {
        return new Response(JSON.stringify({
          sha: catalogBlobSha,
          size: Buffer.byteLength(catalogText),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/${snapshotSha}/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json`
      ) {
        return new Response(catalogText);
      }

      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }));

    const payload = await buildFetchArtifacts({
      log: () => {},
      warn: () => {},
    });
    const metadata = parseArtifactJson(payload, 'catalog-metadata.json');

    expect(metadata.build.workflow_run_id).toBe('12345');
    expect(metadata.build.workflow_run_url).toBe(
      'https://github.example.test/dfurater/Grundschutz-Navigator/actions/runs/12345',
    );
  });

  it('fetches namespace files in parallel while preserving deterministic artifact order', async () => {
    const snapshotSha = 'a'.repeat(40);
    const catalogBlobSha = 'b'.repeat(40);
    const resultNamespace =
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv';
    const actionWordsNamespace =
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/action_words.csv';
    const catalogText = JSON.stringify({
      catalog: {
        groups: [
          {
            controls: [
              {
                props: [
                  { ns: resultNamespace },
                  { ns: actionWordsNamespace },
                ],
              },
            ],
          },
        ],
      },
    });
    const namespaceCsvByPath = new Map([
      ['Dokumentation/namespaces/action_words.csv', 'Infinitiv,Definition\numsetzen,Etwas umsetzen\n'],
      ['Dokumentation/namespaces/result.csv', 'Ergebnis,Definition\nVerfahren,Ein Verfahren\n'],
    ]);
    const pendingNamespaceResponses = [];
    let markBothNamespaceDownloadsStarted: () => void;
    const bothNamespaceDownloadsStarted = new Promise<void>((resolve) => {
      markBothNamespaceDownloadsStarted = resolve;
    });

    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek') {
        return new Response(JSON.stringify({ default_branch: 'main' }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/branches/main') {
        return new Response(JSON.stringify({ commit: { sha: snapshotSha } }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/commits/${snapshotSha}`) {
        return new Response(JSON.stringify({
          commit: {
            committer: {
              date: '2026-04-03T00:00:00.000Z',
            },
          },
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (
        url ===
        `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/contents/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json?ref=${snapshotSha}`
      ) {
        return new Response(JSON.stringify({
          sha: catalogBlobSha,
          size: Buffer.byteLength(catalogText),
        }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      for (const [path, csvText] of namespaceCsvByPath) {
        if (
          url ===
          `https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek/contents/${path}?ref=${snapshotSha}`
        ) {
          const namespaceBlobSha = path === 'Dokumentation/namespaces/action_words.csv'
            ? 'c'.repeat(40)
            : 'd'.repeat(40);
          return new Response(JSON.stringify({
            sha: namespaceBlobSha,
            size: Buffer.byteLength(csvText),
          }), {
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }

      if (
        url ===
        `https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/${snapshotSha}/Anwenderkataloge/Grundschutz%2B%2B/Grundschutz%2B%2B-catalog.json`
      ) {
        return new Response(catalogText);
      }

      for (const [path, csvText] of namespaceCsvByPath) {
        if (
          url ===
          `https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek/${snapshotSha}/${path}`
        ) {
          return new Promise((resolve) => {
            pendingNamespaceResponses.push(() => resolve(new Response(csvText)));
            if (pendingNamespaceResponses.length === namespaceCsvByPath.size) {
              markBothNamespaceDownloadsStarted();
              pendingNamespaceResponses.forEach((release) => release());
            }
          });
        }
      }

      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }));

    const payloadPromise = buildFetchArtifacts({
      log: () => {},
      warn: () => {},
    });
    const namespaceStartResult = await Promise.race([
      bothNamespaceDownloadsStarted.then(() => 'both-started'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 50)),
    ]);
    expect(namespaceStartResult).toBe('both-started');

    const payload = await payloadPromise;
    const vocabularies = parseArtifactJson(payload, 'vocabularies.json');
    const upstreamMetadata = parseArtifactJson(payload, 'upstream-sources-metadata.json');

    expect(vocabularies.namespaces.map((namespace) => namespace.source.path)).toEqual([
      'Dokumentation/namespaces/action_words.csv',
      'Dokumentation/namespaces/result.csv',
    ]);
    expect(upstreamMetadata.files.map((file) => file.path)).toEqual([
      'Dokumentation/namespaces/action_words.csv',
      'Dokumentation/namespaces/result.csv',
    ]);
  });

  it('serializes generated metadata with a trailing newline', () => {
    expect(
      serializeJsonArtifact({ integrity: { fetchedAt: '2026-04-03T00:00:00.000Z' } }, 'Metadaten'),
    ).toBe('{\n  "integrity": {\n    "fetchedAt": "2026-04-03T00:00:00.000Z"\n  }\n}\n');
  });
});

describe('vocabulary-utils', () => {
  it('extracts only referenced official BSI namespace URLs from the final catalog', () => {
    const catalog = {
      catalog: {
        metadata: {
          props: [
            { name: 'ignore-me', ns: 'http://csrc.nist.gov/ns/oscal/1.0' },
          ],
        },
        groups: [
          {
            controls: [
              {
                props: [
                  {
                    name: 'sec_level',
                    value: 'normal-SdT',
                    ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
                  },
                  {
                    name: 'sec_level',
                    value: 'normal-SdT',
                    ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
                  },
                ],
                parts: [
                  {
                    props: [
                      {
                        name: 'result',
                        value: 'Verfahren',
                        ns: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    };

    expect(
      extractReferencedNamespaceUrls(catalog, 'BSI-Bund/Stand-der-Technik-Bibliothek'),
    ).toEqual([
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv',
      'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
    ]);
  });

  it('maps GitHub namespace URLs back to repository-relative paths', () => {
    expect(
      namespaceUrlToRepoPath(
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv',
        'BSI-Bund/Stand-der-Technik-Bibliothek',
      ),
    ).toBe('Dokumentation/namespaces/security_level.csv');

    expect(
      namespaceUrlToRepoPath(
        'http://csrc.nist.gov/ns/oscal/1.0',
        'BSI-Bund/Stand-der-Technik-Bibliothek',
      ),
    ).toBeNull();
  });

  it('parses quoted CSV fields with embedded newlines and escaped quotes', () => {
    const rows = parseCsv(
      'Begriff,Definition\r\nnormal-SdT,"Zeile 1\nZeile ""2"""',
    );

    expect(rows).toEqual([
      ['Begriff', 'Definition'],
      ['normal-SdT', 'Zeile 1\nZeile "2"'],
    ]);
  });

  it('keeps official headers and exposes exact lookup metadata for a namespace CSV', () => {
    const parsed = parseVocabularyCsv(
      'Aufwand,Definition\r\n3,"Mehrere Wochen bis Monate"',
    );

    expect(parsed.columnOrder).toEqual(['Aufwand', 'Definition']);
    expect(parsed.valueColumn).toBe('Aufwand');
    expect(parsed.definitionColumn).toBe('Definition');
    expect(parsed.entries).toEqual([
      {
        value: '3',
        definition: 'Mehrere Wochen bis Monate',
        columns: {
          Aufwand: '3',
          Definition: 'Mehrere Wochen bis Monate',
        },
      },
    ]);
  });

  it('uses the first official CSV column as the exact lookup key', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl:
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/action_words.csv',
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'Dokumentation/namespaces/action_words.csv',
      gitBlobSha: 'blob-action',
      csvText: 'Infinitiv,Definition\r\numsetzen,"Etwas umsetzen"',
    });

    expect(namespace.valueColumn).toBe('Infinitiv');
    expect(namespace.entries).toEqual([
      {
        value: 'umsetzen',
        definition: 'Etwas umsetzen',
        columns: {
          Infinitiv: 'umsetzen',
          Definition: 'Etwas umsetzen',
        },
      },
    ]);
  });

  it('builds namespace data and a deterministic upstream manifest', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl:
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/action_words.csv',
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'Dokumentation/namespaces/action_words.csv',
      gitBlobSha: 'blob-action',
      csvText: 'Infinitiv,Definition\r\numsetzen,"Etwas umsetzen"',
    });

    const manifest = buildUpstreamManifest({
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'snapshot-123',
      catalogPath: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
      catalogGitBlobSha: 'blob-catalog',
      namespaces: [namespace],
    });

    expect(namespace.source.routeId).toBe('dokumentation-namespaces-action-words');
    expect(manifest.files).toEqual([
      {
        kind: 'catalog',
        path: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
        gitBlobSha: 'blob-catalog',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/action_words.csv',
        namespace:
          'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/action_words.csv',
        gitBlobSha: 'blob-action',
      },
    ]);
    expect(manifest.signatureSha256).toHaveLength(64);
  });

  it('changes the manifest signature when only a namespace blob changes', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl:
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv',
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'Dokumentation/namespaces/result.csv',
      gitBlobSha: 'blob-result-a',
      csvText: 'Ergebnis,Definition\r\nVerfahren,"Offizielle Definition"',
    });

    const unchanged = buildUpstreamManifest({
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'snapshot-123',
      catalogPath: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
      catalogGitBlobSha: 'blob-catalog',
      namespaces: [namespace],
    });

    const changed = buildUpstreamManifest({
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'snapshot-123',
      catalogPath: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
      catalogGitBlobSha: 'blob-catalog',
      namespaces: [
        {
          ...namespace,
          source: {
            ...namespace.source,
            gitBlobSha: 'blob-result-b',
          },
        },
      ],
    });

    expect(changed.signatureSha256).not.toBe(unchanged.signatureSha256);
  });

  it('changes the combined signature when only a referenced namespace blob changes', () => {
    const baseConfig = {
      repositoryUrl: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'commit-123',
      catalogPath: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
      catalogBlobSha: 'blob-catalog',
    };

    const unchangedCatalog = buildUpstreamManifest({
      ...baseConfig,
      repository: baseConfig.repositoryUrl,
      catalogGitBlobSha: baseConfig.catalogBlobSha,
      namespaces: [
        buildVocabularyNamespaceData({
          namespaceUrl:
            'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv',
          repository: baseConfig.repositoryUrl,
          path: 'Dokumentation/namespaces/result.csv',
          gitBlobSha: 'blob-result-a',
          csvText: 'Begriff,Definition\nAnforderung,Definition\n',
        }),
      ],
    });

    const changedNamespaceOnly = buildUpstreamManifest({
      ...baseConfig,
      repository: baseConfig.repositoryUrl,
      catalogGitBlobSha: baseConfig.catalogBlobSha,
      namespaces: [
        buildVocabularyNamespaceData({
          namespaceUrl:
            'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/result.csv',
          repository: baseConfig.repositoryUrl,
          path: 'Dokumentation/namespaces/result.csv',
          gitBlobSha: 'blob-result-b',
          csvText: 'Begriff,Definition\nAnforderung,Definition aktualisiert\n',
        }),
      ],
    });

    expect(unchangedCatalog.files[0].gitBlobSha).toBe(changedNamespaceOnly.files[0].gitBlobSha);
    expect(unchangedCatalog.signatureSha256).not.toBe(changedNamespaceOnly.signatureSha256);
  });
});
