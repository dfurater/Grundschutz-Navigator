// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
/** Jede Serialisierung; der Test weist daran die Knotenprüfung vor der Serialisierung nach. */
const serializeCalls = vi.hoisted(() => [] as unknown[]);
vi.mock('@/domain/workspaceJson', async importOriginal => {
  const actual = await importOriginal<typeof import('@/domain/workspaceJson')>();
  return {
    ...actual,
    serializeWorkspaceJson: (value: unknown) => {
      serializeCalls.push(value);
      return actual.serializeWorkspaceJson(value);
    },
  };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceEnvelope, WorkspaceResult } from '@/domain/workspaceModel';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { CLASS_2_IMPORT_LIMITS, WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
const bytes = (text: string) => new TextEncoder().encode(text);
let store: WorkspaceStore;
let db: Dexie;
let one: WorkspaceEnvelope;
let other: WorkspaceEnvelope;

async function catalog(title: string): Promise<Class2OscalImportedDocument> {
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  (source.catalog as { metadata: { title: string } }).metadata.title = title;
  const result = await importClass2OscalDocument(bytes(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}

beforeEach(async () => {
  store = value(await WorkspaceStore.open());
  const a = value(await store.createVerbund('Selected'));
  const b = value(await store.createVerbund('OTHER_VERBUND_SENTINEL'));
  const imported = await catalog('Selected');
  one = value(await store.addDocument(a.verbundId, imported));
  other = value(await store.addDocument(b.verbundId, await catalog('OTHER_DOCUMENT_SENTINEL')));
  value(await store.autosaveDraft(one.localId, one.savedAt, null, { incomplete: true }));
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'Selected', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }, value(await store.getDocument(one.localId))!.savedAt));
  db = new Dexie(WORKSPACE_DATABASE_NAME); await db.open();
});
afterEach(async () => { vi.restoreAllMocks(); db?.close(); store?.close(); await Dexie.delete(WORKSPACE_DATABASE_NAME); });

it('stops the workspace export at the shared node budget before serializing the surplus draft', async () => {
  // Zwei Entwürfe à 520 001 Knoten (zusammen über der Bündelgrenze von 1 000 000) bei zusammen
  // rund 13 MiB Bytes, deutlich unter der Bytegrenze von 32 MiB.
  const bigDraft = (marker: string) => Object.fromEntries([
    [marker, true],
    ...Array.from({ length: 519_999 }, (_, index) => [`k${index}`, index % 10]),
  ]);
  const draftOne = bigDraft('DRAFT_ONE');
  const draftTwo = bigDraft('DRAFT_TWO');
  // setBinding() hat den Vergleichswert des Ausgangsdokuments fortgeschrieben: frisch laden.
  const currentOne = value(await store.getDocument(one.localId))!;
  const currentOther = value(await store.getDocument(other.localId))!;
  value(await store.autosaveDraft(one.localId, currentOne.savedAt, value(await store.getDraft(one.localId))?.savedAt ?? null, draftOne));
  value(await store.autosaveDraft(other.localId, currentOther.savedAt, null, draftTwo));
  const nodes = (value: unknown): number => value !== null && typeof value === 'object'
    ? 1 + Object.values(value).reduce<number>((sum, child) => sum + nodes(child), 0)
    : 1;
  expect(nodes(draftOne)).toBeLessThanOrEqual(CLASS_2_IMPORT_LIMITS.maxNodes);
  expect(nodes(draftOne) + nodes(draftTwo)).toBeGreaterThan(CLASS_2_IMPORT_LIMITS.maxNodes);
  expect(bytes(JSON.stringify(draftOne)).byteLength + bytes(JSON.stringify(draftTwo)).byteLength).toBeLessThan(WORKSPACE_BACKUP_MAX_BYTES);

  const isBigRow = (value: unknown, marker: string) => {
    const source = (value as { source?: unknown } | null)?.source;
    return source !== null && typeof source === 'object' && Object.hasOwn(source, marker);
  };
  serializeCalls.length = 0;
  expect(await store.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_LIMIT_EXCEEDED' } });
  // Genau eine der beiden Zeilen erreicht die Serialisierung: Die zweite stoppt vorher am geteilten Knotenbudget.
  expect(serializeCalls.filter(value => isBigRow(value, 'DRAFT_ONE') || isBigRow(value, 'DRAFT_TWO'))).toHaveLength(1);
}, 30_000);

it('stops the workspace export at the frame nodes before serializing the surplus row', async () => {
  // Rahmenknoten (Wurzel, `format`, `storageSchemaVersion`, eine Liste je Store) zählen ins frühe Budget:
  // ein Bündel mit einem Knoten über der Grenze endet an der überzähligen Zeile, bevor sie serialisiert wird.
  const nodes = (value: unknown): number => value !== null && typeof value === 'object'
    ? 1 + Object.values(value).reduce<number>((sum, child) => sum + nodes(child), 0)
    : 1;
  const current = value(await store.getDocument(other.localId))!;
  value(await store.autosaveDraft(other.localId, current.savedAt, null, { marker: 'SURPLUS' }));
  // Knoten aller Zeilen, die vor der überzähligen Entwurfszeile gelesen werden.
  let before = 0;
  let surplusSeen = false;
  for (const table of db.tables) for (const row of await table.toArray()) {
    if (table.name === 'drafts' && (row as { localId: string }).localId === other.localId) surplusSeen = true;
    else if (!surplusSeen) before += nodes(row);
  }
  const frame = 3 + db.tables.length;
  const source = { marker: 'SURPLUS', values: Array.from({ length: CLASS_2_IMPORT_LIMITS.maxNodes - frame - before - 5 }, () => null) };
  const draft = value(await store.getDraft(other.localId))!;
  value(await store.autosaveDraft(other.localId, current.savedAt, draft.savedAt, source));
  serializeCalls.length = 0;
  expect(await store.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_LIMIT_EXCEEDED' } });
  // Fehlschlag, wenn die Rahmenknoten fehlen und die überzählige Zeile deshalb noch serialisiert wird.
  expect(serializeCalls.filter(row => (row as { source?: { marker?: string } }).source?.marker === 'SURPLUS')).toHaveLength(0);
}, 30_000);
