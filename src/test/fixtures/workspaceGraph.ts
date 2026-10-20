import type { LocalId, VerbundId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import type { OscalRootKey, PinnedOscalVersion } from '@/domain/oscalVersionMatrix';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { makeUuid } from '@/test/fixtures/fixtureUuid';

export function member(rootType: OscalRootKey, id: string, version: PinnedOscalVersion = '1.2.2'): WorkspaceEnvelope {
  const source = makeSchemaValidOscalDocument(rootType, version);
  (source[rootType] as Record<string, unknown>).uuid = makeUuid(id, 0);
  return { localId: id as LocalId, verbundId: 'one' as VerbundId, storageSchemaVersion: 1, rootType, oscalVersion: version,
    trustClass: 'class-2-local-user', documentState: 'imported', createdAt: '2026-10-18T00:00:00Z', savedAt: '2026-10-18T00:00:00Z', source };
}
export function body(document: WorkspaceEnvelope): Record<string, unknown> {
  return (document.source as Record<string, Record<string, unknown>>)[document.rootType];
}
export function bind(from: WorkspaceEnvelope, pointer: string, to: WorkspaceEnvelope): WorkspaceBinding {
  let href: unknown = from.source;
  for (const key of pointer.slice(1).split('/')) href = (href as Record<string, unknown>)[key];
  return { fromLocalId: from.localId, pointer, href: href as string, target: { kind: 'local', localId: to.localId } };
}
