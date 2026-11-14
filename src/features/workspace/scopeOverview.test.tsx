import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { matchPath } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { SCOPE_ROUTE_PATTERN, buildScopeUrl, buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import type { ScopeId, WorkspaceScope } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { VERBUND, fail, fakePort, findNotice, ok } from '@/test/fakeWorkspacePort';
import { renderAppShell } from '@/test/renderAppShell';
import { EMPTY_CATALOG_STATE, mainLandmark as main, renderWorkspaceArea as renderArea } from '@/test/renderWorkspaceArea';
import { SENTINEL, SENTINEL_VERBUND, readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});

vi.mock('@/features/catalog/CatalogBrowser', () => ({
  CatalogBrowser: () => <h1>Katalogansicht</h1>,
}));

const downloads = vi.hoisted(() => [] as string[]);
vi.mock('@/adapters/browserDownload', () => ({
  downloadBlob: (_blob: Blob, filename: string) => { downloads.push(filename); },
}));

const SCOPE: WorkspaceScope = {
  scopeId: '3c2b1a00-5b3f-4c6d-8e9f-0a1b2c3d4e5f' as ScopeId,
  name: 'Netzbetrieb Stadtwerke',
  createdAt: '2026-11-14T00:00:00.000Z',
  savedAt: '2026-11-14T00:00:00.000Z',
  items: [],
  evidence: [],
};

function renderWith(port: WorkspacePort, path = buildWorkspaceIndexUrl()) {
  return renderAppShell([path], {
    shell: () => (
      <CatalogContext.Provider value={EMPTY_CATALOG_STATE}>
        <WorkspaceProvider open={() => ok(port)}><AppShell /></WorkspaceProvider>
      </CatalogContext.Provider>
    ),
  });
}

const region = (name: string) => within(within(main()).getByRole('region', { name }));
/** Primary im Kopf; der Leerzustand bietet denselben Einstieg ein zweites Mal an. */
const createEntry = async () => (await within(main()).findAllByRole('button', { name: 'Anwendungsbereich anlegen' }))[0];

afterEach(async () => {
  await resetWorkspace();
});

describe('Arbeitsbereich mit Anwendungsbereichen', () => {
  it('zeigt einen Bestand ohne Anwendungsbereich mit Leerzustand und alle Verbünde unzugeordnet', async () => {
    const seeded = await seedWorkspace();
    renderArea(buildWorkspaceIndexUrl());
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Arbeitsbereich' })).toBeInTheDocument();
    await within(main()).findByRole('link', { name: SENTINEL_VERBUND });
    expect(region('Anwendungsbereiche').getByText('Kein Anwendungsbereich angelegt')).toBeInTheDocument();
    const rows = region('Alle Informationsverbünde').getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(within(row).getByText('Unzugeordnet')).toBeInTheDocument();
    expect(region('Alle Informationsverbünde').getByRole('link', { name: SENTINEL_VERBUND })).toHaveAttribute('href', buildVerbundUrl(seeded.verbundId));
    expect(await readStore((store) => store.listScopes())).toEqual([]);
  });

  it('legt erst nach bestätigtem Speichern an, öffnet die Übersicht und findet sie nach Reload wieder', async () => {
    const name = `Netzbetrieb ${SENTINEL}`;
    const first = renderArea(buildWorkspaceIndexUrl());
    const entry = await createEntry();
    await waitFor(() => expect(entry).toBeEnabled());
    fireEvent.click(entry);
    expect(within(main()).getByRole('heading', { level: 1, name: 'Anwendungsbereich anlegen' })).toHaveFocus();
    const input = within(main()).getByLabelText('Name des Anwendungsbereichs');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(within(main()).getByRole('button', { name: 'Anlegen' })).toBeDisabled();
    fireEvent.change(input, { target: { value: name } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Anlegen' }));

    const heading = await within(main()).findByRole('heading', { level: 1, name });
    await waitFor(() => expect(heading).toHaveFocus());
    const [stored] = await readStore((store) => store.listScopes());
    expect(stored.name).toBe(name);
    const { pathname, search, hash, state } = first.router.state.location;
    expect(pathname).toBe(buildScopeUrl(stored.scopeId));
    expect(matchPath(SCOPE_ROUTE_PATTERN, pathname)?.params).toEqual({ scopeId: stored.scopeId });
    const exposed = [pathname, search, hash, JSON.stringify(state ?? null), document.title].join('\n');
    expect(exposed).not.toContain(SENTINEL);
    expect(document.title).not.toContain(stored.scopeId);
    expect(document.title).toMatch(/^Anwendungsbereich/);
    expect(within(screen.getByRole('navigation', { name: 'Pfad' })).getByText(name)).toHaveAttribute('aria-current', 'page');
    expect(region('Informationsverbünde').getByText('Keine Informationsverbünde zugeordnet')).toBeInTheDocument();
    first.unmount();

    const reloaded = renderArea(buildWorkspaceIndexUrl());
    const link = await within(await within(main()).findByRole('region', { name: 'Anwendungsbereiche' })).findByRole('link', { name });
    expect(region('Anwendungsbereiche').getByText('0 Informationsverbünde')).toBeInTheDocument();
    fireEvent.click(link);
    expect(await within(main()).findByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(reloaded.router.state.location.pathname).toBe(buildScopeUrl(stored.scopeId));
  });

  it('legt bei Abbruch nichts an und gibt den Fokus an den Einstieg zurück', async () => {
    renderArea(buildWorkspaceIndexUrl());
    const entry = await createEntry();
    await waitFor(() => expect(entry).toBeEnabled());
    fireEvent.click(entry);
    fireEvent.change(within(main()).getByLabelText('Name des Anwendungsbereichs'), { target: { value: 'Verworfen' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(async () => expect(await createEntry()).toHaveFocus());
    expect(await readStore((store) => store.listScopes())).toEqual([]);
  });

  it('listet die zugeordneten Verbünde mit Links auf die unveränderten Verbundrouten', async () => {
    renderWith(fakePort({ listScopes: () => ok([SCOPE]), listVerbuende: () => ok([{ ...VERBUND, scopeId: SCOPE.scopeId }]) }), buildScopeUrl(SCOPE.scopeId));
    await within(main()).findByRole('heading', { level: 1, name: SCOPE.name });
    expect(region('Informationsverbünde').getByRole('link', { name: VERBUND.name })).toHaveAttribute('href', buildVerbundUrl(VERBUND.verbundId));
    expect(region('Informationsverbünde').getByText('1')).toHaveClass('tabular-nums');
  });

  it('zeigt für eine unbekannte oder ungültige scopeId einen lokalen Nicht-gefunden-Zustand', async () => {
    renderWith(fakePort(), buildScopeUrl(SCOPE.scopeId));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Anwendungsbereich nicht gefunden' })).toBeInTheDocument();
    await waitFor(() => expect(document.title).toMatch(/^Anwendungsbereich nicht gefunden/));
  });
});

describe('Speicherfehler, Konflikt und Schreibsperre', () => {
  it('behält bei einem Speicherfehler die Eingabe, meldet die Diagnose und bleibt auf der Anlage', async () => {
    const createScope = vi.fn(() => fail('WORKSPACE_STORAGE_FAILED'));
    const { router } = renderWith(fakePort({ createScope }));
    const entry = await createEntry();
    await waitFor(() => expect(entry).toBeEnabled());
    fireEvent.click(entry);
    const input = within(main()).getByLabelText('Name des Anwendungsbereichs');
    fireEvent.change(input, { target: { value: 'Netzbetrieb Stadtwerke' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Anlegen' }));
    expect(await within(main()).findByText('Lokal speichern fehlgeschlagen. Der Name bleibt erhalten.')).toHaveAttribute('role', 'alert');
    // Die verborgene Übersicht führt dieselben Meldungen; sichtbar ist die der Anlageansicht.
    expect((await screen.findAllByText('Speicher nicht verfügbar', { selector: 'p' })).some((title) => title.closest('[hidden]') === null)).toBe(true);
    expect(input).toHaveValue('Netzbetrieb Stadtwerke');
    expect(createScope).toHaveBeenCalledExactlyOnceWith('Netzbetrieb Stadtwerke');
    expect(router.state.location.pathname).toBe(buildWorkspaceIndexUrl());
  });

  it('behält beim Umbenennen mit Konflikt die Eingabe und schreibt mit dem angezeigten Vergleichsstand', async () => {
    const renameScope = vi.fn(() => fail('WORKSPACE_SAVE_CONFLICT'));
    renderWith(fakePort({ listScopes: () => ok([SCOPE]), renameScope }), buildScopeUrl(SCOPE.scopeId));
    fireEvent.click(await within(main()).findByRole('button', { name: 'Umbenennen' }));
    const input = within(main()).getByLabelText('Neuer Name');
    fireEvent.change(input, { target: { value: 'Netzbetrieb Nord' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(renameScope).toHaveBeenCalledExactlyOnceWith(SCOPE.scopeId, 'Netzbetrieb Nord', SCOPE.savedAt));
    expect(await within(main()).findByText('Lokal speichern fehlgeschlagen. Der Name bleibt erhalten.')).toHaveAttribute('role', 'alert');
    expect(await findNotice('In einem anderen Tab geändert')).toBeInTheDocument();
    expect(input).toHaveValue('Netzbetrieb Nord');
    fireEvent.click(within(main()).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(within(main()).getByRole('button', { name: 'Umbenennen' })).toHaveFocus());
  });

  it('übernimmt einen bestätigten neuen Namen und schließt das Formular', async () => {
    const renamed = { ...SCOPE, name: 'Netzbetrieb Nord', savedAt: '2026-11-14T01:00:00.000Z' };
    let listed = [SCOPE];
    const renameScope = vi.fn(() => { listed = [renamed]; return ok(renamed); });
    renderWith(fakePort({ listScopes: () => ok(listed), renameScope }), buildScopeUrl(SCOPE.scopeId));
    fireEvent.click(await within(main()).findByRole('button', { name: 'Umbenennen' }));
    fireEvent.change(within(main()).getByLabelText('Neuer Name'), { target: { value: 'Netzbetrieb Nord' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Netzbetrieb Nord' })).toBeInTheDocument();
    expect(within(main()).queryByLabelText('Neuer Name')).toBeNull();
  });

  it('sperrt Anlegen und Umbenennen bei Schreibsperre; Exporte bleiben bedienbar', async () => {
    downloads.length = 0;
    const port = fakePort({ schemaStatus: () => ok('newer' as const), listScopes: () => ok([SCOPE]) });
    const { unmount } = renderWith(port);
    await findNotice('Schreibsperre');
    await within(await within(main()).findByRole('region', { name: 'Anwendungsbereiche' })).findByRole('link', { name: SCOPE.name });
    for (const button of within(main()).getAllByRole('button', { name: 'Anwendungsbereich anlegen' })) expect(button).toBeDisabled();
    const exportButton = within(main()).getAllByRole('button', { name: 'Sicherung exportieren' }).at(-1)!;
    expect(exportButton).toBeEnabled();
    fireEvent.click(exportButton);
    await waitFor(() => expect(downloads).toHaveLength(1));
    unmount();

    renderWith(port, buildScopeUrl(SCOPE.scopeId));
    await findNotice('Schreibsperre');
    expect(await within(main()).findByRole('button', { name: 'Umbenennen' })).toBeDisabled();
  });
});
