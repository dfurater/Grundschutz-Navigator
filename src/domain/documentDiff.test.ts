import { describe, expect, it } from 'vitest';
import { diffDocuments } from './documentDiff';

const next = (overrides: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) => ({
  profile: {
    uuid: 'u-1',
    metadata: { title: 'Titel', version: '1.0.0', 'last-modified': '2026-01-01T00:00:00Z', 'oscal-version': '1.1.3', ...metadata },
    ...overrides,
  },
});

const run = (base: unknown, value: unknown, extra: Partial<Parameters<typeof diffDocuments>[0]> = {}) =>
  diffDocuments({ base, next: value, rootType: 'profile', baseSequence: 1, ...extra });

const paths = (value: ReturnType<typeof run>) => value.entries.map(entry => entry.path);

describe('diffDocuments', () => {
  it('reports no entry for an unchanged document', () => {
    expect(run(next(), next())).toEqual({ version: 1, baseSequence: 1, entries: [], truncated: false });
  });

  it('is independent of object key order', () => {
    const reordered = { profile: { metadata: { 'oscal-version': '1.1.3', 'last-modified': '2026-01-01T00:00:00Z', version: '1.0.0', title: 'Titel' }, uuid: 'u-1' } };
    expect(run(next(), reordered).entries).toEqual([]);
  });

  it('marks root uuid and last-modified as write markers without content change', () => {
    const changed = { profile: { uuid: 'u-2', metadata: { title: 'Titel', version: '1.0.0', 'last-modified': '2026-02-02T00:00:00Z', 'oscal-version': '1.1.3' } } };
    const diff = run(next(), changed);
    expect(diff.entries).toEqual([
      { path: '/profile/metadata/last-modified', kind: 'changed', valueKind: 'string', marker: true },
      { path: '/profile/uuid', kind: 'changed', valueKind: 'string', marker: true },
    ]);
  });

  it('carries no raw values and names path, kind and value kind only', () => {
    const diff = run(next(), next({}, { title: 'Neu' }));
    expect(diff.entries).toEqual([{ path: '/profile/metadata/title', kind: 'changed', valueKind: 'string', marker: false }]);
    expect(JSON.stringify(diff.entries)).not.toContain('Neu');
  });

  it('expands added subtrees to leaves and keeps empty containers as leaves', () => {
    const diff = run({ profile: { uuid: 'u-1', metadata: { title: 'Titel', version: '1.0.0', 'last-modified': '2026-01-01T00:00:00Z', 'oscal-version': '1.1.3' } } },
      next({ roles: [{ id: 'r', title: 'Rolle' }], empty: {}, list: [] }));
    expect(paths(diff)).toEqual([
      '/profile/empty',
      '/profile/list',
      '/profile/roles/0/id',
      '/profile/roles/0/title',
    ]);
    expect(diff.entries.find(entry => entry.path === '/profile/empty')?.valueKind).toBe('object');
    expect(diff.entries.find(entry => entry.path === '/profile/list')?.valueKind).toBe('array');
  });

  it('compares arrays by index and reports removals', () => {
    const diff = run(next({ values: ['a', 'b'] }), next({ values: ['a'] }));
    expect(diff.entries).toEqual([{ path: '/profile/values/1', kind: 'removed', valueKind: 'string', marker: false }]);
  });

  it('treats a null base sequence as comparison against the empty document', () => {
    const diff = run({}, next(), { baseSequence: null });
    expect(diff.baseSequence).toBeNull();
    expect(paths(diff)).toContain('/profile/metadata/title');
  });

  it('escapes pointer segments and separates negative zero from zero', () => {
    const diff = run(next({ 'a/b~c': 0 }), next({ 'a/b~c': -0 }));
    expect(diff.entries).toEqual([{ path: '/profile/a~1b~0c', kind: 'changed', valueKind: 'number', marker: false }]);
  });

  it('truncates the entry list at the configured bound', () => {
    const many = Array.from({ length: 5 }, (_, index) => index);
    const diff = run(next({ values: [] }), next({ values: many }), { maxEntries: 3 });
    expect(diff.entries).toHaveLength(3);
    expect(diff.truncated).toBe(true);
  });

  it('truncates on the serialized byte bound', () => {
    const diff = run(next({ values: [] }), next({ values: ['a', 'b', 'c'] }), { maxBytes: 200 });
    expect(diff.entries).toHaveLength(2);
    expect(diff.truncated).toBe(true);
  });

  it('rejects traversal beyond node or depth bounds', () => {
    expect(() => run(next(), next({ values: [1, 2, 3] }), { maxNodes: 2 })).toThrow(new Error('REVIEW_DIFF_LIMIT'));
    expect(() => run(next(), next({ deep: { deeper: { deepest: 1 } } }), { maxDepth: 2 })).toThrow(new Error('REVIEW_DIFF_LIMIT'));
  });

  it('rejects non-JSON values', () => {
    expect(() => run(next(), next({ bad: undefined }))).toThrow(new Error('REVIEW_DIFF_INVALID'));
  });
});
