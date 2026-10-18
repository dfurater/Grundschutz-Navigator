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
it('preserves negative zero in roots, arrays and objects without changing strings', () => {
  const source = { values: [-0, 0, { start: -0 }], text: '-0 "value" \\ end' };
  expect(serializeWorkspaceJson(-0)).toBe('-0');
  const restored = JSON.parse(serializeWorkspaceJson(source));
  expect(Object.is(restored.values[0], -0)).toBe(true);
  expect(Object.is(restored.values[1], 0)).toBe(true);
  expect(Object.is(restored.values[2].start, -0)).toBe(true);
  expect(restored.text).toBe(source.text);
});
