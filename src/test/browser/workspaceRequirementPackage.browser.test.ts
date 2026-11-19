// Aktives Anforderungspaket je Verbund (GSPP-708): Zustände, CAS-Writer, Backup und Restorekonflikt.
import { expect, it, vi } from 'vitest';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import type { WorkspaceStore } from '@/adapters/workspaceStore';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { VerbundId, WorkspaceVerbund } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { restoreVerbundBackup, restoreWorkspaceBackup } from '@/test/restoreWorkspaceBackup';
import { open, value } from '@/test/browser/workspaceStoreFixtures';

const bytes = (text: string) => new TextEncoder().encode(text);
const conflict = { ok: false, diagnostic: { code: 'WORKSPACE_SAVE_CONFLICT' } };
const invalid = { ok: false, diagnostic: { code: 'WORKSPACE_PACKAGE_INVALID' } };
const backupConflict = { ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_CONFLICT' } };
const backupInvalid = { ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } };

async function oscal(rootType: OscalRootKey, title: string, lastModified = '2026-11-12T10:41:00Z') {
  const source = makeSchemaValidOscalDocument(rootType, '1.1.3');
  const metadata = (source[rootType] as { metadata: Record<string, unknown> }).metadata;
  metadata.title = title;
  metadata['last-modified'] = lastModified;
  const result = await importClass2OscalDocument(bytes(JSON.stringify(source)), { trustClass: 'class-2-local-user' });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}

async function verbund(store: WorkspaceStore, id: VerbundId): Promise<WorkspaceVerbund> {
  return value(await store.listVerbuende()).find(row => row.verbundId === id)!;
}

async function packageState(store: WorkspaceStore, id: VerbundId) {
  return value(await store.listRequirementPackages()).find(row => row.verbundId === id)?.state;
}

/** VA mit zwei Profiles; P1 festgelegt. */
async function fixture() {
  const store = await open();
  const va = value(await store.createVerbund('VA'));
  const p1 = value(await store.addDocument(va.verbundId, await oscal('profile', 'P1_TITLE')));
  const p2 = value(await store.addDocument(va.verbundId, await oscal('profile', 'P2_TITLE')));
  return { store, va, p1, p2 };
}

it('legt ein Profile ausdrücklich fest, ohne ein anderes Profile anzufassen, und behält es nach dem Neuöffnen', async () => {
  const { store, va, p1, p2 } = await fixture();
  const network = vi.spyOn(globalThis, 'fetch');
  expect(await packageState(store, va.verbundId)).toBeUndefined();
  const set = value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p1.savedAt }, p1.localId));
  store.close();

  const reopened = await open();
  const stored = (await verbund(reopened, va.verbundId)).requirementPackage!;
  expect(stored).toEqual(set.requirementPackage);
  expect(stored.baseline.localId).toBe(p1.localId);
  expect(stored.baseline.stand).toMatchObject({ rootType: 'profile', lastModified: '2026-11-12T10:41:00Z', contentHash: { algorithm: 'sha-256' } });
  // Ohne `derivedFrom` gibt es nur den lokalen Pin; der Quellenstand bleibt offen, nichts wird nachgeladen.
  expect(stored.sourcePins).toEqual([{ kind: 'local', localId: p1.localId, stand: stored.baseline.stand }]);
  expect(network).not.toHaveBeenCalled();
  expect(await packageState(reopened, va.verbundId)).toEqual({ kind: 'set', requirementPackage: stored, title: 'P1_TITLE' });
  expect(value(await reopened.getDocument(p2.localId))).toEqual(p2);
});

it('meldet nach einer Inhaltsänderung „überholt“, behält beim Neufestlegen die packageId und meldet ein gelöschtes Baselinedokument als nicht auflösbar', async () => {
  const { store, va, p1 } = await fixture();
  const first = value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p1.savedAt }, p1.localId));
  // Gleicher Stempel, anderer Inhalt: Erst der Content-Hash zeigt die Änderung.
  const saved = value(await store.saveDocument(p1.localId, p1.savedAt, null, await oscal('profile', 'P1_CHANGED')));
  expect(await packageState(store, va.verbundId)).toMatchObject({ kind: 'stale', title: 'P1_CHANGED', current: { lastModified: '2026-11-12T10:41:00Z' } });
  const later = value(await store.saveDocument(p1.localId, saved.savedAt, null, await oscal('profile', 'P1_CHANGED', '2026-11-14T09:12:00Z')));
  expect(await packageState(store, va.verbundId)).toMatchObject({ kind: 'stale', current: { lastModified: '2026-11-14T09:12:00Z' } });

  const again = value(await store.setRequirementPackage(va.verbundId, { savedAt: first.savedAt, baselineSavedAt: later.savedAt }, p1.localId));
  expect(again.requirementPackage?.packageId).toBe(first.requirementPackage?.packageId);
  expect(again.requirementPackage?.baseline.stand.lastModified).toBe('2026-11-14T09:12:00Z');
  expect(await packageState(store, va.verbundId)).toMatchObject({ kind: 'set' });

  value(await store.deleteDocument(p1.localId));
  expect(await verbund(store, va.verbundId)).toEqual(again);
  expect(await packageState(store, va.verbundId)).toEqual({ kind: 'unresolvable', requirementPackage: again.requirementPackage });
});

it('lehnt fremde Baselines, falsche Root-Typen und veraltete Vergleichswerte ohne Teiländerung ab', async () => {
  const { store, va, p1, p2 } = await fixture();
  const vb = value(await store.createVerbund('VB'));
  const foreign = value(await store.addDocument(vb.verbundId, await oscal('profile', 'FOREIGN')));
  const ssp = value(await store.addDocument(va.verbundId, await oscal('system-security-plan', 'SSP')));
  const before = value(await store.exportBackup());

  expect(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: foreign.savedAt }, foreign.localId)).toMatchObject(invalid);
  expect(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: ssp.savedAt }, ssp.localId)).toMatchObject(invalid);
  expect(await store.setRequirementPackage(va.verbundId, { savedAt: 'STALE', baselineSavedAt: p1.savedAt }, p1.localId)).toMatchObject(conflict);
  expect(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: 'STALE' }, p1.localId)).toMatchObject(conflict);
  expect(await store.clearRequirementPackage(va.verbundId, { savedAt: 'STALE' })).toMatchObject(conflict);
  value(await store.deleteDocument(p2.localId));
  const afterDelete = value(await store.exportBackup());
  expect(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p2.savedAt }, p2.localId)).toMatchObject(conflict);
  expect(value(await store.exportBackup())).toBe(afterDelete);
  expect(JSON.parse(before).verbuende).toEqual(JSON.parse(afterDelete).verbuende);

  const set = value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p1.savedAt }, p1.localId));
  const cleared = value(await store.clearRequirementPackage(va.verbundId, { savedAt: set.savedAt }));
  expect(cleared).not.toHaveProperty('requirementPackage');
  expect(await packageState(store, va.verbundId)).toBeUndefined();
});

it('transportiert das Paket in Gesamt- und Verbundbackup und weist eine doppelte packageId zurück', async () => {
  const { store, va, p1 } = await fixture();
  const set = value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p1.savedAt }, p1.localId));
  const whole = value(await store.exportBackup());
  const partial = value(await store.exportVerbundBackup(va.verbundId));
  expect(JSON.parse(partial).verbuende[0].requirementPackage).toEqual(set.requirementPackage);

  value(await restoreWorkspaceBackup(store, bytes(whole)));
  expect((await verbund(store, va.verbundId)).requirementPackage).toEqual(set.requirementPackage);

  const parsed = JSON.parse(whole);
  const twin = { ...parsed.verbuende[0], verbundId: crypto.randomUUID(), name: 'VB' };
  const duplicate = { ...parsed, verbuende: [...parsed.verbuende, { ...twin, requirementPackage: { ...twin.requirementPackage, baseline: { ...twin.requirementPackage.baseline, localId: crypto.randomUUID() } } }] };
  expect(await restoreWorkspaceBackup(store, bytes(JSON.stringify(duplicate)))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INVALID' } });

  // Dieselbe packageId an einem anderen Zielverbund sperrt den Verbund-Restore.
  const moved = JSON.parse(partial);
  moved.verbuende[0] = { ...moved.verbuende[0], verbundId: crypto.randomUUID() };
  moved.documents = moved.documents.map((row: { verbundId: string }) => ({ ...row, verbundId: moved.verbuende[0].verbundId, localId: crypto.randomUUID() }));
  moved.verbuende[0].requirementPackage.baseline.localId = moved.documents[0].localId;
  moved.verbuende[0].requirementPackage.sourcePins[0].localId = moved.documents[0].localId;
  expect(await restoreVerbundBackup(store, bytes(JSON.stringify(moved)))).toMatchObject(backupConflict);
});

it('verweigert den Verbund-Restore auf ein abweichendes oder fehlendes Zielpaket und stellt Altbündel ohne Paket wieder her', async () => {
  const { store, va, p1, p2 } = await fixture();
  const withoutPackage = value(await store.exportVerbundBackup(va.verbundId));
  const first = value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p1.savedAt }, p1.localId));
  const withP1 = value(await store.exportVerbundBackup(va.verbundId));

  // Fall F7c: gleiche packageId, andere Baseline.
  const second = value(await store.setRequirementPackage(va.verbundId, { savedAt: first.savedAt, baselineSavedAt: p2.savedAt }, p2.localId));
  expect(second.requirementPackage?.packageId).toBe(first.requirementPackage?.packageId);
  const before = value(await store.exportBackup());
  expect(await restoreVerbundBackup(store, bytes(withP1))).toMatchObject(backupConflict);
  expect(await restoreVerbundBackup(store, bytes(withoutPackage))).toMatchObject(backupConflict);
  expect(value(await store.exportBackup())).toBe(before);

  const cleared = value(await store.clearRequirementPackage(va.verbundId, { savedAt: second.savedAt }));
  expect(await restoreVerbundBackup(store, bytes(withP1))).toMatchObject(backupConflict);
  // Ein v4-Bündel ohne Paketfeld bleibt gegen einen Zielverbund ohne Paket wiederherstellbar.
  const legacy = JSON.parse(withoutPackage);
  legacy.storageSchemaVersion = 4;
  legacy.documents = legacy.documents.map((row: object) => ({ ...row, storageSchemaVersion: 4 }));
  value(await restoreVerbundBackup(store, bytes(JSON.stringify(legacy))));
  expect(await verbund(store, va.verbundId)).not.toHaveProperty('requirementPackage');
  expect(cleared).not.toHaveProperty('requirementPackage');
});

it('verweigert den Verbund-Restore, wenn ein Paketverweis nach dem Restore auf ein Dokument eines anderen Verbunds zeigte', async () => {
  const { store, va, p1, p2 } = await fixture();
  const set = value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p2.savedAt }, p2.localId));
  value(await store.deleteDocument(p2.localId));
  const vb = value(await store.createVerbund('VB'));
  const foreign = value(await store.addDocument(vb.verbundId, await oscal('profile', 'FOREIGN')));

  // Datei: VA mit nicht auflösbarer Baseline, deren localId im Ziel einem Dokument von VB gehört.
  const pointing = JSON.parse(value(await store.exportVerbundBackup(va.verbundId)));
  pointing.verbuende[0].requirementPackage.baseline.localId = foreign.localId;
  pointing.verbuende[0].requirementPackage.sourcePins[0].localId = foreign.localId;
  const before = value(await store.exportBackup());
  expect(await restoreVerbundBackup(store, bytes(JSON.stringify(pointing)))).toMatchObject(backupConflict);

  // Datei: VB bringt ein Dokument mit der localId, auf die das nicht auflösbare Paket von VA zeigt.
  const incoming = JSON.parse(value(await store.exportVerbundBackup(vb.verbundId)));
  incoming.documents[0].localId = p2.localId;
  expect(await restoreVerbundBackup(store, bytes(JSON.stringify(incoming)))).toMatchObject(backupConflict);
  expect(value(await store.exportBackup())).toBe(before);
  expect((await verbund(store, va.verbundId)).requirementPackage).toEqual(set.requirementPackage);
  expect(value(await store.getDocument(p1.localId))).toBeDefined();
});

it('lehnt einen Entwurf ohne metadata.version mit fachlicher Diagnose ab, ohne etwas zu schreiben', async () => {
  const { store, va } = await fixture();
  const source = makeSchemaValidOscalDocument('profile', '1.1.3');
  delete (source.profile as { metadata: Record<string, unknown> }).metadata.version;
  const draft = value(await store.addDocument(va.verbundId, { source, context: { trustClass: 'class-2-local-user' }, rootType: 'profile', oscalVersion: '1.1.3' }, 'draft'));
  const before = value(await store.exportBackup());
  expect(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: draft.savedAt }, draft.localId))
    .toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_PACKAGE_STAND_INCOMPLETE' } });
  expect(value(await store.exportBackup())).toBe(before);
});

it('verweigert den Verbund-Restore, wenn ein anderer Zielverbund dieselbe fehlende Baseline festgelegt hat', async () => {
  const { store, va, p2 } = await fixture();
  value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p2.savedAt }, p2.localId));
  value(await store.deleteDocument(p2.localId));

  // Datei: neuer Verbund mit eigener packageId, dessen nicht auflösbares Paket auf dieselbe localId zeigt.
  const twin = JSON.parse(value(await store.exportVerbundBackup(va.verbundId)));
  twin.verbuende[0] = { ...twin.verbuende[0], verbundId: crypto.randomUUID(), name: 'VB' };
  twin.verbuende[0].requirementPackage.packageId = crypto.randomUUID();
  twin.documents = twin.documents.map((row: object) => ({ ...row, verbundId: twin.verbuende[0].verbundId, localId: crypto.randomUUID() }));
  const before = value(await store.exportBackup());
  expect(await restoreVerbundBackup(store, bytes(JSON.stringify(twin)))).toMatchObject(backupConflict);
  expect(value(await store.exportBackup())).toBe(before);
});

it('nimmt einen class-1-Paketpin nur mit registriertem Artefaktschlüssel aus Gesamt- und Verbundbackup an', async () => {
  const { store, va, p1 } = await fixture();
  value(await store.setRequirementPackage(va.verbundId, { savedAt: va.savedAt, baselineSavedAt: p1.savedAt }, p1.localId));
  const pinned = (text: string, artifactKey: string) => {
    const parsed = JSON.parse(text);
    parsed.verbuende[0].requirementPackage.sourcePins.push({ kind: 'class-1', artifactKey, snapshotCommit: 'c'.repeat(40), contentSha256: 'b'.repeat(64) });
    return bytes(JSON.stringify(parsed));
  };
  const whole = value(await store.exportBackup());
  const partial = value(await store.exportVerbundBackup(va.verbundId));
  const before = whole;
  expect(await restoreWorkspaceBackup(store, pinned(whole, 'catalog-unbekannt'))).toMatchObject(backupInvalid);
  expect(await restoreVerbundBackup(store, pinned(partial, 'catalog-unbekannt'))).toMatchObject(backupInvalid);
  expect(value(await store.exportBackup())).toBe(before);
  value(await restoreWorkspaceBackup(store, pinned(whole, 'catalog-gspp')));
  expect((await verbund(store, va.verbundId)).requirementPackage?.sourcePins[1]).toMatchObject({ kind: 'class-1', artifactKey: 'catalog-gspp' });
});
