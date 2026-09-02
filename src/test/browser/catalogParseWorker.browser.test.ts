import { expect, test, vi } from 'vitest';
import { parseCatalogInWorker } from '@/state/catalogParseWorker';
import { createStartupCatalogSource } from '@/test/fixtures/startupCatalog';

const source = createStartupCatalogSource('catalog-browser-worker');

test('parst den Klasse-1-Katalog im Modul-Worker statt im Main Thread', async () => {
  const jsonParse = vi.spyOn(JSON, 'parse');
  const buffer = new TextEncoder().encode(JSON.stringify(source)).buffer;

  const result = await parseCatalogInWorker(buffer, {
    catalogKey: 'gspp',
    trustClass: 'class-1-verified-public',
  });

  expect(result.catalogDocument.view.controlsById.get('G.1')?.title).toBe('Kontrolle');
  expect(jsonParse).not.toHaveBeenCalled();
});

test('gibt einen Root-Type-Fehler des Workers verständlich zurück', async () => {
  const buffer = new TextEncoder().encode(
    '{"profile":{"metadata":{"oscal-version":"1.1.3"}}}',
  ).buffer;

  await expect(
    parseCatalogInWorker(buffer, {
      catalogKey: 'gspp',
      trustClass: 'class-1-unverified-public',
    }),
  ).rejects.toThrow('OSCAL_ROOT_TYPE_MISMATCH');
});
