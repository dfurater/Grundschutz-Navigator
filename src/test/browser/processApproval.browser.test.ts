import { expect, test, vi } from 'vitest';
import { open, value } from '@/test/browser/workspaceStoreFixtures';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { REVIEW_TRAIL_DEADLINE_MS } from '@/domain/reviewTrail';
import { deriveProcessApproval } from '@/domain/sspProcessApproval';
import { readSspValue } from '@/domain/sspAuthoring';
import type { JsonObject } from '@/domain/jsonGuards';

const decision = { processUuid: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'approved' as const, uuid: 'bbbbbbbb-0000-4000-8000-000000000006', date: '2026-11-08T12:00:00Z', partyUuids: ['aaaaaaaa-0000-4000-8000-000000000005'], remarks: 'Erklärte Leitungsentscheidung' };
async function setup() {
  const store = await open();
  const source = makeProcessCiaSsp('1.2.2');
  const imported = await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!imported.ok) throw new Error(imported.diagnostic.code);
  const verbund = value(await store.createVerbund('Prozessfreigabe'));
  const envelope = value(await store.addDocument(verbund.verbundId, imported.document, 'export-ready'));
  return { store, envelope, document: imported.document };
}
test('berechnet die Prozessbindung im echten Worker und speichert in nativem IndexedDB', async () => {
  const { store, envelope } = await setup();
  const saved = value(await store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision));
  expect(await deriveProcessApproval(saved.source, decision.processUuid)).toMatchObject({ state: 'current', sequence: 2 });
  expect(value(await store.getDraft(envelope.localId))).toBeUndefined();
});
test('nimmt einen überholten, nicht mehr projizierbaren Prozessstand ohne Hashberechnung zurück', async () => {
  const { store, envelope } = await setup();
  const source = structuredClone(envelope.source);
  (readSspValue(source, ['system-implementation', 'components']) as JsonObject[])[1].type = 'business-process';
  const imported = await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!imported.ok) throw new Error(imported.diagnostic.code);
  const changed = value(await store.saveDocument(envelope.localId, envelope.savedAt, null, imported.document));
  const withdrawn = value(await store.saveProcessDecision(envelope.localId, changed.savedAt, null, { ...decision, type: 'withdrawn' }));
  expect(await deriveProcessApproval(withdrawn.source, decision.processUuid)).toMatchObject({ state: 'withdrawn', sequence: 2 });
});
test.each(['document', 'draft'])('verwirft einen konkurrierenden nativen %s-Stand nach Workerstart', async kind => {
  const { store, envelope, document } = await setup();
  const other = await open();
  let before: string;
  // Worker-Erzeugung bleibt echt; die konkurrierende Transaktion liegt zwischen Start und Commit.
  const NativeWorker = globalThis.Worker;
  let changed: Promise<void> | undefined;
  vi.stubGlobal('Worker', class extends NativeWorker {
    override postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
      const options = Array.isArray(transfer) ? { transfer } : transfer;
      if (!message || typeof message !== 'object' || !('processBinding' in message)) { super.postMessage(message, options); return; }
      changed = (async () => {
        if (kind === 'document') value(await other.saveDocument(envelope.localId, envelope.savedAt, null, document));
        else value(await other.autosaveDraft(envelope.localId, envelope.savedAt, null, { synthetic: 'Konkurrierender Entwurf' }));
        before = value(await other.exportBackup());
        super.postMessage(message, options);
      })();
    }
  });
  try {
    expect(await store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
    await changed;
    expect(value(await store.exportBackup())).toBe(before!);
  } finally { vi.unstubAllGlobals(); }
});
test.each(['error', 'deadline'])('erhält den gesamten Speicher bei Worker-%s', async kind => {
  const { store, envelope } = await setup();
  const before = value(await store.exportBackup());
  class FailedWorker {
    onerror?: () => void;
    postMessage() { if (kind === 'error') this.onerror?.(); }
    terminate() {}
  }
  vi.stubGlobal('Worker', FailedWorker);
  if (kind === 'deadline') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const saving = store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision);
    if (kind === 'deadline') {
      await vi.waitUntil(() => vi.getTimerCount() > 0);
      await vi.advanceTimersByTimeAsync(REVIEW_TRAIL_DEADLINE_MS);
    }
    expect(await saving).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
  } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
  expect(value(await store.exportBackup())).toBe(before);
});
test('rollt den nativen Dokumentput bei Quota-Fehler vollständig zurück', async () => {
  const { store, envelope } = await setup();
  const before = value(await store.exportBackup());
  const original = IDBObjectStore.prototype.put;
  const put = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'workspaceMeta') throw new DOMException('Synthetischer Quota-Fehler', 'QuotaExceededError');
    return original.apply(this, args);
  });
  expect(await store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_QUOTA_EXCEEDED' } });
  put.mockRestore();
  expect(value(await store.exportBackup())).toBe(before);
});
