// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/reviewTrailFixtures')).importGateMock());
vi.mock('@/adapters/reviewTrailWork', async () => {
  const { documentSnapshot } = await import('@/domain/reviewTrail');
  const { processContentHash } = await import('@/domain/sspProcessProjection');
  return { reviewTrailInWorker: vi.fn(async (request) => ({ ok: true, value: { snapshot: await documentSnapshot(request.source, request.rootType), processHash: await processContentHash(request.source, request.processBinding.processUuid, request.processBinding.decisionParties) } })) };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { reviewTrailInWorker } from '@/adapters/reviewTrailWork';
import { makeProcessCiaSsp } from '@/test/fixtures/processCia';
import { value, imported } from '@/test/reviewTrailFixtures';
import { deriveProcessApproval } from '@/domain/sspProcessApproval';
import { createOscalDiagnostic } from '@/domain/oscalDiagnostics';
import { readSspValue } from '@/domain/sspAuthoring';
import type { JsonObject } from '@/domain/jsonGuards';

const decision = { processUuid: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'approved' as const, uuid: 'bbbbbbbb-0000-4000-8000-000000000006', date: '2026-11-08T12:00:00Z', partyUuids: ['aaaaaaaa-0000-4000-8000-000000000005'], remarks: 'Erklärte Leitungsentscheidung' };
const stores: WorkspaceStore[] = [];
afterEach(async () => { vi.restoreAllMocks(); stores.splice(0).forEach(store => store.close()); await Dexie.delete(WORKSPACE_DATABASE_NAME); });
async function setup() {
  const store = value(await WorkspaceStore.open()); stores.push(store);
  const verbund = value(await store.createVerbund('Prozessfreigabe'));
  const envelope = value(await store.addDocument(verbund.verbundId, await imported(makeProcessCiaSsp('1.2.2')), 'export-ready'));
  return { store, envelope };
}
it('speichert eine native Entscheidung atomar ohne lokale Prüfspur', async () => {
  const { store, envelope } = await setup();
  const saved = value(await store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision));
  expect(await deriveProcessApproval(saved.source, decision.processUuid)).toMatchObject({ state: 'current', sequence: 2, actionUuid: decision.uuid });
  const db = new Dexie(WORKSPACE_DATABASE_NAME); await db.open();
  try { expect(await db.table('reviewTrail').count()).toBe(0); } finally { db.close(); }
  const withdrawn = value(await store.saveProcessDecision(envelope.localId, saved.savedAt, null, { ...decision, type: 'withdrawn', uuid: 'cccccccc-0000-4000-8000-000000000006' }));
  expect(await deriveProcessApproval(withdrawn.source, decision.processUuid)).toMatchObject({ state: 'withdrawn', sequence: 3 });
});
it.each(['document', 'draft'])('verwirft CAS-Konflikte nach Workerarbeit: %s', async kind => {
  const { store, envelope } = await setup();
  const work = vi.mocked(reviewTrailInWorker).getMockImplementation()!;
  let before: string;
  vi.mocked(reviewTrailInWorker).mockImplementationOnce(async request => {
    if (kind === 'document') value(await store.saveDocument(envelope.localId, envelope.savedAt, null, await imported(makeProcessCiaSsp('1.2.2'))));
    else value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { synthetic: 'Neuer Entwurf' }));
    before = value(await store.exportBackup());
    return work(request);
  });
  expect(await store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await store.exportBackup())).toBe(before!);
});
it('erhält Quelle und Entwurf bei Workerfehler', async () => {
  const { store, envelope } = await setup();
  const before = value(await store.exportBackup());
  vi.mocked(reviewTrailInWorker).mockResolvedValueOnce({ ok: false, diagnostic: createOscalDiagnostic({ code: 'REVIEW_TRAIL_WORK_FAILED', stage: 'domain', validator: { name: 'test', version: '1' }, path: '/' }) });
  expect(await store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision)).toMatchObject({ ok: false, diagnostic: { code: 'REVIEW_TRAIL_WORK_FAILED' } });
  expect(value(await store.exportBackup())).toBe(before);
});
it('friert Entscheidung vor dem ersten await ein', async () => {
  const { store, envelope } = await setup();
  const mutable = structuredClone(decision);
  const saving = store.saveProcessDecision(envelope.localId, envelope.savedAt, null, mutable);
  mutable.partyUuids.splice(0); mutable.remarks = 'Andere Eingabe';
  const saved = value(await saving);
  expect(await deriveProcessApproval(saved.source, decision.processUuid)).toMatchObject({ state: 'current' });
  expect(JSON.stringify(saved.source)).not.toContain('Andere Eingabe');
});
it('rollt bei Quota nach dem Dokumentput die gesamte Transaktion zurück', async () => {
  const { store, envelope } = await setup();
  const before = value(await store.exportBackup());
  const original = IDBObjectStore.prototype.put;
  vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['put']>) {
    if (this.name === 'workspaceMeta') throw new DOMException('Synthetischer Quota-Fehler', 'QuotaExceededError');
    return original.apply(this, args);
  });
  expect(await store.saveProcessDecision(envelope.localId, envelope.savedAt, null, decision)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_QUOTA_EXCEEDED' } });
  expect(value(await store.exportBackup())).toBe(before);
});
it('lehnt eine fehlende Dokument-CAS-Basis ab', async () => {
  const { store, envelope } = await setup();
  const before = value(await store.exportBackup());
  expect(await store.saveProcessDecision(envelope.localId, undefined as unknown as string, null, decision)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await store.exportBackup())).toBe(before);
});
it('verwirft einen gespeicherten Entwurf nicht und beachtet den transaktionalen Guard', async () => {
  const { store, envelope } = await setup();
  const draft = value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, { synthetic: 'Entwurf' }));
  const before = value(await store.exportBackup());
  expect(await store.saveProcessDecision(envelope.localId, envelope.savedAt, draft.savedAt, decision)).toMatchObject({ ok: false, diagnostic: { code: 'SSP_PROCESS_DECISION_BLOCKED' } });
  expect(value(await store.exportBackup())).toBe(before);
  const other = await setup();
  const clean = value(await other.store.exportBackup());
  expect(await other.store.saveProcessDecision(other.envelope.localId, other.envelope.savedAt, null, decision, undefined, () => 'WORKSPACE_CATALOG_PIN_UNVERIFIED')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CATALOG_PIN_UNVERIFIED' } });
  expect(value(await other.store.exportBackup())).toBe(clean);
});
it('speichert die Rücknahme ohne Hash einer nicht berechenbaren aktuellen Projektion', async () => {
  const { store, envelope } = await setup();
  const changed = makeProcessCiaSsp('1.2.2');
  (readSspValue(changed, ['system-implementation', 'components']) as JsonObject[])[1].type = 'business-process';
  const saved = value(await store.saveDocument(envelope.localId, envelope.savedAt, null, await imported(changed)));
  vi.mocked(reviewTrailInWorker).mockClear();
  const withdrawn = value(await store.saveProcessDecision(envelope.localId, saved.savedAt, null, { ...decision, type: 'withdrawn' }));
  expect(vi.mocked(reviewTrailInWorker)).not.toHaveBeenCalled();
  expect(await deriveProcessApproval(withdrawn.source, decision.processUuid)).toMatchObject({ state: 'withdrawn', sequence: 2 });
});
