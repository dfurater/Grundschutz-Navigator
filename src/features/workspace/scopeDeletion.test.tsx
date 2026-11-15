import 'fake-indexeddb/auto';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScopeUrl, buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import { SCOPE, VERBUND, fail, fakePort, findNotice, ok } from '@/test/fakeWorkspacePort';
import { mainLandmark as main, renderWorkspaceArea as renderArea, renderWorkspaceWithPort } from '@/test/renderWorkspaceArea';
import { SENTINEL_VERBUND, readStore, resetWorkspace, seedWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});

afterEach(async () => {
  await resetWorkspace();
});

describe('Anwendungsbereich löschen', () => {
  const openDelete = async () => {
    const trigger = await within(main()).findByRole('button', { name: 'Löschen…' });
    await waitFor(() => expect(trigger).toBeEnabled());
    trigger.focus();
    fireEvent.click(trigger);
    return { trigger, dialog: within(screen.getByRole('alertdialog', { name: 'Anwendungsbereich löschen?' })) };
  };

  it.each([0, 1, 2])('nennt %i Mitglieder und schreibt bei Abbruch nichts', async (count) => {
    const rows = [
      { ...VERBUND, scopeId: SCOPE.scopeId },
      { ...VERBUND, verbundId: '1a1d0c2e-5b3f-4c6d-8e9f-0a1b2c3d4e5f' as typeof VERBUND.verbundId, scopeId: SCOPE.scopeId },
    ].slice(0, count);
    const deleteScope = vi.fn(() => ok(undefined));
    renderWorkspaceWithPort(fakePort({ listScopes: () => ok([SCOPE]), listVerbuende: () => ok(rows), deleteScope }), buildScopeUrl(SCOPE.scopeId));
    const { trigger, dialog } = await openDelete();
    expect(dialog.getByText('Werden unzugeordnet')).toBeVisible();
    expect(dialog.getByText(`${count} ${count === 1 ? 'Informationsverbund' : 'Informationsverbünde'}`)).toBeVisible();
    const cancel = dialog.getByRole('button', { name: 'Abbrechen' });
    expect(cancel).toHaveFocus();
    fireEvent.click(cancel);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(deleteScope).not.toHaveBeenCalled();
  });

  it('zeigt einen Konflikt und liest den aktuellen Stand nach einer veralteten Bestätigung', async () => {
    const member = { ...VERBUND, scopeId: SCOPE.scopeId };
    const updated = { ...SCOPE, name: 'Neuer Stand', savedAt: '2026-11-15T00:00:00.000Z' };
    let listed = [SCOPE];
    const deleteScope = vi.fn(() => {
      listed = [updated];
      return fail('WORKSPACE_SAVE_CONFLICT');
    });
    renderWorkspaceWithPort(fakePort({ listScopes: () => ok(listed), listVerbuende: () => ok([member]), deleteScope }), buildScopeUrl(SCOPE.scopeId));
    const { dialog } = await openDelete();
    fireEvent.click(dialog.getByRole('button', { name: 'Endgültig löschen' }));
    expect(await findNotice('In einem anderen Tab geändert')).toBeInTheDocument();
    expect(await within(main()).findByRole('heading', { name: updated.name })).toBeInTheDocument();
    expect(deleteScope).toHaveBeenCalledExactlyOnceWith(SCOPE.scopeId, {
      scopeSavedAt: SCOPE.savedAt, verbuende: [{ verbundId: member.verbundId, savedAt: member.savedAt }],
    }, 'delete-scope');
  });

  it('kehrt nach bestätigter Löschung mit Status in den Arbeitsbereich zurück und lässt Verbünde öffnen', async () => {
    const seeded = await seedWorkspace();
    const scope = await readStore(store => store.createScope('Netzbetrieb'));
    const rows = await readStore(store => store.listVerbuende());
    await readStore(store => store.assignVerbuende(scope.scopeId, { scopeSavedAt: scope.savedAt, verbuende: rows }));
    const first = renderArea(buildScopeUrl(scope.scopeId));
    const { dialog } = await openDelete();
    fireEvent.click(dialog.getByRole('button', { name: 'Endgültig löschen' }));
    expect(await within(main()).findByRole('heading', { level: 1, name: 'Arbeitsbereich' })).toHaveFocus();
    expect(within(main()).getByRole('status', { name: '' })).toHaveTextContent('Anwendungsbereich gelöscht.');
    await within(main()).findByText('Kein Anwendungsbereich angelegt');

    await act(() => first.router.navigate('/about'));
    await within(main()).findByRole('heading', { level: 1, name: 'Über das Projekt' });
    await act(() => first.router.navigate(-1));
    await within(main()).findByRole('heading', { level: 1, name: 'Arbeitsbereich' });
    expect(within(main()).queryAllByText('Anwendungsbereich gelöscht.')).toHaveLength(0);
    first.unmount();

    renderArea(buildWorkspaceIndexUrl());
    const entry = await within(main()).findByRole('link', { name: SENTINEL_VERBUND });
    expect(entry).toHaveAttribute('href', buildVerbundUrl(seeded.verbundId));
    expect(within(entry.closest('li')!).getByText('Unzugeordnet')).toBeVisible();
    fireEvent.click(entry);
    expect(await within(main()).findByRole('heading', { level: 1, name: SENTINEL_VERBUND })).toBeInTheDocument();
  });
});
