import { describe, expect, it } from 'vitest';
import { processClass2OscalBytes, type Class2OscalImportedDocument } from '@/domain/oscalClass2Import';
import { createOscalDerivedGraph, type DerivedGraphValue } from '@/domain/oscalDerivedGraph';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import type { LocalId, VerbundId, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { encodeOscalSource, OscalSourceDecoder } from '@/domain/oscalImportTransport';
import { checkWorkspaceMembership } from '@/domain/workspaceMembership';

const verbundId = 'workspace-a' as VerbundId;
const localId = 'member-a' as LocalId;
const context = { trustClass: 'class-2-local-user' as const };
async function imported(root: OscalRootKey): Promise<Class2OscalImportedDocument> {
  const result = await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(makeSchemaValidOscalDocument(root, '1.2.2'))), context);
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.document;
}
function member(document: Class2OscalImportedDocument, overrides: Partial<WorkspaceEnvelope> = {}): WorkspaceEnvelope {
  return { ...document, localId, verbundId, trustClass: context.trustClass, storageSchemaVersion: 1,
    documentState: 'imported', createdAt: '2026-10-18T00:00:00Z', savedAt: '2026-10-18T00:00:00Z', ...overrides };
}
function derived(value: unknown): unknown {
  const builder = createOscalDerivedGraph();
  function rebuild(item: unknown): DerivedGraphValue {
    if (Array.isArray(item)) {
      const handle = builder.array();
      for (const element of item) builder.pushArrayItem(handle, rebuild(element));
      return handle;
    }
    if (item !== null && typeof item === 'object') {
      const handle = builder.object();
      for (const [key, field] of Object.entries(item)) builder.setObjectMember(handle, key, rebuild(field));
      return handle;
    }
    return item as DerivedGraphValue;
  }
  return builder.finishRoot(rebuild(value) as Parameters<typeof builder.finishRoot>[0]);
}

describe('checkWorkspaceMembership', () => {
  it.each<OscalRootKey>(['catalog', 'profile', 'component-definition', 'system-security-plan', 'assessment-plan', 'assessment-results', 'plan-of-action-and-milestones'])('admits %s without changing source', async root => {
    const document = await imported(root);
    const before = JSON.stringify(document);
    expect(await checkWorkspaceMembership({ document, members: [], verbundId })).toEqual({ ok: true });
    expect(JSON.stringify(document)).toBe(before);
  });
  it('rejects mapping collections with a dedicated structural diagnostic', async () => {
    const document = await imported('mapping-collection');
    expect(await checkWorkspaceMembership({ document, members: [], verbundId })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_MEMBERSHIP_ROOT_REJECTED', path: '/mapping-collection' } });
  });
  it.each<OscalRootKey>(['profile', 'system-security-plan'])('offers explicit replacement of duplicate %s outside the diagnostic', async root => {
    const document = await imported(root);
    const result = await checkWorkspaceMembership({ document, members: [member(document)], verbundId });
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_ROOT_UUID_DUPLICATE' }, existingLocalId: localId, action: 'replace' });
    if (!result.ok) expect(JSON.stringify(result.diagnostic)).not.toContain(localId);
    expect(await checkWorkspaceMembership({ document, members: [member(document)], verbundId, replacingLocalId: localId })).toEqual({ ok: true });
  });
  it('scopes duplicates to a verbund and excludes only the explicitly replaced member', async () => {
    const document = await imported('profile');
    expect(await checkWorkspaceMembership({ document, members: [member(document, { verbundId: 'other' as VerbundId })], verbundId })).toEqual({ ok: true });
    expect(await checkWorkspaceMembership({ document, members: [member(document)], verbundId, replacingLocalId: 'different' as LocalId })).toMatchObject({ ok: false });
  });
  it('keeps membership identity when authoring changes the root UUID', async () => {
    const document = await imported('profile');
    const source = makeSchemaValidOscalDocument('profile', '1.2.2');
    (source.profile as Record<string, unknown>).uuid = '99999999-9999-4999-8999-999999999999';
    const changed = { ...document, source: derived(source) };
    expect(await checkWorkspaceMembership({ document: changed, members: [member(document)], verbundId, replacingLocalId: localId })).toEqual({ ok: true });
  });
  it('reimports transported sources and rejects malformed sources or wrapper metadata mismatches', async () => {
    const document = await imported('profile');
    const decoder = new OscalSourceDecoder();
    for (const operations of encodeOscalSource(document.source)) decoder.accept(operations);
    expect(await checkWorkspaceMembership({ document: { ...document, source: decoder.finish() }, members: [], verbundId })).toEqual({ ok: true });
    expect(await checkWorkspaceMembership({ document: { ...document, source: { profile: undefined } }, members: [], verbundId })).toMatchObject({ ok: false });
    expect(await checkWorkspaceMembership({ document: { ...document, rootType: 'catalog' }, members: [], verbundId })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DOCUMENT_INVALID' } });
    expect(await checkWorkspaceMembership({ document: { ...document, oscalVersion: '1.1.3' }, members: [], verbundId })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_DOCUMENT_INVALID' } });
  });
  it('rejects wrong trust and schema-invalid documents with redacted diagnostics', async () => {
    const document = await imported('profile');
    const wrongTrust = { ...document, context: { trustClass: 'class-1-verified-public' } } as unknown as Class2OscalImportedDocument;
    expect(await checkWorkspaceMembership({ document: wrongTrust, members: [], verbundId })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_TRUST_CLASS_REJECTED' } });
    const source = makeSchemaValidOscalDocument('profile', '1.2.2');
    const body = source.profile as Record<string, unknown>;
    body.uuid = 'PRIVATE_SENTINEL';
    const result = await checkWorkspaceMembership({ document: { ...document, source }, members: [], verbundId });
    expect(result).toMatchObject({ ok: false, diagnostic: { stage: 'json-schema' } });
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
  });
  it('does not mutate contextual envelopes or use absent roots as identity', async () => {
    const document = await imported('profile');
    const members = [member(document, { source: null }), member(document, { source: { profile: null } })];
    const before = JSON.stringify(members);
    expect(await checkWorkspaceMembership({ document, members, verbundId })).toEqual({ ok: true });
    expect(JSON.stringify(members)).toBe(before);
  });

  it('rejects absent or foreign replacement targets and missing context', async () => {
    const document = await imported('profile');
    for (const members of [[], [member(document, { verbundId: 'foreign' as VerbundId })]]) {
      expect(await checkWorkspaceMembership({ document, members, verbundId, replacingLocalId: localId })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_REPLACEMENT_TARGET_INVALID' } });
    }
    const missingContext = { ...document, context: undefined } as unknown as Class2OscalImportedDocument;
    expect(await checkWorkspaceMembership({ document: missingContext, members: [], verbundId })).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_TRUST_CLASS_REJECTED' } });
  });

  it.each([
    ['profile', '1.2.2'], ['profile', 'v1.2.2'],
    ['system-security-plan', '1.2.2'], ['system-security-plan', 'v1.2.2'],
  ] as const)('matches %s root UUID case with declared version %s without rewriting source', async (root, version) => {
    const uuid = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    for (const incomingUppercase of [false, true]) {
      const source = makeSchemaValidOscalDocument(root, '1.2.2');
      (source[root] as Record<string, unknown>).uuid = incomingUppercase ? uuid.toUpperCase() : uuid;
      ((source[root] as Record<string, unknown>).metadata as Record<string, unknown>)['oscal-version'] = version;
      const result = await processClass2OscalBytes(new TextEncoder().encode(JSON.stringify(source)), context);
      if (!result.ok) throw new Error(result.diagnostic.code);
      const existingSource = makeSchemaValidOscalDocument(root, '1.2.2');
      (existingSource[root] as Record<string, unknown>).uuid = incomingUppercase ? uuid : uuid.toUpperCase();
      const existing = member(result.document, { source: existingSource });
      const before = JSON.stringify([result.document, existing]);
      expect(await checkWorkspaceMembership({ document: result.document, members: [existing], verbundId })).toMatchObject({ ok: false, existingLocalId: localId, action: 'replace', diagnostic: { code: 'WORKSPACE_ROOT_UUID_DUPLICATE' } });
      expect(JSON.stringify([result.document, existing])).toBe(before);
    }
  });

});
