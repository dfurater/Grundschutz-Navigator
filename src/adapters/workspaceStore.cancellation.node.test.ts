// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { document, open, storedValuesAndIndexKeys, value } from '@/test/browser/workspaceStoreFixtures';

vi.mock('@/adapters/oscalImportGate', async () => (await import('@/test/workspaceNodeWorkers')).inProcessImportGate());

it('bricht erst innerhalb der Transaktion ab und erhält Dokumente, Bindungen und Metadaten', async () => {
  const store = await open();
  const verbund = value(await store.createVerbund('Synthetischer Verbund'));
  const catalog = value(await store.addDocument(verbund.verbundId, await document()));
  const source = makeSchemaValidOscalDocument('profile', '1.1.3');
  const href = (source.profile as { imports: { href: string }[] }).imports[0].href;
  value(await store.addDocument(verbund.verbundId, {
    source, rootType: 'profile', oscalVersion: '1.1.3', context: { trustClass: 'class-2-local-user' },
  }, 'imported', [{ pointer: '/profile/imports/0/href', href, target: { kind: 'local', localId: catalog.localId } }]));
  const before = await storedValuesAndIndexKeys();
  const controller = new AbortController();
  const get = IDBObjectStore.prototype.get;
  const lookup = vi.spyOn(IDBObjectStore.prototype, 'get').mockImplementation(function (this: IDBObjectStore, key) {
    const request = get.call(this, key);
    if (this.name === 'verbuende') controller.abort();
    return request;
  });
  const result = await store.addDocument(verbund.verbundId, await document('Neues Dokument'), 'imported', [], controller.signal);
  lookup.mockRestore();
  expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_OPERATION_CANCELLED' } });
  expect(await storedValuesAndIndexKeys()).toBe(before);
});
