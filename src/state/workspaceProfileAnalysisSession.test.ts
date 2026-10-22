import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProfileAnalysisSession } from '@/state/workspaceProfileAnalysisSession';
import { createWorkspaceDocuments } from '@/state/workspaceDocuments';
import { FakeWorker } from '@/test/fakeWorker';
import { fakePort, ok, fail } from '@/test/fakeWorkspacePort';
import { member } from '@/test/fixtures/workspaceGraph';
import type { ProfileAnalysisBasis, ProfileAnalysisInput } from '@/state/workspaceProfileAnalysis';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import type { WorkspaceClass1Artifact } from '@/domain/workspaceGraphModel';

const PROFILE = member('profile', 'p');
const INPUT: ProfileAnalysisInput = { verbundId: PROFILE.verbundId, localId: PROFILE.localId, source: PROFILE.source, bindings: [] };
const BASIS: ProfileAnalysisBasis = { members: [PROFILE], bindings: [], class1Artifacts: [], delivery: new Map() };
const ANALYSIS = { schema: { status: 'passed' }, hints: [], imports: [], targets: new Map(), resolution: { status: 'not-evaluable' } };

function setup() {
  const worker = new FakeWorker((self, message) => {
    self.emitMessage({ type: 'analysis', requestId: (message as { requestId: number }).requestId, analysis: ANALYSIS });
  });
  vi.stubGlobal('Worker', vi.fn(function create() { return worker; }));
  const listDocuments = vi.fn(() => ok([PROFILE]));
  const getDocument = vi.fn(() => ok(PROFILE));
  const listBindings = vi.fn(() => ok([]));
  const port = fakePort({ listDocuments, getDocument, listBindings });
  const write = async <T,>(op: (store: typeof port) => Promise<WorkspaceResult<T>>) => op(port);
  const documents = createWorkspaceDocuments({ port, write, quiet: write, class1: [], delivery: new Map(), targets: new Map() });
  return { worker, documents, listDocuments, getDocument, listBindings };
}

afterEach(() => vi.unstubAllGlobals());

describe('Profilanalyse-Sitzung', () => {
  it('behält fehlgeschlagene Lesezugriffe nicht im Cache und redigiert Ausnahmen', async () => {
    const { documents } = setup();
    const load = vi.spyOn(documents, 'loadProfileAnalysisBasis')
      .mockImplementationOnce(() => fail('WORKSPACE_DOCUMENT_NOT_FOUND'))
      .mockRejectedValueOnce(new Error('private document value'));
    const session = createProfileAnalysisSession();
    expect(await session.analyze(documents, INPUT, new AbortController().signal)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DOCUMENT_NOT_FOUND' } });
    const thrown = await session.analyze(documents, INPUT, new AbortController().signal);
    expect(thrown).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_STORAGE_FAILED' } });
    expect(JSON.stringify(thrown)).not.toContain('private document value');
    expect(await session.analyze(documents, INPUT, new AbortController().signal)).toEqual({ ok: true, value: ANALYSIS });
    expect(load).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('liefert Workerfehler redigiert zurück und nutzt die gültige Basis beim nächsten Versuch', async () => {
    const { documents, worker, listDocuments } = setup();
    worker.postMessage.mockImplementationOnce(() => worker.emitEvent('error'));
    const session = createProfileAnalysisSession();
    expect(await session.analyze(documents, INPUT, new AbortController().signal)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_STORAGE_FAILED' } });
    expect(await session.analyze(documents, INPUT, new AbortController().signal)).toEqual({ ok: true, value: ANALYSIS });
    expect(listDocuments).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('überträgt nur gebundene Klasse-1-Quellen und nimmt eine neue Editor-Bindung ohne Speicherlesen auf', async () => {
    const { documents, worker } = setup();
    const first = { artifactKey: 'first', source: { catalog: {} } } as WorkspaceClass1Artifact;
    const second = { artifactKey: 'second', source: { catalog: {} } } as WorkspaceClass1Artifact;
    const load = vi.spyOn(documents, 'loadProfileAnalysisBasis').mockResolvedValue({ ok: true, value: { ...BASIS, class1Artifacts: [first, second] } });
    const session = createProfileAnalysisSession();
    const input = { ...INPUT, bindings: [{ fromLocalId: INPUT.localId, pointer: '/profile/imports/0/href', href: 'local', target: { kind: 'class-1' as const, artifactKey: 'first' } }] };
    await session.analyze(documents, input, new AbortController().signal);
    expect(worker.postMessage.mock.calls[0][0]).toHaveProperty('basis.class1Artifacts', [first]);
    await session.analyze(documents, { ...input, bindings: [{ ...input.bindings[0], target: { kind: 'class-1', artifactKey: 'second' } }] }, new AbortController().signal);
    expect(worker.postMessage.mock.calls[1][0]).toHaveProperty('basis.class1Artifacts', [second]);
    expect(load).toHaveBeenCalledOnce();
    session.dispose();
  });

  it('verwirft die Vorbereitung nach synchroner Invalidierung, auch vor dem nächsten React-Render', async () => {
    const { documents, worker } = setup();
    let version = 0;
    let release!: (result: WorkspaceResult<ProfileAnalysisBasis>) => void;
    vi.spyOn(documents, 'loadProfileAnalysisBasis').mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const context = { ...documents, analysisVersion: () => version };
    const session = createProfileAnalysisSession();
    const pending = session.analyze(context, INPUT, new AbortController().signal);
    version++;
    release({ ok: true, value: BASIS });
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_OPERATION_CANCELLED' } });
    expect(worker.postMessage).not.toHaveBeenCalled();
    session.dispose();
  });

  it('liest die Basis nur einmal und überträgt bei gleichem Kontext nur die neue Arbeitskopie', async () => {
    const { documents, listDocuments, getDocument, listBindings, worker } = setup();
    const session = createProfileAnalysisSession();
    expect(await session.analyze(documents, INPUT, new AbortController().signal)).toEqual({ ok: true, value: ANALYSIS });
    await session.analyze(documents, { ...INPUT, source: {} }, new AbortController().signal);
    expect(listDocuments).toHaveBeenCalledOnce();
    expect(getDocument).toHaveBeenCalledOnce();
    expect(listBindings).toHaveBeenCalledOnce();
    expect(worker.postMessage.mock.calls[1][0]).not.toHaveProperty('basis');
    expect(worker.postMessage.mock.calls[1][0]).toHaveProperty('input.source', {});
    session.dispose();
  });

  it('ignoriert einen verspäteten Basisstand nach Kontextwechsel', async () => {
    const { documents, worker } = setup();
    let release!: (value: WorkspaceResult<ProfileAnalysisBasis>) => void;
    const old = { ...documents, loadProfileAnalysisBasis: vi.fn(() => new Promise<WorkspaceResult<ProfileAnalysisBasis>>((resolve) => { release = resolve; })) };
    const session = createProfileAnalysisSession();
    const abort = new AbortController();
    const first = session.analyze(old, INPUT, abort.signal);
    abort.abort();
    expect(await first).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_OPERATION_CANCELLED' } });
    const load = vi.spyOn(documents, 'loadProfileAnalysisBasis');
    await session.analyze(documents, INPUT, new AbortController().signal);
    release({ ok: true, value: BASIS });
    await session.analyze(documents, INPUT, new AbortController().signal);
    expect(load).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledTimes(2);
    session.dispose();
  });

  it('liest nach Kontextwechsel neu und räumt beim Dispose auch die Basis auf', async () => {
    const { documents, listDocuments } = setup();
    const session = createProfileAnalysisSession();
    await session.analyze(documents, INPUT, new AbortController().signal);
    const changed = { ...documents };
    await session.analyze(changed, INPUT, new AbortController().signal);
    expect(listDocuments).toHaveBeenCalledTimes(2);
    session.dispose();
    await session.analyze(changed, INPUT, new AbortController().signal);
    expect(listDocuments).toHaveBeenCalledTimes(3);
    session.dispose();
  });

  it('startet bei vorherigem Abbruch keine Lesezugriffe und beendet die Vorbereitung beim Dispose', async () => {
    const { documents, listDocuments } = setup();
    const session = createProfileAnalysisSession();
    expect(await session.analyze(documents, INPUT, AbortSignal.abort())).toMatchObject({ ok: false });
    expect(listDocuments).not.toHaveBeenCalled();
    const delayed = { ...documents, loadProfileAnalysisBasis: () => new Promise<WorkspaceResult<ProfileAnalysisBasis>>(() => {}) };
    const pending = session.analyze(delayed, INPUT, new AbortController().signal);
    session.dispose();
    expect(await pending).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_OPERATION_CANCELLED' } });
    expect(Worker).not.toHaveBeenCalled();
  });
});
