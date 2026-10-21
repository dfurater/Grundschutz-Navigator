import 'fake-indexeddb/auto';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { makeFullSsp, SSP_FIXTURE_IDS } from '@/test/fixtures/systemSecurityPlans';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { mainLandmark as main, renderWorkspaceArea } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());

let seeded: SeededWorkspace;
beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => { vi.restoreAllMocks(); await resetWorkspace(); });

async function upload(file: File) {
  await within(main()).findByRole('button', { name: 'SSP-Datei einlesen' });
  fireEvent.change(main().querySelector('input[type="file"]')!, { target: { files: [file] } });
}

async function openSections() {
  // Jede Ebene ist zunächst geschlossen; die Schleife öffnet auch ihre neu gerenderten Kinder.
  for (let level = 0; level < 12; level++) {
    const closed = main().querySelectorAll('details:not([open])');
    if (!closed.length) break;
    for (const detail of closed) fireEvent.click(detail.querySelector('summary')!);
    await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  }
}

describe('SSP-Station', () => {
  it('nimmt die Quelle unverändert auf und zeigt SSP-Inhalte nur als inaktiven Text', async () => {
    const source = makeFullSsp();
    const body = source['system-security-plan'] as { metadata: { title: string } };
    body.metadata.title = '<img src="https://example.invalid/privat" onerror="alert(1)">';
    const { router } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'ssp'));
    await upload(new File([JSON.stringify(source)], 'privater-dateiname.json'));
    await within(main()).findByRole('heading', { name: body.metadata.title });
    await within(main()).findByText('Systemmerkmale');
    await openSections();
    await waitFor(() => expect(main()).toHaveTextContent('Beispielsystem'));
    expect(main()).toHaveTextContent('gspp-teilweise-geprueft');
    expect(main()).toHaveTextContent('Bereitgestellte Umsetzung.');
    expect(main()).toHaveTextContent('Von der Plattform geerbt.');
    expect(main()).toHaveTextContent('Verantwortung gegenüber der Plattform erfüllt.');
    expect(main()).toHaveTextContent('Eigene Daten · kein Integritätsnachweis');
    expect(main()).toHaveTextContent('nicht auflösbar im aktuellen Kontext');
    expect(main().querySelector('img, iframe, object, embed, a[href^="https:"]')).toBeNull();
    expect(main()).not.toHaveTextContent('iVBORw0KGgo=');
    expect(main()).not.toHaveTextContent('privater-dateiname');
    expect(JSON.stringify(router.state.location)).not.toContain(SSP_FIXTURE_IDS.ssp);
    expect(document.title).not.toContain(body.metadata.title);
    const documents = await readStore(store => store.listDocuments(seeded.verbundId));
    const imported = documents.find(document => document.localId === router.state.location.pathname.split('/').at(-1));
    // Die Route benennt ausschließlich die lokale Identität des aufgenommenen Dokuments.
    expect(imported).toBeDefined();
    expect((await readStore(store => store.getDocument(imported!.localId)))?.source).toEqual(source);
  });

  it.each([
    ['Syntax', '{"geheim":', 'json-syntax'],
    ['Root', JSON.stringify(makeSchemaValidOscalDocument('profile', '1.2.2')), 'root-dispatch'],
    ['Schema', JSON.stringify({ 'system-security-plan': { metadata: { 'oscal-version': '1.2.2' } } }), 'json-schema'],
  ])('lehnt %s mit Stufe ab und speichert nichts', async (_name, json, stage) => {
    renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'ssp'));
    await upload(new File([json], 'geheim.json'));
    const rejection = await within(main()).findByRole('alert');
    expect(rejection).toHaveTextContent(stage);
    expect(rejection).not.toHaveTextContent('geheim');
    expect(await readStore(store => store.listDocuments(seeded.verbundId))).toHaveLength(5);
  });

  it('prüft die Bytegrenze vor dem Lesen', async () => {
    const file = new File([''], 'zu-gross.json');
    Object.defineProperty(file, 'size', { value: CLASS_2_IMPORT_LIMITS.maxBytes + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'ssp'));
    await upload(file);
    expect(await within(main()).findByRole('alert')).toHaveTextContent('resource-limit');
    expect(read).not.toHaveBeenCalled();
  });

  it('zeigt Modelldiagnosen am zugehörigen Dokument, ohne die Quelle zu verändern', async () => {
    const source = makeFullSsp();
    const body = source['system-security-plan'] as { 'system-implementation': { components: unknown[] } };
    body['system-implementation'].components.pop();
    const doc = await readStore(store => store.addDocument(seeded.verbundId, {
      source: JSON.parse(JSON.stringify(source)), rootType: 'system-security-plan', oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' },
    }));
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    expect((await within(main()).findAllByText(/OSCAL_SSP_COMPONENT_REFERENCE_UNRESOLVED/)).length).toBeGreaterThan(0);
    expect((await readStore(store => store.getDocument(doc.localId)))?.source).toEqual(source);
  });

  it('begrenzt auch Modelldiagnosen beim Öffnen der Dokumentseite', async () => {
    const source = JSON.parse(JSON.stringify(makeFullSsp()));
    source['system-security-plan']['system-implementation'].users[0]['role-ids'] = Array.from({ length: 121 }, (_, i) => `unknown-${i}`);
    const doc = await readStore(store => store.addDocument(seeded.verbundId, {
      source, rootType: 'system-security-plan', oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' },
    }));
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    const diagnostics = await within(main()).findByRole('region', { name: 'Modelldiagnosen' });
    expect(within(diagnostics).getAllByRole('listitem')).toHaveLength(50);
    fireEvent.click(within(diagnostics).getByRole('button', { name: /Weitere Modelldiagnosen/ }));
    expect(within(diagnostics).getAllByRole('listitem')).toHaveLength(100);
  });
});
