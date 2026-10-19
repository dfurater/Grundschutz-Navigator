import 'fake-indexeddb/auto';
import { waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import type { CatalogState, LoadedCatalogState } from '@/domain/models';
import type { CatalogKey } from '@/domain/sourceRegistry';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { EMPTY_CATALOG_STATE, mainLandmark as main, renderWorkspaceArea as renderArea } from '@/test/renderWorkspaceArea';
import { resetWorkspace, seedWorkspace, value, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});

/*
 * Bindungen lokaler Dokumente an BSI-Kataloge (GSPP-577): Der Dokumentgraph
 * erhält nur geladene, hash-verifizierte Kataloge aus `CatalogContext`.
 */

let seeded: SeededWorkspace;

beforeEach(async () => {
  seeded = await seedWorkspace();
});

afterEach(async () => {
  await resetWorkspace();
});

describe('Bindung an einen BSI-Katalog', () => {
  async function bindProfileToCatalog() {
    const store = value(await WorkspaceStore.open());
    try {
      const source = makeSchemaValidOscalDocument('profile', '1.2.2');
      const body = source.profile as { metadata: { title: string }; imports: { href: string }[] };
      body.metadata.title = 'Profil auf BSI-Katalog';
      body.imports[0].href = 'bsi-katalog.json';
      const profile = value(await store.addDocument(seeded.verbundId, {
        source, context: { trustClass: 'class-2-local-user' }, rootType: 'profile', oscalVersion: '1.2.2',
      }));
      value(await store.setBinding({
        fromLocalId: profile.localId, pointer: '/profile/imports/0/href', href: 'bsi-katalog.json',
        target: { kind: 'class-1', artifactKey: 'catalog-gspp' },
      }, profile.savedAt));
      return profile;
    } finally { store.close(); }
  }

  function withLoadedCatalog(valid: boolean): CatalogState {
    const loaded = {
      catalogKey: 'gspp',
      catalogDocument: { source: makeSchemaValidOscalDocument('catalog', '1.1.3') },
      verification: { valid },
    } as unknown as LoadedCatalogState;
    return { ...EMPTY_CATALOG_STATE, catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp', loaded]]) };
  }

  it('löst die Bindung gegen den geladenen, verifizierten Katalog auf', async () => {
    const profile = await bindProfileToCatalog();
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
    const edges = await within(main()).findByRole('region', { name: 'Referenzkanten' });
    await waitFor(() => expect(edges.querySelector('[data-edge-state="resolved"]')).toHaveTextContent('/profile/imports/0/href'));
    expect(edges).not.toHaveTextContent('OSCAL_GRAPH_TARGET_NOT_FOUND');
  });

  it.each([
    ['nicht geladenen', EMPTY_CATALOG_STATE],
    ['nicht verifizierten', withLoadedCatalog(false)],
  ])('meldet einen %s Katalog als Sitzungszustand statt als Fehler', async (_label, catalogs) => {
    const profile = await bindProfileToCatalog();
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), catalogs);
    const edges = await within(main()).findByRole('region', { name: 'Referenzkanten' });
    expect(edges).toHaveTextContent('BSI-Katalog in dieser Sitzung nicht geladen');
    expect(edges).not.toHaveTextContent('OSCAL_GRAPH_TARGET_NOT_FOUND');
    expect(edges.querySelector('[data-edge-state="error"]')).toBeNull();
  });
});

