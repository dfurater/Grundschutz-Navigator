// Gesamtlöschung des Arbeitsbereichs: Dialog, Sicherungsangebot und Löschablauf (GSPP-635).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { deleteDatabase } from '@/adapters/workspaceDatabaseLifecycle';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { VerbundId, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider, type OpenWorkspace } from '@/state/WorkspaceContext';
import { createWorkspaceSession } from '@/state/workspaceSession';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { fakeLocks } from '@/test/fakeLocks';
import { VERBUND, fail, fakePort, ok } from '@/test/fakeWorkspacePort';
import { EMPTY_CATALOG_STATE } from '@/test/renderWorkspaceArea';
import { renderAppShell } from '@/test/renderAppShell';

vi.mock('@/features/catalog/CatalogBrowser', () => ({ CatalogBrowser: () => <h1>Katalogansicht</h1> }));
const downloads = vi.hoisted(() => [] as Blob[]);
vi.mock('@/adapters/browserDownload', () => ({ downloadBlob: (blob: Blob) => { downloads.push(blob); } }));

const ENTRY = 'Alle lokalen Daten löschen…';
const CONFIRM = 'Alle lokalen Daten endgültig löschen';
const ABORTED = 'Löschung abgebrochen. Vorbereitend gespeicherte Eingaben bleiben erhalten.';
/** Vorab eingehängte Statusregion der Übersicht; die sichtbaren Meldungsflächen sind aria-hidden-Spiegel. */
const statusRegion = () => document.querySelector('output.sr-only');
type Final = (result: WorkspaceResult<void>) => void;

let locks: LockManager | undefined;
let router: ReturnType<typeof renderAppShell>['router'];
beforeEach(() => { locks = fakeLocks(); downloads.length = 0; });
afterEach(() => { vi.unstubAllGlobals(); });

function renderWith(port: WorkspacePort, open: OpenWorkspace = vi.fn(() => ok(port))) {
  ({ router } = renderAppShell([buildWorkspaceIndexUrl()], {
    shell: () => (
      <CatalogContext.Provider value={EMPTY_CATALOG_STATE}>
        <WorkspaceProvider open={open} session={createWorkspaceSession(locks)}><AppShell /></WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  }));
  return open;
}

async function openDialog() {
  await screen.findByRole('link', { name: VERBUND.name });
  fireEvent.click(screen.getByRole('button', { name: ENTRY }));
  return within(await screen.findByRole('alertdialog'));
}

/**
 * Rendert mit verzögertem `createVerbund` und „Labor“ im Anlegeformular. Der Rückgabewert startet „Vorher sichern“
 * im Dialog, während die Anlage läuft, und prüft, dass der Verbund danach genau einmal angelegt und gesichert ist.
 */
async function renderWithPendingCreate() {
  const verbuende: WorkspaceVerbund[] = [VERBUND];
  let finishCreate: () => void = () => undefined;
  const createVerbund = vi.fn((name: string) => new Promise<WorkspaceResult<WorkspaceVerbund>>((resolve) => {
    finishCreate = () => {
      const created = { ...VERBUND, verbundId: '0b6c2a4e-1d3f-4a5b-8c7d-9e0f1a2b3c4d' as VerbundId, name };
      verbuende.push(created);
      resolve({ ok: true, value: created });
    };
  }));
  const exportBackup = () => ok(JSON.stringify({ verbuende: verbuende.map(({ name }) => name) }));
  renderWith(fakePort({ createVerbund, exportBackup, listVerbuende: () => ok([...verbuende]) }));
  await screen.findByRole('link', { name: VERBUND.name });
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Labor' } });
  return async (dialog: Awaited<ReturnType<typeof openDialog>>) => {
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(dialog.queryByRole('button', { name: 'Anlegen' })).toBeNull();
    expect(downloads).toHaveLength(0);
    await act(async () => { finishCreate(); await Promise.resolve(); });
    expect(await dialog.findByText('Download gestartet. Bewahren Sie die Datei auf.')).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Anlegen' })).toBeNull();
    expect(createVerbund).toHaveBeenCalledExactlyOnceWith('Labor');
    expect((await downloads[0].text()).match(/Labor/g)).toHaveLength(1);
  };
}

describe('Gesamtlöschung', () => {
  it('Öffnen und Abbrechen rufen keine Speicher- oder Löschoperation auf; der Fokus liegt auf Abbrechen', async () => {
    const calls = { deleteAll: vi.fn(() => fail('X')), renameVerbund: vi.fn(() => fail('X')), exportBackup: vi.fn(() => ok('{}')), autosaveDraft: vi.fn(() => fail('X')) };
    renderWith(fakePort(calls));
    const dialog = await openDialog();
    expect(dialog.getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    await waitFor(() => expect(dialog.getByRole('button', { name: CONFIRM })).toBeEnabled());
    expect(dialog.getByText(/Verknüpfungen, Prüfspuren und Vergleichsstände/)).toBeInTheDocument();
    expect(dialog.getByText('Metadaten des Arbeitsbereichs')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('button', { name: ENTRY })).toHaveFocus();
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
    // Nach dem Abbruch ist die Koordination frei: Ein weiterer Tab kann sich anmelden.
    expect(await createWorkspaceSession(locks).register()).toBe(true);
  });

  it('sperrt Sicherung und Löschung, solange ein weiterer Tab offen ist; Schließen bestätigt nichts', async () => {
    const other = createWorkspaceSession(locks);
    await other.register();
    const deleteAll = vi.fn(() => fail('X'));
    renderWith(fakePort({ deleteAll }));
    const dialog = await openDialog();
    expect(await dialog.findByText('Andere Arbeitsbereich-Tabs schließen')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: CONFIRM })).toBeDisabled();
    expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeDisabled();
    other.leave();
    fireEvent.click(dialog.getByRole('button', { name: 'Erneut prüfen' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: CONFIRM })).toBeEnabled());
    expect(deleteAll).not.toHaveBeenCalled();
  });

  it('bleibt ohne Web Locks mit stabiler Diagnose gesperrt', async () => {
    locks = undefined;
    renderWith(fakePort());
    const dialog = await openDialog();
    expect((await dialog.findByText('Löschung hier nicht verfügbar')).closest('[data-diagnostic]')).toHaveAttribute('data-diagnostic', 'WORKSPACE_SESSION_UNAVAILABLE');
    expect(dialog.getByRole('button', { name: CONFIRM })).toBeDisabled();
  });

  it('„Vorher sichern“ meldet den Downloadstart oder den Fehler und löst nie eine Löschung aus', async () => {
    const deleteAll = vi.fn(() => fail('X'));
    let exported: ReturnType<WorkspacePort['exportBackup']> = fail('WORKSPACE_STORAGE_FAILED');
    renderWith(fakePort({ deleteAll, exportBackup: () => exported }));
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    expect(await dialog.findByText('Sicherung nicht erstellt')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: CONFIRM })).toBeDisabled();
    exported = ok('{}');
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    expect(await dialog.findByText('Download gestartet. Bewahren Sie die Datei auf.')).toBeInTheDocument();
    expect(downloads).toHaveLength(1);
    expect(dialog.getByRole('button', { name: CONFIRM })).toBeEnabled();
    expect(deleteAll).not.toHaveBeenCalled();
  });

  it('„Vorher sichern“ klärt eine offene Umbenennung; der Abbruch danach behält die Speicherung', async () => {
    const renameVerbund = vi.fn(() => ok({ ...VERBUND, name: 'Neuer Name' }));
    const deleteAll = vi.fn(() => fail('X'));
    renderWith(fakePort({ renameVerbund, deleteAll }));
    await screen.findByRole('link', { name: VERBUND.name });
    fireEvent.click(screen.getByRole('button', { name: 'Umbenennen' }));
    fireEvent.change(screen.getByLabelText('Neuer Name'), { target: { value: 'Neuer Name' } });
    fireEvent.click(screen.getByRole('button', { name: ENTRY }));
    const dialog = within(await screen.findByRole('alertdialog'));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    expect(await dialog.findByText('Eine offene Eingabe klären')).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: CONFIRM })).toBeDisabled();
    fireEvent.click(dialog.getByRole('button', { name: 'Speichern' }));
    expect(await dialog.findByText('Download gestartet. Bewahren Sie die Datei auf.')).toBeInTheDocument();
    expect(renameVerbund).toHaveBeenCalledWith(VERBUND.verbundId, 'Neuer Name');
    const region = statusRegion();
    expect(region).toBeEmptyDOMElement();
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByText(ABORTED, { selector: 'p' })).toBeInTheDocument();
    expect(statusRegion()).toBe(region);
    expect(region).toHaveTextContent(ABORTED);
    expect(deleteAll).not.toHaveBeenCalled();
  });

  it('„Vorher sichern“ legt den Namen im Anlegeformular vor; nur ein angelegter Name steht in der Sicherung', async () => {
    const verbuende: WorkspaceVerbund[] = [VERBUND];
    const createVerbund = vi.fn((name: string) => {
      const created = { ...VERBUND, verbundId: '0b6c2a4e-1d3f-4a5b-8c7d-9e0f1a2b3c4d' as VerbundId, name };
      verbuende.push(created);
      return ok(created);
    });
    const exportBackup = () => ok(JSON.stringify({ verbuende: verbuende.map(({ name }) => name) }));
    renderWith(fakePort({ createVerbund, exportBackup, listVerbuende: () => ok([...verbuende]) }));
    const backupWith = async (name: string, decision: 'Anlegen' | 'Verwerfen') => {
      await screen.findByRole('link', { name: VERBUND.name });
      fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
      const dialog = await openDialog();
      await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
      fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
      expect(await dialog.findByText(`„${name}“`, { exact: false })).toBeInTheDocument();
      expect(downloads).toHaveLength(0);
      const decide = dialog.getByRole('button', { name: decision });
      decide.focus();
      fireEvent.click(decide);
      expect(await dialog.findByText('Download gestartet. Bewahren Sie die Datei auf.')).toBeInTheDocument();
      // Die erledigte Klärungszeile nimmt den Fokus nicht aus dem Dialog mit.
      expect(dialog.getByRole('heading', { name: 'Vor dem Löschen sichern' })).toHaveFocus();
      fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));
      expect(screen.getByLabelText('Name')).toHaveValue('');
      return downloads.splice(0)[0].text();
    };
    expect(await backupWith('Labor', 'Anlegen')).toContain('Labor');
    expect(createVerbund).toHaveBeenCalledExactlyOnceWith('Labor');
    expect(await backupWith('Verworfen', 'Verwerfen')).not.toContain('Verworfen');
    expect(createVerbund).toHaveBeenCalledTimes(1);
  });

  it('ein nach dem Abbruch fertig angelegter Name leert keine inzwischen neu getippte Eingabe', async () => {
    let finishCreate: (result: WorkspaceResult<WorkspaceVerbund>) => void = () => undefined;
    const createVerbund = vi.fn(() => new Promise<WorkspaceResult<WorkspaceVerbund>>((resolve) => { finishCreate = resolve; }));
    renderWith(fakePort({ createVerbund }));
    await screen.findByRole('link', { name: VERBUND.name });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Labor' } });
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Anlegen' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rechenzentrum' } });
    await act(async () => { finishCreate({ ok: true, value: { ...VERBUND, name: 'Labor' } }); await Promise.resolve(); });
    expect(await screen.findByText(ABORTED, { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Rechenzentrum');
  });

  it('„Vorher sichern“ wartet eine laufende Anlage aus dem Formular ab und sichert den Verbund genau einmal', async () => {
    const backupWhileCreating = await renderWithPendingCreate();
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await backupWhileCreating(await openDialog());
  });

  it('ein erneutes „Vorher sichern“ wartet eine nach dem Abbruch weiterlaufende Anlage aus der Klärungszeile ab', async () => {
    const backupWhileCreating = await renderWithPendingCreate();
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Anlegen' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    await backupWhileCreating(await openDialog());
  });

  it('ein während einer fremden Gesamtlöschung wartender Tab legt den gelöschten Speicher nicht neu an', async () => {
    const holder = createWorkspaceSession(locks);
    await holder.register();
    const entry = await holder.enterExclusive();
    if (entry.status !== 'granted') throw new Error(entry.status);
    const port = fakePort({ createVerbund: () => ok(VERBUND) });
    const open = vi.fn((existing?: boolean) => existing ? ok(null) : ok(port));
    renderWith(port, open);
    expect(await screen.findByText('Speicher wird geöffnet…')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    // Die Löschung des anderen Tabs ist abgeschlossen: Nur ein vorhandener Speicher würde jetzt geöffnet.
    entry.release();
    expect(await screen.findByText('Lokale Daten gelöscht')).toBeInTheDocument();
    expect(open).toHaveBeenCalledExactlyOnceWith(true);
    expect(screen.getByText('0 Informationsverbünde')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(open).toHaveBeenLastCalledWith(false));
  });

  it('meldet eine nach dem Abbruch abgeschlossene Speicherung und startet danach keinen Download', async () => {
    let finishRename: (result: WorkspaceResult<typeof VERBUND>) => void = () => undefined;
    const renameVerbund = vi.fn(() => new Promise<WorkspaceResult<typeof VERBUND>>((resolve) => { finishRename = resolve; }));
    renderWith(fakePort({ renameVerbund }));
    await screen.findByRole('link', { name: VERBUND.name });
    fireEvent.click(screen.getByRole('button', { name: 'Umbenennen' }));
    fireEvent.change(screen.getByLabelText('Neuer Name'), { target: { value: 'Neuer Name' } });
    fireEvent.click(screen.getByRole('button', { name: ENTRY }));
    const dialog = within(await screen.findByRole('alertdialog'));
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    fireEvent.click(await dialog.findByRole('button', { name: 'Speichern' }));
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    expect(screen.queryByText(/Löschung abgebrochen/)).toBeNull();
    finishRename({ ok: true, value: { ...VERBUND, name: 'Neuer Name' } });
    expect(await screen.findByText(ABORTED, { selector: 'p' })).toBeInTheDocument();
    expect(downloads).toHaveLength(0);
  });

  it('startet keinen Download, wenn der Dialog während des Exports abgebrochen wird', async () => {
    let finishExport: (result: WorkspaceResult<string>) => void = () => undefined;
    const exportBackup = vi.fn(() => new Promise<WorkspaceResult<string>>((resolve) => { finishExport = resolve; }));
    renderWith(fakePort({ exportBackup }));
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.getByRole('button', { name: 'Vorher sichern' })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: 'Vorher sichern' }));
    await waitFor(() => expect(exportBackup).toHaveBeenCalledTimes(1));
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    await act(async () => { finishExport({ ok: true, value: '{}' }); await Promise.resolve(); });
    expect(downloads).toHaveLength(0);
  });

  it('startet genau einen Löschrequest, bleibt bei Blockade ausstehend und bestätigt erst den endgültigen Erfolg', async () => {
    let final: Final = () => undefined;
    const deleteAll = vi.fn((_confirmation: string, onFinal?: Final) => { final = onFinal!; return fail('WORKSPACE_DELETE_PENDING'); });
    const listVerbuende = vi.fn(() => ok([VERBUND]));
    const previewRestore = vi.fn(() => fail('WORKSPACE_BACKUP_INVALID'));
    const open = renderWith(fakePort({ deleteAll, listVerbuende, previewRestore }));
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.getByRole('button', { name: CONFIRM })).toBeEnabled());
    const confirm = dialog.getByRole('button', { name: CONFIRM });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await dialog.findByRole('heading', { name: 'Löschung wartet' })).toHaveFocus();
    expect(deleteAll).toHaveBeenCalledTimes(1);
    // Kein Abbruch, kein Export, kein zweiter Versuch; ein neuer Tab bleibt ausgesperrt.
    expect(dialog.queryAllByRole('button')).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByText('Lokale Daten gelöscht')).toBeNull();
    let entered = false;
    void createWorkspaceSession(locks).register().then(() => { entered = true; });
    const reads = listVerbuende.mock.calls.length;
    const region = statusRegion();
    expect(region).toBeEmptyDOMElement();

    final({ ok: true, value: undefined });
    expect(await screen.findByText('Lokale Daten gelöscht')).toBeInTheDocument();
    expect(statusRegion()).toBe(region);
    expect(region).toHaveTextContent('Lokale Daten gelöscht. Der gesamte Arbeitsbestand wurde aus diesem Browserprofil entfernt. Exportierte Dateien bleiben erhalten.');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: 'Informationsverbünde' })).toHaveFocus();
    expect(screen.getByText('0 Informationsverbünde')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: VERBUND.name })).toBeNull();
    expect(screen.queryByRole('button', { name: ENTRY })).toBeNull();
    await waitFor(() => expect(entered).toBe(true));
    // Kein erneutes Öffnen oder Lesen als Abschlussprüfung.
    expect(open).toHaveBeenCalledTimes(1);
    expect(listVerbuende).toHaveBeenCalledTimes(reads);

    // Eine Verbundroute endet nach der Löschung terminal statt im Ladezustand.
    await act(() => router.navigate(buildVerbundUrl(VERBUND.verbundId)));
    expect(await screen.findByText('Unter dieser Adresse ist in diesem Browser kein Informationsverbund gespeichert.')).toBeInTheDocument();
    await act(() => router.navigate(buildWorkspaceIndexUrl()));
    // Die Wiederherstellung bleibt der Einstieg für die gerade angebotene Sicherung; erst die gewählte Datei öffnet einen neuen Speicher.
    expect(screen.getByRole('button', { name: 'Sicherung wiederherstellen…' })).toBeEnabled();
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getAllByLabelText('Sicherungsdatei')[0], { target: { files: [new File(['{}'], 'sicherung.json', { type: 'application/json' })] } });
    await waitFor(() => expect(previewRestore).toHaveBeenCalledTimes(1));
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('beendet die Sperre nach Blockade und späterem Fehler desselben nativen Requests ohne Erfolgsmeldung', async () => {
    const request: { onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; error: DOMException | null } = { error: null };
    const deleteNative = vi.fn(() => request);
    vi.stubGlobal('indexedDB', { deleteDatabase: deleteNative });
    renderWith(fakePort({ deleteAll: (_confirmation, onFinal) => deleteDatabase('gspp-workspace', 10, onFinal) }));
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.getByRole('button', { name: CONFIRM })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: CONFIRM }));
    act(() => request.onblocked!());
    expect(await dialog.findByRole('heading', { name: 'Löschung wartet' })).toBeInTheDocument();
    request.error = new DOMException('blocked', 'UnknownError');
    act(() => request.onerror!());
    expect(await dialog.findByRole('heading', { name: 'Löschung fehlgeschlagen' })).toBeInTheDocument();
    expect(screen.queryByText('Lokale Daten gelöscht')).toBeNull();
    expect(deleteNative).toHaveBeenCalledTimes(1);
    // Die Sperre ist beendet: Der Dialog schließt, und ein weiterer Tab kann sich anmelden.
    fireEvent.click(dialog.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(await createWorkspaceSession(locks).register()).toBe(true);
  });

  it('beendet bei Ablage im Seitencache Verbindung und Sitzung und lädt bei der Rückkehr neu', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...globalThis.location, reload });
    const close = vi.fn();
    renderWith(fakePort({ close }));
    await screen.findByRole('link', { name: VERBUND.name });
    const other = createWorkspaceSession(locks);
    await other.register();
    expect(await other.enterExclusive()).toEqual({ status: 'other-sessions' });
    act(() => { globalThis.dispatchEvent(new PageTransitionEvent('pagehide')); });
    expect(close).not.toHaveBeenCalled();
    act(() => { globalThis.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); });
    expect(close).toHaveBeenCalled();
    const entry = await other.enterExclusive();
    expect(entry.status).toBe('granted');
    if (entry.status === 'granted') entry.release();
    act(() => { globalThis.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('zeigt einen endgültigen Fehler ohne Erfolgsmeldung und ohne den Bestand als gelöscht darzustellen', async () => {
    const deleteAll = vi.fn((_confirmation: string, onFinal?: Final) => {
      const result = failure(new StorageFailure('WORKSPACE_STORAGE_FAILED'));
      onFinal!(result);
      return Promise.resolve(result);
    });
    renderWith(fakePort({ deleteAll }));
    const dialog = await openDialog();
    await waitFor(() => expect(dialog.getByRole('button', { name: CONFIRM })).toBeEnabled());
    fireEvent.click(dialog.getByRole('button', { name: CONFIRM }));
    expect(await dialog.findByRole('heading', { name: 'Löschung fehlgeschlagen' })).toBeInTheDocument();
    fireEvent.click(dialog.getByRole('button', { name: 'Schließen' }));
    expect(screen.queryByText('Lokale Daten gelöscht')).toBeNull();
    expect(screen.getByText('Speicher nicht verfügbar', { selector: 'span' })).toBeInTheDocument();
    expect(deleteAll).toHaveBeenCalledTimes(1);
  });
});
