import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { downloadBlob } from '@/adapters/browserDownload';
import type { CatalogState, LoadedCatalogState } from '@/domain/models';
import type { OscalRootKey, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { DocumentState, LocalId, VerbundId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { makeProfileSource, profileSpecFor } from '@/test/fixtures/profiles';
import { EMPTY_CATALOG_STATE, mainLandmark as main, renderWorkspaceArea as renderArea } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
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

function withGspp(): CatalogState {
  const loaded = { catalogKey: 'gspp', catalogDocument: { source: makeSchemaValidOscalDocument('catalog', '1.1.3') }, verification: { valid: true } } as unknown as LoadedCatalogState;
  return { ...EMPTY_CATALOG_STATE, catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp', loaded]]) };
}

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

  it('weist eine Datei ab, die kein Profile ist', async () => {
    renderArea(buildStationUrl(seeded.verbundId, 'profile'), withGspp());
    await within(main()).findByRole('button', { name: 'Profil-Datei einlesen' });
    const input = main().querySelector<HTMLInputElement>('input[type="file"]')!;
    fireEvent.change(input, { target: { files: [new File([JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))], 'katalog.json')] } });
    expect(await within(main()).findByRole('status', undefined, WAIT)).toHaveTextContent('Nicht aufgenommen');
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
