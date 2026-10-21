import 'fake-indexeddb/auto';
import { act, fireEvent, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceStore } from '@/adapters/workspaceStore';
import { StorageFailure, failure } from '@/adapters/workspaceStorageFailure';
import { buildStationUrl } from '@/app/routes';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { mainLandmark as main, renderWorkspaceArea } from '@/test/renderWorkspaceArea';
import { readStore, resetWorkspace, seedWorkspace, type SeededWorkspace } from '@/test/workspaceAreaFixture';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());

let seeded: SeededWorkspace;
beforeEach(async () => { seeded = await seedWorkspace(); });
afterEach(async () => { vi.restoreAllMocks(); await resetWorkspace(); });

describe.each([
  { station: 'profile', rootType: 'profile', label: 'Profil' },
  { station: 'ssp', rootType: 'system-security-plan', label: 'SSP' },
] as const)('Dateiaufnahme $label', ({ station, rootType, label }) => {
  const bytes = () => new TextEncoder().encode(JSON.stringify(makeSchemaValidOscalDocument(rootType, '1.2.2'))).buffer;
  async function upload(file = new File([bytes()], 'lokal.json')) {
    await within(main()).findByRole('button', { name: `${label}-Datei einlesen` });
    fireEvent.change(main().querySelector('input[type="file"]')!, { target: { files: [file] } });
  }

  it.each(['Stations', 'Verbund'] as const)('beginnt nach einem %swechsel keine Aufnahme aus verzögerten Bytes', async (target) => {
    let finish!: (value: ArrayBuffer) => void;
    const file = new File([''], 'lokal.json');
    vi.spyOn(file, 'arrayBuffer').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const gate = await import('@/adapters/oscalImportGate');
    const check = vi.spyOn(gate, 'importClass2OscalDocument');
    const add = vi.spyOn(WorkspaceStore.prototype, 'addDocument');
    const { router } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, station));
    await upload(file);
    const next = buildStationUrl(target === 'Verbund' ? seeded.otherVerbundId : seeded.verbundId, target === 'Verbund' ? station : 'poam');
    await act(() => router.navigate(next));
    await act(async () => { finish(bytes()); });
    expect(router.state.location.pathname).toBe(next);
    expect(check).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('bricht nach einem Verbundwechsel auch die zweite Schemaprüfung vor dem Schreiben ab', async () => {
    const gate = await import('@/adapters/oscalImportGate');
    const original = gate.importClass2OscalDocument;
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    const checks = vi.spyOn(gate, 'importClass2OscalDocument').mockImplementation(async (...args) => {
      if (checks.mock.calls.length === 2) await waiting;
      return original(...args);
    });
    const { router } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, station));
    await upload();
    await waitFor(() => expect(checks).toHaveBeenCalledTimes(2));
    const next = buildStationUrl(seeded.otherVerbundId, station);
    await act(() => router.navigate(next));
    await act(async () => { finish(); await Promise.all(checks.mock.results.map(result => result.value)); });
    expect(await readStore(store => store.listDocuments(seeded.verbundId))).toHaveLength(5);
    expect(router.state.location.pathname).toBe(next);
  });

  it('navigiert nach einem Verbundwechsel auch bei verspätetem Speicherabschluss nicht zurück', async () => {
    const original = WorkspaceStore.prototype.addDocument;
    let finish!: () => void;
    const waiting = new Promise<void>(resolve => { finish = resolve; });
    let committed = false;
    const add = vi.spyOn(WorkspaceStore.prototype, 'addDocument').mockImplementation(async function (this: WorkspaceStore, ...args) {
      const result = await original.apply(this, args);
      committed = true;
      await waiting;
      return result;
    });
    const { router } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, station));
    await upload();
    await waitFor(() => expect(committed).toBe(true));
    const next = buildStationUrl(seeded.otherVerbundId, station);
    await act(() => router.navigate(next));
    await act(async () => { finish(); await add.mock.results[0].value; });
    expect(router.state.location.pathname).toBe(next);
    expect(await readStore(store => store.listDocuments(seeded.verbundId))).toHaveLength(6);
  });

  it('nimmt bei doppeltem Dateiereignis nur einmal auf', async () => {
    const { router } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, station));
    const add = vi.spyOn(WorkspaceStore.prototype, 'addDocument');
    await within(main()).findByRole('button', { name: `${label}-Datei einlesen` });
    const input = main().querySelector('input[type="file"]')!;
    const file = new File([bytes()], 'lokal.json');
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(router.state.location.pathname).toContain('/dokument/'));
    expect(add).toHaveBeenCalledOnce();
  });

  it('bietet bei fehlgeschlagenem Nachladen den vorhandenen Wiederholungsweg ohne erneute Aufnahme', async () => {
    const { router } = renderWorkspaceArea(buildStationUrl(seeded.verbundId, station));
    await within(main()).findByRole('button', { name: `${label}-Datei einlesen` });
    const original = WorkspaceStore.prototype.addDocument;
    vi.spyOn(WorkspaceStore.prototype, 'addDocument').mockImplementation(async function (this: WorkspaceStore, ...args) {
      const result = await original.apply(this, args);
      vi.spyOn(WorkspaceStore.prototype, 'listDocuments').mockResolvedValueOnce(failure(new StorageFailure('WORKSPACE_STORAGE_FAILED')));
      return result;
    });
    await upload();
    await within(main()).findByRole('heading', { name: 'Informationsverbund nicht lesbar' });
    fireEvent.click(within(main()).getByRole('button', { name: 'Neu laden' }));
    expect(await within(main()).findByRole('button', { name: `${label}-Datei einlesen` })).toBeEnabled();
    expect(await readStore(store => store.listDocuments(seeded.verbundId))).toHaveLength(6);
    expect(router.state.location.pathname).toBe(buildStationUrl(seeded.verbundId, station));
  });
});
