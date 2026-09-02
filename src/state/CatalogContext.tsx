// =============================================================================
// CatalogContext — Loads, parses, and verifies the shipped BSI catalogs
//
// Provides the entire catalog state to the component tree.
//
// Seit GSPP-284 hält der Kontext eine Katalogsammlung statt genau eines
// Katalogs. Der Einstiegskatalog wird eager geladen, jeder weitere erst, wenn
// eine Route ihn auswählt — der Initial-Load wächst deshalb nicht mit der Zahl
// ausgelieferter Kataloge. Integritätsprüfung, Vertrauensklasse und
// Fehlerzustand hängen je Katalog, damit ein beschädigter Katalog die übrigen
// nicht unbrauchbar macht.
// =============================================================================

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from 'react';
import type {
  CatalogState,
  VerificationResult,
  VocabularyProvenance,
  VocabularyRegistry,
  VocabularyRegistryData,
} from '@/domain/models';
import { ENTRY_CATALOG_KEY, type CatalogKey } from '@/domain/sourceRegistry';
import { buildVocabularyRegistry } from '@/domain/vocabulary';
import {
  fetchCatalogWithBuffer,
  fetchVocabularyProvenance,
  verifyArtifactIntegrity,
} from '@/domain/integrity';
import {
  buildSupportedCatalogDescriptors,
  loadCatalogArtifacts,
  toCatalogErrorMessage,
  type SupportedCatalogDescriptor,
} from '@/state/catalogArtifacts';

import {
  catalogReducer,
  createInitialState,
  projectPublicState,
} from '@/state/catalogReducer';

export type { SupportedCatalogDescriptor } from '@/state/catalogArtifacts';

export const CatalogContext = createContext<CatalogState>(
  projectPublicState(createInitialState(ENTRY_CATALOG_KEY), () => {}),
);

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export interface CatalogProviderProps {
  readonly children: ReactNode;
  /** Override entry catalog URL (for testing) */
  readonly catalogUrl?: string;
  /** Override entry catalog metadata URL (for testing) */
  readonly metadataUrl?: string;
  /** Override vocabulary registry URL (for testing) */
  readonly vocabulariesUrl?: string;
  /** Override upstream sources provenance URL (for testing) */
  readonly upstreamSourcesMetadataUrl?: string;
  /**
   * Override the shipped catalog set (for testing). Erlaubt ein Fixture-Register
   * mit mehreren `supported`-Katalogen, das die reale Registry — die heute genau
   * einen ausgeliefert — nicht herstellen kann.
   */
  readonly supportedCatalogs?: readonly SupportedCatalogDescriptor[];
}

export function CatalogProvider({
  children,
  catalogUrl,
  metadataUrl,
  vocabulariesUrl = `${import.meta.env.BASE_URL}data/vocabularies.json`,
  upstreamSourcesMetadataUrl = `${import.meta.env.BASE_URL}data/upstream-sources-metadata.json`,
  supportedCatalogs,
}: CatalogProviderProps) {
  const descriptors = useMemo<readonly SupportedCatalogDescriptor[]>(() => {
    const base =
      supportedCatalogs ?? buildSupportedCatalogDescriptors(import.meta.env.BASE_URL);

    if (catalogUrl === undefined && metadataUrl === undefined) return base;

    return base.map((descriptor) =>
      descriptor.isEntryCatalog
        ? {
            ...descriptor,
            dataUrl: catalogUrl ?? descriptor.dataUrl,
            metadataUrl: metadataUrl ?? descriptor.metadataUrl,
          }
        : descriptor,
    );
  }, [supportedCatalogs, catalogUrl, metadataUrl]);

  const entryDescriptor = useMemo(() => {
    const entry = descriptors.find((descriptor) => descriptor.isEntryCatalog);
    if (!entry) {
      throw new Error('Catalog provider requires exactly one entry catalog descriptor');
    }
    return entry;
  }, [descriptors]);

  const descriptorByKey = useMemo(
    () => new Map(descriptors.map((descriptor) => [descriptor.catalogKey, descriptor])),
    [descriptors],
  );

  const [state, dispatch] = useReducer(
    catalogReducer,
    entryDescriptor.catalogKey,
    createInitialState,
  );

  // Verhindert doppelte Nachlade-Requests bei StrictMode-Effektläufen und Re-Renders.
  const requestedKeysRef = useRef<Set<CatalogKey>>(new Set());
  useEffect(() => {
    requestedKeysRef.current = new Set();
  }, [descriptorByKey]);

  const entryDataUrl = entryDescriptor.dataUrl;
  const entryMetadataUrl = entryDescriptor.metadataUrl;
  const entryCatalogKey = entryDescriptor.catalogKey;

  // Einstiegskatalog und Vokabulare: der einzige eager Ladepfad.
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    async function loadEntryCatalog() {
      dispatch({ type: 'CATALOG_LOAD_START', catalogKey: entryCatalogKey });

      // Start both artifact downloads together to reduce startup latency.
      const catalogPromise = loadCatalogArtifacts(
        { catalogKey: entryCatalogKey, dataUrl: entryDataUrl, metadataUrl: entryMetadataUrl, isEntryCatalog: true },
        isCancelled,
      ).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      );
      const vocabularyPromise = fetchCatalogWithBuffer(vocabulariesUrl).then(
        (result) => ({ ok: true as const, result }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      // Auffangnetz um den gesamten eager Ladepfad: jeder Wurf zwischen hier und
      // dem abschließenden Dispatch muss als sichtbarer Ladefehler enden statt
      // als dauerhafter Ladezustand. Das betrifft besonders das Bauen der
      // Vokabular-Registry, die bei ungültigem JSON, unzulässiger Struktur oder
      // doppelten Werten wirft.
      try {
        // Der Einstiegskatalog entscheidet zuerst: schlägt er fehl, bleibt es
        // beim Fehlerzustand — unveränderte Bestandssemantik des eager Pfads.
        const catalogFetch = await catalogPromise;
        if (cancelled) return;

        if (!catalogFetch.ok) {
          dispatch({
            type: 'CATALOG_LOAD_ERROR',
            catalogKey: entryCatalogKey,
            error: toCatalogErrorMessage(catalogFetch.error),
          });
          return;
        }
        if (!catalogFetch.result) return;

        let vocabularyRegistry: VocabularyRegistry | null = null;
        let vocabularyProvenance: VocabularyProvenance | null = null;
        let vocabularyVerification: VerificationResult | null = null;

        const vocabularyFetch = await vocabularyPromise;
        if (cancelled) return;

        if (!vocabularyFetch.ok) {
          console.warn('Vocabulary artifacts not available. Runtime registry skipped.');
        } else {
          const { buffer: vocabularyBuffer, text: vocabularyText } = vocabularyFetch.result;

          vocabularyRegistry = buildVocabularyRegistry(
            JSON.parse(vocabularyText) as VocabularyRegistryData,
          );

          try {
            vocabularyProvenance = await fetchVocabularyProvenance(upstreamSourcesMetadataUrl);
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

        if (cancelled) return;
        dispatch({
          type: 'VOCABULARY_LOADED',
          vocabularyRegistry,
          vocabularyProvenance,
          vocabularyVerification,
        });
        dispatch({
          type: 'CATALOG_LOAD_SUCCESS',
          catalogKey: entryCatalogKey,
          ...catalogFetch.result,
        });
      } catch (err) {
        if (!cancelled) {
          dispatch({
            type: 'CATALOG_LOAD_ERROR',
            catalogKey: entryCatalogKey,
            error: toCatalogErrorMessage(err),
          });
        }
      }
    }

    loadEntryCatalog();

    return () => {
      cancelled = true;
    };
  }, [
    entryCatalogKey,
    entryDataUrl,
    entryMetadataUrl,
    vocabulariesUrl,
    upstreamSourcesMetadataUrl,
  ]);

  // Bedarfsgerechtes Nachladen: nur der per Route ausgewählte Katalog.
  const activeCatalogKey = state.activeCatalogKey;
  useEffect(() => {
    if (activeCatalogKey === entryCatalogKey) return;

    const descriptor = descriptorByKey.get(activeCatalogKey);
    if (!descriptor) return;
    if (requestedKeysRef.current.has(activeCatalogKey)) return;
    requestedKeysRef.current.add(activeCatalogKey);

    dispatch({ type: 'CATALOG_LOAD_START', catalogKey: activeCatalogKey });

    loadCatalogArtifacts(descriptor, () => false)
      .then((result) => {
        if (!result) return;
        dispatch({
          type: 'CATALOG_LOAD_SUCCESS',
          catalogKey: descriptor.catalogKey,
          ...result,
        });
      })
      .catch((error: unknown) => {
        // Fail-closed je Katalog: der beschädigte Katalog trägt den Fehler,
        // die übrigen bleiben unberührt nutzbar.
        dispatch({
          type: 'CATALOG_LOAD_ERROR',
          catalogKey: descriptor.catalogKey,
          error: toCatalogErrorMessage(error),
        });
      });
  }, [activeCatalogKey, entryCatalogKey, descriptorByKey]);

  const selectCatalog = useCallback(
    (catalogKey: CatalogKey) => {
      if (!descriptorByKey.has(catalogKey)) return;
      dispatch({ type: 'SELECT_CATALOG', catalogKey });
    },
    [descriptorByKey],
  );

  const value = useMemo(
    () => projectPublicState(state, selectCatalog),
    [state, selectCatalog],
  );

  return (
    <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>
  );
}
