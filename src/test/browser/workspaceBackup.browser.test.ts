import Dexie from 'dexie';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { WorkspaceStore, WORKSPACE_DATABASE_NAME } from '@/adapters/workspaceStore';
import { importClass2OscalDocument } from '@/adapters/oscalImportGate';
import type { Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import type { WorkspaceEnvelope, WorkspaceResult, WorkspaceVerbund } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { CLASS_2_IMPORT_LIMITS } from '@/domain/class2ImportLimits.mjs';

function value<T>(result: WorkspaceResult<T>): T {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.value;
}
function valueImported(result: Awaited<ReturnType<typeof importClass2OscalDocument>>): Class2OscalImportedDocument {
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}
let store: WorkspaceStore;
let verbund: WorkspaceVerbund;
let envelope: WorkspaceEnvelope;
beforeEach(async () => {
  store = value(await WorkspaceStore.open());
  verbund = value(await store.createVerbund('Synthetic backup boundary'));
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  const imported = valueImported(await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' }));
  envelope = value(await store.addDocument(verbund.verbundId, imported));
});
afterEach(async () => {
  store?.close();
  await Dexie.delete(WORKSPACE_DATABASE_NAME);
});

it.each(['workspace', 'verbund'] as const)('round-trips a schema-valid profile at source depth 64 (%s)', async scope => {
  const source = makeSchemaValidOscalDocument('profile', '1.1.3');
  let group: Record<string, unknown> = { id: 'deep', title: 'Deep', 'insert-controls': [{ 'include-controls': [{ 'with-ids': ['ac-1'] }] }] };
  for (let index = 0; index < 26; index++) group = { id: `g-${index}`, title: 'Group', groups: [group] };
  Object.assign(source.profile as object, { merge: { custom: { groups: [group] } } });
  const imported = valueImported(await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' }));
  const stored = value(await store.addDocument(verbund.verbundId, imported));
  const backup = value(await (scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(verbund.verbundId)));
  value(await (scope === 'workspace' ? store.restoreBackup(new TextEncoder().encode(backup), 'replace-workspace') : store.restoreVerbundBackup(new TextEncoder().encode(backup), 'replace-verbund')));
  expect(value(await store.getDocument(stored.localId))?.source).toEqual(source);
});

it.each(['workspace', 'verbund'] as const)('round-trips a draft at the full source-depth boundary (%s)', async scope => {
  let source: unknown = null;
  for (let depth = 1; depth < CLASS_2_IMPORT_LIMITS.maxDepth; depth++) source = { child: source };
  value(await store.autosaveDraft(envelope.localId, envelope.savedAt, null, source));
  const backup = value(await (scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(verbund.verbundId)));
  value(await (scope === 'workspace' ? store.restoreBackup(new TextEncoder().encode(backup), 'replace-workspace') : store.restoreVerbundBackup(new TextEncoder().encode(backup), 'replace-verbund')));
  expect(value(await store.getDraft(envelope.localId))?.source).toEqual(source);
});

it.each(['workspace', 'verbund'] as const)('round-trips documents whose combined decoded base64 exceeds the per-source cap (%s)', async scope => {
  const payload = 'AAAA'.repeat(Math.ceil(2.5 * 1024 * 1024 / 3));
  for (let index = 0; index < 2; index++) {
    const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
    Object.assign(source.catalog as object, { 'back-matter': { resources: [{
      uuid: crypto.randomUUID(), base64: { filename: 'synthetic.bin', 'media-type': 'application/octet-stream', value: payload },
    }] } });
    const imported = valueImported(await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' }));
    value(await store.addDocument(verbund.verbundId, imported));
  }
  const backup = value(await (scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(verbund.verbundId)));
  value(await (scope === 'workspace' ? store.restoreBackup(new TextEncoder().encode(backup), 'replace-workspace') : store.restoreVerbundBackup(new TextEncoder().encode(backup), 'replace-verbund')));
  const restored = JSON.parse(value(await (scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(verbund.verbundId))));
  const expected = JSON.parse(backup);
  // Die Gesamtwiederherstellung schreibt ausschließlich den Metazeitstempel fort.
  if (scope === 'workspace') expected.workspaceMeta[0].savedAt = restored.workspaceMeta[0].savedAt;
  expect(restored).toEqual(expected);
}, 30_000);

it.each(['workspace', 'verbund'] as const)('retains a binding after its source href changes and through backup restoration (%s)', async scope => {
  const pointer = '/catalog/metadata/title';
  const href = (envelope.source as { catalog: { metadata: { title: string } } }).catalog.metadata.title;
  const binding = { fromLocalId: envelope.localId, pointer, href, target: { kind: 'class-1' as const, artifactKey: 'catalog-gspp' } };
  value(await store.setBinding(binding));
  const current = value(await store.getDocument(envelope.localId))!;
  const source = makeSchemaValidOscalDocument('catalog', '1.1.3');
  (source.catalog as { metadata: { title: string } }).metadata.title = 'Changed source';
  const imported = valueImported(await importClass2OscalDocument(new TextEncoder().encode(JSON.stringify(source)), { trustClass: 'class-2-local-user' }));
  value(await store.replaceDocument(envelope.localId, current.savedAt, null, imported));
  const backup = value(await (scope === 'workspace' ? store.exportBackup() : store.exportVerbundBackup(verbund.verbundId)));
  value(await (scope === 'workspace' ? store.restoreBackup(new TextEncoder().encode(backup), 'replace-workspace') : store.restoreVerbundBackup(new TextEncoder().encode(backup), 'replace-verbund')));
  expect(value(await store.listBindings())).toEqual([binding]);
  expect(value(await store.getDocument(envelope.localId))?.source).toEqual(source);
});
