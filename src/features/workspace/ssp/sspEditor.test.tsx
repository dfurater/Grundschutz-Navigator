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
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { makeFullSsp, makeMinimalSsp, SSP_FIXTURE_IDS, withSspBody } from '@/test/fixtures/systemSecurityPlans';
import { mainLandmark as main, renderWorkspaceArea as renderArea, withLoadedCatalog } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';
import { withSspCategories, SSP_CATEGORY_IDS } from '@/test/fixtures/sspCategories';

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
  const state = withLoadedCatalog(true);
  const loaded = state.catalogs.get('gspp' as CatalogKey)!;
  const catalog = { metadata: { title: 'Anwenderkatalog' }, controls: [{ id: 'GC.1.1' }, { id: 'GC.1.2' }] };
  return { ...state, catalogs: new Map<CatalogKey, LoadedCatalogState>([['gspp' as CatalogKey, { ...loaded, catalog } as unknown as LoadedCatalogState]]) };
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

describe('Zielobjektbestand', () => {
  it('übernimmt bei offenen Bewertungseingaben keine UUID-lose Umordnung aus einem anderen Tab', async () => {
    const source = withSspBody(makeFullSsp(), body => {
      const first = body['system-characteristics']['system-information']!['information-types']![0];
      delete first.uuid;
      body['system-characteristics']['system-information']!['information-types']!.push({ ...structuredClone(first), title: 'Zweite Informationsart' });
    });
    const ssp = await addSsp(seeded.verbundId, source);
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withGspp());
    const first = await within(main()).findByRole('listitem', { name: /^Informationsart 1/ });
    fireEvent.change(within(first).getByLabelText('Begründung des Schutzbedarfs'), { target: { value: 'Eingabe für Betriebsdaten' } });
    const newer = withSspBody(source, body => { body['system-characteristics']['system-information']!['information-types']!.reverse(); });
    await readStore(store => store.saveDocument(ssp.localId, ssp.savedAt, null, { source: JSON.parse(JSON.stringify(newer)), context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2' }));
    fireEvent.click(within(main()).getByText('Prüfung und Freigabe'));
    await within(main()).findByText('Prüfzustand', undefined, WAIT);
    await new Promise(resolve => setTimeout(resolve, 100));
    const currentFirst = within(main()).getByRole('listitem', { name: /^Informationsart 1/ });
    expect(within(currentFirst).getByLabelText(/information-types.title/)).toHaveValue('Betriebsdaten');
    expect(within(currentFirst).getByLabelText('Begründung des Schutzbedarfs')).toHaveValue('Eingabe für Betriebsdaten');
  });
  it('hält den Bereichswechsel bei nicht übernommenen Bewertungseingaben an und meldet keinen Speicherfehler', async () => {
    const ssp = await addSsp(seeded.verbundId, makeFullSsp());
    const { router } = renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withGspp());
    const first = await within(main()).findByRole('listitem', { name: /^Inventareintrag 1/ });
    fireEvent.change(within(first).getByLabelText('Begründung des Schutzbedarfs'), { target: { value: 'Offene Eingabe' } });
    const areas = within(screen.getByTestId('header-bar')).getByRole('navigation', { name: 'Bereiche' });
    fireEvent.click(within(areas).getByRole('link', { name: 'Katalog' }), { button: 0 });
    expect(await within(main()).findByText(/offenen Schutzbedarfseingaben/, undefined, WAIT)).toBeInTheDocument();
    expect(router.state.location.pathname).toContain(String(ssp.localId));
    expect(screen.queryByText(/Speicher/i, { selector: '[role="alert"]' })).toBeNull();
  });
  it('zeigt Groß-/Kleinschreibung lokaler UUID-Bezüge ohne falschen Auflösungsfehler und erhält die Quelle', async () => {
    const source = withSspBody(makeFullSsp(), body => {
      body['system-implementation'].components[1].uuid = 'abcdefab-0000-4000-8000-000000000002';
      body['system-implementation']['inventory-items']![0]['implemented-components']![0]['component-uuid'] = 'ABCDEFAB-0000-4000-8000-000000000002';
      body.metadata.parties![0].uuid = 'abcdefab-0000-4000-8000-000000000003';
      body['system-implementation']['inventory-items']![0]['responsible-parties']![0]['party-uuids'] = ['ABCDEFAB-0000-4000-8000-000000000003'];
    });
    const ssp = await addSsp(seeded.verbundId, source);
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withGspp());
    const item = await within(main()).findByRole('listitem', { name: /^Inventareintrag 1/ });
    expect(within(item).queryAllByText(/nicht auflösbar/)).toEqual([]);
    expect(within(item).getByLabelText('Lokale Komponente')).toHaveValue('ABCDEFAB-0000-4000-8000-000000000002');
    expect(within(item).getByLabelText('Lokale Partei')).toHaveValue('ABCDEFAB-0000-4000-8000-000000000003');
  });
  it('hält Eingaben an UUID-losen Informationsarten beim Hinzufügen und Umordnen', async () => {
    const source = withSspBody(makeFullSsp(), body => {
      const first = body['system-characteristics']['system-information']!['information-types']![0];
      delete first.uuid;
      body['system-characteristics']['system-information']!['information-types']!.push({ ...structuredClone(first), title: 'Zweite Informationsart' });
    });
    const ssp = await addSsp(seeded.verbundId, source);
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withGspp());
    const first = await within(main()).findByRole('listitem', { name: /^Informationsart 1/ });
    fireEvent.change(within(first).getByLabelText('Begründung des Schutzbedarfs'), { target: { value: 'Noch nicht übernommene Eingabe' } });
    await click('Informationsart hinzufügen');
    fireEvent.click(within(first).getByRole('button', { name: /nach unten$/ }));
    const moved = within(main()).getByRole('listitem', { name: /^Informationsart 2/ });
    expect(within(moved).getByLabelText('Begründung des Schutzbedarfs')).toHaveValue('Noch nicht übernommene Eingabe');
  });
  it('bindet Kategorien bestätigt, speichert direkte und abgeleitete UUIDs und exportiert genau diesen Stand', async () => {
    const ssp = await addSsp(seeded.verbundId, makeFullSsp());
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withSspCategories(withGspp()));
    const component = await within(main()).findByRole('listitem', { name: /Komponente 1/ });
    fireEvent.click(within(component).getByRole('button', { name: 'Kategorienstand binden…' }));
    fireEvent.click(await screen.findByRole('button', { name: /^Kategorienstand binden$/ }));
    fireEvent.click(await within(component).findByRole('checkbox', { name: 'Synthetische Unterkategorie' }));
    expect(within(component).getByText(/Synthetische Elternkategorie · abgeleitet/)).toBeInTheDocument();
    await click('Speichern');
    await waitFor(async () => expect((await readStore(store => store.getDocument(ssp.localId)))?.documentState).toBe('export-ready'), WAIT);
    const saved = (await readStore(store => store.getDocument(ssp.localId)))!;
    const body = saved.source as { 'system-security-plan': { 'system-implementation': { components: { props: unknown[] }[] } } };
    expect(body['system-security-plan']['system-implementation'].components[0].props).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'target-object-category', value: SSP_CATEGORY_IDS[1] }),
      expect.objectContaining({ name: 'effective-target-object-category', value: SSP_CATEGORY_IDS[0] }),
    ]));
    await click('Export');
    await waitFor(() => expect(downloadBlob).toHaveBeenCalled(), WAIT);
    expect(JSON.parse(await vi.mocked(downloadBlob).mock.calls[0][0].text())).toEqual(saved.source);
  });
  it('zeigt offene Abdeckung und erfasst Schutzbedarf mit Begründung im gespeicherten SSP', async () => {
    const ssp = await addSsp(seeded.verbundId, makeFullSsp());
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withGspp());
    expect(await within(main()).findByText('Schutzbedarf: 0 von 4 Objekten bewertet')).toBeInTheDocument();
    const component = await within(main()).findByRole('listitem', { name: /Komponente 1/ });
    fireEvent.change(within(component).getByLabelText('Schutzbedarf'), { target: { value: 'hoch' } });
    fireEvent.change(within(component).getByLabelText('Begründung des Schutzbedarfs'), { target: { value: 'Synthetischer Ausfall' } });
    fireEvent.click(within(component).getByRole('button', { name: 'Bewertung übernehmen' }));
    await click('Speichern');
    await waitFor(async () => {
      const saved = await readStore(store => store.getDocument(ssp.localId));
      expect(JSON.stringify(saved?.source)).toContain('Synthetischer Ausfall');
      expect(JSON.stringify(saved?.source)).toContain('protection-need-coverage');
    }, WAIT);
    expect(within(main()).getByText('Schutzbedarf: 1 von 4 Objekten bewertet')).toBeInTheDocument();
  });
});

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
    expect(await within(main()).findByText(/vorhandene oder nicht vollständig prüfbare Verwendungen/)).toBeInTheDocument();
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
    // Der Baseline-Wechsel hängt den Abschnitt neu ein.
    await waitFor(() => expect(within(main()).getByRole('region', { name: /^Anforderungen/ })).not.toHaveTextContent('nicht auflösbar im aktuellen Kontext'));
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

describe('Abweisungen und Zuordnungen', () => {
  it('sichert offene Eingaben weiter als Entwurf, nachdem das Speichern eine dangling component-uuid abgewiesen hat', async () => {
    const dangling = await addSsp(seeded.verbundId, withSspBody(makeFullSsp(), (body) => { body['system-implementation'].components.pop(); }));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, dangling.localId), withGspp());
    await type('metadata.title', 'Entwurf nach Abweisung');
    await click('Speichern');
    expect(await within(main()).findByText(/component-uuid zeigt auf keine Komponente/, undefined, WAIT)).toBeInTheDocument();
    await waitFor(async () => expect(sspBody(await readStore((store) => store.getDraft(dangling.localId)) as never).metadata.title).toBe('Entwurf nach Abweisung'), WAIT);
  });

  it('bietet für einen externen import-profile.href keine Baseline-Bindung an', async () => {
    const external = await addSsp(seeded.verbundId, withSspBody(makeFullSsp(), (body) => { body['import-profile'].href = 'https://example.invalid/profile.json'; }));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, external.localId), withGspp());
    expect(await within(main()).findByText('Externer Verweis · nicht bindbar', undefined, WAIT)).toBeInTheDocument();
    expect(within(main()).queryByRole('radio', { name: /catalog-gspp/ })).not.toBeInTheDocument();
    expect(await within(main()).findByRole('region', { name: /^Anforderungen/ })).toHaveTextContent('nicht auflösbar im aktuellen Kontext');
  });

  it('verwirft eine gewählte Anforderung, die die neue Baseline nicht führt', async () => {
    const catalog = makeSchemaValidOscalDocument('catalog', '1.2.2');
    (catalog.catalog as { metadata: { title: string } }).metadata.title = 'Lokaler Katalog';
    await readStore((store) => store.addDocument(seeded.verbundId, { source: catalog, context: { trustClass: 'class-2-local-user' }, rootType: 'catalog', oscalVersion: '1.2.2' }));
    const imported = await addSsp(seeded.verbundId, makeFullSsp());
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, imported.localId), withGspp());
    fireEvent.click(await within(main()).findByRole('radio', { name: /catalog-gspp/ }, WAIT));
    const select = await within(main()).findByRole('combobox', { name: /^Neue Anforderung/ }, WAIT);
    fireEvent.change(select, { target: { value: 'GC.1.2' } });
    const add = () => within(main()).getByRole('button', { name: 'Anforderung hinzufügen' });
    expect(add()).toBeEnabled();
    fireEvent.click(within(main()).getByRole('radio', { name: /Lokaler Katalog/ }));
    await waitFor(() => expect(add()).toBeDisabled(), WAIT);
  });

  it('übernimmt keinen neueren Stand, solange eine Baseline-Wahl ungespeichert ist', async () => {
    const { ssp } = seeded;
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withGspp());
    // Der relative href hat keine eigene Ressource: Die Wahl ändert die Quelle nicht, nur die Bindung.
    fireEvent.click(await within(main()).findByRole('radio', { name: /catalog-gspp/ }, WAIT));
    await waitFor(async () => expect(await readStore((store) => store.getDraft(ssp.localId))).toBeDefined(), WAIT);
    const draft = (await readStore((store) => store.getDraft(ssp.localId)))!;
    await readStore((store) => store.saveDocument(ssp.localId, ssp.savedAt, draft.savedAt, {
      source: ssp.source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2',
    }));
    fireEvent.click(within(main()).getByText('Prüfung und Freigabe'));
    await within(main()).findByText('Prüfzustand', undefined, WAIT);
    await new Promise((resolve) => setTimeout(resolve, 100));
    // Ohne Übernahme bleibt der ältere Vergleichsstand: Speichern meldet den Konflikt, statt die neuere Bindung zu überschreiben.
    await click('Speichern');
    expect(await within(main()).findByText('In einem anderen Tab geändert', undefined, WAIT)).toBeInTheDocument();
  });

  it('lässt beim Wiederöffnen die neuere Bindung eines anderen Tabs gelten statt der älteren Baseline-Wahl', async () => {
    const { ssp, profile } = seeded;
    const pointer = '/system-security-plan/import-profile/href';
    const { router } = renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId), withGspp());
    fireEvent.click(await within(main()).findByRole('radio', { name: /catalog-gspp/ }, WAIT));
    await waitFor(async () => expect(await readStore((store) => store.getDraft(ssp.localId))).toBeDefined(), WAIT);
    await router.navigate(buildStationUrl(seeded.verbundId, 'ssp'));
    const draft = (await readStore((store) => store.getDraft(ssp.localId)))!;
    const newer = { fromLocalId: ssp.localId, pointer, href: 'profile.json', target: { kind: 'local' as const, localId: profile.localId } };
    await readStore((store) => store.saveDocument(ssp.localId, ssp.savedAt, draft.savedAt, {
      source: ssp.source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2',
    }, [newer]));

    await router.navigate(buildWorkspaceDocumentUrl(seeded.verbundId, ssp.localId));
    await waitFor(() => expect(within(main()).getByRole('radio', { name: /catalog-gspp/ })).not.toBeChecked(), WAIT);
    const reopened = (await readStore((store) => store.getDocument(ssp.localId)))!;
    await click('Speichern');
    await waitFor(async () => expect((await readStore((store) => store.getDocument(ssp.localId)))!.savedAt).not.toBe(reopened.savedAt), WAIT);
    expect((await readStore((store) => store.listBindings())).filter((binding) => binding.fromLocalId === ssp.localId)).toEqual([newer]);
  });

  it('führt eine ungespeicherte Baseline-Wahl als Entwurf und sperrt den Export', async () => {
    const relative = await addSsp(seeded.verbundId, withSspBody(makeFullSsp(), (body) => { body['import-profile'].href = 'profile.json'; }));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, relative.localId), withGspp());
    await waitFor(() => expect(within(main()).getAllByText('Gültig').length).toBeGreaterThan(0), WAIT);
    fireEvent.click(await within(main()).findByRole('radio', { name: /catalog-gspp/ }, WAIT));
    await waitFor(() => expect(within(main()).getAllByText('Entwurf').length).toBeGreaterThan(0), WAIT);
    expect(within(main()).getByRole('button', { name: 'Export' })).toBeDisabled();
  });

  it('bewertet Anforderungen nicht gegen einen BSI-Katalog, an dessen Stand das SSP nicht gebunden ist', async () => {
    const unpinned = await addSsp(seeded.verbundId, makeFullSsp());
    await readStore((store) => store.setBinding({
      fromLocalId: unpinned.localId, pointer: '/system-security-plan/import-profile/href', href: `#${SSP_FIXTURE_IDS.baselineResource}`,
      target: { kind: 'class-1', artifactKey: 'catalog-gspp' },
    }, unpinned.savedAt));
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, unpinned.localId), withGspp());
    await waitFor(() => expect(main().querySelector('[data-catalog-pin="unpinned"]')).toBeInTheDocument(), WAIT);
    expect(within(main()).getByRole('region', { name: /^Anforderungen/ })).toHaveTextContent('nicht auflösbar im aktuellen Kontext');
  });

  it('navigiert nach einem abgebrochenen Anlegen nicht mehr', async () => {
    let release = () => {};
    const original = WorkspaceStore.prototype.addDocument;
    vi.spyOn(WorkspaceStore.prototype, 'addDocument').mockImplementation(async function (this: WorkspaceStore, ...args: Parameters<WorkspaceStore['addDocument']>) {
      await new Promise<void>((resolve) => { release = resolve; });
      return original.apply(this, args);
    });
    const router = await createSsp();
    fireEvent.click(within(main()).getByRole('radio', { name: /catalog-gspp/ }));
    fireEvent.click(within(main()).getByRole('button', { name: 'SSP anlegen' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Abbrechen' }));
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.pathname).toBe(buildStationUrl(seeded.verbundId, 'ssp'));
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

  it('rendert große Listen schrittweise', async () => {
    const many = withSspBody(makeFullSsp(), (body) => {
      body['system-characteristics']['system-ids'] = Array.from({ length: 60 }, (_, index) => ({ id: `SYS-${index}` }));
    });
    const imported = await addSsp(seeded.verbundId, many);
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, imported.localId), withGspp());
    const list = await within(main()).findByRole('region', { name: /^Systemkennungen/ }, WAIT);
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(within(list).getByRole('button', { name: /Weitere Einträge · 50 von 60/ }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(60);
  });

  it('zeigt eine neue oder ans Ende verschobene Zeile auch jenseits des Ausschnitts', async () => {
    const many = withSspBody(makeFullSsp(), (body) => {
      body['system-characteristics']['system-ids'] = Array.from({ length: 51 }, (_, index) => ({ id: `SYS-${index}` }));
    });
    const imported = await addSsp(seeded.verbundId, many);
    renderArea(buildWorkspaceDocumentUrl(seeded.verbundId, imported.localId), withGspp());
    const list = await within(main()).findByRole('region', { name: /^Systemkennungen/ }, WAIT);
    expect(within(list).getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(within(list).getByRole('button', { name: 'Systemkennung 50 · SYS-49 nach unten' }));
    expect(within(list).getByRole('listitem', { name: 'Systemkennung 51 · SYS-49' })).toBeInTheDocument();
    fireEvent.click(within(main()).getByRole('button', { name: 'Systemkennung hinzufügen' }));
    expect(within(list).getAllByRole('listitem')).toHaveLength(52);
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
