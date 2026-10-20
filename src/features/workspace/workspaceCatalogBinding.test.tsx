import 'fake-indexeddb/auto';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVerbundUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
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
  function profileSource(href: string) {
    const source = makeSchemaValidOscalDocument('profile', '1.2.2');
    const body = source.profile as { metadata: { title: string }; imports: { href: string }[] };
    body.metadata.title = 'Profil auf BSI-Katalog';
    body.imports[0].href = href;
    return { source, context: { trustClass: 'class-2-local-user' as const }, rootType: 'profile' as const, oscalVersion: '1.2.2' as const };
  }

  /** Bindet ein Profil an `catalog-gspp`; `changedHref` ändert danach den Verweis, die Bindung bleibt. */
  async function bindProfileToCatalog(changedHref?: string) {
    const store = value(await WorkspaceStore.open());
    try {
      const profile = value(await store.addDocument(seeded.verbundId, profileSource('bsi-katalog.json')));
      value(await store.setBinding({
        fromLocalId: profile.localId, pointer: '/profile/imports/0/href', href: 'bsi-katalog.json',
        target: { kind: 'class-1', artifactKey: 'catalog-gspp' },
      }, profile.savedAt));
      if (changedHref === undefined) return profile;
      const bound = value(await store.getDocument(profile.localId))!;
      return value(await store.replaceDocument(profile.localId, bound.savedAt, null, profileSource(changedHref)));
    } finally { store.close(); }
  }

  /** Ein Profile öffnet die Bearbeitungsansicht; die Kanten stehen im Reiter Referenzen. */
  async function openReferences() {
    fireEvent.click(await within(main()).findByRole('tab', { name: /^Referenzen/ }));
    return within(main()).findByRole('region', { name: 'Referenzkanten' });
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
    const edges = await openReferences();
    await waitFor(() => expect(edges.querySelector('[data-edge-state="resolved"]')).toHaveTextContent('/profile/imports/0/href'));
    expect(edges).not.toHaveTextContent('OSCAL_GRAPH_TARGET_NOT_FOUND');
  });

  it.each([
    ['nicht geladenen', EMPTY_CATALOG_STATE],
    ['nicht verifizierten', withLoadedCatalog(false)],
  ])('meldet einen %s Katalog als Sitzungszustand statt als Fehler', async (_label, catalogs) => {
    const profile = await bindProfileToCatalog();
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), catalogs);
    const edges = await openReferences();
    expect(edges).toHaveTextContent('BSI-Katalog in dieser Sitzung nicht geladen');
    expect(edges).not.toHaveTextContent('OSCAL_GRAPH_TARGET_NOT_FOUND');
    expect(edges.querySelector('[data-edge-state="error"]')).toBeNull();
  });

  it('zählt die Bindung auf einen nicht geladenen Katalog nicht als Diagnose der Verbundseite', async () => {
    await bindProfileToCatalog();
    renderArea(buildVerbundUrl(seeded.verbundId), EMPTY_CATALOG_STATE);
    const diagnostics = await within(main()).findByRole('region', { name: 'Diagnosen' });
    await waitFor(() => expect(within(main()).getByRole('link', { name: /Profil auf BSI-Katalog/ })).toBeInTheDocument());
    expect(diagnostics).not.toHaveTextContent('OSCAL_GRAPH_TARGET_NOT_FOUND');
  });

  it('meldet eine veraltete Bindung als Fehler, auch wenn ihr Katalog nicht geladen ist', async () => {
    const profile = await bindProfileToCatalog('anderer-katalog.json');
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), EMPTY_CATALOG_STATE);
    const edges = await openReferences();
    await waitFor(() => expect(edges.querySelector('[data-edge-state="error"]')).toHaveTextContent('OSCAL_WORKSPACE_BINDING_STALE'));
    expect(edges).not.toHaveTextContent('BSI-Katalog in dieser Sitzung nicht geladen');
  });
});

