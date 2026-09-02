import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { CatalogProvider } from './CatalogContext';
import { CATALOG_LOAD_MEASURES } from './catalogMeasurements';
import { useCatalog } from '@/hooks/useCatalog';
import { createStartupCatalogSource } from '@/test/fixtures/startupCatalog';

const catalogSource = createStartupCatalogSource('catalog-react-render-measurement');

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
