import { screen } from '@testing-library/react';
import { AppShell } from '@/app/AppShell';
import type { CatalogState } from '@/domain/models';
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
