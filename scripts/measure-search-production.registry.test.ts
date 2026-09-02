// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

// Simuliert Greptiles Reproduktion (GSPP-218): Kataloge im Quellregister sind
// umbenannt (lieferkette → supplychain) und der Einstiegskatalog ist nicht
// mehr gspp. Vorher prüfte der Runner fest codierte Dateinamen und schrieb
// immer catalogKey: 'gspp' ins Ergebnisartefakt — beides lief am Register
// vorbei und wäre bei dieser Umbenennung stillschweigend falsch geblieben.
vi.mock('../src/domain/sourceRegistry.mjs', () => ({
  ENTRY_CATALOG_KEY: 'alpha',
  listCatalogArtifactFileNames: () => [
    'catalog.json',
    'catalog-metadata.json',
    'catalog-supplychain.json',
    'catalog-supplychain-metadata.json',
  ],
}));

describe('measure-search-production Registry-Kopplung', () => {
  it('leitet benötigte Katalogartefakte aus dem Quellregister ab', async () => {
    const { requiredCatalogArtifactPaths } = await import('./measure-search-production.mjs');

    expect(requiredCatalogArtifactPaths()).toEqual([
      'public/data/catalog.json',
      'public/data/catalog-metadata.json',
      'public/data/catalog-supplychain.json',
      'public/data/catalog-supplychain-metadata.json',
    ]);
  });

  it('schreibt den Ergebnis-Katalogschlüssel aus dem Quellregister, nicht fest codiert', async () => {
    const { buildMeasurementOutput } = await import('./measure-search-production.mjs');

    const output = buildMeasurementOutput({
      snapshotSha: 'deadbeef',
      chromiumVersion: 'Chromium/1',
      desktop: { summary: {} },
      mobile: { summary: {} },
    });

    expect(output.catalogKey).toBe('alpha');
  });
});
