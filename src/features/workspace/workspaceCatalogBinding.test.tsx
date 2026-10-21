import 'fake-indexeddb/auto';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildVerbundUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { PROJECT_PROPS_NAMESPACE } from '@/domain/projectProps';
import { readCatalogPins } from '@/domain/workspaceCatalogPin';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import {
  EMPTY_CATALOG_STATE, TEST_CATALOG_COMMIT, mainLandmark as main, renderWorkspaceArea as renderArea, withLoadedCatalog,
} from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, SENTINEL_HREF, value, type SeededWorkspace } from '@/test/workspaceAreaFixture';
import { catalogDelivery } from '@/state/workspaceCatalogSession';
import { createWorkspaceDocuments } from '@/state/workspaceDocuments';
import type { LocalId, WorkspaceResult } from '@/domain/workspaceModel';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/workspaceNodeWorkers')).inProcessReviewTrailWork());

/*
 * Bindungen lokaler Dokumente an BSI-Kataloge (GSPP-577, GSPP-362): Der
 * Dokumentgraph erhält nur geladene, hash-verifizierte Kataloge aus
 * `CatalogContext`, und ein Dokument löst nur gegen seinen gebundenen Stand auf.
 */

const OLD_COMMIT = 'a'.repeat(40);

let seeded: SeededWorkspace;

beforeEach(async () => {
  seeded = await seedWorkspace();
});

afterEach(async () => {
  await resetWorkspace();
});

describe('Bindung an einen BSI-Katalog', () => {
  /** `commit: null` erzeugt ein Profil ohne Katalogpaar. */
  function profileSource(href: string, commit: string | null = TEST_CATALOG_COMMIT) {
    const source = makeSchemaValidOscalDocument('profile', '1.2.2');
    const body = source.profile as { metadata: { title: string; props?: unknown[] }; imports: { href: string }[] };
    body.metadata.title = 'Profil auf BSI-Katalog';
    body.imports[0].href = href;
    if (commit !== null) {
      body.metadata.props = [
        { name: 'assessed-against-catalog-key', value: 'gspp', ns: PROJECT_PROPS_NAMESPACE, group: 'gspp' },
        { name: 'assessed-against-catalog-commit', value: commit, ns: PROJECT_PROPS_NAMESPACE, group: 'gspp' },
      ];
    }
    return { source, context: { trustClass: 'class-2-local-user' as const }, rootType: 'profile' as const, oscalVersion: '1.2.2' as const };
  }

  /** Bindet ein Profil an `catalog-gspp`; `changedHref` ändert danach den Verweis, die Bindung bleibt. */
  async function bindProfileToCatalog(changedHref?: string, commit: string | null = TEST_CATALOG_COMMIT) {
    const store = value(await WorkspaceStore.open());
    try {
      const profile = value(await store.addDocument(seeded.verbundId, profileSource('bsi-katalog.json', commit)));
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

  it('löst die Bindung gegen den geladenen, verifizierten Katalog auf', async () => {
    const profile = await bindProfileToCatalog();
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
    const edges = await openReferences();
    await waitFor(() => expect(edges.querySelector('[data-edge-state="resolved"]')).toHaveTextContent('/profile/imports/0/href'));
    expect(edges).not.toHaveTextContent('OSCAL_GRAPH_TARGET_NOT_FOUND');
    expect(main().querySelector('[data-catalog-pin]')).toBeNull();
  });

  it('hält einen nicht mehr ausgelieferten Stand schreibgeschützt, ohne auf den Viewer-Stand auszuweichen', async () => {
    const profile = await bindProfileToCatalog(undefined, OLD_COMMIT);
    const before = await readStore((store) => store.getDocument(profile.localId));
    const { unmount } = renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
    await waitFor(() => expect(main().querySelector('[data-catalog-pin="not-delivered"]')).toBeInTheDocument());
    expect(main()).toHaveTextContent('OSCAL_WORKSPACE_CATALOG_PIN_NOT_DELIVERED');
    expect(main()).not.toHaveTextContent(OLD_COMMIT);
    expect(within(main()).queryByRole('button', { name: 'An ausgelieferten Stand binden' })).not.toBeInTheDocument();
    for (const button of within(main()).getAllByRole('button', { name: 'Speichern' })) expect(button).toBeDisabled();
    const edges = await openReferences();
    await waitFor(() => expect(edges).toHaveTextContent('Gebundener Katalogstand gesperrt'));
    expect(edges.querySelector('[data-edge-state="resolved"]')).toBeNull();
    unmount();
    // Ein erneutes Laden zeigt denselben Zustand; das Dokument bleibt byteidentisch.
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
    await waitFor(() => expect(main().querySelector('[data-catalog-pin="not-delivered"]')).toBeInTheDocument());
    expect(await readStore((store) => store.getDocument(profile.localId))).toEqual(before);
  });

  it('bietet einem Profil ohne Katalogpaar die bestätigte Bindung an den ausgelieferten Stand an', async () => {
    const profile = await bindProfileToCatalog(undefined, null);
    const before = await readStore((store) => store.getDocument(profile.localId));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
    await waitFor(() => expect(main().querySelector('[data-catalog-pin="unpinned"]')).toBeInTheDocument());
    expect(main()).toHaveTextContent('OSCAL_WORKSPACE_CATALOG_PIN_MISSING');
    expect(await readStore((store) => store.getDocument(profile.localId))).toEqual(before);
    fireEvent.click(within(main()).getByRole('button', { name: 'An ausgelieferten Stand binden' }));
    await waitFor(async () => {
      const stored = await readStore((store) => store.getDocument(profile.localId));
      expect(readCatalogPins(stored?.source, 'profile')).toEqual(new Map([['gspp', TEST_CATALOG_COMMIT]]));
    });
    await waitFor(() => expect(main().querySelector('[data-catalog-pin]')).toBeNull());
    const edges = await openReferences();
    await waitFor(() => expect(edges.querySelector('[data-edge-state="resolved"]')).toHaveTextContent('/profile/imports/0/href'));
  });

  it('bindet ein Profil ohne Katalogpaar auch mit offenem Entwurf und speichert den Entwurf mit', async () => {
    const profile = await bindProfileToCatalog(undefined, null);
    const store = value(await WorkspaceStore.open());
    const draftSource = profileSource('bsi-katalog.json', null).source;
    (draftSource.profile as { metadata: { title: string } }).metadata.title = 'Entwurfstitel';
    try {
      const current = value(await store.getDocument(profile.localId))!;
      value(await store.autosaveDraft(profile.localId, current.savedAt, null, draftSource));
    } finally { store.close(); }
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
    const bind = await within(main()).findByRole('button', { name: 'An ausgelieferten Stand binden' });
    await waitFor(() => expect(bind).toBeEnabled());
    fireEvent.click(bind);
    await waitFor(async () => {
      const stored = await readStore((store) => store.getDocument(profile.localId));
      expect(readCatalogPins(stored?.source, 'profile')).toEqual(new Map([['gspp', TEST_CATALOG_COMMIT]]));
      expect((stored?.source as { profile: { metadata: { title: string } } }).profile.metadata.title).toBe('Entwurfstitel');
    });
  });

  it('sperrt die Prüfung eines Nicht-Profils, dessen Katalogstand nicht ausgeliefert ist', async () => {
    const store = value(await WorkspaceStore.open());
    let localId;
    try {
      const ssp = value(await store.addDocument(seeded.verbundId, {
        source: makeSchemaValidOscalDocument('system-security-plan', '1.2.2'), context: { trustClass: 'class-2-local-user' },
        rootType: 'system-security-plan', oscalVersion: '1.2.2',
      }));
      localId = ssp.localId;
      const href = (ssp.source as { 'system-security-plan': { 'import-profile': { href: string } } })['system-security-plan']['import-profile'].href;
      value(await store.setBinding({ fromLocalId: ssp.localId, pointer: '/system-security-plan/import-profile/href', href, target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, ssp.savedAt));
    } finally { store.close(); }
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, localId!), withLoadedCatalog(true));
    await waitFor(() => expect(main().querySelector('[data-catalog-pin="unpinned"]')).toBeInTheDocument());
    expect(within(main()).queryByRole('button', { name: 'An ausgelieferten Stand binden' })).not.toBeInTheDocument();
    fireEvent.click(within(main()).getByText('Prüfung und Freigabe'));
    await waitFor(() => expect(main().querySelector('details fieldset')).toBeDisabled());
  });

  it('meldet einen manipulierten Stand mit redigierter Diagnose und sperrt das Bearbeiten', async () => {
    const profile = await bindProfileToCatalog();
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(false));
    await waitFor(() => expect(main().querySelector('[data-catalog-pin="unverified"]')).toBeInTheDocument());
    expect(main()).toHaveTextContent('OSCAL_WORKSPACE_CATALOG_PIN_UNVERIFIED');
    expect(main()).not.toHaveTextContent(TEST_CATALOG_COMMIT);
    for (const button of within(main()).getAllByRole('button', { name: 'Speichern' })) expect(button).toBeDisabled();
  });

  it('nennt die Diagnose eines nicht mehr ausgelieferten Stands auf der Verbundseite', async () => {
    await bindProfileToCatalog(undefined, OLD_COMMIT);
    renderArea(buildVerbundUrl(seeded.verbundId), withLoadedCatalog(true));
    const diagnostics = await within(main()).findByRole('region', { name: 'Diagnosen' });
    await waitFor(() => expect(diagnostics).toHaveTextContent('OSCAL_WORKSPACE_CATALOG_PIN_NOT_DELIVERED'));
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

  /** Schreibt eine Prüfentscheidung über den Speicherpfad des Bereichs, so wie die Prüfansicht es tut. */
  async function decideReviewed(localId: LocalId) {
    const store = value(await WorkspaceStore.open());
    try {
      const run = <T,>(operation: (port: WorkspaceStore) => Promise<WorkspaceResult<T>>) => operation(store);
      const documents = createWorkspaceDocuments({
        port: store, write: run, quiet: run, class1: [], delivery: catalogDelivery(withLoadedCatalog(true).catalogs), targets: new Map(),
      });
      const current = value(await store.getDocument(localId))!;
      return await documents.appendDecision(localId, current.savedAt, null, { decision: 'reviewed', expectedSequence: 0 });
    } finally { store.close(); }
  }

  describe('Katalogpaar eines importierten Dokuments ohne Bindung', () => {
    it('sperrt bei einem alten Stand Prüfung und Speicherpfad', async () => {
      const code = 'OSCAL_WORKSPACE_CATALOG_PIN_NOT_DELIVERED';
      // Der Dateiimport legt das Dokument mit leerem Bindungssatz an.
      const profile = await readStore((store) => store.addDocument(seeded.verbundId, profileSource('bsi-katalog.json', OLD_COMMIT), 'imported', []));
      renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
      await waitFor(() => expect(main().querySelector('[data-catalog-pin="not-delivered"]')).toBeInTheDocument());
      expect(main()).toHaveTextContent(code);
      for (const button of within(main()).getAllByRole('button', { name: 'Speichern' })) expect(button).toBeDisabled();
      fireEvent.click(await within(main()).findByRole('tab', { name: /^Prüfung/ }));
      await waitFor(() => expect(main().querySelector('[role="tabpanel"]:not([hidden]) fieldset')).toBeDisabled());
      const result = await decideReviewed(profile.localId);
      expect(result.ok ? undefined : result.diagnostic.code).toBe(code);
      expect((await readStore((store) => store.listReviewTrail(profile.localId))).trail).toEqual([]);
    });

    it('sperrt ein Paar auf einen unbekannten Katalog', async () => {
      const input = profileSource('bsi-katalog.json');
      const props = (input.source.profile as { metadata: { props: { value: string; group: string }[] } }).metadata.props;
      for (const prop of props) prop.group = 'unbekannt';
      props[0].value = 'unbekannt';
      const profile = await readStore((store) => store.addDocument(seeded.verbundId, input, 'imported', []));
      renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withLoadedCatalog(true));
      await waitFor(() => expect(main().querySelector('[data-catalog-pin="invalid"]')).toBeInTheDocument());
      const result = await decideReviewed(profile.localId);
      expect(result.ok ? undefined : result.diagnostic.code).toBe('OSCAL_WORKSPACE_CATALOG_PIN_INVALID');
    });
  });

  describe('SSP → lokales Profil → BSI-Katalog', () => {
    /** Gibt dem Profil aus `seedWorkspace` das Paar `commit` und eine Bindung auf `catalog-gspp`; das SSP bleibt unverändert. */
    async function pinSeededProfile(commit: string) {
      const store = value(await WorkspaceStore.open());
      try {
        const input = profileSource(SENTINEL_HREF, commit);
        const replaced = value(await store.replaceDocument(seeded.profile.localId, seeded.profile.savedAt, null, input));
        value(await store.setBinding({
          fromLocalId: replaced.localId, pointer: '/profile/imports/0/href', href: SENTINEL_HREF,
          target: { kind: 'class-1', artifactKey: 'catalog-gspp' },
        }, replaced.savedAt));
      } finally { store.close(); }
    }

    it('sperrt die Prüfung des SSP, wenn das importierte Profil an einen nicht ausgelieferten Stand gebunden ist', async () => {
      await pinSeededProfile(OLD_COMMIT);
      renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId), withLoadedCatalog(true));
      await waitFor(() => expect(main().querySelector('[data-catalog-pin="not-delivered"][data-catalog-pin-inherited]')).toBeInTheDocument());
      expect(within(main()).queryByRole('button', { name: 'An ausgelieferten Stand binden' })).not.toBeInTheDocument();
      fireEvent.click(within(main()).getByText('Prüfung und Freigabe'));
      await waitFor(() => expect(main().querySelector('details fieldset')).toBeDisabled());
      const result = await decideReviewed(seeded.ssp.localId);
      expect(result.ok ? undefined : result.diagnostic.code).toBe('OSCAL_WORKSPACE_CATALOG_PIN_NOT_DELIVERED');
      expect((await readStore((store) => store.listReviewTrail(seeded.ssp.localId))).trail).toEqual([]);
    });

    it('lässt die Prüfung des SSP frei, solange das Profil an den ausgelieferten Stand gebunden ist', async () => {
      await pinSeededProfile(TEST_CATALOG_COMMIT);
      renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId), withLoadedCatalog(true));
      fireEvent.click(await within(main()).findByText('Prüfung und Freigabe'));
      await waitFor(() => expect(main().querySelector('details fieldset')).toBeEnabled());
      expect(main().querySelector('[data-catalog-pin]')).toBeNull();
      expect((await decideReviewed(seeded.ssp.localId)).ok).toBe(true);
    });
  });
});
