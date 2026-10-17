import { expect, it } from 'vitest';
import { serializeWorkspaceJson } from './workspaceJson';
it('preserves finite JSON serialization', () => {
  const value = { value: -12.5, nested: [null, true, 'text', 1e100] };
  expect(serializeWorkspaceJson(value)).toBe(JSON.stringify(value));
});
it.each([Infinity, -Infinity, NaN])('rejects nonfinite nested numeric values %#', value => {
  expect(() => serializeWorkspaceJson({ nested: [{ value }] })).toThrowError(new Error('WORKSPACE_JSON_INVALID'));
});
it('rejects undefined root source with a stable redacted error', () => {
  expect(() => serializeWorkspaceJson(undefined)).toThrowError(new Error('WORKSPACE_JSON_INVALID'));
});
