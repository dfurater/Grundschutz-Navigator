import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CatalogProvider } from './CatalogContext';
import { CATALOG_LOAD_MEASURES } from './catalogMeasurements';
import { useCatalog } from '@/hooks/useCatalog';

const catalogSource = {
  catalog: {
    uuid: 'catalog-react-render-measurement',
    metadata: {
      title: 'Messkatalog',
      'last-modified': '2026-09-02T00:00:00Z',
      version: '1.0.0',
      'oscal-version': '1.1.3',
    },
    groups: [
      {
        id: 'G',
        title: 'Gruppe',
        controls: [
          {
            id: 'G.1',
            title: 'Kontrolle',
            props: [{ name: 'alt-identifier', value: 'control-g-1' }],
            parts: [{ name: 'statement', prose: 'Die Kontrolle MUSS umgesetzt werden.' }],
          },
        ],
      },
    ],
  },
};

describe('CatalogProvider — Startup-Messpunkte', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    performance.clearMeasures(CATALOG_LOAD_MEASURES.reactRender);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records React rendering after the entry catalog state becomes visible', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/catalog.json') {
        return new Response(JSON.stringify(catalogSource), { status: 200 });
      }
      return new Response(null, { status: 404, statusText: 'Not Found' });
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
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
      expect(result.current.catalog?.controlsById.get('G.1')).toBeDefined();
    });

    expect(performance.getEntriesByName(CATALOG_LOAD_MEASURES.reactRender, 'measure')).toHaveLength(1);
  });
});
