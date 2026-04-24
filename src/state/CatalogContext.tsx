// =============================================================================
// CatalogContext — Loads, parses, and verifies the BSI catalog
//
// Provides the entire catalog state to the component tree.
// =============================================================================

import {
  createContext,
  useEffect,
  useReducer,
  type ReactNode,
} from 'react';
import type {
  Catalog,
  CatalogProvenance,
  CatalogState,
  VerificationResult,
  VocabularyProvenance,
  VocabularyRegistry,
  VocabularyRegistryData,
} from '@/domain/models';
import { parseCatalog } from '@/adapters/oscalAdapter';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import {
  fetchCatalogWithBuffer,
  fetchProvenance,
  fetchVocabularyProvenance,
  verifyArtifactIntegrity,
  verifyCatalogIntegrity,
} from '@/domain/integrity';

/* ------------------------------------------------------------------ */
/*  State                                                              */
/* ------------------------------------------------------------------ */

const initialState: CatalogState = {
  catalog: null,
  provenance: null,
  verification: null,
  vocabularyRegistry: null,
  vocabularyProvenance: null,
  vocabularyVerification: null,
  loading: true,
  error: null,
};

type CatalogAction =
  | { type: 'LOAD_START' }
  | {
      type: 'LOAD_SUCCESS';
      catalog: Catalog;
      provenance: CatalogProvenance | null;
      verification: VerificationResult | null;
      vocabularyRegistry: VocabularyRegistry | null;
      vocabularyProvenance: VocabularyProvenance | null;
      vocabularyVerification: VerificationResult | null;
    }
  | { type: 'LOAD_ERROR'; error: string };

function catalogReducer(state: CatalogState, action: CatalogAction): CatalogState {
  switch (action.type) {
    case 'LOAD_START':
      return { ...state, loading: true, error: null };
    case 'LOAD_SUCCESS':
      return {
        catalog: action.catalog,
        provenance: action.provenance,
        verification: action.verification,
        vocabularyRegistry: action.vocabularyRegistry,
        vocabularyProvenance: action.vocabularyProvenance,
        vocabularyVerification: action.vocabularyVerification,
        loading: false,
        error: null,
      };
    case 'LOAD_ERROR':
      return { ...state, loading: false, error: action.error };
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

export const CatalogContext = createContext<CatalogState>(initialState);

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export interface CatalogProviderProps {
  children: ReactNode;
  /** Override catalog URL (for testing) */
  catalogUrl?: string;
  /** Override metadata URL (for testing) */
  metadataUrl?: string;
  /** Override vocabulary registry URL (for testing) */
  vocabulariesUrl?: string;
  /** Override upstream sources provenance URL (for testing) */
  upstreamSourcesMetadataUrl?: string;
}

export function CatalogProvider({
  children,
  catalogUrl = `${import.meta.env.BASE_URL}data/catalog.json`,
  metadataUrl = `${import.meta.env.BASE_URL}data/catalog-metadata.json`,
  vocabulariesUrl = `${import.meta.env.BASE_URL}data/vocabularies.json`,
  upstreamSourcesMetadataUrl = `${import.meta.env.BASE_URL}data/upstream-sources-metadata.json`,
}: CatalogProviderProps) {
  const [state, dispatch] = useReducer(catalogReducer, initialState);

  useEffect(() => {
    let cancelled = false;

    async function loadCatalog() {
      dispatch({ type: 'LOAD_START' });

      try {
        // Start both artifact downloads together to reduce startup latency.
        const catalogPromise = fetchCatalogWithBuffer(catalogUrl);
        const vocabularyPromise = fetchCatalogWithBuffer(vocabulariesUrl).then(
          (result) => ({ ok: true as const, result }),
          (error) => ({ ok: false as const, error }),
        );

        // 1. Fetch catalog (as ArrayBuffer for integrity check + text for parsing)
        const { buffer, text } = await catalogPromise;

        if (cancelled) return;

        // 2. Parse OSCAL JSON into domain model
        const rawJson = JSON.parse(text);
        const catalog = parseCatalog(rawJson);

        // 3. Try to fetch provenance metadata and verify integrity
        let provenance: CatalogProvenance | null = null;
        let verification: VerificationResult | null = null;
        let vocabularyRegistry: VocabularyRegistry | null = null;
        let vocabularyProvenance: VocabularyProvenance | null = null;
        let vocabularyVerification: VerificationResult | null = null;

        const vocabularyFetch = await vocabularyPromise;
        if (!vocabularyFetch.ok) {
          console.warn(
            'Vocabulary artifacts not available. Runtime registry skipped.',
          );
        } else {
          const { buffer: vocabularyBuffer, text: vocabularyText } =
            vocabularyFetch.result;

          if (cancelled) return;

          vocabularyRegistry = buildVocabularyRegistry(
            JSON.parse(vocabularyText) as VocabularyRegistryData,
          );

          try {
            vocabularyProvenance = await fetchVocabularyProvenance(
              upstreamSourcesMetadataUrl,
            );
            if (!cancelled) {
              vocabularyVerification = await verifyArtifactIntegrity(
                vocabularyBuffer,
                vocabularyProvenance,
              );
            }
          } catch {
            console.warn(
              'Vocabulary provenance metadata not available. Integrity verification skipped.',
            );
          }
        }

        try {
          provenance = await fetchProvenance(metadataUrl);
          if (!cancelled) {
            verification = await verifyCatalogIntegrity(buffer, provenance);
          }
        } catch {
          // Metadata not available (e.g., local dev without running fetch-catalog.sh)
          // The catalog is still usable, just not verified
          console.warn(
            'Catalog provenance metadata not available. Integrity verification skipped.',
          );
        }

        if (!cancelled) {
          dispatch({
            type: 'LOAD_SUCCESS',
            catalog,
            provenance,
            verification,
            vocabularyRegistry,
            vocabularyProvenance,
            vocabularyVerification,
          });
        }
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'LOAD_ERROR',
            error:
              err instanceof Error
                ? err.message
                : 'Unbekannter Fehler beim Laden des Katalogs',
          });
        }
      }
    }

    loadCatalog();

    return () => {
      cancelled = true;
    };
  }, [catalogUrl, metadataUrl, vocabulariesUrl, upstreamSourcesMetadataUrl]);

  return (
    <CatalogContext.Provider value={state}>{children}</CatalogContext.Provider>
  );
}
