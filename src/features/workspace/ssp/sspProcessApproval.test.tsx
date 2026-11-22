import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildStationUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import type { JsonObject } from '@/domain/jsonGuards';
import { readSspValue } from '@/domain/sspAuthoring';
import { appendProcessDecision } from '@/domain/sspProcessApproval';
import { processContentHash } from '@/domain/sspProcessProjection';
import type { LocalId } from '@/domain/workspaceModel';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { dismissModalDialogs } from '@/hooks/useModalDialog';
import { decisionDrafts } from '@/state/processDecisionDrafts';
import { mainLandmark as main, renderWorkspaceArea, withLoadedCatalog } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
// Ein Test hält den Worker an, damit eine Station während des Schreibens neu lädt.
const workHold = vi.hoisted(() => ({ until: Promise.resolve() }));
vi.mock('@/adapters/reviewTrailWork', async () => {
  const work = await (await import('@/test/workspaceNodeWorkers')).inProcessReviewTrailWork();
  return { ...work, reviewTrailInWorker: async (request: Parameters<typeof work.reviewTrailInWorker>[0]) => { await workHold.until; return work.reviewTrailInWorker(request); } };
});
vi.mock('@/hooks/useMediaQuery', () => ({ useMediaQuery: () => true }));

/*
 * Leitungsfreigabe je Geschäftsprozess (GSPP-684) auf dem synthetischen Fall F1
 * aus dem Datenvertrag Prozess-CIA: Anzeige des gespeicherten Freigabestands,
 * Rücknahme und neue Freigabe über den Writer aus GSPP-682.
 */

const WAIT = { timeout: 4000 };
let seeded: SeededWorkspace;
beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => { vi.restoreAllMocks(); await resetWorkspace(); });

type Change = (ssp: { metadata: JsonObject; process: JsonObject }) => void;

function fixture(change?: Change) {
  const source = makeProcessCiaSsp('1.2.2');
  const ssp = (source as { 'system-security-plan': JsonObject })['system-security-plan'];
  change?.({ metadata: ssp.metadata as JsonObject, process: (readSspValue(source, ['system-implementation', 'components']) as JsonObject[])[0] });
  return source;
}

async function open(change?: Change, source: unknown = fixture(change)) {
  const document = await readStore(store => store.addDocument(seeded.verbundId, { source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2' }));
  const { router } = renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, document.localId), withLoadedCatalog(true));
  const region = await within(main()).findByRole('region', { name: 'Leitungsfreigabe' }, WAIT);
  return { localId: document.localId, region: within(region), router };
}

async function actions(localId: LocalId) {
  const stored = await readStore(store => store.getDocument(localId));
  return readSspValue(stored?.source, ['metadata', 'actions']) as JsonObject[];
}

const props = (node: JsonObject) => node.props as JsonObject[];
const PROCESS = 'aaaaaaaa-0000-4000-8000-000000000002';
const PARTY = 'aaaaaaaa-0000-4000-8000-000000000005';
const changeReason: Change = ssp => { Object.assign(props(ssp.process).find(prop => prop.name === 'process-protection-integrity')!, { remarks: 'Geänderter Grund' }); };

/** Gibt einen überholten Prozess frei, hält den Worker an und öffnet die Station während des Schreibens neu. */
async function approveWhileReopening() {
  const { localId, region, router } = await open(changeReason);
  fireEvent.click(await region.findByRole('button', { name: 'Neu freigeben…' }));
  const dialog = within(await screen.findByRole('alertdialog'));
  await dialog.findByText(/^process-cia\/3:sha-256:/);
  fireEvent.change(dialog.getByLabelText('Begründung'), { target: { value: 'Während des Wechsels' } });
  let resolve = () => {};
  workHold.until = new Promise(done => { resolve = done; });
  fireEvent.click(dialog.getByRole('button', { name: 'Freigabe dokumentieren' }));
  await router.navigate(buildStationUrl(seeded.verbundId, 'ssp'));
  await waitFor(() => expect(within(main()).queryByRole('region', { name: 'Leitungsfreigabe' })).not.toBeInTheDocument(), WAIT);
  await router.navigate(buildWorkspaceDocumentUrl(seeded.verbundId, localId));
  const back = within(await within(main()).findByRole('region', { name: 'Leitungsfreigabe' }, WAIT));
  expect(await back.findByText('Überholt', undefined, WAIT)).toBeInTheDocument();
  const release = () => { resolve(); workHold.until = Promise.resolve(); };
  return { localId, back, release };
}

describe('Leitungsfreigabe je Prozess', () => {
  it('nimmt eine aktuelle Freigabe mit Anlass zurück und gibt den Prozess neu frei', async () => {
    const { localId, region } = await open();
    expect(await region.findByText('Aktuell')).toBeInTheDocument();
    expect(region.getByText('Synthetische Institutionsleitung')).toBeInTheDocument();
    expect(region.getByText(/^process-cia\/3:sha-256:24db…f640$/)).toBeInTheDocument();
    expect(region.getByText(/Explizite Risikobetrachtung erforderlich/)).toBeInTheDocument();
    expect(region.queryByRole('button', { name: 'Neu freigeben…' })).not.toBeInTheDocument();

    fireEvent.click(region.getByRole('button', { name: 'Freigabe zurücknehmen…' }));
    const withdraw = within(await screen.findByRole('alertdialog', { name: /^Freigabe zurücknehmen · P-01/ }));
    expect(withdraw.getByText(/Weder Identität noch Befugnis werden geprüft/)).toBeInTheDocument();
    expect(withdraw.getByText(/^process-cia\/3:sha-256:24db…f640$/)).toBeInTheDocument();
    fireEvent.click(withdraw.getByRole('button', { name: 'Freigabe zurücknehmen' }));
    expect(withdraw.getByText('Anlass fehlt.')).toBeInTheDocument();
    expect(await actions(localId)).toHaveLength(1);
    fireEvent.change(withdraw.getByLabelText('Anlass der Rücknahme'), { target: { value: 'Verfügbarkeit wird neu bewertet.' } });
    fireEvent.click(withdraw.getByRole('button', { name: 'Freigabe zurücknehmen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), WAIT);
    expect(await region.findByText('Zurückgenommen', undefined, WAIT)).toBeInTheDocument();
    expect(region.getByText('Verfügbarkeit wird neu bewertet.')).toBeInTheDocument();
    expect((await actions(localId))[1]).toMatchObject({ type: 'withdrawn', remarks: 'Verfügbarkeit wird neu bewertet.', 'responsible-parties': [{ 'role-id': 'institution-management' }] });

    fireEvent.click(region.getByRole('button', { name: 'Neu freigeben…' }));
    const approve = within(await screen.findByRole('alertdialog', { name: /^Freigabe dokumentieren · P-01/ }));
    expect(approve.getByLabelText('Partei')).toHaveValue('aaaaaaaa-0000-4000-8000-000000000005');
    expect(await approve.findByText(/^process-cia\/3:sha-256:24db…f640$/)).toBeInTheDocument();
    fireEvent.change(approve.getByLabelText('Begründung'), { target: { value: 'Neu bewertet und freigegeben.' } });
    fireEvent.click(approve.getByRole('button', { name: 'Freigabe dokumentieren' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), WAIT);
    expect(await region.findByText('Aktuell', undefined, WAIT)).toBeInTheDocument();
    expect(await actions(localId)).toHaveLength(3);
  });

  it.each([
    ['Überholt', 'Neu freigeben…', changeReason],
    ['Aktuell', 'Freigabe zurücknehmen…', ((ssp) => { Object.assign(props(ssp.process).find(prop => prop.name === 'process-priority')!, { value: '7' }); }) as Change],
    ['Fehlt', 'Freigabe dokumentieren…', ((ssp) => {
      // Eine allgemeine Dokumentfreigabe ist keine Prozessfreigabe.
      const [action] = ssp.metadata.actions as JsonObject[];
      action.system = 'https://github.com/dfurater/Grundschutz-Navigator/ns/oscal/actions';
      delete action.props;
    }) as Change],
  ])('zeigt den Stand %s mit passendem Angebot', async (state, button, change) => {
    const { region } = await open(change);
    expect(await region.findByText(state)).toBeInTheDocument();
    expect(region.getByRole('button', { name: button })).toBeEnabled();
  });

  it('legt im Freigabedialog eine Partei im SSP an, speichert sie und bindet sie an die Freigabe', async () => {
    const { localId, region } = await open(ssp => { delete ssp.metadata.actions; });
    fireEvent.click(await region.findByRole('button', { name: 'Freigabe dokumentieren…' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.click(dialog.getByRole('button', { name: '+ Partei im SSP anlegen' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Partei speichern' }));
    expect(dialog.getByText('Name fehlt.')).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText('Name der Partei'), { target: { value: 'Behördenleitung' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Partei speichern' }));
    await waitFor(() => expect(dialog.queryByRole('button', { name: 'Partei speichern' })).not.toBeInTheDocument(), WAIT);
    const stored = await readStore(store => store.getDocument(localId));
    const created = (readSspValue(stored?.source, ['metadata', 'parties']) as JsonObject[]).find(party => party.name === 'Behördenleitung');
    expect(created).toMatchObject({ type: 'organization' });
    expect(dialog.getByLabelText('Partei')).toHaveValue(created!.uuid as string);
    expect(await dialog.findByText(/^process-cia\/3:sha-256:/, undefined, WAIT)).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText('Begründung'), { target: { value: 'Freigegeben.' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Freigabe dokumentieren' }));
    expect(await region.findByText('Aktuell', undefined, WAIT)).toBeInTheDocument();
    expect((await actions(localId))[0]).toMatchObject({ 'responsible-parties': [{ 'role-id': 'institution-management', 'party-uuids': [created!.uuid] }] });
  });

  it('nimmt nach A1, A2 und Rücknahme von A2 auch A1 ausdrücklich zurück, ohne sie zu reaktivieren', async () => {
    const stale = fixture(changeReason);
    const hash = await processContentHash(stale, PROCESS, [{ 'role-id': 'institution-management', 'party-uuids': [PARTY] }]);
    const decision = { processUuid: PROCESS, date: '2026-11-20T10:00:00Z', partyUuids: [PARTY] };
    const second = appendProcessDecision(stale, { ...decision, type: 'approved', uuid: 'bbbbbbbb-0000-4000-8000-000000000001', remarks: 'A2' }, hash);
    const { localId, region } = await open(undefined, appendProcessDecision(second, { ...decision, type: 'withdrawn', uuid: 'bbbbbbbb-0000-4000-8000-000000000002', remarks: 'W(A2)' }));
    expect(await region.findByText('Zurückgenommen')).toBeInTheDocument();
    fireEvent.click(region.getByRole('button', { name: 'Freigabe zurücknehmen…' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByText(/^process-cia\/3:sha-256:24db…f640$/)).toBeInTheDocument();
    fireEvent.change(dialog.getByLabelText('Anlass der Rücknahme'), { target: { value: 'Ältere Freigabe beenden.' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Freigabe zurücknehmen' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), WAIT);
    expect(await region.findByText('Ältere Freigabe beenden.', undefined, WAIT)).toBeInTheDocument();
    expect(region.getByText('Zurückgenommen')).toBeInTheDocument();
    expect(region.queryByRole('button', { name: 'Freigabe zurücknehmen…' })).not.toBeInTheDocument();
    expect((await actions(localId)).at(-1)).toMatchObject({ type: 'withdrawn', props: expect.arrayContaining([expect.objectContaining({ name: 'process-cia-withdraws', value: 'aaaaaaaa-0000-4000-8000-000000000006' })]) });
  });

  it('bewahrt Dialogeingaben über einen Routenwechsel und verwirft sie nur ausdrücklich', async () => {
    const { localId, region, router } = await open();
    fireEvent.click(await region.findByRole('button', { name: 'Freigabe zurücknehmen…' }));
    let dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.change(dialog.getByLabelText('Anlass der Rücknahme'), { target: { value: 'Noch nicht bestätigt' } });
    fireEvent.click(dialog.getByRole('button', { name: '+ Partei im SSP anlegen' }));
    fireEvent.change(dialog.getByLabelText('Name der Partei'), { target: { value: 'Entwurfspartei' } });
    // Das Suchkürzel schließt Dialoge über `dismissModalDialogs()`; das ist kein Abbrechen.
    act(() => { dismissModalDialogs(); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect([...decisionDrafts(localId).values()]).toContainEqual(expect.objectContaining({ remarks: 'Noch nicht bestätigt' }));
    await router.navigate(buildStationUrl(seeded.verbundId, 'ssp'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(), WAIT);
    await router.navigate(buildWorkspaceDocumentUrl(seeded.verbundId, localId));
    const back = within(await within(main()).findByRole('region', { name: 'Leitungsfreigabe' }, WAIT));
    fireEvent.click(await back.findByRole('button', { name: 'Freigabe zurücknehmen…' }, WAIT));
    dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByLabelText('Anlass der Rücknahme')).toHaveValue('Noch nicht bestätigt');
    expect(dialog.getByLabelText('Name der Partei')).toHaveValue('Entwurfspartei');
    fireEvent.click(dialog.getAllByRole('button', { name: 'Abbrechen' }).at(-1)!);
    fireEvent.click(back.getByRole('button', { name: 'Freigabe zurücknehmen…' }));
    dialog = within(await screen.findByRole('alertdialog'));
    expect(dialog.getByLabelText('Anlass der Rücknahme')).toHaveValue('');
    expect(dialog.queryByLabelText('Name der Partei')).not.toBeInTheDocument();
  });

  it('verwirft offene Dialogentwürfe mit dem Löschen des SSP', async () => {
    const { localId, region, router } = await open();
    fireEvent.click(await region.findByRole('button', { name: 'Freigabe zurücknehmen…' }));
    fireEvent.change(within(await screen.findByRole('alertdialog')).getByLabelText('Anlass der Rücknahme'), { target: { value: 'Vertraulicher Entwurf' } });
    await router.navigate(buildStationUrl(seeded.verbundId, 'ssp'));
    await router.navigate(buildWorkspaceDocumentUrl(seeded.verbundId, localId));
    await within(main()).findByRole('region', { name: 'Leitungsfreigabe' }, WAIT);
    expect([...decisionDrafts(localId).values()]).toContainEqual(expect.objectContaining({ remarks: 'Vertraulicher Entwurf' }));
    fireEvent.click(await within(main()).findByRole('button', { name: 'SSP löschen…' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Endgültig löschen' }));
    await waitFor(() => expect(router.state.location.pathname).not.toMatch(/\/dokument\//), WAIT);
    expect(decisionDrafts(localId).size).toBe(0);
  });

  it('zeigt eine ungültige importierte Kette mit Befund und lässt sie unverändert', async () => {
    const { localId, region } = await open(ssp => {
      Object.assign(props((ssp.metadata.actions as JsonObject[])[0]).find(prop => prop.name === 'process-cia-sequence')!, { value: '2' });
    });
    expect(await region.findByText('Ungültig')).toBeInTheDocument();
    expect(region.getByText(/SSP_PROCESS_BINDING_INVALID/)).toBeInTheDocument();
    expect(region.queryByRole('button')).not.toBeInTheDocument();
    expect(await actions(localId)).toHaveLength(1);
  });

  it('bietet ohne drei Schutzziele keine Freigabe an und nennt die Lücke', async () => {
    const { region } = await open(ssp => {
      delete ssp.metadata.actions;
      ssp.process.props = props(ssp.process).filter(prop => prop.name !== 'process-protection-availability');
    });
    expect(await region.findByText('Nicht möglich')).toBeInTheDocument();
    expect(region.getByText(/Keine Freigabe möglich\. Es fehlen: Verfügbarkeit · Bewertung offen/)).toBeInTheDocument();
    expect(region.queryByRole('button', { name: /Freigabe dokumentieren/ })).not.toBeInTheDocument();
  });

  it('sperrt Entscheidungen bei ungespeicherten Änderungen und meldet einen Speicherkonflikt ohne Schreiben', async () => {
    const { localId, region } = await open();
    const stored = await readStore(store => store.getDocument(localId));
    fireEvent.click(await region.findByRole('button', { name: 'Freigabe zurücknehmen…' }));
    const dialog = within(await screen.findByRole('alertdialog'));
    fireEvent.change(dialog.getByLabelText('Anlass der Rücknahme'), { target: { value: 'Anlass' } });
    // Ein anderer Tab speichert denselben Inhalt neu: Der gebundene Stand ist veraltet.
    const foreign = await readStore(store => store.saveDocument(localId, stored!.savedAt, null, { source: structuredClone(stored!.source), context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Freigabe zurücknehmen' }));
    expect(await dialog.findByRole('alert', undefined, WAIT)).toHaveTextContent('Das Dokument wurde in einem anderen Tab geändert');
    expect(dialog.getByLabelText('Anlass der Rücknahme')).toHaveValue('Anlass');
    expect(await readStore(store => store.getDocument(localId))).toEqual(foreign);
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));

    fireEvent.change(within(main()).getByLabelText('Zweck'), { target: { value: 'Geänderter Zweck' } });
    await waitFor(() => expect(region.getByRole('button', { name: 'Freigabe zurücknehmen…' })).toBeDisabled());
    expect(region.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
  });

  it('sperrt Entscheidungen bei einem automatisch gesicherten Entwurf ohne inhaltliche Änderung', async () => {
    const { localId, region } = await open();
    expect(await region.findByRole('button', { name: 'Freigabe zurücknehmen…' })).toBeEnabled();
    const title = within(main()).getAllByRole('textbox', { name: /^Titel/ })[0] as HTMLInputElement;
    const original = title.value;
    fireEvent.change(title, { target: { value: `${original} geändert` } });
    // Zurückgesetzt ist der Inhalt gleich, der automatisch gesicherte Entwurf bleibt und sperrt weiter.
    fireEvent.change(title, { target: { value: original } });
    await waitFor(async () => expect(await readStore(store => store.getDraft(localId))).toBeDefined(), WAIT);
    expect(await region.findByText(/automatisch gesicherter Entwurf liegt vor/, undefined, WAIT)).toBeInTheDocument();
    expect(region.getByRole('button', { name: 'Freigabe zurücknehmen…' })).toBeDisabled();
    // Speichern entfernt den Entwurf und gibt die Aktionen wieder frei.
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(region.getByRole('button', { name: 'Freigabe zurücknehmen…' })).toBeEnabled(), WAIT);
    expect(await readStore(store => store.getDraft(localId))).toBeUndefined();
  });

  it('zeigt nach einem Routenwechsel während des Schreibens die geschriebene Entscheidung', async () => {
    const { localId, back, release } = await approveWhileReopening();
    release();
    expect(await back.findByText('Aktuell', undefined, WAIT)).toBeInTheDocument();
    expect(back.getByText('Während des Wechsels')).toBeInTheDocument();
    expect(await actions(localId)).toHaveLength(2);
  });

  it('führt eine während offener Eingaben geschriebene Entscheidung in den Arbeitsstand zusammen und speichert beides', async () => {
    const { localId, back, release } = await approveWhileReopening();
    const title = within(main()).getAllByRole('textbox', { name: /^Titel/ })[0] as HTMLInputElement;
    fireEvent.change(title, { target: { value: 'Titel während der Freigabe' } });
    release();
    expect(await back.findByText('Aktuell', undefined, WAIT)).toBeInTheDocument();
    expect(back.queryByText(/noch nicht in den Editor übernommen/)).not.toBeInTheDocument();
    expect(title).toHaveValue('Titel während der Freigabe');
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(async () => expect(readSspValue((await readStore(store => store.getDocument(localId)))?.source, ['metadata', 'title'])).toBe('Titel während der Freigabe'), WAIT);
    expect(await actions(localId)).toHaveLength(2);
    expect(back.getByText('Aktuell')).toBeInTheDocument();
  });
});
