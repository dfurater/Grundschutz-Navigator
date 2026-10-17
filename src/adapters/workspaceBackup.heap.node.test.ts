// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
import { processWorkspaceBackupBytes } from './workspaceBackupProcessing';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
function collector(): (() => void) | null {
  try { setFlagsFromString('--expose-gc'); return runInNewContext('gc') as () => void; } catch { return null; }
}
const gc = collector();
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
function heap(): number { gc!(); gc!(); return getHeapStatistics().used_heap_size; }
function input(): Uint8Array {
  const timestamp = '2026-10-16T12:00:00.000Z';
  const localId = '22222222-2222-4222-8222-222222222222';
  const verbundId = '11111111-1111-4111-8111-111111111111';
  const value = { format: 'gspp-workspace', storageSchemaVersion: 1,
    verbuende: [{ verbundId, name: 'Test', createdAt: timestamp, savedAt: timestamp }],
    documents: [{ localId, verbundId, storageSchemaVersion: 1, rootType: 'catalog', oscalVersion: '1.1.3', trustClass: 'class-2-local-user', documentState: 'imported', createdAt: timestamp, savedAt: timestamp, source: makeSchemaValidOscalDocument('catalog', '1.1.3') }],
    drafts: [{ localId, savedAt: timestamp, source: { title: '' } }], bindings: [],
    workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 1, createdAt: timestamp, savedAt: timestamp }] };
  for (let index = 1; index < 4; index++) {
    const nextId = `22222222-2222-4222-8222-22222222222${index + 3}`;
    value.documents.push({ ...value.documents[0], localId: nextId });
    value.drafts.push({ localId: nextId, savedAt: timestamp, source: { title: '' } });
  }
  let remaining = WORKSPACE_BACKUP_MAX_BYTES - new TextEncoder().encode(JSON.stringify(value)).byteLength;
  for (let index = 0; index < value.drafts.length; index++) {
    const length = Math.ceil(remaining / (value.drafts.length - index));
    value.drafts[index].source.title = 'x'.repeat(length);
    remaining -= length;
  }
  return new TextEncoder().encode(JSON.stringify(value));
}
it.skipIf(gc === null)('reports five GC-settled retained-heap samples for a cap-sized valid backup', async () => {
  // Warm schema compilation outside the measured samples.
  await processWorkspaceBackupBytes(new TextEncoder().encode('{}'));
  const samples: number[] = [];
  async function measure(): Promise<number> {
    const bytes = input();
    expect(bytes.byteLength).toBe(WORKSPACE_BACKUP_MAX_BYTES);
    await nextTask();
    const before = heap();
    const result = await processWorkspaceBackupBytes(bytes);
    await nextTask();
    const after = heap();
    expect(result.ok).toBe(true);
    if (result.ok) expect((result.value.drafts[0].source as { title: string }).title.length).toBeGreaterThan(8_000_000);
    return after - before;
  }
  for (let sample = 0; sample < 5; sample++) {
    samples.push(await measure());
    await nextTask();
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const report = JSON.stringify({ inputBytes: WORKSPACE_BACKUP_MAX_BYTES, samples, medianBytes: sorted[2], spreadBytes: sorted[4] - sorted[0], node: process.version, v8: process.versions.v8 });
  console.info(report);
  expect(samples).toHaveLength(5);
}, 120_000);
