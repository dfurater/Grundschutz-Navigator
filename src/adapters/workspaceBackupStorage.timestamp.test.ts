import { restoreWorkspaceBackup, restoreVerbundBackup } from '@/test/restoreWorkspaceBackup';
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());
vi.mock('@/adapters/workspaceBackup', async () => (await import('@/test/workspaceNodeWorkers')).inProcessBackupParser());
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/class2ImportLimits.mjs';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';
import type { WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
const bytes = (text: string) => new TextEncoder().encode(text);
let store: WorkspaceStore;
let verbund: WorkspaceVerbund;

beforeEach(async () => {
  store = value(await WorkspaceStore.open());
  verbund = value(await store.createVerbund('Selected'));
  const imported = await importClass2OscalDocument(bytes(JSON.stringify(makeSchemaValidOscalDocument('catalog', '1.1.3'))), { trustClass: 'class-2-local-user' });
  if (!imported.ok) throw new Error(imported.diagnostic.code);
  value(await store.addDocument(verbund.verbundId, imported.document));
});
afterEach(async () => { store?.close(); await Dexie.delete(WORKSPACE_DATABASE_NAME); });

it('keeps every stamp within four-digit years and every exported bundle restorable', async () => {
  const parsed = JSON.parse(value(await store.exportVerbundBackup(verbund.verbundId)));
  const restoreAt = (savedAt: string) => {
    parsed.documents[0].savedAt = savedAt;
    return restoreVerbundBackup(store, bytes(JSON.stringify(parsed)));
  };
  const before = value(await store.exportBackup());
  expect(await restoreAt('9999-12-31T23:59:59.999Z')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });
  expect(value(await store.exportBackup())).toBe(before);
  value(await restoreAt('9999-12-31T23:59:59.997Z'));
  const restored = value(await store.exportBackup());
  // Fehlschlag, wenn ein Schreibstempel die letzte Millisekunde belegt, die der Wiederherstellungsstempel braucht.
  expect(await store.createVerbund('After the mark')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_TIMESTAMP_EXHAUSTED' } });
  expect(value(await store.exportBackup())).toBe(restored);
  value(await restoreAt('9999-12-31T23:59:59.998Z'));
  const exported = value(await store.exportBackup());
  expect(JSON.parse(exported).workspaceMeta[0].savedAt).toBe('9999-12-31T23:59:59.999Z');
  store.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  store = value(await WorkspaceStore.open());
  // Fehlschlag, wenn die Gesamtsicherung mit dem Grenzstempel in der Metazeile in einer frischen Datenbank nicht wiederherstellbar ist.
  value(await restoreWorkspaceBackup(store, bytes(exported)));
  const reexported = JSON.parse(value(await store.exportBackup()));
  const expected = JSON.parse(exported);
  expected.workspaceMeta[0].databaseId = reexported.workspaceMeta[0].databaseId;
  expect(reexported).toEqual(expected);
});

it('lehnt einen Neubeitritt ab, dessen fortgeschriebene Scopezeile keine wiederherstellbare Sicherung mehr ergäbe', async () => {
  const scope = value(await store.createScope('Bereich'));
  const joining = value(await store.createVerbund('Beitritt', scope));
  const file = JSON.parse(value(await store.exportVerbundBackup(joining.verbundId)));
  const [current] = value(await store.listScopes());
  value(await store.deleteVerbund(joining.verbundId, { savedAt: joining.savedAt, scope: { scopeId: current.scopeId, savedAt: current.savedAt } }));
  const joinAt = (savedAt: string) => {
    file.verbuende[0].savedAt = savedAt;
    return restoreVerbundBackup(store, bytes(JSON.stringify(file)));
  };
  const before = value(await store.exportBackup());
  // Fehlschlag, wenn der Neubeitritt die letzte Millisekunde als `savedAt` der vorhandenen Scopezeile schreibt.
  expect(await joinAt('9999-12-31T23:59:59.998Z')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_TIMESTAMP_EXHAUSTED' } });
  expect(value(await store.exportBackup())).toBe(before);
  value(await joinAt('9999-12-31T23:59:59.997Z'));
  const exports = [value(await store.exportBackup()), value(await store.exportVerbundBackup(joining.verbundId))];
  for (const [index, exported] of exports.entries()) {
    store.close();
    await Dexie.delete(WORKSPACE_DATABASE_NAME);
    store = value(await WorkspaceStore.open());
    value(await (index === 0 ? restoreWorkspaceBackup : restoreVerbundBackup)(store, bytes(exported)));
  }
});

it('lehnt jedes Fortschreiben einer Scopezeile ab, die danach die Bytegrenze überschritte', async () => {
  const scope = value(await store.createScope('Bereich'));
  const joining = value(await store.createVerbund('Beitritt', scope));
  const file = value(await store.exportVerbundBackup(joining.verbundId));
  const full = JSON.parse(value(await store.exportBackup()));
  full.verbuende = full.verbuende.filter((row: WorkspaceVerbund) => row.verbundId !== joining.verbundId);
  // Ohne Millisekunden genau an der Grenze; jeder Schreibstempel trägt Millisekunden und verlängert die Zeile um vier Bytes.
  const row = { ...full.methodikScopes[0], savedAt: '2026-01-01T00:00:00Z', name: '' };
  row.name = 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes - bytes(serializeWorkspaceJson(row)).byteLength);
  full.methodikScopes = [row];
  value(await restoreWorkspaceBackup(store, bytes(JSON.stringify(full))));
  const before = value(await store.exportBackup());
  expect(await restoreVerbundBackup(store, bytes(file))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCOPE_INVALID' } });
  const [stored] = value(await store.listScopes());
  expect(await store.createVerbund('Neu', stored)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCOPE_INVALID' } });
  expect(value(await store.exportBackup())).toBe(before);
});
