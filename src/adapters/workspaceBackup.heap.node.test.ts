// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { getHeapStatistics, setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
import { processWorkspaceBackupBytes } from './workspaceBackupProcessing';
import { CLASS_2_IMPORT_LIMITS, WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
function collector(): (() => void) | null {
  try { setFlagsFromString('--expose-gc'); return runInNewContext('gc') as () => void; } catch { return null; }
}
const gc = collector();
const nextTask = () => new Promise(resolve => setTimeout(resolve, 0));
function heap(): number { gc!(); gc!(); return getHeapStatistics().used_heap_size; }
function nodes(value: unknown): number {
  let count = 1;
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) count += nodes(child);
  }
  return count;
}
function input(dense = true): Uint8Array {
  const timestamp = '2026-10-16T12:00:00.000Z';
  const localId = '22222222-2222-4222-8222-222222222222';
  const verbundId = '11111111-1111-4111-8111-111111111111';
  const value = { format: 'gspp-workspace', storageSchemaVersion: 2,
    verbuende: [{ verbundId, name: 'Test', createdAt: timestamp, savedAt: timestamp }],
    documents: [{ localId, verbundId, storageSchemaVersion: 2, rootType: 'catalog', oscalVersion: '1.1.3', trustClass: 'class-2-local-user', documentState: 'imported', createdAt: timestamp, savedAt: timestamp, source: makeSchemaValidOscalDocument('catalog', '1.1.3') }],
    drafts: [{ localId, savedAt: timestamp, source: [] as unknown[] }], bindings: [],
    reviewTrail: [], reviewBaseline: [],
    workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 2, createdAt: timestamp, savedAt: timestamp }] };
  for (let index = 1; index < 4; index++) {
    const nextId = `22222222-2222-4222-8222-22222222222${index + 3}`;
    value.documents.push({ ...value.documents[0], localId: nextId });
    value.drafts.push({ localId: nextId, savedAt: timestamp, source: [] as unknown[] });
  }
  if (!dense) return new TextEncoder().encode(JSON.stringify(value));
  // Object-dense input saturates both limits, including every scalar node.
  const recordCount = Math.floor((CLASS_2_IMPORT_LIMITS.maxNodes - nodes(value)) / 2);
  for (let index = 0; index < recordCount; index++) value.drafts[index % 4].source.push({ value: '' });
  while (nodes(value) < CLASS_2_IMPORT_LIMITS.maxNodes) value.drafts[0].source.push(null);
  const remaining = WORKSPACE_BACKUP_MAX_BYTES - new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const width = Math.floor(remaining / recordCount);
  let extra = remaining % recordCount;
  for (const draft of value.drafts) {
    for (const row of draft.source) {
      if (row !== null) (row as { value: string }).value = 'x'.repeat(width + (extra-- > 0 ? 1 : 0));
    }
    expect(new TextEncoder().encode(JSON.stringify(draft.source)).byteLength).toBeLessThanOrEqual(CLASS_2_IMPORT_LIMITS.maxBytes);
  }
  expect(nodes(value)).toBe(CLASS_2_IMPORT_LIMITS.maxNodes);
  return new TextEncoder().encode(JSON.stringify(value));
}
it.skipIf(gc === null)('reports five GC-settled retained-heap samples for a cap-sized valid backup', async () => {
  // Warm schema compilation outside the measured samples.
  expect((await processWorkspaceBackupBytes(input(false))).ok).toBe(true);
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
    if (result.ok) expect(nodes(result.value)).toBe(CLASS_2_IMPORT_LIMITS.maxNodes);
    return after - before;
  }
  for (let sample = 0; sample < 5; sample++) {
    samples.push(await measure());
    await nextTask();
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const report = JSON.stringify({ inputBytes: WORKSPACE_BACKUP_MAX_BYTES, inputNodes: CLASS_2_IMPORT_LIMITS.maxNodes, samples, medianBytes: sorted[2], spreadBytes: sorted[4] - sorted[0], node: process.version, v8: process.versions.v8 });
  console.info(report);
  expect(samples).toHaveLength(5);
}, 120_000);
