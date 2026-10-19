import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { buildWorkspaceIndexUrl } from '@/app/routes';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { CatalogState } from '@/domain/models';
import type { VerbundId, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider, type AutosaveFlush } from '@/state/WorkspaceContext';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { catalogCollectionDefaults } from '@/test/catalogState';
import { renderAppShell } from '@/test/renderAppShell';

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <h1>Katalogansicht</h1>,
}));

const downloads = vi.hoisted(() => [] as string[]);
vi.mock('@/adapters/browserDownload', () => ({
  downloadBlob: (_blob: Blob, filename: string) => { downloads.push(filename); },
}));

const catalogState = {
  ...catalogCollectionDefaults(),
  catalogDocument: null, catalog: null, provenance: null, verification: null, loading: false, error: null,
  vocabularyRegistry: null, vocabularyProvenance: null, vocabularyVerification: null,
} as CatalogState;

const VERBUND: WorkspaceVerbund = {
  verbundId: '7a1d0c2e-5b3f-4c6d-8e9f-0a1b2c3d4e5f' as VerbundId,
  name: 'Lesbarer Verbund',
  createdAt: '2026-10-19T00:00:00.000Z',
  savedAt: '2026-10-19T00:00:00.000Z',
};

const ok = <T,>(value: T): Promise<WorkspaceResult<T>> => Promise.resolve({ ok: true, value });
const fail = (code: string) => Promise.resolve(failure(new StorageFailure(code)));

function fakePort(overrides: Partial<WorkspacePort> = {}): WorkspacePort {
  return {
    schemaStatus: () => ok('current' as const),
    listVerbuende: () => ok([VERBUND]),
    listDocuments: () => ok([]),
    getDocument: () => ok(undefined),
    listBindings: () => ok([]),
    createVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    renameVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    deleteVerbund: () => fail('WORKSPACE_STORAGE_FAILED'),
    exportBackup: () => ok('{"format":"gspp-workspace"}'),
    estimate: () => ok({ usage: 10, quota: 100 }),
    close: () => undefined,
    ...overrides,
  };
}

function renderWith(port: WorkspacePort, path = buildWorkspaceIndexUrl(), probe?: React.ReactNode) {
  return renderAppShell([path], {
    shell: () => (
      <CatalogContext.Provider value={catalogState}>
        <WorkspaceProvider open={() => ok(port)}>
          {probe}
          <AppShell />
        </WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  });
}

function notice(name: string) {
  return screen.findByText(name, { selector: 'p' }).then((title) => title.closest('li')!);
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

function AutosaveProbe({ flush }: Readonly<{ flush: AutosaveFlush }>) {
  const { registerAutosave } = useWorkspace();
  useEffect(() => registerAutosave(flush), [registerAutosave, flush]);
  return null;
}

describe('Autosave beim Wechsel in den Katalog', () => {
  it('speichert offene Entwürfe, bevor die Katalogroute erscheint', async () => {
    const order: string[] = [];
    const routerRef: { current?: ReturnType<typeof renderWith>['router'] } = {};
    const flush = vi.fn(async () => {
      order.push(`gespeichert bei ${routerRef.current!.state.location.pathname}`);
      return { ok: true as const, value: undefined };
    });
    const { router } = renderWith(fakePort(), buildWorkspaceIndexUrl(), <AutosaveProbe flush={flush} />);
    routerRef.current = router;
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });

    const areas = within(screen.getByTestId('header-bar')).getByRole('navigation', { name: 'Bereiche' });
    fireEvent.click(within(areas).getByRole('link', { name: 'Katalog' }), { button: 0 });
    await waitFor(() => expect(router.state.location.pathname).toBe('/katalog/gspp'));
    expect(order).toEqual([`gespeichert bei ${buildWorkspaceIndexUrl()}`]);
  });

  it('bleibt im Bereich, wenn ein Entwurf nicht gespeichert werden konnte', async () => {
    const flush = vi.fn(() => fail('WORKSPACE_SAVE_CONFLICT'));
    const { router } = renderWith(fakePort(), buildWorkspaceIndexUrl(), <AutosaveProbe flush={flush} />);
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });
    const areas = within(screen.getByTestId('header-bar')).getByRole('navigation', { name: 'Bereiche' });
    fireEvent.click(within(areas).getByRole('link', { name: 'Katalog' }), { button: 0 });
    await notice('In einem anderen Tab geändert');
    expect(router.state.location.pathname).toBe(buildWorkspaceIndexUrl());
  });
});
