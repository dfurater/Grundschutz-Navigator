import 'fake-indexeddb/auto';
import { fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/oscalImportContract';
import { AR_UUIDS, makeFullAssessmentResults, makeMinimalAssessmentResults } from '@/test/fixtures/assessmentResults';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { mainLandmark as main, renderWorkspaceArea } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
let seeded: SeededWorkspace;
beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await resetWorkspace(); });

async function upload(file: File) {
  await within(main()).findByRole('button', { name: 'Prüfergebnisse-Datei einlesen' });
  fireEvent.change(main().querySelector('input[type="file"]')!, { target: { files: [file] } });
}
async function add(source: unknown) {
  return readStore(store => store.addDocument(seeded.verbundId, {
    source: JSON.parse(JSON.stringify(source)), rootType: 'assessment-results', oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' },
  }, 'imported'));
}
function section(name: string) {
  fireEvent.click(within(main()).getByRole('button', { name: new RegExp(`^${name} ·`) }));
}

describe('Assessment Results in der Station', () => {
  it('importiert unverändert, navigiert nur mit lokalen IDs und liest nach erneutem Öffnen', async () => {
    const source = makeFullAssessmentResults();
    Object.assign(source['assessment-results'].results[0], { props: [{ name: 'foreign-field', ns: 'https://example.invalid/ns', value: 'SOURCE_SENTINEL' }] });
    source['assessment-results'].metadata.title = '<img src="https://example.invalid/PRIVAT">';
    const { router, unmount } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'assessment'));
    await upload(new File([JSON.stringify(source)], 'privater-dateiname.json'));
    await within(main()).findByRole('heading', { name: source['assessment-results'].metadata.title });
    await within(main()).findByRole('button', { name: /^Findings · 2/ });
    const path = router.state.location.pathname;
    const imported = (await readStore(store => store.listDocuments(seeded.verbundId))).find(d => path.endsWith(d.localId))!;
    expect(imported.documentState).toBe('imported');
    expect((await readStore(store => store.getDocument(imported.localId)))?.source).toEqual(source);
    expect(JSON.stringify(router.state.location)).not.toMatch(/PRIVAT|SOURCE_SENTINEL|00000000-0000/);
    expect(document.title).not.toContain('PRIVAT');
    expect(main()).not.toHaveTextContent('privater-dateiname');
    unmount();
    renderWorkspaceArea(path);
    expect(await within(main()).findByRole('button', { name: /^Findings · 2/ })).toBeEnabled();
    expect((await readStore(store => store.getDocument(imported.localId)))?.source).toEqual(source);
  });

  it.each([
    ['Syntax', '{"geheim":', 'json-syntax'],
    ['Root', JSON.stringify(makeSchemaValidOscalDocument('profile', '1.2.2')), 'OSCAL_ROOT_NOT_ASSESSMENT_RESULTS'],
    ['Version', JSON.stringify({ 'assessment-results': { metadata: { 'oscal-version': '9.9.9' } } }), 'OSCAL_ROOT_VERSION_UNSUPPORTED'],
    ['Schema', JSON.stringify({ 'assessment-results': { metadata: { 'oscal-version': '1.2.2' } } }), 'json-schema'],
  ])('weist %s redigiert ab', async (_name, json, stage) => {
    renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'assessment'));
    await upload(new File([json], 'geheim.json'));
    const rejected = await within(main()).findByRole('alert');
    expect(rejected).toHaveTextContent(stage);
    expect(rejected).not.toHaveTextContent('geheim');
    expect(await readStore(store => store.listDocuments(seeded.verbundId))).toHaveLength(5);
  });

  it('prüft die Bytegrenze vor dem Lesen', async () => {
    const file = new File([''], 'privat.json');
    Object.defineProperty(file, 'size', { value: CLASS_2_IMPORT_LIMITS.maxBytes + 1 });
    const read = vi.spyOn(file, 'arrayBuffer');
    renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'assessment'));
    await upload(file);
    expect(await within(main()).findByRole('alert')).toHaveTextContent('resource-limit');
    expect(read).not.toHaveBeenCalled();
  });

  it('zeigt Findings, Observation-Gültigkeit, Risks, Urheber und passive Evidenz als Text', async () => {
    const source = makeFullAssessmentResults();
    Object.assign(source['assessment-results'].results[0].risks[0], { status: 'accepted-by-ciso', deadline: '2026-11-30T00:00:00Z' });
    source['assessment-results'].results[0].risks[0].remediations[0].lifecycle = 'in-review';
    const doc = await add(source);
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    await within(main()).findByRole('button', { name: /^Findings · 2/ });
    expect(main()).toHaveTextContent('ohne verknüpften Beleg');
    fireEvent.click(within(main()).getByRole('button', { name: /^ac-1_obj.*Finding/ }));
    expect(main()).toHaveTextContent('not-satisfied');
    expect(main()).toHaveTextContent('nicht auflösbar im aktuellen Kontext');
    expect(main().querySelector(`[id="${AR_UUIDS.finding}"]`)).not.toBeNull();
    fireEvent.click(within(main()).getByRole('button', { name: 'Zur Liste' }));
    section('Observations');
    expect(main()).toHaveTextContent('expired');
    fireEvent.click(within(main()).getByRole('button', { name: new RegExp(AR_UUIDS.observation) }));
    expect(main()).toHaveTextContent('<script>alert(1)</script>');
    expect(main()).toHaveTextContent('Prüferin');
    expect(main()).toHaveTextContent('party');
    expect(main()).toHaveTextContent('current');
    expect(within(main()).getByRole('button', { name: 'Herunterladen' })).toBeEnabled();
    expect(main()).not.toHaveTextContent('PHNjcmlwdD4=');
    expect(main().querySelector('script, img, iframe, object, embed, a[href^="https:"]')).toBeNull();
    fireEvent.click(within(main()).getByRole('button', { name: 'Zur Liste' }));
    section('Risks');
    fireEvent.click(within(main()).getByRole('button', { name: /Risiko/ }));
    expect(main()).toHaveTextContent('unbekannt: accepted-by-ciso');
    expect(main()).toHaveTextContent('unbekannt: in-review');
    expect(main()).toHaveTextContent('2026-11-30T00:00:00Z');
    expect(main()).toHaveTextContent('https://threats.invalid/T-1.json');
    expect(main().querySelector(`[id="${AR_UUIDS.response}"]`)).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect((await readStore(store => store.getDocument(doc.localId)))?.source).toEqual(source);
  });

  it.each([{ types: undefined }, { types: ['control-objective', 'discovery'] }])('zeigt das Typfeld nur für vorhandene Observation-Typen: $types', async ({ types }) => {
    const source = makeFullAssessmentResults();
    if (types !== undefined) Object.assign(source['assessment-results'].results[0].observations[0], { types });
    const doc = await add(source);
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    await within(main()).findByRole('button', { name: /^Findings · 2/ });
    section('Observations');
    fireEvent.click(within(main()).getByRole('button', { name: new RegExp(AR_UUIDS.observation) }));
    const detail = within(within(main()).getByRole('complementary', { name: 'Observation-Detail' }));
    if (types?.length) {
      expect(detail.getByText('Typ', { exact: true })).toBeVisible();
      expect(detail.getByText(types.join(', '), { exact: true })).toBeVisible();
    } else {
      expect(detail.queryByText('Typ', { exact: true })).toBeNull();
    }
    expect(detail.getByText('INTERVIEW', { exact: true })).toBeVisible();
    expect((await readStore(store => store.getDocument(doc.localId)))?.source).toEqual(source);
  });

  it('zeigt fehlende optionale Listen als Leerzustände', async () => {
    const doc = await add(makeMinimalAssessmentResults());
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    expect(await within(main()).findByText('Keine Findings.')).toBeVisible();
    section('Observations');
    expect(within(main()).getByText('Keine Observations.')).toBeVisible();
    section('Risks');
    expect(within(main()).getByText('Keine Risks.')).toBeVisible();
  });

  it('wechselt zwischen Ergebnissen ohne die Auswahl des alten Ergebnisses zu übernehmen', async () => {
    const source = makeFullAssessmentResults();
    const second = makeMinimalAssessmentResults()['assessment-results'].results[0];
    source['assessment-results'].results.push({ ...second, uuid: AR_UUIDS.missing, title: 'Zweite Prüfung' } as never);
    const doc = await add(source);
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    await within(main()).findByRole('button', { name: /^Findings · 2/ });
    fireEvent.change(within(main()).getByRole('combobox', { name: 'Ergebnis' }), { target: { value: '1' } });
    expect(within(main()).getByText('Keine Findings.')).toBeVisible();
  });

  it('zeigt große Findinglisten in Schritten von 50', async () => {
    const source = makeMinimalAssessmentResults();
    Object.assign(source['assessment-results'].results[0], { findings: Array.from({ length: 56 }, (_, index) => ({
      uuid: `00000000-0000-4000-8000-${String(1000 + index).padStart(12, '0')}`,
      title: `Feststellung ${index}`, description: 'Synthetischer Befund',
      target: { type: 'objective-id', 'target-id': 'ac-1_obj', status: { state: 'not-satisfied' } },
    })) });
    const doc = await add(source);
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    await within(main()).findByRole('button', { name: /^Findings · 56/ });
    expect(main().querySelectorAll('[data-assessment-entry]')).toHaveLength(50);
    fireEvent.click(within(main()).getByRole('button', { name: /Weitere Findings/ }));
    expect(main().querySelectorAll('[data-assessment-entry]')).toHaveLength(56);
  });

  it('begrenzt Maßnahmen in Zeile und Detail, ohne Quellmaßnahmen zu verlieren', async () => {
    const source = makeFullAssessmentResults();
    source['assessment-results'].results[0].risks[0].remediations = Array.from({ length: 56 }, (_, index) => ({
      uuid: `00000000-0000-4000-8000-${String(2000 + index).padStart(12, '0')}` as typeof AR_UUIDS.response,
      title: `Maßnahme ${index}`, description: 'Synthetische Maßnahme', lifecycle: 'planned',
    }));
    const doc = await add(source);
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    await within(main()).findByRole('button', { name: /^Findings · 2/ });
    section('Risks');
    expect(main()).toHaveTextContent('+53 Maßnahmen');
    fireEvent.click(within(main()).getByRole('button', { name: /Risiko/ }));
    expect(main().querySelectorAll('li[id]')).toHaveLength(50);
    fireEvent.click(within(main()).getByRole('button', { name: /Weitere Maßnahmen/ }));
    expect(main().querySelectorAll('li[id]')).toHaveLength(56);
    expect((await readStore(store => store.getDocument(doc.localId)))?.source).toEqual(source);
  });

  it('zeigt bei wiederholten Observation-Verweisen denselben Evidenzbestand nur einmal', async () => {
    const source = makeFullAssessmentResults();
    Object.assign(source['assessment-results'].results[0].findings[0], { 'related-observations': Array.from({ length: 100 }, () => ({ 'observation-uuid': AR_UUIDS.observation })) });
    const doc = await add(source);
    renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, doc.localId));
    await within(main()).findByRole('button', { name: /^Findings · 2/ });
    fireEvent.click(within(main()).getByRole('button', { name: /^ac-1_obj.*Finding/ }));
    expect(within(main()).getAllByRole('region', { name: 'Evidenzressource' })).toHaveLength(1);
  });
});
