// =============================================================================
// useCatalog — Hook to consume the CatalogContext
// =============================================================================

import { useContext } from 'react';
import { CatalogContext } from '@/state/CatalogContext';
import type { CatalogState } from '@/domain/models';

/**
 * Access the catalog state from the CatalogContext.
 *
 * Must be used within a <CatalogProvider>.
 *
 * @returns The current catalog state (catalog, provenance, verification, loading, error)
 */
export function useCatalog(): CatalogState {
  return useContext(CatalogContext);
}
