import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { areaForPath, buildVerbundUrl, buildWorkspaceDocumentUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider, type AutosaveFlush } from '@/state/WorkspaceContext';
import { VERBUND, fail, fakePort, findNotice as notice, ok } from '@/test/fakeWorkspacePort';
import { EMPTY_CATALOG_STATE } from '@/test/renderWorkspaceArea';
import { renderAppShell } from '@/test/renderAppShell';

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <h1>Katalogansicht</h1>,
}));

const catalogState = EMPTY_CATALOG_STATE;

function AutosaveProbe({ flush }: Readonly<{ flush: AutosaveFlush }>) {
  const { registerAutosave } = useWorkspace();
  useEffect(() => registerAutosave(flush), [registerAutosave, flush]);
  return null;
}

type Router = ReturnType<typeof renderAppShell>['router'];

/** Wege aus dem Arbeitsbereich in den Katalogbereich; jeder läuft über den Router. */
const LEAVE_PATHS: readonly (readonly [string, (router: Router) => void | Promise<void>])[] = [
  ['Bereichswechsel', () => {
    const areas = within(screen.getByTestId('header-bar')).getByRole('navigation', { name: 'Bereiche' });
    fireEvent.click(within(areas).getByRole('link', { name: 'Katalog' }), { button: 0 });
  }],
  ['Kopfzeilensuche', () => {
    const input = screen.getByRole('searchbox', { name: 'Katalog durchsuchen' });
    fireEvent.change(input, { target: { value: 'Passwort' } });
    fireEvent.keyDown(input, { key: 'Enter' });
  }],
  ['Lupe', () => { fireEvent.click(screen.getByRole('link', { name: 'Suche' }), { button: 0 }); }],
  ['Suchkürzel', () => { fireEvent.keyDown(document, { key: 'k', metaKey: true }); }],
  ['Markenlink', () => { fireEvent.click(screen.getByRole('link', { name: 'Grundschutz++ Navigator' }), { button: 0 }); }],
  ['Zurück', (router) => act(() => router.navigate(-1))],
];

function renderLeaving(flush: AutosaveFlush, from = buildWorkspaceIndexUrl()) {
  // Der Katalogeintrag davor ist das Ziel von „Zurück“.
  return renderAppShell(['/katalog/gspp', from], {
    initialIndex: 1,
    shell: () => (
      <CatalogContext.Provider value={catalogState}>
        <WorkspaceProvider open={() => ok(fakePort())}>
          <AutosaveProbe flush={flush} />
          <AppShell />
        </WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  });
}

describe('Autosave beim Wechsel in den Katalog', () => {
  it.each(LEAVE_PATHS)('%s speichert offene Entwürfe, bevor die Katalogroute erscheint', async (_, leave) => {
    const order: string[] = [];
    const routerRef: { current?: Router } = {};
    const flush = vi.fn(async () => {
      order.push(`gespeichert bei ${routerRef.current!.state.location.pathname}`);
      return { ok: true as const, value: undefined };
    });
    const { router } = renderLeaving(flush);
    routerRef.current = router;
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });

    await leave(router);
    await waitFor(() => expect(areaForPath(router.state.location.pathname)).toBe('katalog'));
    expect(order).toEqual([`gespeichert bei ${buildWorkspaceIndexUrl()}`]);
  });

  it.each(LEAVE_PATHS)('%s bleibt im Bereich, wenn ein Entwurf nicht gespeichert werden konnte', async (_, leave) => {
    const flush = vi.fn(() => fail('WORKSPACE_SAVE_CONFLICT'));
    const { router } = renderLeaving(flush);
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });

    await leave(router);
    await notice('In einem anderen Tab geändert');
    expect(flush).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe(buildWorkspaceIndexUrl());
  });
});

describe('Autosave beim Verlassen einer Dokumentroute im Bereich', () => {
  const documentUrl = buildWorkspaceDocumentUrl(VERBUND.verbundId, '0e1d2c3b-4a59-4687-8796-a5b4c3d2e1f0');

  it('speichert vor dem Wechsel zur Verbundseite und bleibt bei einem Fehler auf der Dokumentroute', async () => {
    const flush = vi.fn<AutosaveFlush>(() => fail('WORKSPACE_SAVE_CONFLICT'));
    const { router } = renderLeaving(flush, documentUrl);
    await screen.findByRole('heading', { level: 1, name: 'Dokument nicht gefunden' });
    await act(() => router.navigate(buildVerbundUrl(VERBUND.verbundId)));
    await notice('In einem anderen Tab geändert');
    expect(router.state.location.pathname).toBe(documentUrl);

    flush.mockImplementation(() => Promise.resolve({ ok: true as const, value: undefined }));
    await act(() => router.navigate(buildVerbundUrl(VERBUND.verbundId)));
    await waitFor(() => expect(router.state.location.pathname).toBe(buildVerbundUrl(VERBUND.verbundId)));
  });
});

/** Autosave, dessen Speichervorgänge der Test einzeln abschließt. */
function delayedFlush() {
  const settle: ((result: WorkspaceResult<void>) => void)[] = [];
  const flush = vi.fn(() => new Promise<WorkspaceResult<void>>((resolve) => { settle.push(resolve); }));
  return { flush, settle };
}

describe('Autosave bei überlappenden Navigationen', () => {
  const saved: WorkspaceResult<void> = { ok: true, value: undefined };

  async function leaveTwice() {
    const { flush, settle } = delayedFlush();
    const { router } = renderLeaving(flush);
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });
    await act(() => router.navigate('/suche'));
    await act(() => router.navigate('/katalog/gspp'));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));
    return { router, flush, settle };
  }

  it('folgt nur dem letzten Ziel, wenn ein älterer Speichervorgang zuerst endet', async () => {
    const { router, flush, settle } = await leaveTwice();

    await act(async () => { settle[0](saved); });
    // Der zweite Versuch speichert erst nach dem ersten und erneut, denn der Entwurf kann sich seitdem geändert haben.
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
    expect(router.state.location.pathname).toBe(buildWorkspaceIndexUrl());

    await act(async () => { settle[1](saved); });
    await waitFor(() => expect(router.state.location.pathname).toBe('/katalog/gspp'));
  });

  it('bleibt im Bereich, wenn der Speichervorgang des letzten Ziels scheitert', async () => {
    const { router, flush, settle } = await leaveTwice();

    await act(async () => { settle[0](saved); });
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(2));
    await act(async () => { settle[1](failure(new StorageFailure('WORKSPACE_SAVE_CONFLICT'))); });
    await notice('In einem anderen Tab geändert');
    expect(router.state.location.pathname).toBe(buildWorkspaceIndexUrl());
  });

  it('lässt einen aufgehobenen Übertritt ruhen, wenn der Nutzer im Bereich weiterklickt', async () => {
    const { flush, settle } = delayedFlush();
    const { router } = renderLeaving(flush);
    await screen.findByRole('link', { name: 'Lesbarer Verbund' });
    await act(() => router.navigate('/suche'));
    await waitFor(() => expect(flush).toHaveBeenCalledTimes(1));

    const verbundUrl = buildVerbundUrl(VERBUND.verbundId);
    await act(() => router.navigate(verbundUrl));
    expect(router.state.location.pathname).toBe(verbundUrl);

    // Ein veralteter `proceed()` würde hier als unbehandelte Ablehnung „unblocked -> proceeding“ scheitern.
    await act(async () => { settle[0](saved); });
    expect(router.state.location.pathname).toBe(verbundUrl);
  });
});
