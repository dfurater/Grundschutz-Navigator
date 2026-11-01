import 'fake-indexeddb/auto';
import { cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import { buildStationUrl } from '@/app/routes';
import { makeFullPoam, makeMinimalPoam } from '@/test/fixtures/poams';
import { mainLandmark as main, renderWorkspaceArea } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, SENTINEL, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());

let seeded: SeededWorkspace;
beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await resetWorkspace(); });

// JSON-Kopie: Die Fixture teilt Teilobjekte, der Klasse-2-Objektgraph verlangt einen Baum.
function addPoam(source: unknown) {
  return readStore(store => store.addDocument(seeded.verbundId, {
    source: JSON.parse(JSON.stringify(source)), context: { trustClass: 'class-2-local-user' }, rootType: 'plan-of-action-and-milestones', oscalVersion: '1.2.2',
  }, 'imported'));
}

describe('Umsetzungsfortschritt in der Station POA&M', () => {
  it('listet Maßnahmen mit und ohne erklärte Umsetzung lesend und ohne Klasse-2-Werte in URL oder Log', async () => {
    const open = makeFullPoam();
    const openBody = open['plan-of-action-and-milestones'];
    openBody['poam-items'][0].title = `Offen ${SENTINEL}`;
    const done = makeMinimalPoam();
    done['plan-of-action-and-milestones'].uuid = '00000000-0000-4000-8000-000000000401';
    const doneSource = makeFullPoam();
    const doneBody = doneSource['plan-of-action-and-milestones'];
    doneBody.uuid = '00000000-0000-4000-8000-000000000402';
    doneBody['poam-items'][0].title = 'Erledigt';
    (doneBody.risks[0].remediations[0] as Record<string, unknown>).lifecycle = 'completed';
    await addPoam(open);
    await addPoam(done);
    await addPoam(doneSource);
    const writes = ['saveDocument', 'autosaveDraft', 'addDocument', 'setBinding', 'deleteDocument']
      .map(method => vi.spyOn(WorkspaceStore.prototype, method as keyof WorkspaceStore));
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map(level => vi.spyOn(console, level as 'log'));

    const { router } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'poam'));
    const openSection = await within(main()).findByRole('region', { name: /Umsetzung nicht erklärt/ });
    const doneSection = within(main()).getByRole('region', { name: /^Umsetzung erklärt/ });
    expect(openSection).toHaveTextContent(`Offen ${SENTINEL}`);
    expect(openSection).toHaveTextContent('2026-12-01T00:00:00Z');
    expect(openSection).toHaveTextContent('ac-1_obj');
    expect(openSection).toHaveTextContent('Geplant');
    expect(within(openSection).getByText('Maßnahme').closest('li')).toHaveTextContent('Fristlage unbekannt');
    expect(within(openSection).getByText('Maßnahme').closest('li')).toHaveTextContent('keine Frist');
    expect(doneSection).toHaveTextContent('Erledigt');
    expect(doneSection).toHaveTextContent('Umsetzung erklärt');
    expect(doneSection).toHaveTextContent('risk.status open');
    expect(main()).toHaveTextContent('Fristlage berechnet aus Frist und Systemzeit');
    expect(main()).not.toHaveTextContent(/eingehalten|Abgeschlossen/);

    fireEvent.change(within(main()).getByLabelText('Sortierung'), { target: { value: 'stand' } });
    await waitFor(() => expect(within(main()).getByLabelText('Sortierung')).toHaveValue('stand'));
    expect(JSON.stringify(router.state.location)).not.toContain(SENTINEL);
    expect(JSON.stringify(router.state.location)).not.toContain('stand');
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
  });

  it('führt ein importiertes POA&M von künftiger über überschrittene Frist zur erklärten Umsetzung ohne Wirksamkeitsbeleg', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const source = makeFullPoam();
    const added = await addPoam(source);
    const rowAt = async (now: string) => {
      vi.setSystemTime(new Date(now));
      renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'poam'));
      return (await within(main()).findByText('Maßnahme')).closest('li') as HTMLElement;
    };

    expect(await rowAt('2026-11-30T23:59:59Z')).toHaveTextContent('noch nicht fällig');
    cleanup();
    const overdue = await rowAt('2026-12-01T00:00:00Z');
    expect(within(overdue).getByText('überschritten')).toBeInTheDocument();
    fireEvent.click(within(overdue).getByText('Quellen'));
    expect(within(overdue).getByText('/plan-of-action-and-milestones/risks/0/deadline')).toBeVisible();
    cleanup();

    (source['plan-of-action-and-milestones'].risks[0].remediations[0] as Record<string, unknown>).lifecycle = 'completed';
    await readStore(store => store.saveDocument(added.localId, added.savedAt, null, {
      source: JSON.parse(JSON.stringify(source)), context: { trustClass: 'class-2-local-user' }, rootType: 'plan-of-action-and-milestones', oscalVersion: '1.2.2',
    }));
    const declared = await rowAt('2026-12-02T00:00:00Z');
    expect(within(main()).getByRole('region', { name: /^Umsetzung erklärt/ })).toContainElement(declared);
    expect(declared).toHaveTextContent('Einhaltung nicht belegt');
    expect(declared).not.toHaveTextContent('überschritten');
    expect(declared).toHaveTextContent('Wirksamkeit nicht belegt');
    expect(declared).toHaveTextContent('risk.status open');
  });

  it('meldet einen Ladefehler als Alert ohne Klasse-2-Werte in der Konsole', async () => {
    const source = makeFullPoam();
    source['plan-of-action-and-milestones']['poam-items'][0].title = `Fehler ${SENTINEL}`;
    const added = await addPoam(source);
    const original = WorkspaceStore.prototype.getDocument;
    let calls = 0;
    // Der erste Abruf baut die Verbundansicht; erst der Abruf der Fortschrittsliste scheitert.
    vi.spyOn(WorkspaceStore.prototype, 'getDocument').mockImplementation(function (this: WorkspaceStore, localId) {
      if (localId === added.localId && ++calls > 1) return Promise.resolve(failure(new StorageFailure('WORKSPACE_STORAGE_FAILED')));
      return original.call(this, localId);
    });
    const logs = ['log', 'info', 'warn', 'error', 'debug'].map(level => vi.spyOn(console, level as 'log'));
    renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'poam'));
    expect(await within(main()).findByRole('alert')).toHaveTextContent('Umsetzungsfortschritt konnte nicht geladen werden.');
    expect(main()).not.toHaveTextContent('Umsetzungsfortschritt wird geladen');
    expect(main()).not.toHaveTextContent(`Fehler ${SENTINEL}`);
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
  });

  it('zeigt ohne POA&M leere Bereiche statt eines Fehlers', async () => {
    renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'poam'));
    const openSection = await within(main()).findByRole('region', { name: /Umsetzung nicht erklärt/ });
    expect(openSection).toHaveTextContent('Keine.');
    expect(within(main()).queryByRole('alert')).toBeNull();
  });
});
