import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/app/AppShell';
import { buildScopeUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import type { ScopeId, WorkspaceScope } from '@/domain/workspaceModel';
import { CatalogContext } from '@/state/CatalogContext';
import { WorkspaceProvider } from '@/state/WorkspaceContext';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { fakePort, ok } from '@/test/fakeWorkspacePort';
import { renderAppShell } from '@/test/renderAppShell';
import { EMPTY_CATALOG_STATE, mainLandmark as main, renderWorkspaceArea as renderArea } from '@/test/renderWorkspaceArea';
import { resetWorkspace } from '@/test/workspaceAreaFixture';

// Der Impressum-Chunk trifft erst auf `impressumChunk.release()` ein: Die Navigation dorthin bleibt so lange `loading`.
const impressumChunk = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const arrived = new Promise<void>((resolve) => { release = resolve; });
  return { arrived, release: () => release() };
});
vi.mock('@/features/pages/ImpressumPage', async () => {
  await impressumChunk.arrived;
  return { ImpressumPage: () => <h1>Impressum</h1> };
});

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
const createEntry = async () => (await within(main()).findAllByRole('button', { name: 'Anwendungsbereich anlegen' }))[0];

afterEach(async () => {
  await resetWorkspace();
});

describe('Navigation und Fokus rund um Anwendungsbereiche', () => {
  it('lässt eine während des Speicherns gewählte Navigation auf eine noch ladende Seite bestehen', async () => {
    let finish: (value: Awaited<ReturnType<WorkspacePort['createScope']>>) => void = () => undefined;
    const createScope = vi.fn(() => new Promise<Awaited<ReturnType<WorkspacePort['createScope']>>>((resolve) => { finish = resolve; }));
    const { router } = renderWith(fakePort({ createScope }));
    const entry = await createEntry();
    await waitFor(() => expect(entry).toBeEnabled());
    fireEvent.click(entry);
    fireEvent.change(within(main()).getByLabelText('Name des Anwendungsbereichs'), { target: { value: 'Netzbetrieb' } });
    fireEvent.click(within(main()).getByRole('button', { name: 'Anlegen' }));
    void router.navigate('/impressum');
    await waitFor(() => expect(router.state.navigation.state).toBe('loading'));
    // Der Ziel-Chunk lädt noch: Die Anlageansicht ist montiert, wenn das Speichern bestätigt wird.
    expect(within(main()).getByRole('heading', { level: 1, name: 'Anwendungsbereich anlegen' })).toBeInTheDocument();
    finish({ ok: true, value: { ...SCOPE, name: 'Netzbetrieb' } });
    await waitFor(() => expect(createScope).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    impressumChunk.release();
    expect(await screen.findByRole('heading', { level: 1, name: 'Impressum' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/impressum');
  });

  it('gibt den Fokus bei Escape an den Einstieg im Leerzustand zurück', async () => {
    renderArea(buildWorkspaceIndexUrl());
    await waitFor(async () => expect(await createEntry()).toBeEnabled());
    const emptyEntry = region('Anwendungsbereiche').getByRole('button', { name: 'Anwendungsbereich anlegen' });
    fireEvent.click(emptyEntry);
    fireEvent.keyDown(within(main()).getByLabelText('Name des Anwendungsbereichs'), { key: 'Escape' });
    await waitFor(() => expect(region('Anwendungsbereiche').getByRole('button', { name: 'Anwendungsbereich anlegen' })).toHaveFocus());
  });

  it('setzt den Fokus beim Rückweg aus dem Anwendungsbereich auf die Überschrift des Arbeitsbereichs', async () => {
    renderWith(fakePort({ listScopes: () => ok([SCOPE]) }), buildScopeUrl(SCOPE.scopeId));
    await within(main()).findByRole('heading', { level: 1, name: SCOPE.name });
    const back = within(main()).getByRole('link', { name: /Arbeitsbereich/ });
    back.focus();
    fireEvent.click(back);
    const heading = await within(main()).findByRole('heading', { level: 1, name: 'Arbeitsbereich' });
    await waitFor(() => expect(heading).toHaveFocus());
  });
});
