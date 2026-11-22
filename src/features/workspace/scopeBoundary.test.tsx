import 'fake-indexeddb/auto';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScopeUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { buildScopeBoundary, scopeBoundaryInput } from '@/domain/scopeBoundary';
import type { WorkspaceResult, WorkspaceScope } from '@/domain/workspaceModel';
import { SCOPE, fail, fakePort, ok } from '@/test/fakeWorkspacePort';
import { mainLandmark as main, renderWorkspaceArea as renderArea, renderWorkspaceWithPort } from '@/test/renderWorkspaceArea';
import { SENTINEL, readStore, resetWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/features/catalog/CatalogBrowser', () => ({ CatalogBrowser: () => <h1>Katalogansicht</h1> }));

const card = () => within(within(main()).getByRole('region', { name: 'Abgrenzung' }));
const findCard = async () => within(await within(main()).findByRole('region', { name: 'Abgrenzung' }));
const type = (label: string, text: string) => fireEvent.change(within(main()).getByLabelText(label), { target: { value: text } });
const FIELDS: [string, string][] = [
  ['Organisatorische Abgrenzung', `Verwaltung ${SENTINEL}`], ['Geschäftsprozesse', 'Netzbetrieb'],
  ['Standorte, Anwendungen und IT-Systeme', 'Standort Nord'], ['Externe Partner und Dienstleister', 'keine'],
  ['Schnittstellen', 'Dienstleister-Portal'], ['Ausschlüsse', 'Messstellenbetrieb'],
  ['Quelle', 'Abgrenzung v2'], ['Datum', '2026-10-22'], ['Rolle', 'ISB'], ['Zuständige Stelle', 'Sicherheitsorganisation'],
];

afterEach(async () => {
  await resetWorkspace();
});

describe('Abgrenzung des Anwendungsbereichs', () => {
  it('erfasst die Abgrenzung von „Fehlt“ zu „Erfasst“, zeigt sie nach Reload und meldet ein leeres Pflichtfeld als „Offen“', async () => {
    const created = await readStore((store) => store.createScope('Netzbetrieb'));
    const first = renderArea(buildScopeUrl(created.scopeId));
    const edit = await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ });
    expect(card().getAllByText('Fehlt')).toHaveLength(2);
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    expect(within(main()).getByRole('heading', { level: 1, name: 'Abgrenzung erfassen' })).toHaveFocus();
    for (const [label, text] of FIELDS) type(label, text);
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));

    await waitFor(() => expect(within(main()).getByRole('heading', { level: 1, name: 'Netzbetrieb' })).toHaveFocus());
    expect(card().getByText('Erfasst')).toBeInTheDocument();
    expect(card().getByText('Abgrenzung v2 · 22.10.2026')).toBeInTheDocument();
    expect(card().getByText('ISB · Sicherheitsorganisation')).toBeInTheDocument();
    // Quellentexte werden nie als Link aufgelöst; Abgrenzungstexte stehen weder in Route noch Titel.
    expect(card().queryByRole('link')).toBeNull();
    const { pathname, search, hash, state } = first.router.state.location;
    expect([pathname, search, hash, JSON.stringify(state ?? null), document.title].join('\n')).not.toContain(SENTINEL);
    first.unmount();

    renderArea(buildScopeUrl(created.scopeId));
    expect(await (await findCard()).findByText('Erfasst')).toBeInTheDocument();
    expect(card().getByText('Abgrenzung v2 · 22.10.2026')).toBeInTheDocument();
    fireEvent.click(card().getByRole('button', { name: /Abgrenzung bearbeiten/ }));
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Dienstleister-Portal');
    type('Schnittstellen', '  ');
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).queryByRole('heading', { level: 1, name: 'Abgrenzung bearbeiten' })).toBeNull());
    expect(await card().findByText('Offen')).toBeInTheDocument();
    expect(card().getByText('Schnittstellen')).toBeInTheDocument();
  });

  it('behält die Eingabe bei Konflikt und Speicherfehler; Abbrechen speichert nichts und fokussiert den Auslöser', async () => {
    const saveScopeBoundary = vi.fn()
      .mockReturnValueOnce(fail('WORKSPACE_SAVE_CONFLICT'))
      .mockReturnValueOnce(fail('WORKSPACE_STORAGE_FAILED'));
    renderWorkspaceWithPort(fakePort({ listScopes: () => ok([SCOPE]), saveScopeBoundary }), buildScopeUrl(SCOPE.scopeId));
    const edit = await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    type('Schnittstellen', 'Portal');
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    expect(await within(main()).findByText(/Anwendungsbereich inzwischen geändert/)).toHaveAttribute('role', 'alert');
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Portal');
    expect(saveScopeBoundary).toHaveBeenCalledWith(SCOPE.scopeId, SCOPE.savedAt, expect.objectContaining({ interfaces: 'Portal' }));
    expect(within(main()).queryByRole('button', { name: 'Aktuellen Stand laden' })).toBeNull();
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    expect(await within(main()).findByText('Lokal speichern fehlgeschlagen. Die Eingabe bleibt erhalten.')).toHaveAttribute('role', 'alert');
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Portal');

    fireEvent.click(within(main()).getByRole('button', { name: 'Abbrechen' }));
    await waitFor(() => expect(card().getByRole('button', { name: /Abgrenzung erfassen/ })).toHaveFocus());
    expect(saveScopeBoundary).toHaveBeenCalledTimes(2);
  });

  it('übernimmt nach einem Konflikt den neueren Stand nur ausdrücklich und überschreibt ihn nie mit veralteter Eingabe', async () => {
    const created = await readStore((store) => store.createScope('Netzbetrieb'));
    renderArea(buildScopeUrl(created.scopeId));
    const edit = await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    type('Schnittstellen', 'Alt');
    // Ein anderer Tab speichert inzwischen eine Abgrenzung.
    const [current] = await readStore((store) => store.listScopes());
    await readStore((store) => store.saveScopeBoundary(current.scopeId, current.savedAt, { ...scopeBoundaryInput(undefined), interfaces: 'Neu' }));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    expect(await within(main()).findByText(/Anwendungsbereich inzwischen geändert/)).toHaveAttribute('role', 'alert');
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Alt');
    // Ein erneutes Speichern der alten Eingabe bleibt ein Konflikt, auch nachdem der Bestand neu gelesen wurde.
    const load = await within(main()).findByRole('button', { name: 'Aktuellen Stand laden' });
    expect(load).toBeEnabled();
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).getByRole('button', { name: 'Speichern' })).toBeEnabled());
    expect((await readStore((store) => store.listScopes()))[0].items[0]?.details.interfaces).toBe('Neu');
    fireEvent.click(load);
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Neu');
    type('Ausschlüsse', 'Messstellenbetrieb');
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).queryByRole('heading', { level: 1, name: 'Abgrenzung bearbeiten' })).toBeNull());
    expect((await readStore((store) => store.listScopes()))[0].items[0]?.details).toMatchObject({ interfaces: 'Neu', exclusions: 'Messstellenbetrieb' });
  });

  it('speichert nach einer reinen Zuordnungsänderung ohne Laden eines neuen Stands', async () => {
    const created = await readStore((store) => store.createScope('Netzbetrieb'));
    renderArea(buildScopeUrl(created.scopeId));
    const edit = await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    type('Schnittstellen', 'Portal');
    // Ein anderer Tab legt im Bereich einen Verbund an: Der Stempel des Bereichs steigt, die Abgrenzung bleibt.
    const [current] = await readStore((store) => store.listScopes());
    await readStore((store) => store.createVerbund('Mitglied', current));
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    expect(await within(main()).findByText(/Anwendungsbereich inzwischen geändert/)).toHaveAttribute('role', 'alert');
    await waitFor(() => expect(within(main()).getByRole('button', { name: 'Speichern' })).toBeEnabled());
    expect(within(main()).queryByRole('button', { name: 'Aktuellen Stand laden' })).toBeNull();
    // Der Provider hat neu gelesen, sobald er den neuen Verbund führt; `setVerbuende` folgt auf `setScopes`.
    await waitFor(() => expect(within(main()).getByText('Mitglied')).toBeInTheDocument());
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await waitFor(() => expect(within(main()).queryByRole('heading', { level: 1, name: 'Abgrenzung erfassen' })).toBeNull());
    expect((await readStore((store) => store.listScopes()))[0].items[0]?.details.interfaces).toBe('Portal');
  });

  it('behält eine ungespeicherte Eingabe über einen Routenwechsel', async () => {
    const { router } = renderWorkspaceWithPort(fakePort({ listScopes: () => ok([SCOPE]) }), buildScopeUrl(SCOPE.scopeId));
    const edit = await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    type('Schnittstellen', 'Portal');
    await router.navigate(buildWorkspaceIndexUrl());
    await within(main()).findByRole('heading', { level: 1, name: 'Arbeitsbereich' });
    await router.navigate(buildScopeUrl(SCOPE.scopeId));
    fireEvent.click(await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ }));
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Portal');
    fireEvent.click(within(main()).getByRole('button', { name: 'Abbrechen' }));
    fireEvent.click(await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ }));
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('');
  });

  it('sperrt Erfassen bei Schreibsperre und zeigt eine vorhandene Abgrenzung schreibgeschützt', async () => {
    const first = renderWorkspaceWithPort(fakePort({ schemaStatus: () => ok('newer' as const), listScopes: () => ok([SCOPE]) }), buildScopeUrl(SCOPE.scopeId));
    expect(await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ })).toBeDisabled();
    first.unmount();
    const item = buildScopeBoundary('88888888-8888-4888-8888-888888888888', { ...scopeBoundaryInput(undefined), interfaces: 'Portal' });
    const stored = { ...SCOPE, items: [item] } as unknown as WorkspaceScope;
    renderWorkspaceWithPort(fakePort({ schemaStatus: () => ok('newer' as const), listScopes: () => ok([stored]) }), buildScopeUrl(SCOPE.scopeId));
    const view = await (await findCard()).findByRole('button', { name: /Abgrenzung ansehen/ });
    expect(view).toBeEnabled();
    fireEvent.click(view);
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Portal');
    expect(within(main()).getByLabelText('Schnittstellen')).toBeDisabled();
    expect(within(main()).getByRole('button', { name: 'Speichern' })).toBeDisabled();
  });

  it('löscht nach dem Speichern keinen inzwischen neu begonnenen Entwurf', async () => {
    let finish: (value: WorkspaceResult<WorkspaceScope>) => void = () => undefined;
    const saveScopeBoundary = vi.fn(() => new Promise<WorkspaceResult<WorkspaceScope>>((resolve) => { finish = resolve; }));
    const { router } = renderWorkspaceWithPort(fakePort({ listScopes: () => ok([SCOPE]), saveScopeBoundary }), buildScopeUrl(SCOPE.scopeId));
    const edit = await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ });
    await waitFor(() => expect(edit).toBeEnabled());
    fireEvent.click(edit);
    type('Schnittstellen', 'Erste');
    fireEvent.click(within(main()).getByRole('button', { name: 'Speichern' }));
    await router.navigate(buildWorkspaceIndexUrl());
    await within(main()).findByRole('heading', { level: 1, name: 'Arbeitsbereich' });
    await router.navigate(buildScopeUrl(SCOPE.scopeId));
    fireEvent.click(await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ }));
    type('Schnittstellen', 'Zweite');
    finish({ ok: true, value: SCOPE });
    await router.navigate(buildWorkspaceIndexUrl());
    await within(main()).findByRole('heading', { level: 1, name: 'Arbeitsbereich' });
    await router.navigate(buildScopeUrl(SCOPE.scopeId));
    fireEvent.click(await (await findCard()).findByRole('button', { name: /Abgrenzung erfassen/ }));
    expect(within(main()).getByLabelText('Schnittstellen')).toHaveValue('Zweite');
  });
});
