// @vitest-environment node
import { expect, it } from 'vitest';
import { serializeWorkspaceRecoveryJson } from '@/adapters/workspaceRecoveryJson';
import { serializeWorkspaceJson } from '@/domain/workspaceJson';

it('keeps ordinary future JSON bundles byte-identical', () => {
  const backup = { storageSchemaVersion: 2, future: [{ text: 'synthetic', list: [null, true, 1.5] }] };
  expect(serializeWorkspaceRecoveryJson(backup)).toBe(serializeWorkspaceJson(backup));
});

it.each([
  [new Date(0), ['date', '0']],
  [new Uint8Array([0, 255]), ['view', 'Uint8Array', 3, 0, 2]],
  [new Int16Array([1, -2]), ['view', 'Int16Array', 3, 0, 4]],
  [new BigInt64Array([1n, -2n]), ['view', 'BigInt64Array', 3, 0, 16]],
])('encodes a standalone IndexedDB value without changing the strict JSON contract (%#)', (value, node) => {
  const backup = { storageSchemaVersion: 2, value };
  const encoded = JSON.parse(serializeWorkspaceRecoveryJson(backup));
  expect(encoded.payload.nodes[2]).toEqual(node);
  expect(() => serializeWorkspaceJson(backup)).toThrow('WORKSPACE_JSON_INVALID');
});

it('uses references for an otherwise JSON-compatible alias', () => {
  const shared = { synthetic: true };
  const encoded = JSON.parse(serializeWorkspaceRecoveryJson({ storageSchemaVersion: 2, first: shared, second: shared }));
  expect(encoded.payload.nodes[0]).toEqual(['object', [['storageSchemaVersion', 1], ['first', 2], ['second', 2]]]);
});

it('encodes a deep future JSON tree without a call-stack limit', () => {
  let nested: unknown = null;
  for (let depth = 0; depth < 10_000; depth++) nested = { child: nested };
  const encoded = JSON.parse(serializeWorkspaceRecoveryJson({ storageSchemaVersion: 2, nested }));
  expect(encoded.valueEncoding).toBe('gspp-structured-clone-v1');
  expect(encoded.payload.nodes).toHaveLength(10_003);
});
