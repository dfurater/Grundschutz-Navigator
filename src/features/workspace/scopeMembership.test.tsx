import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildScopeUrl, buildStationUrl, buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import type { WorkspaceScope, WorkspaceVerbund } from '@/domain/workspaceModel';
import { fail, fakePort, ok } from '@/test/fakeWorkspacePort';
import { mainLandmark, renderWorkspaceArea, renderWorkspaceWithPort } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});

const networkName = 'Netzbetrieb Stadtwerke';
const northName = 'Rechenzentrum Nord';
const portalName = 'Kundenportal';
const otherName = 'Messstellenbetrieb';
const main = () => within(mainLandmark());
const dialog = () => within(screen.getByRole('alertdialog'));
const button = (name: string) => main().getByRole('button', { name });

let network: WorkspaceScope;
let other: WorkspaceScope;
let north: WorkspaceVerbund;
let portal: WorkspaceVerbund;
let seeded: Awaited<ReturnType<typeof seedWorkspace>>;

beforeEach(async () => {
  seeded = await seedWorkspace();
  network = await readStore(store => store.createScope(networkName));
  other = await readStore(store => store.createScope(otherName));
  north = await readStore(store => store.renameVerbund(seeded.verbundId, northName));
  portal = await readStore(store => store.renameVerbund(seeded.otherVerbundId, portalName));
});

afterEach(resetWorkspace);

const rows = () => readStore(store => store.listVerbuende());

async function documentsAndBindings() {
  return {
    north: await readStore(store => store.listDocuments(north.verbundId)),
    portal: await readStore(store => store.listDocuments(portal.verbundId)),
    sources: await Promise.all([seeded.profile, seeded.ssp, seeded.foreign].map(({ localId }) => readStore(store => store.getDocument(localId)))),
    bindings: await readStore(store => store.listBindings()),
  };
}

async function openAssignment() {
  const open = await main().findByRole('button', { name: 'Vorhandene zuordnen' });
  open.focus();
  fireEvent.click(open);
  expect(main().getByRole('heading', { name: 'Vorhandene Verbünde zuordnen' })).toHaveFocus();
  fireEvent.click(main().getByRole('checkbox', { name: northName }));
  fireEvent.click(main().getByRole('checkbox', { name: portalName }));
}

describe('Zuordnung im Arbeitsbereich', () => {
  it('ordnet zwei Verbünde gemeinsam zu und erhält ihre Profile und Rückwege nach Reload', async () => {
    await readStore(store => store.createVerbund('Bereits im Netzbetrieb', network));
    await readStore(store => store.createVerbund('Anderweitig zugeordnet', other));
    const before = await documentsAndBindings();
    const view = renderWorkspaceArea(buildScopeUrl(network.scopeId));
    await openAssignment();
    expect(main().getAllByRole('checkbox')).toHaveLength(2);
    const assigned = within(main().getByRole('region', { name: 'Bereits zugeordnet' }));
    expect(assigned.getByText('Bereits im Netzbetrieb')).toBeVisible();
    expect(assigned.getByText('Anderweitig zugeordnet')).toBeVisible();
    const submit = button('2 zuordnen');
    submit.focus();
    fireEvent.click(submit);
    expect(dialog().getByText(networkName, { exact: false })).toBeVisible();
    expect(dialog().getByRole('button', { name: 'Abbrechen' })).toHaveFocus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(submit).toHaveFocus();
    expect((await rows()).filter(row => row.scopeId === network.scopeId)).toHaveLength(1);
    fireEvent.click(submit);
    fireEvent.click(dialog().getByRole('button', { name: 'Zuordnen' }));
    await main().findByRole('link', { name: northName });
    view.unmount();

    const { router } = renderWorkspaceArea(buildScopeUrl(network.scopeId));
    for (const [verbund, profile] of [[north, seeded.profile], [portal, seeded.foreign]] as const) {
      fireEvent.click(await main().findByRole('link', { name: verbund.name }));
      await main().findByRole('heading', { level: 1, name: verbund.name });
      expect(main().getByText('Anwendungsbereich:')).toBeVisible();
      expect(main().getByText(networkName)).toBeVisible();
      const path = within(screen.getByRole('navigation', { name: 'Pfad' }));
      expect(path.getByRole('link', { name: networkName })).toHaveAttribute('href', buildScopeUrl(network.scopeId));
      fireEvent.click(path.getByRole('button', { name: /Informationsverbund/ }));
      expect(screen.getAllByRole('menuitemradio').map(item => item.textContent)).toEqual(expect.arrayContaining([northName, portalName]));
      expect(screen.queryByRole('menuitemradio', { name: /Anderweitig/ })).toBeNull();
      fireEvent.keyDown(document, { key: 'Escape' });
      const stations = within(screen.getByRole('navigation', { name: 'Stationen' }));
      fireEvent.click(stations.getByRole('link', { name: /^Profile/ }));
      await waitFor(() => expect(router.state.location.pathname).toBe(buildStationUrl(verbund.verbundId, 'profile')));
      const station = await main().findByRole('region', { name: 'Station Profile' });
      const profileLinks = within(station).getAllByRole('link');
      expect(profileLinks.map(link => link.getAttribute('href')?.split('/').at(-1))).toContain(profile.localId);
      expect(router.state.location.pathname).not.toContain(networkName);
      expect(document.title).not.toContain(networkName);
      expect(document.title).not.toContain(verbund.name);
      fireEvent.click(path.getByRole('link', { name: networkName }));
    }
    await main().findByRole('heading', { level: 1, name: networkName });
    await act(() => router.navigate(buildWorkspaceIndexUrl()));
    for (const name of [northName, portalName]) {
      const link = await main().findByRole('link', { name });
      expect(within(link.closest('li')!).getByText(networkName)).toBeVisible();
    }
    expect(await documentsAndBindings()).toEqual(before);
  });

  it('behält die Auswahl bei einem Konflikt, lädt den aktuellen Bestand und schreibt keine Teilzuordnung', async () => {
    renderWorkspaceArea(buildScopeUrl(network.scopeId));
    await openAssignment();
    fireEvent.click(button('2 zuordnen'));
    await readStore(store => store.changeVerbundScope(portal.verbundId, null, other, portal.savedAt));
    const concurrent = await rows();
    fireEvent.click(dialog().getByRole('button', { name: 'Zuordnen' }));
    expect(await main().findByRole('alert')).toHaveTextContent('inzwischen geändert');
    expect(main().getByRole('checkbox', { name: northName })).toBeChecked();
    expect(await within(main().getByRole('region', { name: 'Bereits zugeordnet' })).findByText(portalName)).toBeVisible();
    expect(await rows()).toEqual(concurrent);
  });

  it('lädt die Auswahl nach einer Änderung aus „Bereits zugeordnet“ neu', async () => {
    await readStore(store => store.changeVerbundScope(portal.verbundId, null, other, portal.savedAt));
    renderWorkspaceArea(buildScopeUrl(network.scopeId));
    fireEvent.click(await main().findByRole('button', { name: 'Vorhandene zuordnen' }));
    fireEvent.click(within(main().getByRole('region', { name: 'Bereits zugeordnet' })).getByRole('button', { name: 'Zuordnung ändern…' }));
    fireEvent.click(main().getByRole('radio', { name: 'Keiner' }));
    await waitFor(() => expect(button('Zuordnung aufheben…')).toBeEnabled());
    fireEvent.click(button('Zuordnung aufheben…'));
    fireEvent.click(dialog().getByRole('button', { name: 'Zuordnung aufheben' }));
    expect(await main().findByRole('checkbox', { name: portalName })).toBeVisible();
    expect(within(main().getByRole('region', { name: 'Bereits zugeordnet' })).queryByText(portalName)).toBeNull();
  });

  it('wiederholt nach einem Lesefehler die Dokumentabfrage für denselben Verbund', async () => {
    const listDocuments = vi.fn().mockImplementationOnce(() => fail('WORKSPACE_STORAGE_FAILED')).mockImplementation(() => ok([]));
    const port = fakePort({
      listScopes: () => ok([network, other]),
      listVerbuende: () => ok([{ ...north, scopeId: network.scopeId }]),
      listDocuments,
    });
    renderWorkspaceWithPort(port, buildScopeUrl(network.scopeId));
    fireEvent.click(await main().findByRole('button', { name: 'Zuordnung ändern…' }));
    fireEvent.click(main().getByRole('radio', { name: otherName }));
    fireEvent.click(await main().findByRole('button', { name: 'Neu laden' }));
    await waitFor(() => expect(button('Zuordnung ändern…')).toBeEnabled());
    expect(listDocuments).toHaveBeenLastCalledWith(north.verbundId);
    expect(listDocuments).toHaveBeenCalledTimes(2);
    expect(main().getByText('Verbundidentität · 0 Dokumente')).toBeVisible();
  });

  it('hält die Auswahl sichtbar, wenn der Zielbereich gelöscht wurde', async () => {
    renderWorkspaceArea(buildScopeUrl(network.scopeId));
    await openAssignment();
    fireEvent.click(button('2 zuordnen'));
    await readStore(store => store.deleteScope(network.scopeId, { scopeSavedAt: network.savedAt, verbuende: [] }, 'delete-scope'));
    fireEvent.click(dialog().getByRole('button', { name: 'Zuordnen' }));
    expect(await main().findByText('Der Anwendungsbereich ist nicht mehr verfügbar.')).toBeVisible();
    expect(main().getByRole('checkbox', { name: northName })).toBeChecked();
    expect(button('2 zuordnen')).toBeDisabled();
    expect(await rows()).toEqual(expect.arrayContaining([north, portal]));
  });

  it('wechselt und löst eine Zuordnung nur per Bestätigung und kann aus einem Verbund zuordnen', async () => {
    await readStore(store => store.changeVerbundScope(north.verbundId, null, network, north.savedAt));
    const before = await rows();
    const docs = await documentsAndBindings();
    const { router } = renderWorkspaceArea(buildScopeUrl(network.scopeId));
    const change = await main().findByRole('button', { name: 'Zuordnung ändern…' });
    change.focus();
    fireEvent.click(change);
    expect(main().getByText('Bisher').nextElementSibling).toHaveTextContent(networkName);
    fireEvent.click(main().getByRole('radio', { name: otherName }));
    await waitFor(() => expect(button('Zuordnung ändern…')).toBeEnabled());
    fireEvent.click(button('Zuordnung ändern…'));
    expect(dialog().getByText(otherName, { exact: false })).toBeVisible();
    fireEvent.click(dialog().getByRole('button', { name: 'Abbrechen' }));
    fireEvent.click(button('Abbrechen'));
    expect(change).toHaveFocus();
    expect(await rows()).toEqual(before);

    fireEvent.click(change);
    await act(() => router.navigate(buildWorkspaceIndexUrl()));
    expect(await rows()).toEqual(before);
    await act(() => router.navigate(buildScopeUrl(network.scopeId)));
    fireEvent.click(await main().findByRole('button', { name: 'Zuordnung ändern…' }));
    fireEvent.click(main().getByRole('radio', { name: otherName }));
    await waitFor(() => expect(button('Zuordnung ändern…')).toBeEnabled());
    fireEvent.click(button('Zuordnung ändern…'));
    fireEvent.click(dialog().getByRole('button', { name: 'Zuordnung ändern' }));
    await waitFor(async () => expect((await rows()).find(row => row.verbundId === north.verbundId)?.scopeId).toBe(other.scopeId));
    await act(() => router.navigate(buildScopeUrl(other.scopeId)));
    fireEvent.click(await main().findByRole('button', { name: 'Zuordnung aufheben…' }));
    expect(main().getByRole('radio', { name: 'Keiner' })).toBeChecked();
    await waitFor(() => expect(button('Zuordnung aufheben…')).toBeEnabled());
    fireEvent.click(button('Zuordnung aufheben…'));
    fireEvent.click(dialog().getByRole('button', { name: 'Zuordnung aufheben' }));
    await waitFor(async () => expect((await rows()).find(row => row.verbundId === north.verbundId)?.scopeId).toBeUndefined());

    await act(() => router.navigate(buildVerbundUrl(north.verbundId)));
    fireEvent.click(await main().findByRole('button', { name: 'Zuordnen…' }));
    expect(main().getByText('Bisher').nextElementSibling).toHaveTextContent('keiner');
    fireEvent.click(main().getByRole('radio', { name: otherName }));
    await waitFor(() => expect(button('Zuordnen…')).toBeEnabled());
    fireEvent.click(button('Zuordnen…'));
    fireEvent.click(dialog().getByRole('button', { name: 'Zuordnen' }));
    await waitFor(async () => expect((await rows()).find(row => row.verbundId === north.verbundId)?.scopeId).toBe(other.scopeId));
    expect(await documentsAndBindings()).toEqual(docs);
  });

  it('hält den Namen beim Routenwechsel und legt den Verbund im Anwendungsbereich an', async () => {
    const { router } = renderWorkspaceArea(buildScopeUrl(network.scopeId));
    fireEvent.click(await main().findByRole('button', { name: 'Informationsverbund hier anlegen' }));
    fireEvent.change(main().getByLabelText('Name des Informationsverbunds'), { target: { value: 'Verwaltung' } });
    await act(() => router.navigate(buildWorkspaceIndexUrl()));
    await act(() => router.navigate(buildScopeUrl(network.scopeId)));
    fireEvent.click(await main().findByRole('button', { name: 'Informationsverbund hier anlegen' }));
    expect(main().getByLabelText('Name des Informationsverbunds')).toHaveValue('Verwaltung');
    fireEvent.click(button('Anlegen'));
    await main().findByRole('link', { name: 'Verwaltung' });
    expect((await rows()).find(row => row.name === 'Verwaltung')?.scopeId).toBe(network.scopeId);
  });

  it('sperrt Anlegen, Zuordnen, Wechsel und Aufheben bei schreibgeschütztem Speicher', async () => {
    const port = fakePort({
      schemaStatus: () => ok('newer' as const),
      listScopes: () => ok([network]),
      listVerbuende: () => ok([{ ...north, scopeId: network.scopeId }, portal]),
    });
    const { router } = renderWorkspaceWithPort(port, buildScopeUrl(network.scopeId));
    await main().findByText('Schreibsperre');
    for (const action of ['Vorhandene zuordnen', 'Informationsverbund hier anlegen', 'Zuordnung ändern…', 'Zuordnung aufheben…']) {
      expect(button(action)).toBeDisabled();
    }
    await act(() => router.navigate(buildVerbundUrl(portal.verbundId)));
    expect(await main().findByRole('button', { name: 'Zuordnen…' })).toBeDisabled();
  });
});
