// Gesamtlöschung des Arbeitsbereichs: Dialog, Sicherungsangebot und Löschablauf (GSPP-635).
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import { createWorkspaceSession } from '@/state/workspaceSession';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { fakeLocks } from '@/test/fakeLocks';
import { VERBUND, fail, fakePort, ok } from '@/test/fakeWorkspacePort';
import { EMPTY_CATALOG_STATE } from '@/test/renderWorkspaceArea';
import { renderAppShell } from '@/test/renderAppShell';

vi.mock('@/features/catalog/CatalogBrowser', () => ({ CatalogBrowser: () => <h1>Katalogansicht</h1> }));
const downloads = vi.hoisted(() => [] as string[]);
vi.mock('@/adapters/browserDownload', () => ({ downloadBlob: (_blob: Blob, filename: string) => { downloads.push(filename); } }));

const ENTRY = 'Alle lokalen Daten löschen…';
const CONFIRM = 'Alle lokalen Daten endgültig löschen';
type Final = (result: WorkspaceResult<void>) => void;

let locks: LockManager | undefined;
let router: ReturnType<typeof renderAppShell>['router'];
beforeEach(() => { locks = fakeLocks(); downloads.length = 0; });

function renderWith(port: WorkspacePort, open = vi.fn(() => ok(port))) {
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

describe('Gesamtlöschung', () => {
  it('Öffnen und Abbrechen rufen keine Speicher- oder Löschoperation auf; der Fokus liegt auf Abbrechen', async () => {
    const calls = { deleteAll: vi.fn(() => fail('X')), renameVerbund: vi.fn(() => fail('X')), exportBackup: vi.fn(() => ok('{}')), autosaveDraft: vi.fn(() => fail('X')) };
    renderWith(fakePort(calls));
    const dialog = await openDialog();
    expect(dialog.getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    await waitFor(() => expect(dialog.getByRole('button', { name: CONFIRM })).toBeEnabled());
    expect(dialog.getByText(/Verknüpfungen, Prüfspuren und Vergleichsstände/)).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
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
    fireEvent.click(dialog.getByRole('button', { name: 'Abbrechen' }));
    expect(await screen.findByText('Löschung abgebrochen. Vorbereitend gespeicherte Eingaben bleiben erhalten.')).toBeInTheDocument();
    expect(deleteAll).not.toHaveBeenCalled();
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
    expect(await screen.findByText('Löschung abgebrochen. Vorbereitend gespeicherte Eingaben bleiben erhalten.')).toBeInTheDocument();
    expect(downloads).toHaveLength(0);
  });

  it('startet genau einen Löschrequest, bleibt bei Blockade ausstehend und bestätigt erst den endgültigen Erfolg', async () => {
    let final: Final = () => undefined;
    const deleteAll = vi.fn((_confirmation: string, onFinal?: Final) => { final = onFinal!; return fail('WORKSPACE_DELETE_PENDING'); });
    const listVerbuende = vi.fn(() => ok([VERBUND]));
    const open = renderWith(fakePort({ deleteAll, listVerbuende }));
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

    final({ ok: true, value: undefined });
    expect(await screen.findByText('Lokale Daten gelöscht')).toBeInTheDocument();
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
    // Erst das ausdrückliche Anlegen öffnet einen neuen Speicher.
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
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
