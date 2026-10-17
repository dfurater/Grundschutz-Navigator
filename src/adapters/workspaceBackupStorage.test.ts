// @vitest-environment node
import 'fake-indexeddb/auto';
import Dexie, { type IndexableTypePart } from 'dexie';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
vi.mock('@/adapters/workspaceBackup', async () => {
  const { processWorkspaceBackupBytes, processVerbundBackupBytes } = await import('@/adapters/workspaceBackupProcessing');
  return { parseWorkspaceBackup: processWorkspaceBackupBytes, parseVerbundBackup: processVerbundBackupBytes };
});
import { WorkspaceStore, WORKSPACE_DATABASE_NAME, WORKSPACE_SCHEMA } from '@/adapters/workspaceStore';
import { exportWorkspaceBackupSnapshot } from '@/adapters/workspaceBackupStorage';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { VerbundId, WorkspaceEnvelope, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { WORKSPACE_BACKUP_MAX_BYTES } from '@/domain/class2ImportLimits.mjs';

function value<T>(result: WorkspaceResult<T>): T { if (!result.ok) throw new Error(result.diagnostic.code); return result.value; }
const bytes = (text: string) => new TextEncoder().encode(text);
let store: WorkspaceStore;
let db: Dexie;
let a: WorkspaceVerbund;
let b: WorkspaceVerbund;
let one: WorkspaceEnvelope;
let other: WorkspaceEnvelope;
let imported: Class2OscalImportedDocument;

async function catalog(title: string): Promise<Class2OscalImportedDocument> {
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  (source.catalog as { metadata: { title: string } }).metadata.title = title;
  const result = await importClass2OscalDocument(bytes(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}
const titleOf = (row: { source: unknown }) => (row.source as { catalog: { metadata: { title: string } } }).catalog.metadata.title;

/** Zweites Browserprofil: die Datenbank wird ersetzt; `store` und `db` zeigen wieder auf den neuen Bestand. */
async function nextProfile(): Promise<void> {
  store.close();
  db.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
  store = value(await WorkspaceStore.open());
  db = new Dexie(WORKSPACE_DATABASE_NAME);
  await db.open();
}

beforeEach(async () => {
  store = value(await WorkspaceStore.open());
  a = value(await store.createVerbund('Selected'));
  b = value(await store.createVerbund('OTHER_VERBUND_SENTINEL'));
  imported = await catalog('Selected');
  one = value(await store.addDocument(a.verbundId, imported));
  other = value(await store.addDocument(b.verbundId, await catalog('OTHER_DOCUMENT_SENTINEL')));
  value(await store.autosaveDraft(one.localId, one.savedAt, null, { incomplete: true }));
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'Selected', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }));
  db = new Dexie(WORKSPACE_DATABASE_NAME); await db.open();
});
afterEach(async () => { vi.restoreAllMocks(); db?.close(); store?.close(); await Dexie.delete(WORKSPACE_DATABASE_NAME); });

it('exports exactly one verbund and restores it without changing another verbund', async () => {
  const backup = value(await store.exportVerbundBackup(a.verbundId));
  const parsed = JSON.parse(backup);
  expect(parsed).toMatchObject({ format: 'gspp-workspace-verbund', verbuende: [a], documents: [{ localId: one.localId }], drafts: [{ localId: one.localId }], bindings: [{ fromLocalId: one.localId }] });
  expect(parsed).not.toHaveProperty('workspaceMeta');
  expect(backup).not.toContain('OTHER_');
  value(await store.renameVerbund(a.verbundId, 'Changed'));
  const added = value(await store.addDocument(a.verbundId, imported));
  value(await store.restoreVerbundBackup(bytes(backup), 'replace-verbund'));
  expect(value(await store.exportVerbundBackup(a.verbundId))).toBe(backup);
  expect(value(await store.getDocument(added.localId))).toBeUndefined();
  expect(value(await store.getDocument(other.localId))).toEqual(other);
  value(await store.deleteVerbund(a.verbundId));
  value(await store.restoreVerbundBackup(bytes(backup), 'replace-verbund'));
  expect(value(await store.exportVerbundBackup(a.verbundId))).toBe(backup);
});

it('rejects foreign localId collisions atomically', async () => {
  const selected = JSON.parse(value(await store.exportVerbundBackup(a.verbundId)));
  const oldId = selected.documents[0].localId;
  const text = JSON.stringify(selected).replaceAll(oldId, other.localId);
  const before = value(await store.exportBackup());
  expect(await store.restoreVerbundBackup(bytes(text), 'replace-verbund')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_CONFLICT' } });
  expect(value(await store.exportBackup())).toBe(before);
});

it('restores an empty verbund without admitting foreign drafts or retaining stale selected rows', async () => {
  const empty = value(await store.createVerbund('Empty'));
  const parsed = JSON.parse(value(await store.exportVerbundBackup(empty.verbundId)));
  expect(parsed.documents).toHaveLength(0);
  expect(parsed.drafts).toHaveLength(0);
  expect(parsed.bindings).toHaveLength(0);
  parsed.verbuende[0].verbundId = a.verbundId;
  value(await store.restoreVerbundBackup(bytes(JSON.stringify(parsed)), 'replace-verbund'));
  expect(value(await store.listDocuments(a.verbundId))).toHaveLength(0);
  expect(value(await store.getDraft(one.localId))).toBeUndefined();
  expect(value(await store.listBindings())).toHaveLength(0);
  expect(value(await store.getDocument(other.localId))).toEqual(other);
});

it('rejects crossed formats, invalid sources, newer schemas and oversized bytes without mutation', async () => {
  const total = value(await store.exportBackup());
  const selected = value(await store.exportVerbundBackup(a.verbundId));
  expect(await store.restoreBackup(bytes(selected), 'replace-workspace')).toMatchObject({ ok: false });
  const invalid = JSON.parse(selected); invalid.documents[0].source = { catalog: {} };
  for (const input of [bytes(total), bytes(JSON.stringify(invalid)), bytes(selected.replace('"storageSchemaVersion":1', '"storageSchemaVersion":2')), new Uint8Array(WORKSPACE_BACKUP_MAX_BYTES + 1)]) {
    expect(await store.restoreVerbundBackup(input, 'replace-verbund')).toMatchObject({ ok: false });
    expect(value(await store.exportBackup())).toBe(total);
  }
  expect(await store.exportVerbundBackup('missing' as typeof a.verbundId)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_VERBUND_NOT_FOUND' } });
  expect(await store.restoreVerbundBackup(bytes(selected), '' as 'replace-verbund')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_CONFIRMATION_REQUIRED' } });
});

it('keeps each verbund restorable when the aggregate workspace exceeds the byte cap', async () => {
  for (const row of [one, other]) value(await store.autosaveDraft(row.localId, value(await store.getDocument(row.localId))!.savedAt, value(await store.getDraft(row.localId))?.savedAt ?? null, { text: 'x'.repeat(9 * 1024 * 1024) }));
  for (const row of [one, other]) {
    const added = value(await store.addDocument(row.verbundId, imported));
    value(await store.autosaveDraft(added.localId, added.savedAt, null, { text: 'x'.repeat(9 * 1024 * 1024) }));
  }
  expect(await store.exportBackup()).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_LIMIT_EXCEEDED' } });
  for (const verbund of [a, b]) {
    const backup = value(await store.exportVerbundBackup(verbund.verbundId));
    value(await store.restoreVerbundBackup(bytes(backup), 'replace-verbund'));
    expect(value(await store.exportVerbundBackup(verbund.verbundId))).toBe(backup);
  }
}, 30_000);

it('preserves unknown future data through the global export path', async () => {
  await db.table('workspaceMeta').update('workspace', { storageSchemaVersion: 2, future: 'FUTURE_METADATA' });
  const backup = await db.transaction('r', db.tables, () => exportWorkspaceBackupSnapshot(db));
  expect(JSON.parse(backup)).toMatchObject({ storageSchemaVersion: 2, workspaceMeta: [{ future: 'FUTURE_METADATA' }] });
  expect(await store.exportVerbundBackup(a.verbundId)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SCHEMA_NEWER' } });
});

it.each(['workspace', 'verbund'] as const)('never reissues a comparison value loaded before a restore (%s)', async scope => {
  // Bündelstand vor der Geräteuhr: Ohne frischen Zeilenstempel gäbe jeder Save nach der Wiederherstellung denselben Wert zurück.
  const future = new Date(Date.now() + 3_600_000).toISOString(); const later = new Date(Date.now() + 7_200_000).toISOString();
  const parsed = JSON.parse(value(await (scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(a.verbundId))));
  for (const row of [...parsed.documents, ...parsed.drafts]) row.savedAt = future;
  // Jede Zeile des Bündels zählt: die Verbundzeile trägt hier den höchsten Wert.
  for (const row of parsed.verbuende) row.savedAt = later;
  const backup = bytes(JSON.stringify(parsed));
  const restore = () => scope === 'workspace' ? store.restoreBackup(backup, 'replace-workspace') : store.restoreVerbundBackup(backup, 'replace-verbund');
  value(await restore());
  // Fehlschlag, wenn der Dateiwert des Bündels nach der Wiederherstellung noch als Vergleichswert passt.
  expect(await store.saveDocument(one.localId, future, future, imported)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  // Der danach geladene gemeinsame Stempel gelingt und liegt über jedem Bündelwert.
  const loaded = value(await store.getDocument(one.localId))!;
  const draft = value(await store.getDraft(one.localId))!;
  expect(loaded.savedAt).toBe(draft.savedAt);
  expect(Date.parse(loaded.savedAt)).toBeGreaterThan(Date.parse(later));
  const saved = value(await store.saveDocument(one.localId, loaded.savedAt, draft.savedAt, imported));
  expect(Date.parse(saved.savedAt)).toBeGreaterThan(Date.parse(loaded.savedAt));
  // Fehlschlag, wenn der vor der zweiten Wiederherstellung geladene Vergleichswert den späteren Stand überschreibt.
  value(await restore());
  expect(await store.saveDocument(one.localId, saved.savedAt, null, imported)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  const restoredAgain = value(await store.getDocument(one.localId))!;
  expect(Date.parse(restoredAgain.savedAt)).toBeGreaterThan(Date.parse(saved.savedAt));
});

it.each(['workspace', 'verbund'] as const)('rejects a pre-restore comparison value that the restored bundle reuses (%s)', async scope => {
  // Zwei Profile folgen derselben Backup-Linie und reichen sich Bündel: Beide Geräteuhren liegen hinter
  // dem Stempel F des Ausgangsbündels, sodass ein Save und ein Entwurf in beiden Profilen unterschiedlichen
  // Inhalt mit identischem Stempel erzeugen (p2Stamp == p1.savedAt).
  const future = new Date(Date.now() + 3_600_000).toISOString();
  const exportBundle = (verbundId: VerbundId) => scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(verbundId);
  const restoreBundle = (text: string) => scope === 'workspace' ? store.restoreBackup(bytes(text), 'replace-workspace') : store.restoreVerbundBackup(bytes(text), 'replace-verbund');

  // Ausgangsbündel: ein Verbund mit zwei Dokumenten und einem Entwurf, alle Zeilenstempel über die Uhr gehoben.
  await nextProfile();
  const ancestor = value(await store.createVerbund('Ancestor'));
  const documentOne = value(await store.addDocument(ancestor.verbundId, await catalog('DOCUMENT_ONE')));
  const documentTwo = value(await store.addDocument(ancestor.verbundId, await catalog('DOCUMENT_TWO')));
  value(await store.autosaveDraft(documentTwo.localId, documentTwo.savedAt, null, { text: 'DRAFT_ANCESTOR' }));
  const ancestorFile = JSON.parse(value(await exportBundle(ancestor.verbundId)));
  for (const row of [...ancestorFile.documents, ...ancestorFile.drafts]) row.savedAt = future;
  const sharedFile = JSON.stringify(ancestorFile);

  // Profil 2 speichert Dokument eins und bearbeitet Entwurf zwei; Profil 1 tut dasselbe mit anderem Inhalt.
  const profile = async (content: string, draft: string) => {
    await nextProfile();
    value(await restoreBundle(sharedFile));
    const first = value(await store.getDocument(documentOne.localId))!;
    const second = value(await store.getDocument(documentTwo.localId))!;
    const pending = value(await store.getDraft(documentTwo.localId))!;
    const saved = value(await store.saveDocument(documentOne.localId, first.savedAt, null, await catalog(content)));
    const edited = value(await store.autosaveDraft(documentTwo.localId, second.savedAt, pending.savedAt, { text: draft }));
    const bundle = JSON.parse(value(await exportBundle(ancestor.verbundId))) as {
      documents: { localId: string; savedAt: string }[];
      drafts: { localId: string; savedAt: string }[];
    };
    return { saved, edited, bundle };
  };
  const second = await profile('CONTENT_FROM_PROFILE_2', 'DRAFT_FROM_PROFILE_2');
  const first = await profile('CONTENT_FROM_PROFILE_1', 'DRAFT_FROM_PROFILE_1');

  // Vorbedingung des Befunds: unterschiedlicher Inhalt mit identischem Stempel in beiden Profilen.
  expect(second.bundle.documents.find(row => row.localId === documentOne.localId)?.savedAt).toBe(first.saved.savedAt);
  expect(second.bundle.drafts.find(row => row.localId === documentTwo.localId)?.savedAt).toBe(first.edited.savedAt);

  // Profil 1 liest das Bündel von Profil 2 ein, während der offene Tab die Werte von vorher hält.
  value(await restoreBundle(JSON.stringify(second.bundle)));
  expect(titleOf(value(await store.getDocument(documentOne.localId))!)).toBe('CONTENT_FROM_PROFILE_2');
  // Fehlschlag, wenn der vor der Wiederherstellung geladene Dokumentwert den wiederhergestellten Inhalt still überschreibt.
  expect(await store.saveDocument(documentOne.localId, first.saved.savedAt, null, await catalog('CONTENT_FROM_PROFILE_1')))
    .toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(titleOf(value(await store.getDocument(documentOne.localId))!)).toBe('CONTENT_FROM_PROFILE_2');
  // Fehlschlag, wenn der vor der Wiederherstellung geladene Entwurfswert den wiederhergestellten Entwurf still überschreibt.
  const restoredOne = value(await store.getDocument(documentOne.localId))!;
  const restoredTwo = value(await store.getDocument(documentTwo.localId))!;
  expect(await store.autosaveDraft(documentTwo.localId, restoredTwo.savedAt, first.edited.savedAt, { text: 'DRAFT_FROM_PROFILE_1' }))
    .toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  expect(value(await store.getDraft(documentTwo.localId))?.source).toEqual({ text: 'DRAFT_FROM_PROFILE_2' });
  // Nach der Wiederherstellung geladene Werte speichern weiterhin.
  const restoredDraft = value(await store.getDraft(documentTwo.localId))!;
  const editedAgain = value(await store.autosaveDraft(documentTwo.localId, restoredTwo.savedAt, restoredDraft.savedAt, { text: 'AFTER_RESTORE' }));
  expect(editedAgain.source).toEqual({ text: 'AFTER_RESTORE' });
  const savedAgain = value(await store.saveDocument(documentOne.localId, restoredOne.savedAt, null, await catalog('CONTENT_AFTER_RESTORE')));
  expect(titleOf(savedAgain)).toBe('CONTENT_AFTER_RESTORE');
});

it.each(['workspace', 'verbund'] as const)('validates the file stamp of restored rows and never exports it (%s)', async scope => {
  const exportBundle = () => scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(a.verbundId);
  const restore = (text: string) => scope === 'workspace' ? store.restoreBackup(bytes(text), 'replace-workspace') : store.restoreVerbundBackup(bytes(text), 'replace-verbund');
  const parsed = JSON.parse(value(await exportBundle()));
  const documentRow = parsed.documents.find((row: { localId: string }) => row.localId === one.localId);
  const draftRow = parsed.drafts.find((row: { localId: string }) => row.localId === one.localId);
  const before = value(await store.exportBackup());
  // Fehlschlag, wenn die Bündelform einen ungültigen Dateistempel durchlässt oder dabei den Bestand ändert.
  for (const row of [documentRow, draftRow]) {
    row.backupSavedAt = 'not-a-timestamp';
    expect(await restore(JSON.stringify(parsed))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });
    expect(value(await store.exportBackup())).toBe(before);
    delete row.backupSavedAt;
  }
  // Ein mitgeführter Fremdwert wird mit dem Dateistempel überschrieben und fehlt in jedem Export.
  documentRow.backupSavedAt = '2001-01-01T00:00:00.000Z';
  draftRow.backupSavedAt = '2002-02-02T00:00:00.000Z';
  value(await restore(JSON.stringify(parsed)));
  const exported = JSON.parse(value(await exportBundle()));
  const exportedDocument = exported.documents.find((row: { localId: string }) => row.localId === one.localId);
  expect(exportedDocument.savedAt).toBe(documentRow.savedAt);
  expect(exportedDocument).not.toHaveProperty('backupSavedAt');
  expect(exported.drafts.find((row: { localId: string }) => row.localId === one.localId)).not.toHaveProperty('backupSavedAt');
  // Fehlschlag, wenn der Dateiwert nach der Wiederherstellung noch als Vergleichswert passt.
  expect(await store.saveDocument(one.localId, documentRow.savedAt, draftRow.savedAt, imported)).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } });
  // Ein echter Schreibvorgang entfernt den Dateistempel; Liste und Re-Export tragen den Schreibstempel.
  const restored = value(await store.getDocument(one.localId))!;
  const restoredSummary = value(await store.listDocuments(a.verbundId)).find(row => row.localId === one.localId);
  expect(restoredSummary).toMatchObject({ savedAt: restored.savedAt });
  expect(restoredSummary).not.toHaveProperty('backupSavedAt');
  value(await store.setBinding({ fromLocalId: one.localId, pointer: '/catalog/metadata/title', href: 'Selected', target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }));
  const touched = value(await store.getDocument(one.localId))!;
  expect(Date.parse(touched.savedAt)).toBeGreaterThan(Date.parse(restored.savedAt));
  const writtenDocument = JSON.parse(value(await exportBundle())).documents.find((row: { localId: string }) => row.localId === one.localId);
  expect(writtenDocument.savedAt).toBe(touched.savedAt);
  expect(writtenDocument.savedAt).not.toBe(documentRow.savedAt);
});

it('keeps every stamp within four-digit years and the stored state exportable', async () => {
  const parsed = JSON.parse(value(await store.exportVerbundBackup(a.verbundId)));
  parsed.documents[0].savedAt = '9999-12-31T23:59:59.999Z';
  const before = value(await store.exportBackup());
  expect(await store.restoreVerbundBackup(bytes(JSON.stringify(parsed)), 'replace-verbund')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });
  expect(value(await store.exportBackup())).toBe(before);
  parsed.documents[0].savedAt = '9999-12-31T23:59:59.998Z';
  value(await store.restoreVerbundBackup(bytes(JSON.stringify(parsed)), 'replace-verbund'));
  const restored = value(await store.exportBackup());
  // Fehlschlag, wenn die nächste Schreibtransaktion einen fünfstelligen Jahresstempel schreibt und jeden Export bricht.
  expect(await store.createVerbund('After the mark')).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_TIMESTAMP_EXHAUSTED' } });
  expect(value(await store.exportBackup())).toBe(restored);
});

it('exports out-of-line keys of newer stores and rejects stores named like bundle members', async () => {
  db.close();
  store.close();
  const next = new Dexie(WORKSPACE_DATABASE_NAME);
  next.version(2).stores({ ...WORKSPACE_SCHEMA, futureStore: 'id', outbound: '' }).upgrade(async tx => {
    await tx.table('workspaceMeta').update('workspace', { storageSchemaVersion: 2 });
    await tx.table('futureStore').add({ id: 'inline' });
    const keys: IndexableTypePart[] = ['key-1', new Date('2026-10-17T00:00:00.000Z'), new Uint8Array([1, 2, 255]), Infinity, -Infinity];
    await tx.table('outbound').bulkAdd([{ value: 'TEXT' }, { value: 'DATE' }, { value: 'BINARY' }, { value: 'MAX' }, { value: 'MIN' }], keys);
    await tx.table('outbound').add({ value: 'ARRAY' }, ['a', new Date(0)]);
    await tx.table('outbound').add({ value: 'ARRAY_MAX' }, [Infinity]);
  });
  await next.open();
  const parsed = JSON.parse(await next.transaction('r', next.tables, () => exportWorkspaceBackupSnapshot(next)));
  next.close();
  // IndexedDB orders number before date before string before binary before array keys.
  expect(parsed.outbound).toEqual([{ value: 'MIN' }, { value: 'MAX' }, { value: 'DATE' }, { value: 'TEXT' }, { value: 'BINARY' }, { value: 'ARRAY_MAX' }, { value: 'ARRAY' }]);
  // Fehlschlag, wenn Schlüssel außerhalb der Datensätze fehlen, Datums-, Binär- oder ±Infinity-Schlüssel den Export brechen oder ein Store mit Schlüsselpfad Schlüssel erhält.
  expect(parsed.outOfLineKeys).toEqual({ outbound: [{ number: '-Infinity' }, { number: 'Infinity' }, { date: '2026-10-17T00:00:00.000Z' }, 'key-1', { binary: 'AQL/' }, [{ number: 'Infinity' }], ['a', { date: '1970-01-01T00:00:00.000Z' }]] });
  const reserved = new Dexie(WORKSPACE_DATABASE_NAME);
  reserved.version(3).stores({ ...WORKSPACE_SCHEMA, futureStore: 'id', outbound: '', format: 'id' });
  await reserved.open();
  await expect(reserved.transaction('r', reserved.tables, () => exportWorkspaceBackupSnapshot(reserved))).rejects.toMatchObject({ code: 'WORKSPACE_SCHEMA_INVALID' });
  reserved.close();
});
