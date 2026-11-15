import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScopeUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import type { WorkspacePort } from '@/state/workspaceVerbundView';
import { SCOPE, fakePort, ok } from '@/test/fakeWorkspacePort';
import { mainLandmark as main, renderWorkspaceArea as renderArea, renderWorkspaceWithPort } from '@/test/renderWorkspaceArea';
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

const renderWith = (port: WorkspacePort, path = buildWorkspaceIndexUrl()) => renderWorkspaceWithPort(port, path);

const region = (name: string) => within(within(main()).getByRole('region', { name }));
const createEntry = async () => (await within(main()).findAllByRole('button', { name: 'Anwendungsbereich anlegen' }))[0];

type CreateResult = Awaited<ReturnType<WorkspacePort['createScope']>>;

/** Sendet die Anlage von „Netzbetrieb“ ab; das Speichern bleibt offen, bis `finish()` es bestätigt. */
const submitWithPendingSave = async () => {
  let resolveSave: (value: CreateResult) => void = () => undefined;
  const createScope = vi.fn(() => new Promise<CreateResult>((resolve) => { resolveSave = resolve; }));
  const { router } = renderWith(fakePort({ createScope }));
  const entry = await createEntry();
  await waitFor(() => expect(entry).toBeEnabled());
  fireEvent.click(entry);
  fireEvent.change(within(main()).getByLabelText('Name des Anwendungsbereichs'), { target: { value: 'Netzbetrieb' } });
  fireEvent.click(within(main()).getByRole('button', { name: 'Anlegen' }));
  return { router, createScope, finish: () => resolveSave({ ok: true, value: { ...SCOPE, name: 'Netzbetrieb' } }) };
};

afterEach(async () => {
  await resetWorkspace();
});

describe('Navigation und Fokus rund um Anwendungsbereiche', () => {
  it('lässt eine während des Speicherns gewählte Navigation auf eine noch ladende Seite bestehen', async () => {
    const { router, createScope, finish } = await submitWithPendingSave();
    // Das Speichern endet, sobald der Router `loading` meldet, noch bevor React neu rendert.
    const unsubscribe = router.subscribe((state) => {
      if (state.navigation.state !== 'loading') return;
      unsubscribe();
      finish();
    });
    void router.navigate('/impressum');
    await waitFor(() => expect(router.state.navigation.state).toBe('loading'));
    // Der Ziel-Chunk lädt noch: Die Anlageansicht ist montiert, wenn das Speichern bestätigt wird.
    expect(within(main()).getByRole('heading', { level: 1, name: 'Anwendungsbereich anlegen' })).toBeInTheDocument();
    expect(createScope).toHaveBeenCalledTimes(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    impressumChunk.release();
    expect(await screen.findByRole('heading', { level: 1, name: 'Impressum' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/impressum');
  });

  it('lässt eine während des Speicherns abgeschlossene Navigation bestehen, solange die Anlageansicht noch angezeigt wird', async () => {
    const { router, createScope, finish } = await submitWithPendingSave();
    // Der Router meldet Ziel und `idle` gemeinsam; das Speichern endet, bevor React die Anlageansicht abbaut.
    let formShown = false;
    const unsubscribe = router.subscribe((state) => {
      if (state.navigation.state !== 'idle' || state.location.pathname !== '/impressum') return;
      unsubscribe();
      formShown = within(main()).queryByRole('heading', { level: 1, name: 'Anwendungsbereich anlegen' }) !== null;
      finish();
    });
    impressumChunk.release();
    void router.navigate('/impressum');
    expect(await screen.findByRole('heading', { level: 1, name: 'Impressum' })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(formShown).toBe(true);
    expect(createScope).toHaveBeenCalledTimes(1);
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
