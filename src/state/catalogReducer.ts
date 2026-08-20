// =============================================================================
// Katalogsammlung als Zustand (GSPP-284)
//
// Reducer und Zustandsform des Ladepfads, getrennt vom Provider in
// CatalogContext.tsx. Jeder Katalog trägt hier seinen eigenen Ladezustand,
// damit ein beschädigter Katalog die übrigen nicht berührt.
// =============================================================================

import type {
  CatalogDocument,
  CatalogProvenance,
  CatalogState,
  LoadedCatalogState,
  VerificationResult,
  VocabularyProvenance,
  VocabularyRegistry,
} from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

export interface InternalCatalogState {
  catalogs: ReadonlyMap<CatalogKey, LoadedCatalogState>;
  entryCatalogKey: CatalogKey;
  activeCatalogKey: CatalogKey;
  vocabularyRegistry: VocabularyRegistry | null;
  vocabularyProvenance: VocabularyProvenance | null;
  vocabularyVerification: VerificationResult | null;
}

export function pendingCatalog(catalogKey: CatalogKey): LoadedCatalogState {
  return {
    catalogKey,
    catalogDocument: null,
    catalog: null,
    provenance: null,
    verification: null,
    loading: true,
    error: null,
  };
}

export function createInitialState(entryCatalogKey: CatalogKey): InternalCatalogState {
  return {
    catalogs: new Map([[entryCatalogKey, pendingCatalog(entryCatalogKey)]]),
    entryCatalogKey,
    activeCatalogKey: entryCatalogKey,
    vocabularyRegistry: null,
    vocabularyProvenance: null,
    vocabularyVerification: null,
  };
}

export type CatalogAction =
  | { type: 'CATALOG_LOAD_START'; catalogKey: CatalogKey }
  | {
      type: 'CATALOG_LOAD_SUCCESS';
      catalogKey: CatalogKey;
      catalogDocument: CatalogDocument;
      provenance: CatalogProvenance | null;
      verification: VerificationResult | null;
    }
  | { type: 'CATALOG_LOAD_ERROR'; catalogKey: CatalogKey; error: string }
  | {
      type: 'VOCABULARY_LOADED';
      vocabularyRegistry: VocabularyRegistry | null;
      vocabularyProvenance: VocabularyProvenance | null;
      vocabularyVerification: VerificationResult | null;
    }
  | { type: 'SELECT_CATALOG'; catalogKey: CatalogKey };

function withCatalog(
  state: InternalCatalogState,
  catalogKey: CatalogKey,
  next: LoadedCatalogState,
): InternalCatalogState {
  const catalogs = new Map(state.catalogs);
  catalogs.set(catalogKey, next);
  return { ...state, catalogs };
}

export function catalogReducer(
  state: InternalCatalogState,
  action: CatalogAction,
): InternalCatalogState {
  switch (action.type) {
    case 'CATALOG_LOAD_START':
      return withCatalog(state, action.catalogKey, pendingCatalog(action.catalogKey));
    case 'CATALOG_LOAD_SUCCESS':
      return withCatalog(state, action.catalogKey, {
        catalogKey: action.catalogKey,
        catalogDocument: action.catalogDocument,
        // Immer aus dem Dokument abgeleitet — die beiden Felder können
        // deshalb nicht auseinanderlaufen.
        catalog: action.catalogDocument.view,
        provenance: action.provenance,
        verification: action.verification,
        loading: false,
        error: null,
      });
    case 'CATALOG_LOAD_ERROR':
      return withCatalog(state, action.catalogKey, {
        ...(state.catalogs.get(action.catalogKey) ?? pendingCatalog(action.catalogKey)),
        loading: false,
        error: action.error,
      });
    case 'VOCABULARY_LOADED':
      return {
        ...state,
        vocabularyRegistry: action.vocabularyRegistry,
        vocabularyProvenance: action.vocabularyProvenance,
        vocabularyVerification: action.vocabularyVerification,
      };
    case 'SELECT_CATALOG': {
      if (action.catalogKey === state.activeCatalogKey) return state;
      return { ...state, activeCatalogKey: action.catalogKey };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

export function projectPublicState(
  state: InternalCatalogState,
  selectCatalog: (catalogKey: CatalogKey) => void,
): CatalogState {
  const active =
    state.catalogs.get(state.activeCatalogKey) ?? pendingCatalog(state.activeCatalogKey);

  return {
    catalogs: state.catalogs,
    entryCatalogKey: state.entryCatalogKey,
    activeCatalogKey: state.activeCatalogKey,
    selectCatalog,
    catalogDocument: active.catalogDocument,
    catalog: active.catalog,
    provenance: active.provenance,
    verification: active.verification,
    loading: active.loading,
    error: active.error,
    vocabularyRegistry: state.vocabularyRegistry,
    vocabularyProvenance: state.vocabularyProvenance,
    vocabularyVerification: state.vocabularyVerification,
  };
}
