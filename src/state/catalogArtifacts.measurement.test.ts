import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATALOG_LOAD_MEASURES } from './catalogMeasurements';
import { loadCatalogArtifacts } from './catalogArtifacts';
import { createStartupCatalogSource } from '@/test/fixtures/startupCatalog';

const catalogSource = createStartupCatalogSource('catalog-startup-measurement');

describe('loadCatalogArtifacts — Startup-Messpunkte', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const name of Object.values(CATALOG_LOAD_MEASURES)) {
      performance.clearMeasures(name);
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('separates artifact download, JSON parse, and domain parsing in User Timing', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input) === '/catalog.json') {
        return new Response(JSON.stringify(catalogSource), { status: 200 });
      }
      return new Response(null, { status: 404, statusText: 'Not Found' });
    });

    const result = await loadCatalogArtifacts({
      catalogKey: 'gspp',
      dataUrl: '/catalog.json',
      metadataUrl: '/catalog-metadata.json',
      isEntryCatalog: true,
    });

    expect(result?.catalogDocument.view.controlsById.get('G.1')?.title).toBe('Kontrolle');
    expect(performance.getEntriesByName(CATALOG_LOAD_MEASURES.download, 'measure')).toHaveLength(1);
    expect(performance.getEntriesByName(CATALOG_LOAD_MEASURES.jsonParse, 'measure')).toHaveLength(1);
    expect(performance.getEntriesByName(CATALOG_LOAD_MEASURES.domainParse, 'measure')).toHaveLength(1);
  });
});
