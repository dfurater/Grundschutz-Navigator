// =============================================================================
// Testhilfe: Katalogsammlungs-Felder des CatalogState (GSPP-284)
//
// Komponententests bauen ihren CatalogState aus einem einzelnen Katalogfixture.
// Die Sammlungsfelder sind für sie ohne Aussage, müssen aber gesetzt sein.
// Eine gemeinsame Vorbelegung hält sie an einer Stelle, statt sie in jeder
// Testdatei zu wiederholen.
// =============================================================================

import type { CatalogState } from '@/domain/models';
import { ENTRY_CATALOG_KEY } from '@/domain/sourceRegistry';

type CatalogCollectionFields = Pick<
  CatalogState,
  'catalogs' | 'entryCatalogKey' | 'activeCatalogKey' | 'selectCatalog'
>;

export function catalogCollectionDefaults(): CatalogCollectionFields {
  return {
    catalogs: new Map(),
    entryCatalogKey: ENTRY_CATALOG_KEY,
    activeCatalogKey: ENTRY_CATALOG_KEY,
    selectCatalog: () => {},
  };
}
