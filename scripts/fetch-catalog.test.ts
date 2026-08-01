import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFetchArtifacts,
  serializeJsonArtifact,
  validateCatalogControlIdentities,
  validateFetchedCatalogArtifact,
  validateFetchedOscalArtifact,
  writeArtifacts,
} from './fetch-catalog.mjs';
import {
  OFFICIAL_BSI_REPOSITORY_URL,
  OFFICIAL_CATALOG_PATH,
  assertAllowedGitHubRef,
  assertAllowedUpstreamRepoPath,
  resolveOptionalSnapshotSha,
} from './security-guards.mjs';
import { buildUpstreamManifest } from './upstream-artifacts.mjs';
import {
  buildVocabularyNamespaceData,
  extractReferencedNamespaceUrls,
  namespaceUrlToRepoPath,
  parseCsv,
  parseVocabularyCsv,
  sha256Hex,
} from './vocabulary-utils.mjs';
import { SOURCE_REGISTRY } from '../src/domain/sourceRegistry.mjs';

const SNAPSHOT_SHA = 'a'.repeat(40);
const REPOSITORY_API = 'https://api.github.com/repos/BSI-Bund/Stand-der-Technik-Bibliothek';
const RAW_BASE = 'https://raw.githubusercontent.com/BSI-Bund/Stand-der-Technik-Bibliothek';
const RESULT_NAMESPACE_URL =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/result.csv';
const ACTION_WORDS_NAMESPACE_URL =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/action_words.csv';
const PRACTICES_NAMESPACE_PATH = 'documentation/namespaces/practices.csv';
const PRACTICE_ALT_IDENTIFIER = '33333333-3333-4333-8333-333333333333';
const PRACTICES_CSV =
  `Kürzel,Begriff,Definition,UUID\nGC,Governance,Fixture definition,${PRACTICE_ALT_IDENTIFIER}\n`;
const TOPICS_NAMESPACE_PATH = 'documentation/namespaces/topics.csv';
const TOPIC_ALT_IDENTIFIER = '22222222-2222-4222-8222-222222222222';
const TOPICS_CSV =
  `Begriff,Definition,UUID\nFixture,Fixture definition,${TOPIC_ALT_IDENTIFIER}\n`;
const OUTPUT_ARTIFACT_FILE_NAMES = [
  'catalog.json',
  'catalog-metadata.json',
  'vocabularies.json',
  'upstream-sources-metadata.json',
] as const;
const temporaryOutputDirectories = new Set<string>();

/** Die vom echten Grundschutz++-Katalog deklarierte Modellversion (GSPP-283). */
const CATALOG_OSCAL_VERSION = '1.1.3';

/**
 * Minimaler OSCAL-Rumpf für ein Testartefakt. `metadata.oscal-version` ist
 * Pflichtfeld: der Fetch-Guard prüft sie fail-closed gegen die Versionsmatrix
 * und gegen die Registry-Erwartung.
 */
function makeOscalDocumentText(
  rootType: string,
  oscalVersion: string,
  root: Record<string, unknown> = {},
) {
  return `${JSON.stringify({
    [rootType]: {
      metadata: { title: rootType, 'oscal-version': oscalVersion },
      ...root,
    },
  })}\n`;
}

const MINIMAL_REGISTRY = [
  {
    artifactKey: 'catalog-gspp',
    kind: 'oscal',
    oscalVersion: CATALOG_OSCAL_VERSION,
    expectedRootType: 'catalog',
    catalogKey: 'gspp',
    upstreamPath: OFFICIAL_CATALOG_PATH,
    lifecycle: 'supported',
    title: 'Grundschutz++ Anwenderkatalog',
  },
  {
    artifactKey: 'namespaces-bsi',
    kind: 'vocabulary-collection',
    upstreamDirectory: 'documentation/namespaces',
    fileSuffix: '.csv',
    lifecycle: 'supported',
    title: 'Offizielle BSI-Namespace-Vokabulare',
  },
] as const;

type RawContents = string | Buffer;
type RawFileMap = Map<string, RawContents>;
type ResponseFactory = (attempt: number) => Response | Promise<Response>;
type RawResponseFactory = (
  path: string,
  contents: RawContents,
) => Response | Promise<Response>;

function inputUrl(input: string | URL | Request) {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.toString() : input.url;
}

function bufferFrom(contents: RawContents) {
  return Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
}

function gitBlobSha(contents: RawContents) {
  const buffer = bufferFrom(contents);
  return createHash('sha1')
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest('hex');
}

function encodeRepoPath(repoPath: string) {
  return repoPath.split('/').map(encodeURIComponent).join('/');
}

function rawUrl(repoPath: string, snapshotSha = SNAPSHOT_SHA) {
  return `${RAW_BASE}/${snapshotSha}/${encodeRepoPath(repoPath)}`;
}

function makeTreeEntry(path: string, contents: RawContents) {
  const buffer = bufferFrom(contents);
  return {
    path,
    mode: '100644',
    type: 'blob',
    sha: gitBlobSha(buffer),
    size: buffer.length,
  };
}

function makeTreeResponse(rawByPath: RawFileMap, extraEntries: ReturnType<typeof makeTreeEntry>[] = []) {
  return {
    truncated: false,
    tree: [
      ...[...rawByPath].map(([path, contents]) => makeTreeEntry(path, contents)),
      ...extraEntries,
    ],
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    headers: { 'Content-Type': 'application/json' },
  });
}

function responseWithContents(contents: RawContents) {
  const body = Buffer.isBuffer(contents) ? new Uint8Array(contents) : contents;
  return new Response(body);
}

function installSnapshotFetch({
  rawByPath,
  snapshotSha = SNAPSHOT_SHA,
  branchSha = snapshotSha,
  repositoryResponse,
  branchResponse,
  commitResponse,
  rawResponse,
}: {
  rawByPath: RawFileMap;
  snapshotSha?: string;
  branchSha?: string;
  repositoryResponse?: ResponseFactory;
  branchResponse?: ResponseFactory;
  commitResponse?: ResponseFactory;
  rawResponse?: RawResponseFactory;
}) {
  let repositoryAttempts = 0;
  let branchAttempts = 0;
  let commitAttempts = 0;

  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = inputUrl(input);

    if (url === REPOSITORY_API) {
      repositoryAttempts += 1;
      return repositoryResponse?.(repositoryAttempts) ?? jsonResponse({ default_branch: 'main' });
    }

    if (url === `${REPOSITORY_API}/branches/main`) {
      branchAttempts += 1;
      return branchResponse?.(branchAttempts) ?? jsonResponse({ commit: { sha: branchSha } });
    }

    if (url === `${REPOSITORY_API}/commits/${snapshotSha}`) {
      commitAttempts += 1;
      return commitResponse?.(commitAttempts) ?? jsonResponse({
        commit: { committer: { date: '2026-04-03T00:00:00.000Z' } },
      });
    }

    for (const [path, contents] of rawByPath) {
      if (url === rawUrl(path, snapshotSha)) {
        return rawResponse?.(path, contents) ?? responseWithContents(contents);
      }
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    getRepositoryAttempts: () => repositoryAttempts,
  };
}

function makeCatalogText(namespaceUrls: string[] = []) {
  const controls = namespaceUrls.length === 0
    ? []
    : [
        {
          id: 'CTRL.1',
          props: [
            { name: 'alt-identifier', value: '11111111-1111-4111-8111-111111111111' },
            ...namespaceUrls.map((namespaceUrl, index) => ({
              name: `namespace-${index}`,
              value: `value-${index}`,
              ns: namespaceUrl,
            })),
          ],
        },
      ];
  const groups = [
    {
      id: 'GC',
      props: [{ name: 'alt-identifier', value: PRACTICE_ALT_IDENTIFIER }],
      groups: [
        {
          id: 'GC.1',
          props: [{ name: 'alt-identifier', value: TOPIC_ALT_IDENTIFIER }],
          controls,
        },
      ],
    },
  ];

  return `${JSON.stringify({
    catalog: {
      uuid: 'demo',
      metadata: { title: 'Grundschutz++', 'oscal-version': CATALOG_OSCAL_VERSION },
      groups,
    },
  }, null, 2)}\n`;
}

function makeMinimalFetchInput(
  namespaceFiles: RawFileMap = new Map(),
  catalogNamespaceUrls = [...namespaceFiles.keys()].map(
    (path) => `https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/${path}`,
  ),
  includePractices = true,
) {
  const materializedNamespaceFiles = new Map(namespaceFiles);
  if (includePractices && !materializedNamespaceFiles.has(PRACTICES_NAMESPACE_PATH)) {
    materializedNamespaceFiles.set(PRACTICES_NAMESPACE_PATH, PRACTICES_CSV);
  }
  if (!materializedNamespaceFiles.has(TOPICS_NAMESPACE_PATH)) {
    materializedNamespaceFiles.set(TOPICS_NAMESPACE_PATH, TOPICS_CSV);
  }
  const catalogText = makeCatalogText(catalogNamespaceUrls);
  const rawByPath = new Map<string, RawContents>([
    [OFFICIAL_CATALOG_PATH, catalogText],
    ...materializedNamespaceFiles,
  ]);
  return {
    catalogText,
    namespaceFiles: materializedNamespaceFiles,
    rawByPath,
    treeResponse: makeTreeResponse(rawByPath),
  };
}

function parseArtifactJson(
  payload: Awaited<ReturnType<typeof buildFetchArtifacts>>,
  fileName: string,
) {
  const artifact = payload.artifacts.find((currentArtifact) => currentArtifact.fileName === fileName);
  expect(artifact).toBeDefined();
  return JSON.parse(Buffer.from(artifact!.contentsBase64, 'base64').toString('utf8'));
}

function makeWritePayload() {
  return {
    artifacts: OUTPUT_ARTIFACT_FILE_NAMES.map((fileName) => ({
      fileName,
      contentsBase64: Buffer.from(`bytes:${fileName}\0`, 'utf8').toString('base64'),
    })),
    summary: {},
  };
}

async function makeTemporaryOutputDirectoryPath() {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'fetch-catalog-writer-'));
  temporaryOutputDirectories.add(parentDirectory);
  return join(parentDirectory, 'output');
}

async function buildMinimalArtifacts({
  namespaceFiles = new Map<string, RawContents>(),
  catalogNamespaceUrls,
  includePractices = true,
  treeResponse,
  fetchOptions = {},
}: {
  namespaceFiles?: RawFileMap;
  catalogNamespaceUrls?: string[];
  includePractices?: boolean;
  treeResponse?: ReturnType<typeof makeTreeResponse>;
  fetchOptions?: Partial<Parameters<typeof installSnapshotFetch>[0]>;
} = {}) {
  const input = makeMinimalFetchInput(
    namespaceFiles,
    catalogNamespaceUrls,
    includePractices,
  );
  const installed = installSnapshotFetch({
    rawByPath: input.rawByPath,
    ...fetchOptions,
  });
  const payload = await buildFetchArtifacts(
    { log: () => {}, warn: () => {} },
    {
      retryDelaysMs: [0, 0],
      registryEntries: MINIMAL_REGISTRY,
      treeResponse: treeResponse ?? input.treeResponse,
    },
  );
  return { ...input, ...installed, payload };
}

describe('fetch-catalog', () => {
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    await Promise.all(
      [...temporaryOutputDirectories].map((directory) => rm(directory, { recursive: true, force: true })),
    );
    temporaryOutputDirectories.clear();
  });

  it('writes exactly the allowlisted artifacts with unchanged bytes', async () => {
    const payload = makeWritePayload();
    const outputDirectory = await makeTemporaryOutputDirectoryPath();

    await writeArtifacts(payload, outputDirectory);

    await expect(
      readdir(outputDirectory).then((fileNames) => fileNames.sort()),
    ).resolves.toEqual([...OUTPUT_ARTIFACT_FILE_NAMES].sort());
    for (const artifact of payload.artifacts) {
      const writtenBytes = await readFile(join(outputDirectory, artifact.fileName));
      const expectedBytes = Buffer.from(artifact.contentsBase64, 'base64');
      expect(writtenBytes).toEqual(expectedBytes);
      expect(sha256Hex(writtenBytes)).toBe(sha256Hex(expectedBytes));
    }
  });

  it.each([
    {
      name: 'a missing artifacts section',
      payload: { summary: {} },
      message: 'fetch-catalog payload is missing required sections',
    },
    {
      name: 'an invalid artifact record',
      payload: { artifacts: [null], summary: {} },
      message: 'fetch-catalog payload contains an invalid artifact record',
    },
    {
      name: 'an unexpected artifact file name',
      payload: {
        ...makeWritePayload(),
        artifacts: [
          ...makeWritePayload().artifacts.slice(0, -1),
          { fileName: '../unexpected.json', contentsBase64: 'e30K' },
        ],
      },
      message: 'fetch-catalog payload contains an unexpected file: ../unexpected.json',
    },
    {
      name: 'a duplicate artifact file name',
      payload: {
        ...makeWritePayload(),
        artifacts: [
          ...makeWritePayload().artifacts,
          makeWritePayload().artifacts[0],
        ],
      },
      message: 'fetch-catalog payload contains a duplicate file: catalog.json',
    },
    {
      name: 'a missing allowlisted artifact',
      payload: {
        ...makeWritePayload(),
        artifacts: makeWritePayload().artifacts.slice(0, -1),
      },
      message: 'fetch-catalog payload omitted expected file: upstream-sources-metadata.json',
    },
  ])('rejects $name before creating the output directory', async ({ payload, message }) => {
    const outputDirectory = await makeTemporaryOutputDirectoryPath();

    await expect(writeArtifacts(payload, outputDirectory)).rejects.toThrow(message);
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
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
    expect(assertAllowedUpstreamRepoPath('documentation/namespaces/result.csv')).toBe(
      'documentation/namespaces/result.csv',
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
      '{\n "catalog" : { "uuid":"demo","metadata":{"title":"Grundschutz++","oscal-version":"1.1.3"}, "groups":[ ] }\n}\n',
      'utf8',
    );
    const artifact = validateFetchedCatalogArtifact(rawCatalog);

    expect(artifact.json).toEqual({
      catalog: {
        uuid: 'demo',
        metadata: { title: 'Grundschutz++', 'oscal-version': '1.1.3' },
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

  it('validates OSCAL artifacts against their expected root type', () => {
    const profileBuffer = Buffer.from(
      '{"profile":{"uuid":"demo","metadata":{"oscal-version":"1.1.3"}}}',
      'utf8',
    );
    const artifact = validateFetchedOscalArtifact(profileBuffer, 'profile');

    expect(artifact.json).toEqual({
      profile: { uuid: 'demo', metadata: { 'oscal-version': '1.1.3' } },
    });
    expect(artifact.buffer).toEqual(profileBuffer);
    expect(artifact.schemaPin.oscalVersion).toBe('1.1.3');
    expect(artifact.schemaPin.schemaFileName).toBe('oscal_profile_schema.json');
  });

  it('rejects OSCAL root-type mismatches in both directions', () => {
    const catalogBuffer = Buffer.from('{"catalog":{"uuid":"demo"}}', 'utf8');
    const profileBuffer = Buffer.from('{"profile":{"uuid":"demo"}}', 'utf8');

    expect(() => validateFetchedOscalArtifact(catalogBuffer, 'profile')).toThrow(
      'Profilwurzel muss ein JSON-Objekt sein.',
    );
    expect(() => validateFetchedOscalArtifact(profileBuffer, 'catalog')).toThrow(
      'Katalogwurzel muss ein JSON-Objekt sein.',
    );
  });

  it('rejects conflicting OSCAL roots even when the expected root exists', () => {
    const conflicting = Buffer.from(
      '{"catalog":{"uuid":"catalog"},"profile":{"uuid":"profile"}}',
      'utf8',
    );

    expect(() => validateFetchedOscalArtifact(conflicting, 'catalog')).toThrow(
      'Katalog enthält widersprüchliche OSCAL-Wurzeln: catalog, profile.',
    );
  });

  describe('OSCAL-Versionsprüfung (GSPP-283)', () => {
    function oscalBuffer(rootType: string, metadata: unknown, extra: Record<string, unknown> = {}) {
      return Buffer.from(JSON.stringify({ [rootType]: { uuid: 'demo', metadata }, ...extra }), 'utf8');
    }

    it('rejects an artifact without metadata.oscal-version fail-closed', () => {
      expect(() => validateFetchedOscalArtifact(oscalBuffer('catalog', { title: 'x' }), 'catalog'))
        .toThrow('OSCAL_VERSION_MISSING');
    });

    it('rejects an unpinned version instead of falling back to a neighbouring one', () => {
      expect(() => validateFetchedOscalArtifact(
        oscalBuffer('catalog', { 'oscal-version': '1.0.4' }),
        'catalog',
      )).toThrow('OSCAL_ROOT_VERSION_UNSUPPORTED');
    });

    it('rejects a mapping-collection below OSCAL 1.2.0 as an impossible combination', () => {
      expect(() => validateFetchedOscalArtifact(
        oscalBuffer('mapping-collection', { 'oscal-version': '1.1.3' }),
        'mapping-collection',
      )).toThrow('OSCAL_ROOT_VERSION_IMPOSSIBLE');
    });

    it('rejects a $schema directive that contradicts the declared version', () => {
      expect(() => validateFetchedOscalArtifact(
        oscalBuffer('mapping-collection', { 'oscal-version': '1.2.2' }, {
          $schema: 'http://csrc.nist.gov/ns/oscal/1.2.1/oscal-mapping-schema.json',
        }),
        'mapping-collection',
      )).toThrow('OSCAL_SCHEMA_DIRECTIVE_CONFLICT');
    });

    it('accepts the real BSI $schema directive that agrees with the declared version', () => {
      const artifact = validateFetchedOscalArtifact(
        oscalBuffer('mapping-collection', {
          // Reale BSI-Dokumentversion: kein Versionsindikator, darf nicht als solcher gelesen werden.
          version: 'gsmap-oscal-export-v1',
          'oscal-version': '1.2.1',
        }, { $schema: 'http://csrc.nist.gov/ns/oscal/1.2.1/oscal-mapping-schema.json' }),
        'mapping-collection',
      );

      expect(artifact.schemaPin.oscalVersion).toBe('1.2.1');
      expect(artifact.schemaPin.releaseTag).toBe('v1.2.1');
    });

    it('rejects a declared version that deviates from the source registry expectation', () => {
      expect(() => validateFetchedOscalArtifact(
        oscalBuffer('catalog', { 'oscal-version': '1.2.2' }),
        'catalog',
        { artifactKey: 'catalog-gspp', expectedOscalVersion: '1.1.3' },
      )).toThrow('Deklarierte OSCAL-Version weicht vom Quellregister ab');
    });
  });

  it('rejects unknown expected root types', () => {
    expect(() => validateFetchedOscalArtifact(
      Buffer.from('{"catalog":{"uuid":"demo"}}', 'utf8'),
      'plan',
    )).toThrow('Unbekannter OSCAL-Root-Typ');
  });

  it('rejects controls with a missing alt-identifier', () => {
    expect(() => validateCatalogControlIdentities({
      catalog: {
        groups: [{ controls: [{ id: 'CTRL.1', props: [] }] }],
      },
    }, 'catalog-gspp')).toThrow(
      'Datenqualitätsfehler in catalog-gspp: Control CTRL.1 hat keinen alt-identifier.',
    );
  });

  it('rejects duplicate alt-identifiers across nested catalog groups', () => {
    const duplicate = '11111111-1111-4111-8111-111111111111';
    expect(() => validateCatalogControlIdentities({
      catalog: {
        groups: [
          {
            controls: [{
              id: 'CTRL.1',
              props: [{ name: 'alt-identifier', value: duplicate }],
            }],
            groups: [{
              controls: [{
                id: 'CTRL.2',
                props: [{ name: 'alt-identifier', value: duplicate }],
              }],
            }],
          },
        ],
      },
    }, 'catalog-gspp')).toThrow(
      `alt-identifier ${duplicate} ist für CTRL.1 und CTRL.2 doppelt`,
    );
  });

  it('rejects duplicate alt-identifiers when the first control has an empty ID', () => {
    const duplicate = '11111111-1111-4111-8111-111111111111';
    expect(() => validateCatalogControlIdentities({
      catalog: {
        controls: [
          {
            id: '',
            props: [{ name: 'alt-identifier', value: duplicate }],
          },
          {
            id: 'CTRL.2',
            props: [{ name: 'alt-identifier', value: duplicate }],
          },
        ],
      },
    }, 'catalog-gspp')).toThrow(
      `alt-identifier ${duplicate} ist für <ohne ID> und CTRL.2 doppelt`,
    );
  });

  it('aborts when the upstream snapshot cannot be resolved after retries', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      return new Response('Service Unavailable', {
        status: 503,
        statusText: 'Service Unavailable',
      });
    }));

    await expect(buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      { retryDelaysMs: [0, 0], registryEntries: MINIMAL_REGISTRY },
    )).rejects.toThrow('Build abgebrochen, damit nicht ungepinnt von main geladen wird');
    expect(requests).toBe(3);
  });

  it('aborts when the default branch does not expose an exact commit SHA', async () => {
    installSnapshotFetch({
      rawByPath: new Map(),
      branchSha: 'not-a-commit',
    });

    await expect(buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      { registryEntries: MINIMAL_REGISTRY },
    )).rejects.toThrow('GitHub branch main enthält keine gültige Commit-SHA.');
  });

  it('continues with an unknown commit date when snapshot metadata is unavailable', async () => {
    const input = makeMinimalFetchInput();
    const warn = vi.fn();
    installSnapshotFetch({
      rawByPath: input.rawByPath,
      commitResponse: () => new Response('rate limited', {
        status: 429,
        statusText: 'Too Many Requests',
      }),
    });

    const payload = await buildFetchArtifacts(
      { log: () => {}, warn },
      {
        retryDelaysMs: [0, 0],
        registryEntries: MINIMAL_REGISTRY,
        treeResponse: input.treeResponse,
      },
    );
    const metadata = parseArtifactJson(payload, 'catalog-metadata.json');

    expect(metadata.source.commit_sha).toBe(SNAPSHOT_SHA);
    expect(metadata.source.commit_date).toBe('unknown');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining(`Commit-Metadaten für aufgelösten Snapshot ${SNAPSHOT_SHA} nicht laden`),
    );
  });

  it('retries transient GitHub API errors and succeeds on a later attempt', async () => {
    const input = makeMinimalFetchInput();
    const installed = installSnapshotFetch({
      rawByPath: input.rawByPath,
      repositoryResponse: (attempt) => attempt === 1
        ? new Response('temporary', { status: 503, statusText: 'Service Unavailable' })
        : jsonResponse({ default_branch: 'main' }),
    });

    const payload = await buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      {
        retryDelaysMs: [0, 0],
        registryEntries: MINIMAL_REGISTRY,
        treeResponse: input.treeResponse,
      },
    );

    expect(installed.getRepositoryAttempts()).toBe(2);
    expect(parseArtifactJson(payload, 'catalog-metadata.json').source.commit_sha).toBe(SNAPSHOT_SHA);
  });

  it('does not retry non-transient GitHub API errors', async () => {
    let requests = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      requests += 1;
      return new Response('Not Found', { status: 404, statusText: 'Not Found' });
    }));

    await expect(buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      { retryDelaysMs: [0, 0], registryEntries: MINIMAL_REGISTRY },
    )).rejects.toThrow('Build abgebrochen, damit nicht ungepinnt von main geladen wird');
    expect(requests).toBe(1);
  });

  it('truncates oversized response bodies in error messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(`<html>${'x'.repeat(60000)}</html>`, {
      status: 503,
      statusText: 'Service Unavailable',
    })));

    const error = await buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      { retryDelaysMs: [], registryEntries: MINIMAL_REGISTRY },
    ).then(
      () => new Error('buildFetchArtifacts hätte fehlschlagen müssen'),
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('gekürzt');
    expect((error as Error).message.length).toBeLessThan(1000);
  });

  it('rejects a catalog whose raw bytes do not match the tree blob SHA', async () => {
    const input = makeMinimalFetchInput();
    const treeResponse = makeTreeResponse(input.rawByPath);
    const catalogEntry = treeResponse.tree.find((entry) => entry.path === OFFICIAL_CATALOG_PATH)!;
    catalogEntry.sha = 'f'.repeat(40);
    installSnapshotFetch({ rawByPath: input.rawByPath });

    await expect(buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      {
        registryEntries: MINIMAL_REGISTRY,
        treeResponse,
      },
    )).rejects.toThrow(`Git-Blob-SHA stimmt nicht mit dem BSI-Tree überein: ${OFFICIAL_CATALOG_PATH}`);
  });

  it('rejects a catalog whose raw size does not match the tree size', async () => {
    const input = makeMinimalFetchInput();
    const treeResponse = makeTreeResponse(input.rawByPath);
    const catalogEntry = treeResponse.tree.find((entry) => entry.path === OFFICIAL_CATALOG_PATH)!;
    catalogEntry.size += 1;
    installSnapshotFetch({ rawByPath: input.rawByPath });

    await expect(buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      {
        registryEntries: MINIMAL_REGISTRY,
        treeResponse,
      },
    )).rejects.toThrow(`Dateigröße stimmt nicht mit dem BSI-Tree überein: ${OFFICIAL_CATALOG_PATH}`);
  });

  it('rejects a preview artifact root mismatch through buildFetchArtifacts', async () => {
    const previewPath = 'control_layer/WLAN/sources/profiles/WLAN-profile.json';
    const input = makeMinimalFetchInput();
    input.rawByPath.set(previewPath, '{"catalog":{"uuid":"wrong-root"}}');
    const previewRegistry = [
      ...MINIMAL_REGISTRY,
      {
        artifactKey: 'profile-wlan',
        kind: 'oscal',
        oscalVersion: '1.1.3',
        expectedRootType: 'profile',
        upstreamPath: previewPath,
        lifecycle: 'preview',
        title: 'WLAN Profil',
      },
    ] as const;
    installSnapshotFetch({ rawByPath: input.rawByPath });

    await expect(buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      {
        registryEntries: previewRegistry,
        treeResponse: makeTreeResponse(input.rawByPath),
      },
    )).rejects.toThrow('Profilwurzel muss ein JSON-Objekt sein.');
  });

  it('fails closed with a manual registry recovery hint when a registered preview artifact is missing', async () => {
    const missingPreviewPath =
      'implementation_layer/AWS Beispiel-Components/retired-component_definition.json';
    const input = makeMinimalFetchInput();
    const previewRegistry = [
      ...MINIMAL_REGISTRY,
      {
        artifactKey: 'component-retired',
        kind: 'oscal',
        oscalVersion: '1.1.2',
        expectedRootType: 'component-definition',
        upstreamPath: missingPreviewPath,
        lifecycle: 'preview',
        title: 'Retired Component',
      },
    ] as const;
    installSnapshotFetch({ rawByPath: input.rawByPath });

    await expect(buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      {
        registryEntries: previewRegistry,
        treeResponse: input.treeResponse,
      },
    )).rejects.toThrow(
      `Registriertes Artefakt fehlt im vollständigen BSI-Tree: ${missingPreviewPath}. Quellregister manuell gegen den gepinnten BSI-Snapshot prüfen; keine automatische Pfadfreigabe.`,
    );
  });

  it('emits catalog.json with exact upstream bytes and local build metadata', async () => {
    vi.stubEnv('GITHUB_RUN_ID', undefined);
    vi.stubEnv('GITHUB_REPOSITORY', undefined);
    vi.stubEnv('GITHUB_SERVER_URL', undefined);
    const { catalogText, payload } = await buildMinimalArtifacts();
    const rawCatalogBuffer = Buffer.from(catalogText, 'utf8');
    const catalogArtifact = payload.artifacts.find((artifact) => artifact.fileName === 'catalog.json');
    const metadata = parseArtifactJson(payload, 'catalog-metadata.json');

    expect(catalogArtifact).toBeDefined();
    expect(Buffer.from(catalogArtifact!.contentsBase64, 'base64')).toEqual(rawCatalogBuffer);
    expect(metadata.artifactKey).toBe('catalog-gspp');
    expect(metadata.integrity.sha256).toBe(sha256Hex(rawCatalogBuffer));
    expect(metadata.integrity.size_bytes).toBe(rawCatalogBuffer.length);
    expect(metadata.source.git_blob_sha).toBe(gitBlobSha(rawCatalogBuffer));
    expect(metadata.source.upstream_sha256).toBe(metadata.integrity.sha256);
    expect(metadata.build.workflow_run_id).toBe('local');
    expect(metadata.build.workflow_run_url).toBeNull();
  });

  it('rejects duplicate Practice UUIDs before emitting artifacts', async () => {
    await expect(buildMinimalArtifacts({
      namespaceFiles: new Map([
        [
          PRACTICES_NAMESPACE_PATH,
          'Kürzel,Begriff,Definition,UUID\nGC,Governance,Definition,practice-uuid-1\nISMS,Management,Definition,practice-uuid-1\n',
        ],
      ]),
    })).rejects.toThrow('Practice-UUID-Integrität');
  });

  it('rejects missing or unmatched practices.csv coverage before emitting artifacts', async () => {
    await expect(buildMinimalArtifacts({
      includePractices: false,
    })).rejects.toThrow('practices.csv fehlt');

    await expect(buildMinimalArtifacts({
      namespaceFiles: new Map([
        [
          PRACTICES_NAMESPACE_PATH,
          'Kürzel,Begriff,Definition,UUID\nGC,Governance,Definition,unmatched-practice-uuid\n',
        ],
      ]),
    })).rejects.toThrow('Practice-UUID-Integrität');
  });

  it('emits a workflow run URL only when GitHub Actions metadata is present', async () => {
    vi.stubEnv('GITHUB_RUN_ID', '12345');
    vi.stubEnv('GITHUB_REPOSITORY', 'dfurater/Grundschutz-Navigator');
    vi.stubEnv('GITHUB_SERVER_URL', 'https://github.example.test');
    const { payload } = await buildMinimalArtifacts();
    const metadata = parseArtifactJson(payload, 'catalog-metadata.json');

    expect(metadata.build.workflow_run_id).toBe('12345');
    expect(metadata.build.workflow_run_url).toBe(
      'https://github.example.test/dfurater/Grundschutz-Navigator/actions/runs/12345',
    );
  });

  it('materializes every direct namespace CSV even when the catalog does not reference it', async () => {
    const unreferencedPath = 'documentation/namespaces/security_targets_levels.csv';
    const nestedPath = 'documentation/namespaces/nested/ignored.csv';
    const readmePath = 'documentation/namespaces/readme.md';
    const namespaceFiles = new Map<string, RawContents>([
      ['documentation/namespaces/result.csv', 'Ergebnis,Definition\nVerfahren,Ein Verfahren\n'],
      [
        unreferencedPath,
        'Wert,Definition\n0,Keine Relevanz\n1,Mittlere Relevanz\n2,Höchste Relevanz\n',
      ],
    ]);
    const input = makeMinimalFetchInput(namespaceFiles, [RESULT_NAMESPACE_URL]);
    const treeResponse = makeTreeResponse(input.rawByPath, [
      makeTreeEntry(nestedPath, 'Wert,Definition\nnested,Nicht erlaubt\n'),
      makeTreeEntry(readmePath, '# Kein Vokabular\n'),
    ]);

    const { payload, fetchMock } = await buildMinimalArtifacts({
      namespaceFiles,
      catalogNamespaceUrls: [RESULT_NAMESPACE_URL],
      treeResponse,
    });
    const vocabularies = parseArtifactJson(payload, 'vocabularies.json');
    const upstreamMetadata = parseArtifactJson(payload, 'upstream-sources-metadata.json');
    const materializedPaths = [
      PRACTICES_NAMESPACE_PATH,
      'documentation/namespaces/result.csv',
      unreferencedPath,
      TOPICS_NAMESPACE_PATH,
    ];

    expect(vocabularies.namespaces.map((namespace) => namespace.source.path)).toEqual(
      materializedPaths,
    );
    expect(
      vocabularies.namespaces.find(
        (namespace) => namespace.source.path === unreferencedPath,
      ),
    ).toMatchObject({
      valueColumn: 'Wert',
      definitionColumn: 'Definition',
      entries: [
        { value: '0', definition: 'Keine Relevanz' },
        { value: '1', definition: 'Mittlere Relevanz' },
        { value: '2', definition: 'Höchste Relevanz' },
      ],
    });
    expect(upstreamMetadata.files.map((file) => file.path)).toEqual(materializedPaths);
    expect(
      upstreamMetadata.manifest.files
        .filter((file) => file.rootType === 'vocabulary')
        .map((file) => file.path),
    ).toEqual(materializedPaths);

    const requestedUrls = fetchMock.mock.calls.map(([request]) => inputUrl(request));
    expect(requestedUrls).toContain(rawUrl(unreferencedPath));
    expect(requestedUrls).not.toContain(rawUrl(nestedPath));
    expect(requestedUrls).not.toContain(rawUrl(readmePath));
  });

  it('fetches namespace files in parallel while preserving deterministic artifact order', async () => {
    const namespaceFiles = new Map<string, RawContents>([
      ['documentation/namespaces/result.csv', 'Ergebnis,Definition\nVerfahren,Ein Verfahren\n'],
      ['documentation/namespaces/action_words.csv', 'Infinitiv,Definition\numsetzen,Etwas umsetzen\n'],
    ]);
    const input = makeMinimalFetchInput(namespaceFiles);
    const pendingNamespaceResponses: Array<() => void> = [];
    let markBothNamespaceDownloadsStarted: () => void = () => {};
    const bothNamespaceDownloadsStarted = new Promise<void>((resolve) => {
      markBothNamespaceDownloadsStarted = resolve;
    });
    installSnapshotFetch({
      rawByPath: input.rawByPath,
      rawResponse: (path, contents) => {
        if (path === OFFICIAL_CATALOG_PATH) return responseWithContents(contents);
        return new Promise<Response>((resolve) => {
          pendingNamespaceResponses.push(() => resolve(responseWithContents(contents)));
          if (pendingNamespaceResponses.length === input.namespaceFiles.size) {
            markBothNamespaceDownloadsStarted();
            pendingNamespaceResponses.forEach((release) => release());
          }
        });
      },
    });

    const payloadPromise = buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      {
        registryEntries: MINIMAL_REGISTRY,
        treeResponse: input.treeResponse,
      },
    );
    const namespaceStartResult = await Promise.race([
      bothNamespaceDownloadsStarted.then(() => 'both-started'),
      new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
    ]);
    expect(namespaceStartResult).toBe('both-started');

    const payload = await payloadPromise;
    const vocabularies = parseArtifactJson(payload, 'vocabularies.json');
    const upstreamMetadata = parseArtifactJson(payload, 'upstream-sources-metadata.json');

    expect(vocabularies.namespaces.map((namespace) => namespace.source.path)).toEqual([
      'documentation/namespaces/action_words.csv',
      PRACTICES_NAMESPACE_PATH,
      'documentation/namespaces/result.csv',
      TOPICS_NAMESPACE_PATH,
    ]);
    expect(upstreamMetadata.files.map((file) => file.path)).toEqual([
      'documentation/namespaces/action_words.csv',
      PRACTICES_NAMESPACE_PATH,
      'documentation/namespaces/result.csv',
      TOPICS_NAMESPACE_PATH,
    ]);
    const vocabulariesArtifact = payload.artifacts.find(
      (artifact) => artifact.fileName === 'vocabularies.json',
    )!;
    const vocabulariesBuffer = Buffer.from(vocabulariesArtifact.contentsBase64, 'base64');
    expect(upstreamMetadata.integrity.sha256).toBe(sha256Hex(vocabulariesBuffer));
    expect(upstreamMetadata.integrity.size_bytes).toBe(vocabulariesBuffer.length);
    expect(upstreamMetadata.manifest.schemaVersion).toBe(2);
    expect(upstreamMetadata.manifest.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(upstreamMetadata.taxonomyCoverage.topics).toMatchObject({
      catalogTopicCount: 1,
      distinctCatalogUuidCount: 1,
      csvEntryCount: 1,
      matchedCatalogTopicCount: 1,
      unmatchedCatalogTopicCount: 0,
      orphanCsvEntryCount: 0,
      missingCatalogUuidCount: 0,
      duplicateCsvUuidCount: 0,
    });
  });

  it('validates the full registry without shipping extra artifacts or fetching unclassified paths', async () => {
    const unclassifiedPath = 'control_layer/Kernel/unclassified-catalog.json';
    const namespacePath = 'documentation/namespaces/result.csv';
    const rawByPath = new Map<string, RawContents>();

    for (const entry of SOURCE_REGISTRY) {
      if (entry.kind !== 'oscal') continue;
      rawByPath.set(
        entry.upstreamPath,
        entry.upstreamPath === OFFICIAL_CATALOG_PATH
          ? makeCatalogText([RESULT_NAMESPACE_URL])
          : makeOscalDocumentText(entry.expectedRootType, entry.oscalVersion, {
              uuid: entry.artifactKey,
            }),
      );
    }
    rawByPath.set(namespacePath, 'Ergebnis,Definition\nVerfahren,Ein Verfahren\n');
    rawByPath.set(PRACTICES_NAMESPACE_PATH, PRACTICES_CSV);
    rawByPath.set(TOPICS_NAMESPACE_PATH, TOPICS_CSV);
    const unclassifiedContents = '{"catalog":{"uuid":"unclassified"}}\n';
    const treeResponse = makeTreeResponse(rawByPath, [
      makeTreeEntry(unclassifiedPath, unclassifiedContents),
    ]);
    const { fetchMock } = installSnapshotFetch({ rawByPath });

    const payload = await buildFetchArtifacts(
      { log: () => {}, warn: () => {} },
      { registryEntries: SOURCE_REGISTRY, treeResponse },
    );
    const requestedUrls = fetchMock.mock.calls.map(([input]) => inputUrl(input));

    expect(payload.artifacts.map((artifact) => artifact.fileName)).toEqual([
      'catalog.json',
      'catalog-metadata.json',
      'vocabularies.json',
      'upstream-sources-metadata.json',
    ]);
    expect(requestedUrls).not.toContain(rawUrl(unclassifiedPath));
    const manifest = parseArtifactJson(payload, 'upstream-sources-metadata.json').manifest;
    expect(manifest.files).toHaveLength(
      SOURCE_REGISTRY.filter((entry) => entry.kind === 'oscal').length + 3,
    );
    expect(manifest.files.some((file) => file.path === unclassifiedPath)).toBe(false);
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
        metadata: { props: [{ name: 'ignore-me', ns: 'http://csrc.nist.gov/ns/oscal/1.0' }] },
        groups: [{
          controls: [{
            props: [
              { name: 'result', value: 'Verfahren', ns: RESULT_NAMESPACE_URL },
              { name: 'result', value: 'Verfahren', ns: RESULT_NAMESPACE_URL },
              { name: 'action', value: 'umsetzen', ns: ACTION_WORDS_NAMESPACE_URL },
            ],
          }],
        }],
      },
    };

    expect(extractReferencedNamespaceUrls(
      catalog,
      'BSI-Bund/Stand-der-Technik-Bibliothek',
    )).toEqual([ACTION_WORDS_NAMESPACE_URL, RESULT_NAMESPACE_URL]);
  });

  it('rejects external HTTP(S) CSV namespace hosts', () => {
    expect(() => extractReferencedNamespaceUrls({
      catalog: {
        groups: [{ controls: [{ props: [{ ns: 'https://evil.example/namespaces/result.csv' }] }] }],
      },
    }, 'BSI-Bund/Stand-der-Technik-Bibliothek')).toThrow(
      'Externe oder nicht erlaubte Namespace-Quelle: https://evil.example/namespaces/result.csv',
    );
  });

  it('maps GitHub namespace URLs back to repository-relative paths', () => {
    expect(namespaceUrlToRepoPath(
      RESULT_NAMESPACE_URL,
      'BSI-Bund/Stand-der-Technik-Bibliothek',
    )).toBe('documentation/namespaces/result.csv');
    expect(namespaceUrlToRepoPath(
      'http://csrc.nist.gov/ns/oscal/1.0',
      'BSI-Bund/Stand-der-Technik-Bibliothek',
    )).toBeNull();
  });

  it('parses quoted CSV fields with embedded newlines and escaped quotes', () => {
    expect(parseCsv(
      'Begriff,Definition\r\nnormal-SdT,"Zeile 1\nZeile ""2"""',
    )).toEqual([
      ['Begriff', 'Definition'],
      ['normal-SdT', 'Zeile 1\nZeile "2"'],
    ]);
  });

  it('keeps official headers and exposes exact lookup metadata for a namespace CSV', () => {
    const parsed = parseVocabularyCsv('Aufwand,Definition\r\n3,"Mehrere Wochen bis Monate"');
    expect(parsed.columnOrder).toEqual(['Aufwand', 'Definition']);
    expect(parsed.valueColumn).toBe('Aufwand');
    expect(parsed.definitionColumn).toBe('Definition');
    expect(parsed.entries).toEqual([{
      value: '3',
      definition: 'Mehrere Wochen bis Monate',
      columns: { Aufwand: '3', Definition: 'Mehrere Wochen bis Monate' },
    }]);
  });

  it('preserves UUID and user-facing practice columns while parsing practices.csv', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl:
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/practices.csv',
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'documentation/namespaces/practices.csv',
      gitBlobSha: 'b'.repeat(40),
      csvText:
        'Kürzel,Begriff,Definition,UUID,Schwerpunkt,Nummerierung,auch bekannt als\nGC,Governance und Compliance,Definition,uuid-practice-1,Methodik,1,Corporate Governance\n',
    });

    expect(namespace.entries[0]).toMatchObject({
      value: 'GC',
      definition: 'Definition',
      columns: {
        UUID: 'uuid-practice-1',
        Schwerpunkt: 'Methodik',
        Nummerierung: '1',
        'auch bekannt als': 'Corporate Governance',
      },
    });
  });

  it('preserves topic UUIDs while parsing topics.csv', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl:
        'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/topics.csv',
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'documentation/namespaces/topics.csv',
      gitBlobSha: 'c'.repeat(40),
      csvText:
        'Begriff,Definition,UUID\nOrganisation,Offizielle Definition,uuid-topic-1\n',
    });

    expect(namespace).toMatchObject({
      valueColumn: 'Begriff',
      definitionColumn: 'Definition',
      entries: [{
        value: 'Organisation',
        definition: 'Offizielle Definition',
        columns: { UUID: 'uuid-topic-1' },
      }],
    });
  });

  it('uses the first official CSV column as the exact lookup key', () => {
    const namespace = buildVocabularyNamespaceData({
      namespaceUrl: ACTION_WORDS_NAMESPACE_URL,
      repository: 'BSI-Bund/Stand-der-Technik-Bibliothek',
      path: 'documentation/namespaces/action_words.csv',
      gitBlobSha: 'b'.repeat(40),
      csvText: 'Infinitiv,Definition\r\numsetzen,"Etwas umsetzen"',
    });

    expect(namespace.source.routeId).toBe('documentation-namespaces-action-words');
    expect(namespace.valueColumn).toBe('Infinitiv');
    expect(namespace.entries).toEqual([{
      value: 'umsetzen',
      definition: 'Etwas umsetzen',
      columns: { Infinitiv: 'umsetzen', Definition: 'Etwas umsetzen' },
    }]);
  });
});

describe('upstream manifest v2', () => {
  const catalogFile = {
    artifactKey: 'catalog-gspp',
    rootType: 'catalog',
    lifecycle: 'supported',
    path: OFFICIAL_CATALOG_PATH,
    gitBlobSha: 'b'.repeat(40),
    contentSha256: 'c'.repeat(64),
  };
  const namespaceFile = {
    artifactKey: 'namespaces-bsi',
    rootType: 'vocabulary',
    lifecycle: 'supported',
    path: 'documentation/namespaces/result.csv',
    gitBlobSha: 'd'.repeat(40),
    contentSha256: 'e'.repeat(64),
  };

  it('builds a canonical v2 manifest from complete artifact provenance', () => {
    const manifest = buildUpstreamManifest({
      repository: OFFICIAL_BSI_REPOSITORY_URL,
      snapshotCommitSha: SNAPSHOT_SHA,
      files: [namespaceFile, catalogFile],
    });

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.repository).toBe(OFFICIAL_BSI_REPOSITORY_URL);
    expect(manifest.files).toEqual([catalogFile, namespaceFile]);
    expect(manifest.signatureSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the signature when only artifact content provenance changes', () => {
    const unchanged = buildUpstreamManifest({
      repository: OFFICIAL_BSI_REPOSITORY_URL,
      snapshotCommitSha: SNAPSHOT_SHA,
      files: [catalogFile, namespaceFile],
    });
    const changed = buildUpstreamManifest({
      repository: OFFICIAL_BSI_REPOSITORY_URL,
      snapshotCommitSha: SNAPSHOT_SHA,
      files: [catalogFile, { ...namespaceFile, contentSha256: 'f'.repeat(64) }],
    });

    expect(changed.signatureSha256).not.toBe(unchanged.signatureSha256);
  });
});
