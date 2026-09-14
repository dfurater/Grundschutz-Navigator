// =============================================================================
// Testhilfe: gemeinsame Vorbelegung der FilterPanel-Tests (GSPP-226)
//
// `FilterPanel.test.tsx` und `SecurityTargetFilterSections.test.tsx` rendern
// beide das Panel und brauchen dieselben Facettenzähler und denselben
// Katalogzustand. Die Vorbelegung liegt hier statt doppelt in beiden Dateien —
// eine Kopie hätte die Zähler auseinanderlaufen lassen, sobald eine Dimension
// dazukommt, und wurde von der Duplikatsprüfung als Befund gemeldet.
//
// `vi.mock('@/hooks/useCatalog')` bleibt bewusst in den Testdateien: Der Aufruf
// wird pro Datei gehoisted und lässt sich nicht teilen.
// =============================================================================

import type { CatalogState, VocabularyRegistry } from '@/domain/models';
import type { FacetCounts } from '@/hooks/useFilteredControls';
import { catalogCollectionDefaults } from '@/test/catalogState';

/** Facettenzähler mit Werten in den Dimensionen, die die Tests auswerten. */
export const filterPanelFacetCounts: FacetCounts = {
  securityLevels: {
    'normal-SdT': 2,
    erhöht: 1,
  },
  effortLevels: {
    '0': 0,
    '1': 0,
    '2': 0,
    '3': 1,
    '4': 1,
    '5': 0,
  },
  modalverben: {
    MUSS: 2,
    SOLLTE: 1,
    KANN: 0,
  },
  tags: {},
  zielobjektKategorien: {},
  handlungsworte: {},
  dokumentationstypen: {},
  linkRelationen: {},
  securityTargets: {
    confidentiality: { '0': 1, '1': 2, '2': 1 },
    integrity: { '1': 1, '2': 0 },
    availability: {},
    authenticity: {},
  },
};

/** Facettenzähler ohne jeden Treffer — für die Ausblendregeln. */
export const filterPanelEmptyFacetCounts: FacetCounts = {
  securityLevels: {},
  effortLevels: {},
  modalverben: {},
  tags: {},
  zielobjektKategorien: {},
  handlungsworte: {},
  dokumentationstypen: {},
  linkRelationen: {},
  securityTargets: {
    confidentiality: {},
    integrity: {},
    availability: {},
    authenticity: {},
  },
};

/** Katalogzustand mit Vokabularregistry, sonst leer. */
export function makeFilterPanelCatalogState(
  vocabularyRegistry: VocabularyRegistry,
): CatalogState {
  return {
    ...catalogCollectionDefaults(),
    catalogDocument: null,
    catalog: null,
    provenance: null,
    verification: null,
    vocabularyRegistry,
    vocabularyProvenance: null,
    vocabularyVerification: null,
    loading: false,
    error: null,
  };
}
