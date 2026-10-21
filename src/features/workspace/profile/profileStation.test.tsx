import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { downloadBlob } from '@/adapters/browserDownload';
import type { CatalogState, LoadedCatalogState } from '@/domain/models';
import type { WorkspaceStore as WorkspaceStoreClass } from '@/adapters/workspaceStore';
import type { OscalRootKey, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { DocumentState, LocalId, VerbundId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { makeProfileSource, profileSpecFor } from '@/test/fixtures/profiles';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { REVIEW_ACTIONS_SYSTEM } from '@/domain/reviewTrail';
import { EMPTY_CATALOG_STATE, TEST_CATALOG_COMMIT, mainLandmark as main, renderWorkspaceArea as renderArea, withLoadedCatalog } from '@/test/renderWorkspaceArea';
import { readCatalogPins } from '@/domain/workspaceCatalogPin';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/workspaceNodeWorkers')).inProcessReviewTrailWork());
vi.mock('@/adapters/browserDownload', () => ({ downloadBlob: vi.fn() }));
// Desktop-Stufe: rechtes Panel mit Export und Speichern; die Mobilstufe deckt die Browser-Lane ab.
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));

/*
 * Profile-Station (GSPP-292): Neuanlage über das Importziel, Bearbeitung,
 * Autosave, explizites Speichern mit change-on-write und validierter Export.
 * Speicher ist `fake-indexeddb`; ohne `Worker`-API laufen Schema, Resolution
 * und Export im Prozess.
 */

const WAIT = { timeout: 4000 };
let seeded: SeededWorkspace;

beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => {
  vi.mocked(downloadBlob).mockReset();
  vi.restoreAllMocks();
  await resetWorkspace();
});

const withGspp = (valid = true): CatalogState => withLoadedCatalog(valid);

function local(rootType: OscalRootKey, version: PinnedOscalVersion, title: string, change?: (body: Record<string, unknown>) => void) {
  const source = makeSchemaValidOscalDocument(rootType, version);
  const body = source[rootType] as Record<string, unknown> & { metadata: { title: string } };
  body.metadata.title = title;
  change?.(body);
  return { source, context: { trustClass: 'class-2-local-user' as const }, rootType, oscalVersion: version };
}

function add(verbundId: VerbundId, input: ReturnType<typeof local>, state: DocumentState = 'imported'): Promise<WorkspaceEnvelope> {
  return readStore((store) => store.addDocument(verbundId, input, state));
}

function profileBody(envelope: WorkspaceEnvelope | undefined) {
  return (envelope?.source as { profile: { uuid: string; metadata: Record<string, string>; imports: Record<string, unknown>[]; 'back-matter'?: { resources: { uuid: string }[] } } }).profile;
}

/** Ein Stand aus einem anderen Tab; er behält das Katalogpaar des gespeicherten Profils. */
function externalProfile(current: WorkspaceEnvelope) {
  return local('profile', '1.1.3', 'Extern geändert', (body) => {
    (body.metadata as Record<string, unknown>).props = (profileBody(current).metadata as Record<string, unknown>).props;
  });
}

async function storedProfiles(verbundId: VerbundId) {
  return (await readStore((store) => store.listDocuments(verbundId))).filter((document) => document.rootType === 'profile');
}

async function openNewProfile(title: string) {
  fireEvent.click(await within(main()).findByRole('button', { name: 'Neues Profil' }));
  fireEvent.change(within(main()).getByRole('textbox', { name: /^Titel/ }), { target: { value: title } });
}

async function openTab(name: RegExp) {
  fireEvent.click(await within(main()).findByRole('tab', { name }));
}

async function openDiagnostics() {
  const toggle = await within(main()).findByRole('button', { name: /^Diagnosen/ });
  await waitFor(() => expect(toggle).not.toHaveTextContent('werden abgeleitet'), WAIT);
  fireEvent.click(toggle);
  return within(main()).getByRole('region', { name: 'Diagnosen' });
}

describe('Neuanlage über das Importziel', () => {
  it('speichert vor der Zielwahl nichts und legt danach ein gebundenes 1.1.3-Profil auf catalog-gspp an', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket Rechenzentrum');
    const create = within(main()).getByRole('button', { name: 'Profil anlegen' });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(await storedProfiles(seeded.verbundId)).toHaveLength(1);

    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(create);
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
    const stored = await readStore((store) => store.getDocument(localId));
    const body = profileBody(stored);
    expect(stored).toMatchObject({ documentState: 'draft', oscalVersion: '1.1.3', trustClass: 'class-2-local-user' });
    // Keine Klasse-1-Provenienz: weder Herkunftsverweis noch Hashindikator am lokalen Profil.
    expect(stored?.derivedFrom).toBeUndefined();
    expect(main()).not.toHaveTextContent(/Verifiziert/);
    expect(body.metadata['oscal-version']).toBe('1.1.3');
    // Das Profil ist an den ausgelieferten, verifizierten Stand gebunden: nur das Referenzpaar, keine Katalogbytes.
    expect(readCatalogPins(stored?.source, 'profile')).toEqual(new Map([['gspp', TEST_CATALOG_COMMIT]]));
    const href = body.imports[0].href as string;
    expect(href).toMatch(/^#[0-9a-f-]{36}$/);
    expect(body['back-matter']?.resources.map((resource) => resource.uuid)).toEqual([href.slice(1)]);
    expect((await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === localId)).toEqual([
      { fromLocalId: localId, pointer: '/profile/imports/0/href', href, target: { kind: 'class-1', artifactKey: 'catalog-gspp' } },
    ]);

    expect(await within(main()).findByText('Entwurf')).toBeInTheDocument();
    expect(within(main()).getByRole('button', { name: 'Export' })).toBeDisabled();
    await openTab(/^Referenzen/);
    const edges = await within(main()).findByRole('region', { name: 'Referenzkanten' });
    await waitFor(() => expect(edges.querySelector('[data-edge-state="resolved"]')).toHaveTextContent('/profile/imports/0/href'), WAIT);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('zeigt „BSI-geprüft“ nur für einen Katalog mit bestandener Hashprüfung', async () => {
    renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp(false));
    await openNewProfile('Paket');
    const radio = await within(main()).findByRole('radio', { name: /catalog-gspp/ });
    expect(radio.closest('label')!).toHaveTextContent('BSI-Katalog · nicht verifiziert');
    expect(radio).toBeDisabled();
    expect(main()).not.toHaveTextContent('BSI-geprüft');
  });

  it('legt kein Profil auf einem BSI-Katalog an, dessen Hashprüfung noch aussteht', async () => {
    const loading = { catalogKey: 'gspp', catalogDocument: null, catalog: null, verification: null, error: null, loading: true } as unknown as LoadedCatalogState;
    renderArea(buildStationUrl(seeded.verbundId, 'profile'), { ...EMPTY_CATALOG_STATE, catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp', loading]]) });
    await openNewProfile('Paket');
    fireEvent.click(await within(main()).findByRole('radio', { name: /catalog-gspp/ }));
    expect(within(main()).getByRole('button', { name: 'Profil anlegen' })).toBeDisabled();
  });

  it('zeigt einen Katalog mit Ladefehler als nicht ladbar und nicht wählbar', async () => {
    const failed = { catalogKey: 'gspp', catalogDocument: null, catalog: null, verification: null, error: 'Netzfehler' } as unknown as LoadedCatalogState;
    renderArea(buildStationUrl(seeded.verbundId, 'profile'), { ...EMPTY_CATALOG_STATE, catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp', failed]]) });
    await openNewProfile('Paket');
    const radio = await within(main()).findByRole('radio', { name: /catalog-gspp/ });
    expect(radio.closest('label')!).toHaveTextContent('BSI-Katalog · nicht ladbar');
    expect(radio).toBeDisabled();
  });

  it('bindet ein Ziel des eigenen Verbunds lokal und bietet kein Ziel eines anderen Verbunds an', async () => {
    const catalog = await add(seeded.verbundId, local('catalog', '1.2.2', 'Zusatzkatalog'));
    await add(seeded.otherVerbundId, local('catalog', '1.2.2', 'Fremder Katalog'));
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Lokales Paket');
    expect(within(main()).queryByRole('radio', { name: /Fremder Katalog/ })).not.toBeInTheDocument();
    expect(within(main()).queryByRole('radio', { name: /Fremdes Profil/ })).not.toBeInTheDocument();
    fireEvent.click(await within(main()).findByRole('radio', { name: /Zusatzkatalog/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
    const [binding] = (await readStore((store) => store.listBindings())).filter((entry) => entry.fromLocalId === localId);
    expect(binding.target).toEqual({ kind: 'local', localId: catalog.localId });
    expect((await readStore((store) => store.getDocument(localId)))?.oscalVersion).toBe('1.2.2');
  });
});

describe('Bearbeiten, Autosave, Speichern und Export', () => {
  async function createdProfile() {
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket');
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
    return { localId, created: (await readStore((store) => store.getDocument(localId)))! };
  }

  it('sichert Änderungen als Entwurf ohne neue UUID und vergibt sie erst beim Speichern; danach ist der Export gültig', async () => {
    const { localId, created } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('radio', { name: 'Einzelne Anforderungen' }));
    fireEvent.click(await within(main()).findByRole('checkbox', { name: 'ac-1 auswählen' }, WAIT));
    await waitFor(async () => expect(await readStore((store) => store.getDraft(localId))).toBeDefined(), WAIT);
    const draft = await readStore((store) => store.getDraft(localId));
    expect(profileBody(draft as never).imports[0]['include-controls']).toEqual([{ 'with-ids': ['ac-1'] }]);
    expect(profileBody(draft as never).uuid).toBe(profileBody(created).uuid);
    expect(profileBody(draft as never).metadata['last-modified']).toBe(profileBody(created).metadata['last-modified']);
    expect(profileBody(await readStore((store) => store.getDocument(localId)))).toEqual(profileBody(created));

    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).getAllByText('Gültig').length).toBeGreaterThan(0), WAIT);
    const saved = await readStore((store) => store.getDocument(localId));
    expect(saved?.documentState).toBe('export-ready');
    expect(profileBody(saved).uuid).not.toBe(profileBody(created).uuid);
    expect(profileBody(saved).metadata['last-modified']).not.toBe(profileBody(created).metadata['last-modified']);
    expect(await readStore((store) => store.getDraft(localId))).toBeUndefined();

    fireEvent.click(within(main()).getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce(), WAIT);
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    const exported = JSON.parse(await blob.text());
    expect(filename).toBe('profile.json');
    expect(exported).toEqual(saved?.source);
    expect(JSON.stringify(exported)).not.toMatch(/localId|verbundId|savedAt|documentState|artifactKey/);
  });

  it('bindet einen Prüfpunkt ohne Dokumentänderung und schreibt erst die Freigabe als Aktion', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).getAllByText('Gültig').length).toBeGreaterThan(0), WAIT);
    const before = (await readStore((store) => store.getDocument(localId)))!;
    const beforeUuid = profileBody(before).uuid;
    const beforeModified = profileBody(before).metadata['last-modified'];

    await openTab(/^Prüfung/);
    fireEvent.click(await within(main()).findByRole('button', { name: 'Prüfpunkt setzen' }, WAIT));
    expect(await within(main()).findByText(/Letzter Prüfpunkt/, undefined, WAIT)).toBeInTheDocument();
    const checkpointed = (await readStore((store) => store.getDocument(localId)))!;
    expect(profileBody(checkpointed).uuid).toBe(beforeUuid);
    expect(profileBody(checkpointed).metadata['last-modified']).toBe(beforeModified);
    expect(profileBody(checkpointed).metadata.actions).toBeUndefined();

    fireEvent.change(within(main()).getByRole('combobox', { name: /^Rolle/ }), { target: { value: '__new' } });
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Neue Rolle (ID)' }), { target: { value: 'freigabe' } });
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Neue Rolle (Bezeichnung)' }), { target: { value: 'Freigabe' } });
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Neue Partei (Name)' }), { target: { value: 'Rechenzentrum' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Freigeben' }));

    await waitFor(() => expect(main().querySelector('[data-review-badge="approved"]')).toBeInTheDocument(), WAIT);
    const approved = (await readStore((store) => store.getDocument(localId)))!;
    const metadata = profileBody(approved).metadata as Record<string, unknown>;
    expect(metadata.roles).toEqual([{ id: 'freigabe', title: 'Freigabe' }]);
    expect(metadata.parties).toEqual([{ uuid: expect.any(String), type: 'organization', name: 'Rechenzentrum' }]);
    const [party] = metadata.parties as { uuid: string }[];
    expect(metadata.actions).toEqual([
      expect.objectContaining({
        type: 'approved',
        system: REVIEW_ACTIONS_SYSTEM,
        'responsible-parties': [{ 'role-id': 'freigabe', 'party-uuids': [party.uuid] }],
      }),
    ]);

    await openTab(/^Importe/);
    fireEvent.click(within(main()).getByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect(profileBody(await readStore((store) => store.getDocument(localId))).metadata['last-modified']).not.toBe(profileBody(approved).metadata['last-modified']), WAIT);
    await openTab(/^Prüfung/);
    await waitFor(() => expect(main().querySelector('[data-review-badge="stale"]')).toBeInTheDocument(), WAIT);
  });

  it('setzt das Freigabeformular nach Erfolg zurück und legt bei erneuter Freigabe keine doppelte Partei an', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).getAllByText('Gültig').length).toBeGreaterThan(0), WAIT);
    await openTab(/^Prüfung/);

    fireEvent.change(await within(main()).findByRole('combobox', { name: /^Rolle/ }, WAIT), { target: { value: '__new' } });
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Neue Rolle (ID)' }), { target: { value: 'freigabe' } });
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Neue Rolle (Bezeichnung)' }), { target: { value: 'Freigabe' } });
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Neue Partei (Name)' }), { target: { value: 'Rechenzentrum' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Freigeben' }));
    await waitFor(() => expect(main().querySelector('[data-review-badge="approved"]')).toBeInTheDocument(), WAIT);

    expect(within(main()).getByRole('combobox', { name: /^Rolle/ })).toHaveValue('');
    expect(within(main()).queryByRole('textbox', { name: 'Neue Rolle (ID)' })).not.toBeInTheDocument();
    const party = within(main()).getByRole('checkbox', { name: /Rechenzentrum/ });
    expect(party).not.toBeChecked();

    fireEvent.change(within(main()).getByRole('combobox', { name: /^Rolle/ }), { target: { value: 'freigabe' } });
    fireEvent.click(party);
    fireEvent.click(within(main()).getByRole('button', { name: 'Freigeben' }));
    await waitFor(async () => {
      const metadata = profileBody(await readStore((store) => store.getDocument(localId))).metadata as Record<string, unknown>;
      expect(metadata.actions).toHaveLength(2);
      expect(metadata.parties).toHaveLength(1);
    }, WAIT);
  });

  it('lädt nach einem Konflikt im Prüf-Tab den neuen Stand und gibt die Aktionen wieder frei', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).getAllByText('Gültig').length).toBeGreaterThan(0), WAIT);
    await openTab(/^Prüfung/);
    const current = (await readStore((store) => store.getDocument(localId)))!;
    await readStore((store) => store.saveDocument(localId, current.savedAt, null, externalProfile(current)));
    const checkpoint = await within(main()).findByRole('button', { name: 'Prüfpunkt setzen' }, WAIT);
    fireEvent.click(checkpoint);
    expect(await within(main()).findByText(/Der gespeicherte Stand hat sich geändert; die Prüfspur wurde neu geladen/)).toBeInTheDocument();
    const checkpointAgain = await within(main()).findByRole('button', { name: 'Prüfpunkt setzen' }, WAIT);
    await waitFor(() => expect(checkpointAgain).toBeEnabled(), WAIT);
    fireEvent.click(checkpointAgain);
    await waitFor(async () => {
      const trail = await readStore((store) => store.listReviewTrail(localId));
      expect(trail.trail).toHaveLength(1);
    }, WAIT);
    expect(await within(main()).findByText(/Letzter Prüfpunkt/, undefined, WAIT)).toBeInTheDocument();
  });

  it('erhält offene Eingaben bei einem fremden Speicherstand und überschreibt ihn nicht', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).getAllByText('Gültig').length).toBeGreaterThan(0), WAIT);
    await openTab(/^Prüfung/);
    const current = (await readStore((store) => store.getDocument(localId)))!;
    const draft = await readStore((store) => store.getDraft(localId));
    await openTab(/^Importe/);
    fireEvent.click(within(main()).getByRole('button', { name: '+ Muster' }));
    const external = await readStore((store) => store.saveDocument(localId, current.savedAt, draft?.savedAt ?? null, externalProfile(current)));
    expect(profileBody(external).metadata.title).toBe('Extern geändert');
    await openTab(/^Prüfung/);
    const reviewed = await within(main()).findByRole('button', { name: 'Als geprüft markieren' }, WAIT);
    fireEvent.click(reviewed);
    expect(await within(main()).findByText(/Der gespeicherte Stand hat sich geändert; die Prüfspur wurde neu geladen/)).toBeInTheDocument();
    expect(await within(main()).findByText(/Der gespeicherte Stand wurde in einem anderen Tab geändert\. Deine offenen Eingaben bleiben erhalten/)).toBeInTheDocument();
    const stored = (await readStore((store) => store.getDocument(localId)))!;
    expect(profileBody(stored).metadata.title).toBe('Extern geändert');
    await waitFor(() => expect(reviewed).toBeEnabled(), WAIT);
    fireEvent.click(reviewed);
    await waitFor(async () => {
      const trail = await readStore((store) => store.listReviewTrail(localId));
      expect(trail.trail.some((row) => row.kind === 'decision' && row.decision === 'reviewed')).toBe(true);
    }, WAIT);
  });

  it('behält eine Eingabe während des Speicherns als Arbeitsstand und sichert sie danach als Entwurf', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('radio', { name: 'Einzelne Anforderungen' }));
    const checkbox = await within(main()).findByRole('checkbox', { name: 'ac-1 auswählen' }, WAIT);
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    fireEvent.click(checkbox);
    await waitFor(async () => expect((await readStore((store) => store.getDocument(localId)))?.documentState).toBe('export-ready'), WAIT);
    expect(within(main()).getByRole('checkbox', { name: 'ac-1 auswählen' })).toBeChecked();
    await waitFor(async () => {
      const draft = await readStore((store) => store.getDraft(localId));
      expect(profileBody(draft as never)?.imports[0]['include-controls']).toEqual([{ 'with-ids': ['ac-1'] }]);
    }, WAIT);
  });

  it('meldet ein gescheitertes Löschen und sichert offene Eingaben weiter', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const { StorageFailure, failure } = await import('@/adapters/workspaceStorageFailure');
    vi.spyOn(WorkspaceStore.prototype, 'deleteDocument').mockResolvedValue(failure(new StorageFailure('WORKSPACE_STORAGE_FAILED')));
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil löschen…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Endgültig löschen' }));
    expect(await within(main()).findByText('Das Profil wurde nicht gelöscht.', undefined, WAIT)).toBeInTheDocument();
    await waitFor(async () => expect(await readStore((store) => store.getDraft(localId))).toBeDefined(), WAIT);
  });

  it('sichert Eingaben, die während einer scheiternden Löschung entstehen', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const { StorageFailure, failure } = await import('@/adapters/workspaceStorageFailure');
    let rejectDelete: () => void = () => {};
    const deleting = vi.spyOn(WorkspaceStore.prototype, 'deleteDocument').mockImplementation(() => new Promise((resolve) => {
      rejectDelete = () => resolve(failure(new StorageFailure('WORKSPACE_STORAGE_FAILED')));
    }));
    const { localId } = await createdProfile();
    const addPattern = await within(main()).findByRole('button', { name: '+ Muster' });
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil löschen…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(() => expect(deleting).toHaveBeenCalled(), WAIT);
    fireEvent.click(addPattern);
    rejectDelete();
    expect(await within(main()).findByText('Das Profil wurde nicht gelöscht.', undefined, WAIT)).toBeInTheDocument();
    await waitFor(async () => expect(await readStore((store) => store.getDraft(localId))).toBeDefined(), WAIT);
  });

  it('verlässt die Dokumentroute erst, wenn die Sicherung eines laufenden Speicherns bestätigt ist', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const { StorageFailure, failure } = await import('@/adapters/workspaceStorageFailure');
    let failSave: () => void = () => {};
    vi.spyOn(WorkspaceStore.prototype, 'saveDocument').mockImplementation(() => new Promise((resolve) => {
      failSave = () => resolve(failure(new StorageFailure('WORKSPACE_STORAGE_FAILED')));
    }));
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket');
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    fireEvent.click(within(main()).getByRole('link', { name: /^Profile$/ }));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toMatch(/\/dokument\//);
    failSave();
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/\/dokument\//), WAIT);
    expect(await readStore((store) => store.getDraft(localId))).toBeDefined();
  });

  it('sichert eine Eingabe, die während der Navigationssicherung entsteht, vor dem Routenwechsel', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const saved: unknown[] = [];
    let finishFirst: () => void = () => {};
    const autosave = vi.spyOn(WorkspaceStore.prototype, 'autosaveDraft').mockImplementation((localId, _savedAt, _draftSavedAt, source) => {
      saved.push(source);
      if (saved.length === 1) {
        return new Promise((resolve) => {
          finishFirst = () => resolve({ ok: true, value: { localId, source, savedAt: '2026-10-20T00:00:01.000Z' } });
        });
      }
      return Promise.resolve({ ok: true, value: { localId, source, savedAt: '2026-10-20T00:00:02.000Z' } });
    });
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket');
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('link', { name: /^Profile$/ }));
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), WAIT);
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Muster 1' }), { target: { value: 'ac-*' } });
    finishFirst();
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/\/dokument\//), WAIT);
    expect(JSON.stringify(saved.at(-1))).toContain('"pattern":"ac-*"');
  });

  it('gibt die Navigation erst frei, wenn ein während der Sicherung begonnenes Speichern bestätigt ist', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const originalAutosave = WorkspaceStore.prototype.autosaveDraft;
    const originalSave = WorkspaceStore.prototype.saveDocument;
    let finishAutosave: () => void = () => {};
    let finishSave: () => void = () => {};
    const autosaves = vi.spyOn(WorkspaceStore.prototype, 'autosaveDraft').mockImplementation(function (this: WorkspaceStoreClass, ...args) {
      if (autosaves.mock.calls.length === 1) {
        return new Promise((resolve) => { finishAutosave = () => resolve(originalAutosave.call(this, ...args)); });
      }
      return originalAutosave.call(this, ...args);
    });
    const saves = vi.spyOn(WorkspaceStore.prototype, 'saveDocument').mockImplementation(function (this: WorkspaceStoreClass, ...args) {
      return new Promise((resolve) => { finishSave = () => resolve(originalSave.call(this, ...args)); });
    });
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket');
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('link', { name: /^Profile$/ }));
    await waitFor(() => expect(autosaves).toHaveBeenCalledTimes(1), WAIT);
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Muster 1' }), { target: { value: 'ac-*' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    finishAutosave();
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(1), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toMatch(/\/dokument\//);
    finishSave();
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/\/dokument\//), WAIT);
    expect(JSON.stringify((await readStore((store) => store.getDocument(localId)))?.source)).toContain('"pattern":"ac-*"');
  });

  it('gibt die Navigation erst frei, wenn ein während des Autosave begonnenes Speichern ohne weitere Eingabe bestätigt ist', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const originalAutosave = WorkspaceStore.prototype.autosaveDraft;
    const originalSave = WorkspaceStore.prototype.saveDocument;
    let finishAutosave: () => void = () => {};
    let finishSave: () => void = () => {};
    const autosaves = vi.spyOn(WorkspaceStore.prototype, 'autosaveDraft').mockImplementation(function (this: WorkspaceStoreClass, ...args) {
      if (autosaves.mock.calls.length === 1) {
        return new Promise((resolve) => { finishAutosave = () => resolve(originalAutosave.call(this, ...args)); });
      }
      return originalAutosave.call(this, ...args);
    });
    const saves = vi.spyOn(WorkspaceStore.prototype, 'saveDocument').mockImplementation(function (this: WorkspaceStoreClass, ...args) {
      return new Promise((resolve) => { finishSave = () => resolve(originalSave.call(this, ...args)); });
    });
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket');
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('link', { name: /^Profile$/ }));
    await waitFor(() => expect(autosaves).toHaveBeenCalledTimes(1), WAIT);
    // Kein weiterer Arbeitsstand: der Autosave endet erfolgreich, während das Speichern noch läuft.
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    finishAutosave();
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(1), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toMatch(/\/dokument\//);
    finishSave();
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/\/dokument\//), WAIT);
  });

  it('sichert den neuesten Stand, wenn das während der Sicherung begonnene Speichern scheitert', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const { StorageFailure, failure } = await import('@/adapters/workspaceStorageFailure');
    const originalAutosave = WorkspaceStore.prototype.autosaveDraft;
    let finishAutosave: () => void = () => {};
    let finishSave: () => void = () => {};
    const autosaves = vi.spyOn(WorkspaceStore.prototype, 'autosaveDraft').mockImplementation(function (this: WorkspaceStoreClass, ...args) {
      if (autosaves.mock.calls.length === 1) {
        return new Promise((resolve) => { finishAutosave = () => resolve(originalAutosave.call(this, ...args)); });
      }
      return originalAutosave.call(this, ...args);
    });
    const saves = vi.spyOn(WorkspaceStore.prototype, 'saveDocument').mockImplementation(() => new Promise((resolve) => {
      finishSave = () => resolve(failure(new StorageFailure('WORKSPACE_STORAGE_FAILED')));
    }));
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket');
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('link', { name: /^Profile$/ }));
    await waitFor(() => expect(autosaves).toHaveBeenCalledTimes(1), WAIT);
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Muster 1' }), { target: { value: 'ac-*' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    finishAutosave();
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(1), WAIT);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(router.state.location.pathname).toMatch(/\/dokument\//);
    finishSave();
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/\/dokument\//), WAIT);
    await waitFor(async () => expect(JSON.stringify((await readStore((store) => store.getDraft(localId)))?.source)).toContain('"pattern":"ac-*"'), WAIT);
  });

  it('bleibt bei einem Fehler der letzten Sicherung während der Navigation auf der Dokumentroute', async () => {
    const { WorkspaceStore } = await import('@/adapters/workspaceStore');
    const { StorageFailure, failure } = await import('@/adapters/workspaceStorageFailure');
    let finishFirst: () => void = () => {};
    const autosave = vi.spyOn(WorkspaceStore.prototype, 'autosaveDraft').mockImplementation((localId, _savedAt, _draftSavedAt, source) => {
      if (autosave.mock.calls.length === 1) {
        return new Promise((resolve) => {
          finishFirst = () => resolve({ ok: true, value: { localId, source, savedAt: '2026-10-20T00:00:01.000Z' } });
        });
      }
      return Promise.resolve(failure(new StorageFailure('WORKSPACE_STORAGE_FAILED')));
    });
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await openNewProfile('Paket');
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil anlegen' }));
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('link', { name: /^Profile$/ }));
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(1), WAIT);
    fireEvent.change(within(main()).getByRole('textbox', { name: 'Muster 1' }), { target: { value: 'ac-*' } });
    finishFirst();
    await waitFor(() => expect(autosave).toHaveBeenCalledTimes(2), WAIT);
    expect(await within(main()).findByText('Sicherung fehlgeschlagen', undefined, WAIT)).toBeInTheDocument();
    expect(router.state.location.pathname).toMatch(/\/dokument\//);
    expect(within(main()).getByRole('textbox', { name: 'Muster 1' })).toHaveValue('ac-*');
  });

  it('sichert offene Eingaben sofort, wenn der Editor innerhalb des Bereichs verlassen wird', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('link', { name: /^Profile$/ }));
    await waitFor(async () => expect(await readStore((store) => store.getDraft(localId))).toBeDefined(), WAIT);
  });

  it('löscht ein Profil nach Bestätigung samt Entwurf und Bindung', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Profil löschen…' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(async () => expect(await readStore((store) => store.getDocument(localId))).toBeUndefined(), WAIT);
    expect(await readStore((store) => store.getDraft(localId))).toBeUndefined();
    expect((await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === localId)).toEqual([]);
    expect(await within(main()).findByRole('button', { name: 'Neues Profil' }, WAIT)).toBeInTheDocument();
  });

  it('speichert einen schemawidrigen Stand nur als Entwurf und exportiert ihn nicht', async () => {
    const { localId } = await createdProfile();
    fireEvent.click(await within(main()).findByRole('button', { name: '+ Muster' }));
    fireEvent.change(await within(main()).findByRole('textbox', { name: 'Muster 1' }), { target: { value: 'ac-* ' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    expect(await within(main()).findByText(/als Entwurf gespeichert/, undefined, WAIT)).toBeInTheDocument();
    expect((await readStore((store) => store.getDocument(localId)))?.documentState).toBe('draft');
    expect(within(main()).getByRole('button', { name: 'Export' })).toBeDisabled();
  });
});

describe('Kopie eines eingelesenen Profils', () => {
  it('nimmt eine 1.1.3-Profildatei über das Importgate auf und behält ihre Version über das Speichern', async () => {
    const source = makeProfileSource(profileSpecFor('profile-gspp'));
    const { router } = renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await within(main()).findByRole('button', { name: 'Profil-Datei einlesen' });
    const input = main().querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(source)], 'profil.json', { type: 'application/json' })] } });
    await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
    const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
    expect(await readStore((store) => store.getDocument(localId))).toMatchObject({ documentState: 'imported', oscalVersion: '1.1.3', source });

    const [exclusions] = await within(main()).findAllByRole('region', { name: 'Ausschlüsse' }, WAIT);
    fireEvent.click(within(exclusions).getByRole('button', { name: '+ Anforderung' }));
    fireEvent.change(within(exclusions).getByRole('textbox', { name: 'ID der Anforderung' }), { target: { value: 'GC.1.1' } });
    fireEvent.click(within(exclusions).getByRole('button', { name: 'Hinzufügen' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect((await readStore((store) => store.getDocument(localId)))?.documentState).toBe('export-ready'), WAIT);
    const saved = await readStore((store) => store.getDocument(localId));
    expect(saved?.oscalVersion).toBe('1.1.3');
    expect(profileBody(saved).metadata['oscal-version']).toBe('1.1.3');
    expect(profileBody(saved).imports[0]['exclude-controls']).toEqual([{ 'with-ids': ['GC.1.1'] }]);
    expect(profileBody(saved)['back-matter']).toEqual((source.profile as Record<string, unknown>)['back-matter']);
  });

  it('weist eine übergroße Datei vor dem Lesen ab', async () => {
    renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await within(main()).findByRole('button', { name: 'Profil-Datei einlesen' });
    const file = new File(['{}'], 'gross.json');
    Object.defineProperty(file, 'size', { value: CLASS_2_IMPORT_LIMITS.maxBytes + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    fireEvent.change(main().querySelector<HTMLInputElement>('input[type="file"]')!, { target: { files: [file] } });
    expect(await within(main()).findByRole('alert', undefined, WAIT)).toHaveTextContent('Nicht aufgenommen');
    expect(read).not.toHaveBeenCalled();
    expect(within(main()).getByRole('button', { name: 'Profil-Datei einlesen' })).toBeEnabled();
  });

  it('weist eine Datei ab, die kein Profile ist', async () => {
    renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await within(main()).findByRole('button', { name: 'Profil-Datei einlesen' });
    const input = main().querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))], 'katalog.json')] } });
    expect(await within(main()).findByRole('alert', undefined, WAIT)).toHaveTextContent('Nicht aufgenommen');
    expect(await storedProfiles(seeded.verbundId)).toHaveLength(1);
  });
});

describe('Fremddokumente bleiben erhalten', () => {
  it('nimmt ein 1.2.x-Profil ohne href an, zeigt die Graphdiagnose und schreibt nichts', async () => {
    const profile = await add(seeded.verbundId, local('profile', '1.2.2', 'Ohne Quellbezug', (body) => {
      body.imports = [{ 'include-all': {} }];
      body.modify = {};
    }));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withGspp());
    const diagnostics = await openDiagnostics();
    expect(diagnostics).toHaveTextContent('OSCAL_GRAPH_IMPORT_SOURCE_MISSING');
    expect(diagnostics).toHaveTextContent('modify ohne Inhalt');
    expect(within(main()).queryByRole('button', { name: 'Importziel zuordnen' })).not.toBeInTheDocument();
    expect(await readStore((store) => store.getDraft(profile.localId))).toBeUndefined();
    expect((await readStore((store) => store.getDocument(profile.localId)))?.source).toEqual(profile.source);
  });

  it('meldet gemischte Versionen mit PROFILE_RESOLUTION_VERSION_MISMATCH und bietet kein Ziel anderer Version an', async () => {
    const catalog = await add(seeded.verbundId, local('catalog', '1.1.3', 'Alter Katalog'));
    const profile = await add(seeded.verbundId, local('profile', '1.2.2', 'Gemischt'));
    const href = profileBody(profile).imports[0].href as string;
    await readStore((store) => store.setBinding({ fromLocalId: profile.localId, pointer: '/profile/imports/0/href', href, target: { kind: 'local', localId: catalog.localId } }, profile.savedAt));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withGspp());
    expect(await openDiagnostics()).toHaveTextContent('PROFILE_RESOLUTION_VERSION_MISMATCH');
    fireEvent.click(within(main()).getByRole('button', { name: '+ Import hinzufügen' }));
    const menu = within(main()).getByRole('group', { name: 'Importziel' });
    expect(within(menu).getByRole('button', { name: /Alter Katalog/ })).toBeDisabled();
    expect(within(menu).getByRole('button', { name: /catalog-gspp/ })).toBeDisabled();
    expect((await readStore((store) => store.getDocument(profile.localId)))?.oscalVersion).toBe('1.2.2');
  });

  it('behält zwei Bindungen desselben href an ihren Pointern über das Speichern', async () => {
    const first = await add(seeded.verbundId, local('catalog', '1.2.2', 'Katalog A'));
    const second = await add(seeded.verbundId, local('catalog', '1.2.2', 'Katalog B'));
    const profile = await add(seeded.verbundId, local('profile', '1.2.2', 'Doppelt', (body) => {
      const [entry] = body.imports as Record<string, unknown>[];
      body.imports = [entry, { href: entry.href, 'include-all': {} }];
    }));
    const href = profileBody(profile).imports[0].href as string;
    for (const [index, target] of [[0, first], [1, second]] as const) {
      const current = (await readStore((store) => store.getDocument(profile.localId)))!;
      await readStore((store) => store.setBinding({ fromLocalId: profile.localId, pointer: `/profile/imports/${index}/href`, href, target: { kind: 'local', localId: target.localId } }, current.savedAt));
    }
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withGspp());
    fireEvent.click(await within(main()).findByRole('button', { name: 'Speichern' }, WAIT));
    await waitFor(async () => expect((await readStore((store) => store.getDocument(profile.localId)))?.documentState).toBe('export-ready'), WAIT);
    const bindings = (await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === profile.localId);
    expect(bindings.map((binding) => [binding.pointer, binding.target])).toEqual([
      ['/profile/imports/0/href', { kind: 'local', localId: first.localId }],
      ['/profile/imports/1/href', { kind: 'local', localId: second.localId }],
    ]);
  });

  it('gibt die Bindung eines entfernten Imports nicht an den nachrückenden weiter', async () => {
    const first = await add(seeded.verbundId, local('catalog', '1.2.2', 'Katalog A'));
    const second = await add(seeded.verbundId, local('catalog', '1.2.2', 'Katalog B'));
    const profile = await add(seeded.verbundId, local('profile', '1.2.2', 'Doppelt', (body) => {
      const [entry] = body.imports as Record<string, unknown>[];
      body.imports = [entry, { href: entry.href, 'include-all': {} }];
    }));
    const href = profileBody(profile).imports[0].href as string;
    for (const [index, target] of [[0, first], [1, second]] as const) {
      const current = (await readStore((store) => store.getDocument(profile.localId)))!;
      await readStore((store) => store.setBinding({ fromLocalId: profile.localId, pointer: `/profile/imports/${index}/href`, href, target: { kind: 'local', localId: target.localId } }, current.savedAt));
    }
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withGspp());
    fireEvent.click(await within(main()).findByRole('button', { name: 'Import 1 entfernen' }, WAIT));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect(profileBody(await readStore((store) => store.getDocument(profile.localId))).imports).toHaveLength(1), WAIT);
    const bindings = (await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === profile.localId);
    expect(bindings.map((binding) => [binding.pointer, binding.target])).toEqual([['/profile/imports/0/href', { kind: 'local', localId: second.localId }]]);
  });

  it('ordnet ein Importziel nur dem gewählten von zwei ungebundenen Importen gleichen href zu', async () => {
    const catalog = await add(seeded.verbundId, local('catalog', '1.2.2', 'Katalog A'));
    const profile = await add(seeded.verbundId, local('profile', '1.2.2', 'Ungebunden', (body) => {
      const [entry] = body.imports as Record<string, unknown>[];
      body.imports = [entry, { href: entry.href, 'include-all': {} }];
    }));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withGspp());
    const [assign] = await within(main()).findAllByRole('button', { name: 'Importziel zuordnen' }, WAIT);
    fireEvent.click(assign);
    fireEvent.click(within(within(main()).getByRole('group', { name: 'Importziel' })).getByRole('button', { name: /Katalog A/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect((await readStore((store) => store.getDocument(profile.localId)))?.documentState).toBe('export-ready'), WAIT);
    const bindings = (await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === profile.localId);
    expect(bindings.map((binding) => [binding.pointer, binding.target])).toEqual([['/profile/imports/0/href', { kind: 'local', localId: catalog.localId }]]);
  });

  it('zeigt nach dem Entfernen eines Imports keine Anforderungen des alten Ziels beim nachrückenden', async () => {
    const first = await add(seeded.verbundId, local('catalog', '1.2.2', 'Katalog A'));
    const second = await add(seeded.verbundId, local('catalog', '1.2.2', 'Katalog B', (body) => {
      ((body.groups as Record<string, unknown>[])[0].controls as Record<string, unknown>[])[0].id = 'zz-9';
    }));
    const otherHref = '#0c0c0c0c-0000-4000-8000-000000000001';
    const profile = await add(seeded.verbundId, local('profile', '1.2.2', 'Zwei Ziele', (body) => {
      const [entry] = body.imports as Record<string, unknown>[];
      body.imports = [entry, { href: otherHref, 'include-controls': [{ 'with-ids': ['zz-9'] }] }];
    }));
    const href = profileBody(profile).imports[0].href as string;
    for (const [index, target, pointerHref] of [[0, first, href], [1, second, otherHref]] as const) {
      const current = (await readStore((store) => store.getDocument(profile.localId)))!;
      await readStore((store) => store.setBinding({ fromLocalId: profile.localId, pointer: `/profile/imports/${index}/href`, href: pointerHref, target: { kind: 'local', localId: target.localId } }, current.savedAt));
    }
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, profile.localId), withGspp());
    await within(main()).findByRole('checkbox', { name: 'zz-9 auswählen' }, WAIT);
    fireEvent.click(within(main()).getByRole('button', { name: 'Import 1 entfernen' }));
    expect(within(main()).queryByRole('checkbox', { name: 'ac-1 auswählen' })).not.toBeInTheDocument();
    expect(await within(main()).findByRole('checkbox', { name: 'zz-9 auswählen' }, WAIT)).toBeChecked();
  });

  it('bricht einen zirkulären Import mit Fehler ab', async () => {
    const first = await add(seeded.verbundId, local('profile', '1.2.2', 'Erstes'));
    const second = await add(seeded.verbundId, local('profile', '1.2.2', 'Zweites'));
    const href = profileBody(first).imports[0].href as string;
    await readStore((store) => store.setBinding({ fromLocalId: first.localId, pointer: '/profile/imports/0/href', href, target: { kind: 'local', localId: second.localId } }, first.savedAt));
    await readStore((store) => store.setBinding({ fromLocalId: second.localId, pointer: '/profile/imports/0/href', href, target: { kind: 'local', localId: first.localId } }, second.savedAt));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, first.localId), withGspp());
    const diagnostics = await openDiagnostics();
    expect(diagnostics.querySelector('[data-outcome="failed"]')).toHaveTextContent(/CYCLE/);
    expect(diagnostics).not.toHaveTextContent('Anforderungen aufgelöst');
  });
});
