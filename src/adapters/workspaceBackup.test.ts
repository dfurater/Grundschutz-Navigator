// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/adapters/oscalImportGate', async () => {
  const { processClass2OscalBytes } = await import('@/domain/oscalClass2Import');
  return { importClass2OscalDocument: processClass2OscalBytes };
});
import { processWorkspaceBackupBytes as parseWorkspaceBackup } from './workspaceBackupProcessing';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import type { WorkspaceBackup } from '@/domain/workspaceModel';
const id = '11111111-1111-4111-8111-111111111111';
const localId = '22222222-2222-4222-8222-222222222222';
const timestamp = '2026-10-16T12:00:00.000Z';
export function backupFixture(): WorkspaceBackup {
  return { format: 'gspp-workspace', storageSchemaVersion: 1,
    verbuende: [{ verbundId: id, name: 'Test', createdAt: timestamp, savedAt: timestamp }],
    documents: [{ localId, verbundId: id, storageSchemaVersion: 1, rootType: 'catalog', oscalVersion: '1.1.3', trustClass: 'class-2-local-user', documentState: 'imported', createdAt: timestamp, savedAt: timestamp, source: makeSchemaValidOscalDocument('catalog', '1.1.3') }],
    drafts: [{ localId, savedAt: timestamp, source: { incomplete: true } }], bindings: [],
    workspaceMeta: [{ id: 'workspace', storageSchemaVersion: 1, createdAt: timestamp, savedAt: timestamp }] };
}
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
describe('workspace backup validation', () => {
  it('retains valid OSCAL source and incomplete drafts', async () => {
    const backup = backupFixture();
    expect(await parseWorkspaceBackup(encode(backup))).toEqual({ ok: true, value: backup });
  });
  it.each([
    (b: WorkspaceBackup) => ({ ...b, extra: 'secret' }),
    (b: WorkspaceBackup) => ({ ...b, storageSchemaVersion: 2 }),
    (b: WorkspaceBackup) => ({ ...b, documents: [...b.documents, b.documents[0]] }),
    (b: WorkspaceBackup) => ({ ...b, documents: [{ ...b.documents[0], localId: 'secret' }] }),
    (b: WorkspaceBackup) => ({ ...b, documents: [{ ...b.documents[0], trustClass: 'class-1-verified-public' }] }),
    (b: WorkspaceBackup) => ({ ...b, documents: [{ ...b.documents[0], oscalVersion: '1.2.0' }] }),
    (b: WorkspaceBackup) => ({ ...b, documents: [{ ...b.documents[0], source: { catalog: {} } }] }),
    (b: WorkspaceBackup) => ({ ...b, drafts: [{ localId: id, savedAt: timestamp, source: {} }] }),
    (b: WorkspaceBackup) => ({ ...b, verbuende: [] }),
    (b: WorkspaceBackup) => ({ ...b, bindings: [{ fromLocalId: localId, pointer: '/catalog', href: 'secret', target: { kind: 'local', localId: id } }] }),
    (b: WorkspaceBackup) => ({ ...b, bindings: [{ fromLocalId: localId, pointer: '/catalog', href: 'secret', target: { kind: 'class-1', artifactKey: 'invalid/key' } }] }),
    (b: WorkspaceBackup) => ({ ...b, workspaceMeta: [] }),
  ])('rejects malformed closed structures with redacted diagnostics %#', async mutate => {
    const result = await parseWorkspaceBackup(encode(mutate(backupFixture())));
    expect(result).toMatchObject({ ok: false, diagnostic: { stage: 'domain', path: '/', validator: { name: 'gspp-workspace', version: '1' } } });
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it.each(['{"format":"gspp-workspace","format":"secret"}', '{', '['.repeat(65) + '0' + ']'.repeat(65)])('rejects duplicate, malformed and deep JSON', async text => {
    expect(await parseWorkspaceBackup(new TextEncoder().encode(text))).toMatchObject({ ok: false });
  });
  it('rejects invalid UTF8', async () => expect(await parseWorkspaceBackup(new Uint8Array([255]))).toMatchObject({ ok: false }));
});

it('rejects an aggregate node limit violation in an incomplete draft', async () => {
  const backup = backupFixture();
  backup.drafts[0] = { ...backup.drafts[0], source: Array(1_000_001).fill(null) };
  expect(await parseWorkspaceBackup(encode(backup))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_RESOURCE_REJECTED' } });
});
it('rejects cross-verbund bindings', async () => {
  const backup = backupFixture();
  const other = '33333333-3333-4333-8333-333333333333';
  backup.verbuende.push({ ...backup.verbuende[0], verbundId: other });
  backup.documents.push({ ...backup.documents[0], localId: other, verbundId: other });
  backup.bindings.push({ fromLocalId: localId, pointer: '/catalog', href: 'secret', target: { kind: 'local', localId: other } });
  expect(await parseWorkspaceBackup(encode(backup))).toMatchObject({ ok: false });
});
it('accepts supported registry bindings and rejects duplicate binding keys', async () => {
  const { SOURCE_REGISTRY } = await import('@/domain/sourceRegistry');
  const artifactKey = SOURCE_REGISTRY.find(entry => entry.lifecycle === 'supported')!.artifactKey;
  const backup = backupFixture();
  backup.bindings.push({ fromLocalId: localId, pointer: '/catalog', href: 'unchanged', target: { kind: 'class-1', artifactKey } });
  expect(await parseWorkspaceBackup(encode(backup))).toMatchObject({ ok: true });
  backup.bindings.push(backup.bindings[0]);
  expect(await parseWorkspaceBackup(encode(backup))).toMatchObject({ ok: false });
});
it('keeps backup parsing separate from OSCAL byte-policy provenance', async () => {
  const { parseWorkspaceBackupInput, parseClass2OscalInput, isParserProducedRoot } = await import('@/domain/oscalImportProcessing');
  const { CLASS_2_IMPORT_LIMITS, WORKSPACE_BACKUP_MAX_BYTES } = await import('@/domain/class2ImportLimits.mjs');
  const parsed = parseWorkspaceBackupInput(encode({ payload: 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes) }));
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(isParserProducedRoot(parsed.source as object)).toBe(false);
  expect(parseClass2OscalInput(new Uint8Array(CLASS_2_IMPORT_LIMITS.maxBytes + 1)).ok).toBe(false);
  expect(await parseWorkspaceBackup(new Uint8Array(WORKSPACE_BACKUP_MAX_BYTES + 1))).toMatchObject({ ok: false });
});
it('applies the per-source byte cap to restored incomplete drafts', async () => {
  const { CLASS_2_IMPORT_LIMITS } = await import('@/domain/class2ImportLimits.mjs');
  const backup = backupFixture();
  backup.drafts[0] = { ...backup.drafts[0], source: { text: 'x'.repeat(CLASS_2_IMPORT_LIMITS.maxBytes) } };
  expect(await parseWorkspaceBackup(encode(backup))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_RESOURCE_REJECTED', path: '/' } });
});
it('applies decoded base64 limits to restored incomplete draft sources', async () => {
  const { CLASS_2_IMPORT_LIMITS } = await import('@/domain/class2ImportLimits.mjs');
  const backup = backupFixture();
  backup.drafts[0] = { ...backup.drafts[0], source: { catalog: { 'back-matter': { resources: [{ base64: { value: 'AAAA'.repeat(Math.floor(CLASS_2_IMPORT_LIMITS.maxDecodedBase64Bytes / 3) + 1) } }] } } } };
  expect(await parseWorkspaceBackup(encode(backup))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_RESOURCE_REJECTED', path: '/' } });
});
it('rejects raw numeric overflow in incomplete restored drafts', async () => {
  const backup = backupFixture();
  backup.drafts[0] = { ...backup.drafts[0], source: { value: 'NUMERIC_OVERFLOW_PLACEHOLDER' } };
  const raw = JSON.stringify(backup).replace('"NUMERIC_OVERFLOW_PLACEHOLDER"', '1e400');
  expect(await parseWorkspaceBackup(new TextEncoder().encode(raw))).toMatchObject({ ok: false, diagnostic: { code: 'WORKSPACE_BACKUP_INPUT_REJECTED', path: '/' } });
});
