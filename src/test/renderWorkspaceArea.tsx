import { screen } from '@testing-library/react';
import { AppShell } from '@/app/AppShell';
import type { CatalogState, LoadedCatalogState } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { renderAppShell } from '@/test/renderAppShell';

/** Katalogzustand ohne geladenen Katalog; Arbeitsbereichstests brauchen nur die Shell. */
export const EMPTY_CATALOG_STATE = {
  ...catalogCollectionDefaults(),
  catalogDocument: null,
  catalog: null,
  provenance: null,
  verification: null,
  loading: false,
  error: null,
  vocabularyRegistry: null,
  vocabularyProvenance: null,
  vocabularyVerification: null,
} as CatalogState;

/** Manifest-Commit des ausgelieferten Test-Katalogs `gspp`. */
export const TEST_CATALOG_COMMIT = 'c'.repeat(40);

/** Katalogzustand mit geladenem `gspp`-Katalog; `valid` ist das Ergebnis der Hashprüfung. */
export function withLoadedCatalog(valid: boolean, sourceCommit = TEST_CATALOG_COMMIT): CatalogState {
  const loaded = {
    catalogKey: 'gspp',
    catalogDocument: { source: makeSchemaValidOscalDocument('catalog', '1.1.3') },
    verification: { valid, sourceCommit },
  } as unknown as LoadedCatalogState;
  return { ...EMPTY_CATALOG_STATE, catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp', loaded]]) };
}

/** Shell mit echtem `WorkspaceProvider` und echter Routentabelle für Router-Tests des Bereichs Informationsverbünde. */
export function renderWorkspaceArea(path: string, catalogs: CatalogState = EMPTY_CATALOG_STATE) {
  return renderAppShell([path], {
    shell: () => (
      <CatalogContext.Provider value={catalogs}>
        <WorkspaceProvider><AppShell /></WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  });
}

export function mainLandmark(): HTMLElement {
  return screen.getByRole('main');
}
