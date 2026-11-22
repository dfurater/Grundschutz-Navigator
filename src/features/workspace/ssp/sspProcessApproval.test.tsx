import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import type { JsonObject } from '@/domain/jsonGuards';
import { readSspValue } from '@/domain/sspAuthoring';
import type { LocalId } from '@/domain/workspaceModel';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { mainLandmark as main, renderWorkspaceArea, withLoadedCatalog } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
vi.mock('@/adapters/reviewTrailWork', async () => (await import('@/test/workspaceNodeWorkers')).inProcessReviewTrailWork());
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

async function open(change?: Change) {
  const source = makeProcessCiaSsp('1.2.2');
  const ssp = (source as { 'system-security-plan': JsonObject })['system-security-plan'];
  change?.({ metadata: ssp.metadata as JsonObject, process: (readSspValue(source, ['system-implementation', 'components']) as JsonObject[])[0] });
  const document = await readStore(store => store.addDocument(seeded.verbundId, { source, context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2' }));
  renderWorkspaceArea(buildWorkspaceDocumentUrl(seeded.verbundId, document.localId), withLoadedCatalog(true));
  const region = await within(main()).findByRole('region', { name: 'Leitungsfreigabe' }, WAIT);
  return { localId: document.localId, region: within(region) };
}

async function actions(localId: LocalId) {
  const stored = await readStore(store => store.getDocument(localId));
  return readSspValue(stored?.source, ['metadata', 'actions']) as JsonObject[];
}

const props = (node: JsonObject) => node.props as JsonObject[];

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
    ['Überholt', 'Neu freigeben…', ((ssp) => { Object.assign(props(ssp.process).find(prop => prop.name === 'process-protection-integrity')!, { remarks: 'Geänderter Grund' }); }) as Change],
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
    await readStore(store => store.saveDocument(localId, stored!.savedAt, null, { source: structuredClone(stored!.source), context: { trustClass: 'class-2-local-user' }, rootType: 'system-security-plan', oscalVersion: '1.2.2' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Freigabe zurücknehmen' }));
    expect(await dialog.findByRole('alert', undefined, WAIT)).toHaveTextContent('Das Dokument wurde in einem anderen Tab geändert');
    expect(await actions(localId)).toHaveLength(1);
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));

    fireEvent.change(within(main()).getByLabelText('Zweck'), { target: { value: 'Geänderter Zweck' } });
    await waitFor(() => expect(region.getByRole('button', { name: 'Freigabe zurücknehmen…' })).toBeDisabled());
    expect(region.getByText(/Ungespeicherte Änderungen/)).toBeInTheDocument();
  });
});
