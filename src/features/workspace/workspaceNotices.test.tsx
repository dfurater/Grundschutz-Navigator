import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { VerbundId, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { VERBUND, fail, fakePort, findNotice as notice, ok } from '@/test/fakeWorkspacePort';
import { EMPTY_CATALOG_STATE } from '@/test/renderWorkspaceArea';
import { renderAppShell } from '@/test/renderAppShell';

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <h1>Katalogansicht</h1>,
}));

const downloads = vi.hoisted(() => [] as string[]);
vi.mock('@/adapters/browserDownload', () => ({
  downloadBlob: (_blob: Blob, filename: string) => { downloads.push(filename); },
}));

const catalogState = EMPTY_CATALOG_STATE;

function renderWith(port: WorkspacePort) {
  return renderAppShell([buildWorkspaceIndexUrl()], {
    shell: () => (
      <CatalogContext.Provider value={catalogState}>
        <WorkspaceProvider open={() => ok(port)}>
          <AppShell />
        </WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  });
}


describe('Speichermeldungen', () => {
  it('Schreibsperre: Lesen und Backup-Export bleiben bedienbar, Schreiben ist gesperrt', async () => {
    downloads.length = 0;
    renderWith(fakePort({ schemaStatus: () => ok('newer' as const) }));
    const lock = await notice('Schreibsperre');
    expect(lock).toHaveAttribute('role', 'alert');
    expect(await screen.findByRole('link', { name: 'Lesbarer Verbund' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Umbenennen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Löschen…' })).toBeDisabled();

    const exportButton = within(lock).getByRole('button', { name: 'Sicherung exportieren' });
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toMatch(/^informationsverbuende-sicherung-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('meldet eine Schreibsperre auch, wenn erst ein Schreibversuch sie erkennt', async () => {
    renderWith(fakePort({ createVerbund: () => fail('WORKSPACE_SCHEMA_NEWER') }));
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    await notice('Schreibsperre');
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled();
  });

  it('sperrt das Schreiben, wenn die Schemaversion nicht gelesen werden kann', async () => {
    renderWith(fakePort({ schemaStatus: () => fail('WORKSPACE_STORAGE_FAILED') }));
    await notice('Speicher nicht verfügbar');
    expect(await screen.findByRole('link', { name: 'Lesbarer Verbund' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Umbenennen' })).toBeDisabled();
  });

  it('prüft die Schemaversion bei „Neu laden“ erneut und gibt das Schreiben erst danach frei', async () => {
    const schemaStatus = vi.fn<WorkspacePort['schemaStatus']>()
      .mockImplementationOnce(() => fail('WORKSPACE_STORAGE_FAILED'))
      .mockImplementationOnce(() => fail('WORKSPACE_STORAGE_FAILED'))
      .mockImplementation(() => ok('current' as const));
    renderWith(fakePort({ schemaStatus }));
    fireEvent.click(within(await notice('Speicher nicht verfügbar')).getByRole('button', { name: 'Neu laden' }));
    fireEvent.click(within(await notice('Speicher nicht verfügbar')).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Umbenennen' })).toBeEnabled());
    expect(screen.queryByText('Speicher nicht verfügbar')).not.toBeInTheDocument();
    expect(schemaStatus).toHaveBeenCalledTimes(3);
  });

  it('legt bei schnellem Doppelklick nur einen Verbund an', async () => {
    let finish: (result: WorkspaceResult<WorkspaceVerbund>) => void = () => undefined;
    const createVerbund = vi.fn(() => new Promise<WorkspaceResult<WorkspaceVerbund>>((resolve) => { finish = resolve; }));
    renderWith(fakePort({ createVerbund }));
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neu' } });
    const submit = screen.getByRole('button', { name: 'Anlegen' });
    fireEvent.click(submit);
    fireEvent.click(submit);
    fireEvent.submit(submit.closest('form')!);
    expect(createVerbund).toHaveBeenCalledTimes(1);
    expect(submit).toBeDisabled();
    finish({ ok: true, value: { ...VERBUND, verbundId: '1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b' as VerbundId, name: 'Neu' } });
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue(''));
  });

  it('Quota-Vorwarnung mit Hinweis auf den Export', async () => {
    renderWith(fakePort({ estimate: () => ok({ usage: 85, quota: 100 }) }));
    const warning = await notice('Speicher fast voll');
    expect(warning).toHaveAttribute('role', 'status');
    expect(warning).toHaveTextContent('Sichern Sie Ihre Daten mit einem Export.');
    expect(within(warning).getByRole('button', { name: 'Sicherung exportieren' })).toBeEnabled();
  });

  it('erschöpftes Quota beim Schreiben', async () => {
    renderWith(fakePort({ createVerbund: () => fail('WORKSPACE_QUOTA_EXCEEDED') }));
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Neu' } });
    fireEvent.click(screen.getByRole('button', { name: 'Anlegen' }));
    const exceeded = await notice('Speicher voll');
    expect(within(exceeded).getByRole('button', { name: 'Sicherung exportieren' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Anlegen' })).toBeEnabled();
  });

  it('Multi-Tab-Konflikt mit „Neu laden“, das den Stand neu liest', async () => {
    const listVerbuende = vi.fn(() => ok([VERBUND]));
    renderWith(fakePort({ listVerbuende, renameVerbund: () => fail('WORKSPACE_SAVE_CONFLICT') }));
    fireEvent.click(await screen.findByRole('button', { name: 'Umbenennen' }));
    fireEvent.change(screen.getByLabelText('Neuer Name'), { target: { value: 'Anders' } });
    fireEvent.click(screen.getByRole('button', { name: 'Speichern' }));

    const conflict = await notice('In einem anderen Tab geändert');
    const reads = listVerbuende.mock.calls.length;
    fireEvent.click(within(conflict).getByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(screen.queryByText('In einem anderen Tab geändert')).not.toBeInTheDocument());
    expect(listVerbuende.mock.calls.length).toBeGreaterThan(reads);
  });

  it('versucht ein gescheitertes Öffnen über „Neu laden“ erneut', async () => {
    const open = vi.fn()
      .mockResolvedValueOnce(failure(new StorageFailure('WORKSPACE_OPEN_TIMEOUT')))
      .mockResolvedValue({ ok: true, value: fakePort() });
    renderAppShell([buildWorkspaceIndexUrl()], {
      shell: () => (
        <CatalogContext.Provider value={catalogState}>
          <WorkspaceProvider open={open}><AppShell /></WorkspaceProvider>
        </CatalogContext.Provider>
      ),
    });
    const failed = await notice('Speicher nicht verfügbar');
    fireEvent.click(within(failed).getByRole('button', { name: 'Neu laden' }));
    expect(await screen.findByRole('link', { name: 'Lesbarer Verbund' })).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('zeigt auf einer Verbundroute nach gescheitertem Öffnen einen Fehlerzustand statt eines Dauerladens', async () => {
    const open = vi.fn()
      .mockResolvedValueOnce(failure(new StorageFailure('WORKSPACE_OPEN_TIMEOUT')))
      .mockResolvedValue({ ok: true, value: fakePort() });
    renderAppShell([buildVerbundUrl(VERBUND.verbundId)], {
      shell: () => (
        <CatalogContext.Provider value={catalogState}>
          <WorkspaceProvider open={open}><AppShell /></WorkspaceProvider>
        </CatalogContext.Provider>
      ),
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Informationsverbund nicht lesbar' })).toBeInTheDocument();
    expect(screen.queryByText('Informationsverbund wird geladen…')).not.toBeInTheDocument();
    const failed = await notice('Speicher nicht verfügbar');
    fireEvent.click(within(failed).getByRole('button', { name: 'Neu laden' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Lesbarer Verbund' })).toBeInTheDocument();
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('meldet auf der Übersicht nach gescheitertem Öffnen keinen laufenden Öffnungsvorgang', async () => {
    renderAppShell([buildWorkspaceIndexUrl()], {
      shell: () => (
        <CatalogContext.Provider value={catalogState}>
          <WorkspaceProvider open={() => fail('WORKSPACE_OPEN_TIMEOUT')}><AppShell /></WorkspaceProvider>
        </CatalogContext.Provider>
      ),
    });
    await notice('Speicher nicht verfügbar');
    expect(screen.getByText('Speicher nicht verfügbar', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByText('Speicher wird geöffnet…')).not.toBeInTheDocument();
  });

  it('öffnet den Speicher auf dem Katalogpfad nicht', async () => {
    const open = vi.fn(() => ok(fakePort()));
    renderAppShell(['/katalog/gspp'], {
      shell: () => (
        <CatalogContext.Provider value={catalogState}>
          <WorkspaceProvider open={open}><AppShell /></WorkspaceProvider>
        </CatalogContext.Provider>
      ),
    });
    expect(await screen.findByRole('heading', { name: 'Katalogansicht' })).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});
