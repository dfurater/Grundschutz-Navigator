import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VocabularyProvenance,
  VocabularyRegistryData,
} from '@/domain/models';
import { CatalogProvider } from './CatalogContext';
import { computeSHA256 } from '@/domain/integrity';
import { useCatalog } from '@/hooks/useCatalog';
import { SUPPORTED_CATALOG_KEY } from '@/domain/sourceRegistry';
import { countPropRemarks } from '@/test/oscalStructure';

const securityNamespace =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/security_level.csv';
const modalNamespace =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/documentation/namespaces/modal_verbs.csv';

const rawCatalogDocument = {
  catalog: {
    uuid: 'catalog-1',
    metadata: {
      title: 'Anwenderkatalog Grundschutz++',
      'last-modified': '2026-03-27T00:00:00Z',
      version: '1.0.0',
      'oscal-version': '1.1.3',
    },
    groups: [
      {
        id: 'GC',
        title: 'Governance und Compliance',
        groups: [
          {
            id: 'GC.1',
            title: 'Strategie',
            controls: [
              {
                id: 'GC.1.1',
                title: 'Kontrolle',
                props: [
                  { name: 'alt-identifier', value: 'uuid-gc-1-1' },
                  {
                    name: 'sec_level',
                    value: 'erhöht',
                    ns: securityNamespace,
                    remarks: 'Nur im Quellgraphen erhalten.',
                  },
                ],
                links: [
                  {
                    href: '#gc-1-2',
                    rel: 'reference',
                    'resource-fragment': 'abschnitt-1',
                  },
                ],
                parts: [
                  {
                    name: 'statement',
                    prose: 'Eine Kontrolle MUSS umgesetzt werden.',
                    props: [
                      {
                        name: 'modal_verb',
                        value: 'MUSS',
                        ns: modalNamespace,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    'back-matter': {
      resources: [{ uuid: 'resource-ohne-inhalt' }],
    },
    'x-unbekanntes-feld': ['bleibt', 'erhalten'],
  },
};

const vocabularyRegistryData: VocabularyRegistryData = {
  sourceCommitSha: 'snapshot-123',
  namespaces: [
    {
      source: {
        namespace: securityNamespace,
        repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
        path: 'documentation/namespaces/security_level.csv',
        fileName: 'security_level.csv',
        routeId: 'documentation-namespaces-security-level',
        gitBlobSha: 'blob-security',
      },
      columnOrder: ['Begriff', 'Definition'],
      valueColumn: 'Begriff',
      definitionColumn: 'Definition',
      entries: [
        {
          value: 'erhöht',
          definition: 'Erhöhte Sicherheitsstufe',
          columns: {
            Begriff: 'erhöht',
            Definition: 'Erhöhte Sicherheitsstufe',
          },
        },
      ],
    },
    {
      source: {
        namespace: modalNamespace,
        repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
        path: 'documentation/namespaces/modal_verbs.csv',
        fileName: 'modal_verbs.csv',
        routeId: 'documentation-namespaces-modal-verbs',
        gitBlobSha: 'blob-modal',
      },
      columnOrder: ['Modalverb', 'Definition'],
      valueColumn: 'Modalverb',
      definitionColumn: 'Definition',
      entries: [
        {
          value: 'MUSS',
          definition: 'Verbindliche Anforderung',
          columns: {
            Modalverb: 'MUSS',
            Definition: 'Verbindliche Anforderung',
          },
        },
      ],
    },
  ],
};

function makeVocabularyProvenance(sha256: string, sizeBytes: number): VocabularyProvenance {
  return {
    source: {
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      catalogPath: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
      snapshotCommitSha: 'snapshot-123',
      snapshotCommitDate: '2026-03-26T00:00:00Z',
    },
    manifest: {
      schemaVersion: 2,
      repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
      snapshotCommitSha: 'snapshot-123',
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
          contentSha256: 'csv-hash-security',
        },
      ],
      signatureSha256: 'signature-123',
    },
    files: [
      {
        namespace: securityNamespace,
        path: 'documentation/namespaces/security_level.csv',
        fileName: 'security_level.csv',
        routeId: 'documentation-namespaces-security-level',
        gitBlobSha: 'blob-security',
        sha256: 'csv-hash-security',
        sizeBytes: 64,
      },
    ],
    integrity: {
      sha256,
      size_bytes: sizeBytes,
      fetched_at: '2026-03-27T12:00:00Z',
    },
    build: {
      workflow_run_id: 'local',
      workflow_run_url: null,
      runner_environment: 'local',
    },
  };
}

describe('CatalogProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads catalog and vocabulary artifacts together without external runtime fetches', async () => {
    const vocabularyResponseText = JSON.stringify(vocabularyRegistryData);
    const vocabularyResponseBytes = new TextEncoder().encode(vocabularyResponseText);
    const vocabularyProvenance = makeVocabularyProvenance(
      await computeSHA256(vocabularyResponseBytes.buffer as ArrayBuffer),
      vocabularyResponseBytes.byteLength,
    );

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input) => {
        const url = String(input);

        if (url === '/catalog.json') {
          return new Response(JSON.stringify(rawCatalogDocument), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url === '/catalog-metadata.json') {
          return new Response(
            JSON.stringify({
              source: {
                repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
                file: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
                commit_sha: 'snapshot-123',
                git_blob_sha: 'blob-catalog',
              },
              integrity: {
                sha256: 'bad-hash-for-test',
                size_bytes: 42,
                fetched_at: '2026-03-27T12:00:00Z',
              },
              build: {
                workflow_run_id: 'local',
                workflow_run_url: null,
                runner_environment: 'local',
              },
            }),
            {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            },
          );
        }

        if (url === '/vocabularies.json') {
          return new Response(vocabularyResponseText, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        if (url === '/upstream-sources-metadata.json') {
          return new Response(JSON.stringify(vocabularyProvenance), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        return new Response(null, { status: 404, statusText: 'Not Found' });
      },
    );

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CatalogProvider
        catalogUrl="/catalog.json"
        metadataUrl="/catalog-metadata.json"
        vocabulariesUrl="/vocabularies.json"
        upstreamSourcesMetadataUrl="/upstream-sources-metadata.json"
      >
        {children}
      </CatalogProvider>
    );

    const { result } = renderHook(() => useCatalog(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.catalog?.controlsById.has('GC.1.1')).toBe(true);
      expect(result.current.vocabularyRegistry?.namespacesByUrl.has(securityNamespace)).toBe(true);
    });

    expect(
      result.current.vocabularyRegistry?.namespacesByUrl
        .get(securityNamespace)
        ?.entriesByValue.get('erhöht')
        ?.definition,
    ).toBe('Erhöhte Sicherheitsstufe');
    expect(result.current.vocabularyProvenance?.manifest.signatureSha256).toBe('signature-123');
    expect(result.current.vocabularyVerification?.valid).toBe(true);
    expect(result.current.vocabularyVerification?.sourceCommit).toBe('snapshot-123');
    expect(result.current.vocabularyVerification?.fetchedAt).toBe('2026-03-27T12:00:00Z');
    expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual([
      '/catalog.json',
      '/vocabularies.json',
      '/upstream-sources-metadata.json',
      '/catalog-metadata.json',
    ]);
  });

  it('keeps the catalog usable when vocabulary artifacts are missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url === '/catalog.json') {
        return new Response(JSON.stringify(rawCatalogDocument), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404, statusText: 'Not Found' });
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CatalogProvider
        catalogUrl="/catalog.json"
        metadataUrl="/catalog-metadata.json"
        vocabulariesUrl="/vocabularies.json"
        upstreamSourcesMetadataUrl="/upstream-sources-metadata.json"
      >
        {children}
      </CatalogProvider>
    );

    const { result } = renderHook(() => useCatalog(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.catalog?.controlsById.has('GC.1.1')).toBe(true);
    });

    expect(result.current.vocabularyRegistry).toBeNull();
    expect(result.current.vocabularyProvenance).toBeNull();
  });

  it('hält den Quellgraphen des Katalogs neben dem Domänenmodell (ADR-2 §1)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url === '/catalog.json') {
        return new Response(JSON.stringify(rawCatalogDocument), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404, statusText: 'Not Found' });
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CatalogProvider
        catalogUrl="/catalog.json"
        metadataUrl="/catalog-metadata.json"
        vocabulariesUrl="/vocabularies.json"
        upstreamSourcesMetadataUrl="/upstream-sources-metadata.json"
      >
        {children}
      </CatalogProvider>
    );

    const { result } = renderHook(() => useCatalog(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.catalogDocument?.view).toBeDefined();
    });

    const document = result.current.catalogDocument;

    // Das Domänenmodell ist die Projektion desselben Dokuments, keine Kopie.
    expect(result.current.catalog).toBe(document?.view);

    // §2: Der Kontext wird explizit geführt, nicht aus dem Dokument geraten.
    expect(document?.context.catalogKey).toBe(SUPPORTED_CATALOG_KEY);

    // §0/§1: Der Quellgraph überlebt den gesamten Ladepfad unverändert.
    expect(JSON.stringify(document?.source)).toBe(JSON.stringify(rawCatalogDocument));
    expect(countPropRemarks(document?.source)).toBe(1);
  });

  /* ---------------------------------------------------------------- */
  /*  Vertrauensklasse (ADR-2 §10)                                    */
  /* ---------------------------------------------------------------- */

  async function renderWithCatalogMetadata(
    metadata: Record<string, unknown> | null,
  ) {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);

      if (url === '/catalog.json') {
        return new Response(JSON.stringify(rawCatalogDocument), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      if (url === '/catalog-metadata.json' && metadata) {
        return new Response(JSON.stringify(metadata), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(null, { status: 404, statusText: 'Not Found' });
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <CatalogProvider
        catalogUrl="/catalog.json"
        metadataUrl="/catalog-metadata.json"
        vocabulariesUrl="/vocabularies.json"
        upstreamSourcesMetadataUrl="/upstream-sources-metadata.json"
      >
        {children}
      </CatalogProvider>
    );

    const { result } = renderHook(() => useCatalog(), { wrapper });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.catalogDocument?.view).toBeDefined();
    });

    return result;
  }

  function makeCatalogProvenance(sha256: string, sizeBytes: number) {
    return {
      source: {
        repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
        file: 'control_layer/Grundschutz++/Grundschutz++-resolved_catalog.json',
        commit_sha: 'snapshot-123',
        git_blob_sha: 'blob-catalog',
      },
      integrity: {
        sha256,
        size_bytes: sizeBytes,
        fetched_at: '2026-03-27T12:00:00Z',
      },
      build: {
        workflow_run_id: 'local',
        workflow_run_url: null,
        runner_environment: 'local',
      },
    };
  }

  it('führt den Katalog erst nach bestandener Hashprüfung als verifiziert', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(rawCatalogDocument));
    const provenance = makeCatalogProvenance(
      await computeSHA256(bytes.buffer as ArrayBuffer),
      bytes.byteLength,
    );

    const result = await renderWithCatalogMetadata(provenance);

    expect(result.current.verification?.valid).toBe(true);
    expect(result.current.catalogDocument?.context.trustClass).toBe(
      'class-1-verified-public',
    );
  });

  it('führt den Katalog nicht als verifiziert, wenn der Hash nicht passt', async () => {
    const provenance = makeCatalogProvenance('bad-hash-for-test', 42);

    const result = await renderWithCatalogMetadata(provenance);

    expect(result.current.verification?.valid).toBe(false);
    expect(result.current.catalogDocument?.context.trustClass).toBe(
      'class-1-unverified-public',
    );
  });

  it('führt den Katalog nicht als verifiziert, wenn die Integritätsmetadaten fehlen', async () => {
    const result = await renderWithCatalogMetadata(null);

    expect(result.current.provenance).toBeNull();
    expect(result.current.verification).toBeNull();
    expect(result.current.catalogDocument?.context.trustClass).toBe(
      'class-1-unverified-public',
    );
  });
});
