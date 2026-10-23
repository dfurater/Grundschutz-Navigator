// @vitest-environment node
import 'fake-indexeddb/auto';
import { expect, it, vi } from 'vitest';
import { makeFullSsp } from '@/test/fixtures/systemSecurityPlans';
import { removeSspItem } from '@/domain/sspAuthoring';
import { targetDeletionUses } from '@/domain/sspTargetDeletion';
import { open, value } from '@/test/browser/workspaceStoreFixtures';

vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});

const input = (source: unknown, rootType = 'system-security-plan') => ({ source, rootType, oscalVersion: '1.2.2', context: { trustClass: 'class-2-local-user' } }) as const;

it('prüft nach der Vorprüfung hinzugekommene Bindungen in der Save-Transaktion und erhält Quelle/Entwurf', async () => {
  const store = await open();
  const v = value(await store.createVerbund('Synthetisch'));
  const original = JSON.parse(JSON.stringify(makeFullSsp()));
  const ssp = value(await store.addDocument(v.verbundId, input(original) as never, 'draft'));
  const path = ['system-characteristics', 'system-information', 'information-types'];
  expect(targetDeletionUses(original, [...path, 0], ssp.localId, [], [])).toEqual([]);
  const next = removeSspItem(original, path, 0);
  const draft = value(await store.autosaveDraft(ssp.localId, ssp.savedAt, null, next));
  const ap = { 'assessment-plan': { uuid: 'aaaaaaaa-0000-4000-8000-000000000001', metadata: { title: 'AP', version: '1', 'last-modified': '2026-10-23T00:00:00Z', 'oscal-version': '1.2.2' }, 'import-ssp': { href: '#ssp' } } };
  const ref = value(await store.addDocument(v.verbundId, input(ap, 'assessment-plan') as never, 'draft'));
  value(await store.setBinding({ fromLocalId: ref.localId, pointer: '/assessment-plan/import-ssp/href', href: '#ssp', target: { kind: 'local', localId: ssp.localId } }, ref.savedAt));
  const current = value(await store.getDocument(ssp.localId))!;
  expect(await store.saveDocument(ssp.localId, current.savedAt, draft.savedAt, input(next) as never, undefined, 'draft')).toMatchObject({ ok: false, diagnostic: { code: 'SSP_TARGET_DELETE_BLOCKED' } });
  expect(value(await store.getDocument(ssp.localId))!.source).toEqual(original);
  expect(value(await store.getDraft(ssp.localId))!.source).toEqual(next);
});
