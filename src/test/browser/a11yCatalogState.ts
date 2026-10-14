import { parseCatalog } from '@/adapters/oscalAdapter';
import type { CatalogState } from '@/domain/models';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { createTestVocabularyRegistry } from '@/test/fixtures/vocabulary';

/** Öffentliche Struktur mit synthetischen Inhalten für echte Katalog-, Such- und Detailansichten. */
export function createA11yCatalogState(): CatalogState {
  const catalog = parseCatalog({
    uuid: 'a11y-catalog',
    metadata: {
      title: 'Accessibility-Testkatalog',
      'last-modified': '2026-10-12T00:00:00Z',
      version: '1.0.0',
      'oscal-version': '1.1.3',
    },
    groups: [{
      id: 'TOP',
      title: 'Testpraktik',
      groups: [{
        id: 'TOP.1',
        title: 'Zugriff und Netz',
        controls: [{
          id: 'TOP.1.1',
          title: 'Zugriff schützen',
          props: [
            { name: 'alt-identifier', value: 'a11y-access' },
            { name: 'sec_level', value: 'normal-SdT' },
            { name: 'effort_level', value: '2' },
          ],
          parts: [
            { name: 'statement', prose: 'Die Organisation MUSS den Zugriff auf Daten schützen.' },
            { name: 'guidance', prose: 'Berechtigungen werden regelmäßig geprüft und dokumentiert.' },
          ],
        }, {
          id: 'TOP.1.2',
          title: 'Netz segmentieren',
          props: [{ name: 'alt-identifier', value: 'a11y-network' }],
          parts: [{ name: 'statement', prose: 'Das Netz SOLLTE in getrennte Bereiche gegliedert werden.' }],
        }],
      }],
    }],
  }, { catalogKey: ENTRY_CATALOG_KEY });

  return {
    ...catalogCollectionDefaults(),
    catalog,
    catalogDirectory: [{ catalogKey: catalog.catalogKey, title: catalog.metadata.title }],
    catalogDocument: null,
    provenance: null,
    verification: null,
    vocabularyRegistry: createTestVocabularyRegistry(),
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}
