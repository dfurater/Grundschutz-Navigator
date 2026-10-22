import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { downloadBlob } from '@/adapters/browserDownload';
import type { CatalogState, LoadedCatalogState } from '@/domain/models';
import { PINNED_OSCAL_VERSIONS, type PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import type { CatalogKey } from '@/domain/sourceRegistry';
import type { LocalId, VerbundId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { makeFullSsp, makeMinimalSsp, SSP_FIXTURE_IDS, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import { EMPTY_CATALOG_STATE, mainLandmark as main, renderWorkspaceArea as renderArea } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/workspaceNodeWorkers')).inProcessReviewTrailWork());
vi.mock('@/adapters/browserDownload', () => ({ downloadBlob: vi.fn() }));
// Desktop-Stufe: rechtes Panel mit Export und Speichern; die Mobilstufe deckt die Browser-Lane ab.
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));

/*
 * SSP-Station (GSPP-609): Neuanlage mit Baseline-Wahl, Formulare,
 * Autosave, explizites Speichern mit unveränderter Root-UUID und validierter
 * Export. Speicher ist `fake-indexeddb`; ohne `Worker`-API laufen Schema und
 * Export im Prozess.
 */

const WAIT = { timeout: 4000 };
let seeded: SeededWorkspace;

beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => {
  vi.mocked(downloadBlob).mockReset();
  vi.restoreAllMocks();
  await resetWorkspace();
});

/** catalog-gspp mit bestandener Hashprüfung und zwei Anforderungen. */
function withGspp(): CatalogState {
  const loaded = {
    catalogKey: 'gspp', catalogDocument: { source: makeSchemaValidOscalDocument('catalog', '1.1.3') }, verification: { valid: true },
    catalog: { metadata: { title: 'Anwenderkatalog' }, controls: [{ id: 'GC.1.1' }, { id: 'GC.1.2' }] },
  } as unknown as LoadedCatalogState;
  return { ...EMPTY_CATALOG_STATE, catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp', loaded]]) };
}

function sspBody(envelope: WorkspaceEnvelope | undefined) {
  return (envelope?.source as { 'system-security-plan': { uuid: string; metadata: Record<string, string>; 'import-profile': { href: string } } })['system-security-plan'];
}

async function addSsp(verbundId: VerbundId, source: Record<string, unknown>, oscalVersion: PinnedOscalVersion = '1.2.2') {
  return readStore((store) => store.addDocument(verbundId, { source: JSON.parse(JSON.stringify(source)), context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion }));
}

/** Feld über seinen vollständigen OSCAL-Schlüssel; „Pflicht“ darf folgen. */
const field = (key: string) => within(main()).findByLabelText(new RegExp(`${key.replaceAll('.', String.raw`\.`)}(Pflicht)?$`), undefined, WAIT);
const type = async (key: string, value: string) => fireEvent.change(await field(key), { target: { value } });
const click = async (name: string | RegExp) => fireEvent.click(await within(main()).findByRole('button', { name }, WAIT));

async function createSsp(title = 'Plan Rechenzentrum') {
  const { router } = renderArea(buildStationUrl(seeded.verbundId, 'ssp'), withGspp());
  await click('Neues SSP');
  fireEvent.change(within(main()).getByRole('textbox', { name: /^Titel/ }), { target: { value: title } });
  return router;
}

async function created(router: ReturnType<typeof renderArea>['router']) {
  await waitFor(() => expect(router.state.location.pathname).toMatch(/\/dokument\//), WAIT);
  const localId = router.state.location.pathname.split('/').at(-1) as LocalId;
  return { localId, document: (await readStore((store) => store.getDocument(localId)))! };
}

/** Füllt jede Pflichtstruktur eines neuen 1.2.2-SSP über die Formulare. */
async function fillRequired() {
  await click('Systemkennung hinzufügen');
  await type('system-characteristics.system-ids.id', 'SYS-1');
  await type('system-characteristics.system-name', 'Rechenzentrum');
  await type('system-characteristics.description', 'Ein synthetisches System.');
  await type('system-characteristics.status.state', 'operational');
  await type('system-characteristics.authorization-boundary.description', 'Grenze.');
  await click('Informationsart hinzufügen');
  await type('system-characteristics.system-information.information-types.title', 'Betriebsdaten');
  await type('system-characteristics.system-information.information-types.description', 'Synthetisch.');
  await click('Komponente hinzufügen');
  await type('system-implementation.components.title', 'Server');
  await type('system-implementation.components.type', 'this-system');
  await type('system-implementation.components.description', 'Ein Server.');
  await type('system-implementation.components.status.state', 'operational');
  await type('control-implementation.description', 'Umsetzung.');
  fireEvent.change(await within(main()).findByLabelText(/^Neue Anforderung/), { target: { value: 'GC.1.1' } });
  await click('Anforderung hinzufügen');
}

describe('Neuanlage mit Baseline-Wahl', () => {
  it('speichert vor der Baseline-Wahl nichts und legt danach einen gebundenen 1.2.2-Entwurf an', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const before = (await readStore((store) => store.listDocuments(seeded.verbundId))).length;
    const router = await createSsp();
    const create = within(main()).getByRole('button', { name: 'SSP anlegen' });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(await readStore((store) => store.listDocuments(seeded.verbundId))).toHaveLength(before);
    expect(within(main()).queryByRole('radio', { name: /Fremdes Profil/ })).not.toBeInTheDocument();

    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(create);
    const { localId, document: stored } = await created(router);
    const body = sspBody(stored);
    expect(stored).toMatchObject({ documentState: 'draft', oscalVersion: '1.2.2', trustClass: 'class-2-local-user' });
    expect(stored.derivedFrom).toBeUndefined();
    expect(body.metadata).toMatchObject({ title: 'Plan Rechenzentrum', version: '1.0', 'oscal-version': '1.2.2' });
    expect(body.metadata['last-modified']).toMatch(/Z$/);
    expect(body['import-profile'].href).toMatch(/^#[0-9a-f-]{36}$/);
    expect((await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === localId)).toEqual([
      { fromLocalId: localId, pointer: '/system-security-plan/import-profile/href', href: body['import-profile'].href, target: { kind: 'class-1', artifactKey: 'catalog-gspp' } },
    ]);
    expect(await within(main()).findByText('Entwurf')).toBeInTheDocument();
    expect(within(main()).getByRole('region', { name: 'Offene Pflichtstruktur' })).toHaveTextContent('/system-security-plan/system-implementation/components');
    expect(within(main()).getByRole('button', { name: 'Export' })).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(router.state.location)).not.toContain('Plan Rechenzentrum');
    expect(document.title).not.toContain('Plan Rechenzentrum');
  });
});

describe('Formulare, Speichern und Export', () => {
  it('führt ein neues SSP bis export-ready; die Root-UUID bleibt, last-modified wechselt nur mit Inhalt', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const router = await createSsp();
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'SSP anlegen' }));
    const { localId, document: start } = await created(router);
    await fillRequired();
    expect(await within(main()).findByText('Keine offene Pflichtstruktur.')).toBeInTheDocument();
    // Autosave schreibt den Entwurf und lässt UUID und last-modified unverändert.
    await waitFor(async () => expect(await readStore((store) => store.getDraft(localId))).toBeDefined(), WAIT);
    const draft = await readStore((store) => store.getDraft(localId));
    expect(sspBody(draft as never).uuid).toBe(sspBody(start).uuid);
    expect(sspBody(draft as never).metadata['last-modified']).toBe(sspBody(start).metadata['last-modified']);

    await click('Speichern');
    await waitFor(() => expect(within(main()).getAllByText('Gültig').length).toBeGreaterThan(0), WAIT);
    const saved = (await readStore((store) => store.getDocument(localId)))!;
    expect(saved.documentState).toBe('export-ready');
    expect(sspBody(saved).uuid).toBe(sspBody(start).uuid);
    expect(sspBody(saved).metadata['last-modified']).not.toBe(sspBody(start).metadata['last-modified']);

    // Speichern ohne Inhaltsänderung lässt last-modified unverändert.
    await click('Speichern');
    await waitFor(async () => expect((await readStore((store) => store.getDocument(localId)))!.savedAt).not.toBe(saved.savedAt), WAIT);
    expect(sspBody(await readStore((store) => store.getDocument(localId))).metadata['last-modified']).toBe(sspBody(saved).metadata['last-modified']);

    await click('Export');
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledOnce(), WAIT);
    const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
    const exported = JSON.parse(await blob.text());
    expect(filename).toBe('ssp.json');
    expect(exported).toEqual((await readStore((store) => store.getDocument(localId)))!.source);
    expect(JSON.stringify(exported)).not.toMatch(/localId|verbundId|savedAt|documentState|artifactKey/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('speichert einen Entwurf mit offener Pflichtstruktur lokal und bietet keinen Export', async () => {
    const router = await createSsp();
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'SSP anlegen' }));
    const { localId } = await created(router);
    await type('system-characteristics.system-name', 'Nur ein Name');
    await click('Speichern');
    expect(await within(main()).findByText(/als Entwurf gespeichert/, undefined, WAIT)).toBeInTheDocument();
    const saved = await readStore((store) => store.getDocument(localId));
    expect(saved?.documentState).toBe('draft');
    expect((saved?.source as Record<string, Record<string, Record<string, string>>>)['system-security-plan']['system-characteristics']['system-name']).toBe('Nur ein Name');
    expect(within(main()).getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it.each(PINNED_OSCAL_VERSIONS)('%s: ein importiertes SSP behält seine oscal-version beim Speichern', async (version) => {
    const imported = await addSsp(seeded.verbundId, makeMinimalSsp(version), version);
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, imported.localId), withGspp());
    await type('metadata.title', `Geändert ${version}`);
    await click('Speichern');
    await waitFor(async () => expect((await readStore((store) => store.getDocument(imported.localId)))!.savedAt).not.toBe(imported.savedAt), WAIT);
    const saved = (await readStore((store) => store.getDocument(imported.localId)))!;
    expect(saved).toMatchObject({ oscalVersion: version, documentState: 'export-ready' });
    expect(sspBody(saved).metadata['oscal-version']).toBe(version);
    expect(sspBody(saved).uuid).toBe(sspBody(imported).uuid);
  });

  it('führt users nur in 1.1.x als Pflicht', async () => {
    const legacy = await addSsp(seeded.verbundId, makeMinimalSsp('1.1.3'), '1.1.3');
    const { unmount } = renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, legacy.localId), withGspp());
    expect((await within(main()).findByRole('region', { name: /^Benutzer/ }, WAIT))).toHaveTextContent('Pflicht');
    unmount();
    const current = await addSsp(seeded.verbundId, makeMinimalSsp('1.2.2'));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, current.localId), withGspp());
    expect((await within(main()).findByRole('region', { name: /^Benutzer/ }, WAIT))).not.toHaveTextContent('Pflicht');
  });
});

describe('Referenzen und Bindungen', () => {
  it('weist das Entfernen einer referenzierten Komponente ab und speichert keine dangling component-uuid', async () => {
    const full = await addSsp(seeded.verbundId, makeFullSsp());
    const { unmount } = renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, full.localId), withGspp());
    await click(/^Komponente 1 · Gesamtsystem entfernen$/);
    expect(await within(main()).findByText(/Eine Umsetzungsaussage verweist auf sie/)).toBeInTheDocument();
    expect(within(main()).getByRole('listitem', { name: /Komponente 1 · Gesamtsystem/ })).toBeInTheDocument();
    unmount();

    const dangling = await addSsp(seeded.verbundId, withSspBody(makeFullSsp(), (body) => { body['system-implementation'].components.pop(); }));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, dangling.localId), withGspp());
    await type('metadata.title', 'Geändert');
    await click('Speichern');
    expect(await within(main()).findByText(/component-uuid zeigt auf keine Komponente/, undefined, WAIT)).toBeInTheDocument();
    expect((await readStore((store) => store.getDocument(dangling.localId)))!.savedAt).toBe(dangling.savedAt);
  });

  it('wechselt die Baseline über die Bindung; ohne Baseline ist die control-id nicht auflösbar', async () => {
    const imported = await addSsp(seeded.verbundId, makeFullSsp());
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, imported.localId), withGspp());
    const requirements = await within(main()).findByRole('region', { name: /^Anforderungen/ }, WAIT);
    expect(requirements).toHaveTextContent('nicht auflösbar im aktuellen Kontext');
    expect(within(main()).queryByRole('radio', { name: /Fremdes Profil/ })).not.toBeInTheDocument();

    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    await waitFor(() => expect(requirements).not.toHaveTextContent('nicht auflösbar im aktuellen Kontext'));
    await click('Speichern');
    await waitFor(async () => {
      const bindings = (await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === imported.localId);
      expect(bindings).toEqual([{
        fromLocalId: imported.localId, pointer: '/system-security-plan/import-profile/href', href: `#${SSP_FIXTURE_IDS.baselineResource}`,
        target: { kind: 'class-1', artifactKey: 'catalog-gspp' },
      }]);
    }, WAIT);
  });

  it('erhält eingehende import-ssp-Bindungen beim Speichern; die Kante bleibt aufgelöst', async () => {
    const ap = seeded.assessmentPlan;
    const href = (ap.source as { 'assessment-plan': { 'import-ssp': { href: string } } })['assessment-plan']['import-ssp'].href;
    const binding = { fromLocalId: ap.localId, pointer: '/assessment-plan/import-ssp/href', href, target: { kind: 'local' as const, localId: seeded.ssp.localId } };
    await readStore((store) => store.setBinding(binding, ap.savedAt));
    const { unmount } = renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId), withGspp());
    await type('metadata.title', 'Neuer SSP-Titel');
    await click('Speichern');
    await waitFor(async () => expect((await readStore((store) => store.getDocument(seeded.ssp.localId)))!.savedAt).not.toBe(seeded.ssp.savedAt), WAIT);
    expect(await readStore((store) => store.listBindings())).toContainEqual(binding);
    unmount();

    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ap.localId), withGspp());
    const edges = await within(main()).findByRole('region', { name: 'Referenzkanten' }, WAIT);
    await waitFor(() => expect(edges.querySelector('[data-edge-state="resolved"]')).toHaveTextContent('/assessment-plan/import-ssp/href'), WAIT);
  });
});

describe('Listenzeilen und Löschung', () => {
  it('hält Eingaben beim Hinzufügen, Entfernen und Verschieben an ihrer Zeile', async () => {
    const imported = await addSsp(seeded.verbundId, makeMinimalSsp('1.2.2'));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, imported.localId), withGspp());
    await click('Rolle hinzufügen');
    await click('Rolle hinzufügen');
    const ids = () => within(main()).getAllByLabelText(/^Kennung metadata\.roles\.id/) as HTMLInputElement[];
    fireEvent.change(ids()[0], { target: { value: 'erste' } });
    fireEvent.change(ids()[1], { target: { value: 'zweite' } });
    const second = ids()[1];
    await click('Rolle 2 · zweite nach oben');
    expect(ids()[0]).toBe(second);
    expect(ids().map((input) => input.value)).toEqual(['zweite', 'erste']);
    await click('Rolle 1 · zweite entfernen');
    expect(ids()).toHaveLength(1);
    expect(ids()[0].value).toBe('erste');
  });

  it('löscht ein SSP erst nach Bestätigung samt Bindungen', async () => {
    const { router } = renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, seeded.ssp.localId), withGspp());
    await click('SSP löschen…');
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(buildStationUrl(seeded.verbundId, 'ssp')), WAIT);
    expect(await readStore((store) => store.getDocument(seeded.ssp.localId))).toBeUndefined();
    expect((await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === seeded.ssp.localId)).toEqual([]);
  });
});
