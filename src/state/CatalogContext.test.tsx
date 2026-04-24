import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  VocabularyProvenance,
  VocabularyRegistryData,
} from '@/domain/models';
import { CatalogProvider } from './CatalogContext';
import { useCatalog } from '@/hooks/useCatalog';

const securityNamespace =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/security_level.csv';
const modalNamespace =
  'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek/tree/main/Dokumentation/namespaces/modal_verbs.csv';

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
                  {
                    name: 'sec_level',
                    value: 'erhöht',
                    ns: securityNamespace,
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
  },
};

const vocabularyRegistryData: VocabularyRegistryData = {
  sourceCommitSha: 'snapshot-123',
  namespaces: [
    {
      source: {
        namespace: securityNamespace,
        repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
        path: 'Dokumentation/namespaces/security_level.csv',
        fileName: 'security_level.csv',
        routeId: 'dokumentation-namespaces-security-level',
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
        path: 'Dokumentation/namespaces/modal_verbs.csv',
        fileName: 'modal_verbs.csv',
        routeId: 'dokumentation-namespaces-modal-verbs',
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

const vocabularyProvenance: VocabularyProvenance = {
  source: {
    repository: 'https://github.com/BSI-Bund/Stand-der-Technik-Bibliothek',
    snapshotCommitSha: 'snapshot-123',
    catalogPath: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
    files: [
      {
        kind: 'catalog',
        path: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
        gitBlobSha: 'blob-catalog',
      },
      {
        kind: 'namespace',
        path: 'Dokumentation/namespaces/security_level.csv',
        namespace: securityNamespace,
        gitBlobSha: 'blob-security',
      },
    ],
    signatureSha256: 'signature-123',
  },
  integrity: {
    sha256: 'sha-vocab',
    size_bytes: 42,
    fetched_at: '2026-03-27T12:00:00Z',
  },
  build: {
    workflow_run_id: 'local',
    workflow_run_url: null,
    runner_environment: 'local',
  },
};

describe('CatalogProvider', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads catalog and vocabulary artifacts together without external runtime fetches', async () => {
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
                file: 'Anwenderkataloge/Grundschutz++/Grundschutz++-catalog.json',
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
          return new Response(JSON.stringify(vocabularyRegistryData), {
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
    expect(result.current.vocabularyProvenance?.source.signatureSha256).toBe('signature-123');
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
});
