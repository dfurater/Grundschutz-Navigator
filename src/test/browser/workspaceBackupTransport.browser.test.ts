import { restoreWorkspaceBackup } from '@/test/restoreWorkspaceBackup';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import type { WorkspaceResult } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/class2ImportLimits.mjs';
import { countObjectGraphNodesCapped } from '@/domain/oscalObjectGraph';
import { TRANSPORT_MAX_OPERATIONS } from '@/domain/oscalImportTransport';

function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}
let store: WorkspaceStore;
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  store?.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});

it('returns a node-dense bundle from the real worker in acknowledged bounded fragments', async () => {
  store = value(await WorkspaceStore.open());
  const verbund = value(await store.createVerbund('Synthetic transport'));
  const imported = await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))), { trustClass: 'class-2-local-user' });
  if (!imported.ok) throw new Error(imported.diagnostic.code);
  const envelope = value(await store.addDocument(verbund.verbundId, imported.document));
  value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, []));
  const bundle = JSON.parse(value(await store.exportBackup()));
  const limit = CLASS_2_IMPORT_LIMITS.maxNodes;
  const source = Array(limit - countObjectGraphNodesCapped(bundle, limit)).fill(null);
  bundle.drafts[0].source = source;
  expect(countObjectGraphNodesCapped(bundle, limit)).toBe(limit);
  const backup = JSON.stringify(bundle);
  const frames: { type: string; sequence?: number; size?: number; acks: number }[] = [];
  let acks = 0;
  const NativeWorker = Worker;
  const original = Worker.prototype.postMessage;
  const post = vi.spyOn(Worker.prototype, 'postMessage').mockImplementation(function (this: Worker, message, transfer) {
    if ((message as { type?: string }).type === 'ack') acks++;
    original.call(this, message, Array.isArray(transfer) ? { transfer } : transfer);
  });
  vi.stubGlobal('Worker', class extends NativeWorker {
    constructor(url: string | URL, options?: WorkerOptions) {
      super(url, options);
      this.addEventListener('message', event => frames.push({ type: event.data.type, sequence: event.data.sequence, size: event.data.operations?.length, acks }));
    }
  });
  try { value(await restoreWorkspaceBackup(store, new TextEncoder().encode(backup))); }
  finally { vi.unstubAllGlobals(); post.mockRestore(); }
  const chunks = frames.filter(frame => frame.type === 'chunk');
  expect(frames[0].type).toBe('start');
  expect(frames.at(-1)).toMatchObject({ type: 'done', sequence: chunks.length });
  // Fehlschlag, wenn der Worker das Bündel in einer Nachricht sendet, ein Fragment vor der Quittung des vorigen schickt oder die Fragmentgrenze überschreitet.
  expect(chunks.length).toBeGreaterThan(source.length / TRANSPORT_MAX_OPERATIONS);
  chunks.forEach((chunk, index) => {
    expect(chunk).toMatchObject({ sequence: index, acks: index });
    expect(chunk.size).toBeLessThanOrEqual(TRANSPORT_MAX_OPERATIONS);
  });
  expect(value(await store.getDraft(envelope.localId))?.source).toEqual(source);
}, 120_000);
