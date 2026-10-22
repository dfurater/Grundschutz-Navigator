import 'fake-indexeddb/auto';
import { fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { buildStationUrl } from '@/app/routes';
import { makeFullPoam, makeMinimalPoam } from '@/test/fixtures/poams';
import { mainLandmark as main, renderWorkspaceArea } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, SENTINEL, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());

let seeded: SeededWorkspace;
beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => { vi.restoreAllMocks(); await resetWorkspace(); });

// JSON-Kopie: Die Fixture teilt Teilobjekte, der Klasse-2-Objektgraph verlangt einen Baum.
function addPoam(source: unknown) {
  return readStore(store => store.addDocument(seeded.verbundId, {
    source: JSON.parse(JSON.stringify(source)), context: { trustClass: 'class-2-local-user' }, rootType: 'plan-of-action-and-milestones', oscalVersion: '1.2.2',
  }, 'imported'));
}

describe('Umsetzungsfortschritt in der Station POA&M', () => {
  it('listet offene und abgeschlossene Maßnahmen lesend und ohne Klasse-2-Werte in URL oder Log', async () => {
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
    const openSection = await within(main()).findByRole('region', { name: /Offene Maßnahmen/ });
    const doneSection = within(main()).getByRole('region', { name: /Abgeschlossene Maßnahmen/ });
    expect(openSection).toHaveTextContent(`Offen ${SENTINEL}`);
    expect(openSection).toHaveTextContent('2026-12-01T00:00:00Z');
    expect(openSection).toHaveTextContent('ac-1_obj');
    expect(openSection).toHaveTextContent('Geplant');
    expect(within(openSection).getByText('Maßnahme').closest('li')).toHaveTextContent('ohne Frist');
    expect(doneSection).toHaveTextContent('Erledigt');
    expect(doneSection).toHaveTextContent('Abgeschlossen');
    expect(doneSection).toHaveTextContent('risk.status open');
    expect(main()).toHaveTextContent('Fristzustand berechnet aus Frist und Systemzeit');

    fireEvent.change(within(main()).getByLabelText('Sortierung'), { target: { value: 'stand' } });
    await waitFor(() => expect(within(main()).getByLabelText('Sortierung')).toHaveValue('stand'));
    expect(JSON.stringify(router.state.location)).not.toContain(SENTINEL);
    expect(JSON.stringify(router.state.location)).not.toContain('stand');
    for (const spy of writes) expect(spy).not.toHaveBeenCalled();
    for (const spy of logs) expect(JSON.stringify(spy.mock.calls)).not.toContain(SENTINEL);
  });

  it('zeigt ohne POA&M leere Bereiche statt eines Fehlers', async () => {
    renderWorkspaceArea(buildStationUrl(seeded.verbundId, 'poam'));
    const openSection = await within(main()).findByRole('region', { name: /Offene Maßnahmen/ });
    expect(openSection).toHaveTextContent('Keine.');
    expect(within(main()).queryByRole('alert')).toBeNull();
  });
});
