import { describe, expect, it } from 'vitest';
import { buildWorkspaceCatalog } from '@/domain/workspaceCatalog';

describe('buildWorkspaceCatalog', () => {
  it('indexes arbitrary catalog controls and nested statements without registry metadata or mutation', () => {
    const source = { catalog: { controls: [{ id: 'a', parts: [{ id: 'a.s', parts: [{ id: 'a.s.1' }] }], controls: [{ id: 'b' }] }], groups: [{ groups: [{ controls: [{ id: 'c' }] }] }] } };
    const before = structuredClone(source);
    const result = buildWorkspaceCatalog(source);
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect([...result.catalog.controlsById.keys()]).toEqual(['a', 'b', 'c']);
    expect(result.catalog.controlsById.get('a')).toEqual({ id: 'a', statementIds: ['a.s', 'a.s.1'] });
    expect(source).toEqual(before);
  });

  it('accepts an empty catalog', () => {
    const result = buildWorkspaceCatalog({ catalog: {} });
    expect(result.status === 'success' && result.catalog.controlsById.size).toBe(0);
  });

  it.each([
    { catalog: { controls: [{ id: 'SECRET' }, { id: 'SECRET' }] } },
    { catalog: { controls: [{ id: 'a', controls: [{ id: 'a' }] }] } },
    { catalog: { controls: [{ title: 'SECRET' }] } },
    { catalog: { groups: 'SECRET' } },
    { profile: { title: 'SECRET' } },
  ])('rejects invalid or ambiguous projections with structural diagnostics', (source) => {
    const result = buildWorkspaceCatalog(source);
    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.diagnostics).not.toHaveLength(0);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });
});

describe('workspace catalog structural boundaries', () => {
  it('accepts wide catalogs within the class-2 node limit without call-stack expansion', () => {
    const controls = Array.from({length:150_000}, (_, index) => ({id:`c-${index}`,title:'x'}));
    const result = buildWorkspaceCatalog({catalog:{controls}});
    expect(result.status === 'success' && result.catalog.controlsById.size).toBe(controls.length);
  });
  it('keeps identical statement IDs scoped to their own control', () => {
    const result = buildWorkspaceCatalog({ catalog: { controls: [
      { id: 'a', parts: [{ id: 'same' }] }, { id: 'b', parts: [{ id: 'same' }] },
    ] } });
    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.catalog.controlsById.get('a')?.statementIds).toEqual(['same']);
    expect(result.catalog.controlsById.get('b')?.statementIds).toEqual(['same']);
  });

  it('accepts parts without optional IDs', () => {
    expect(buildWorkspaceCatalog({ catalog: { controls: [{ id: 'a', parts: [{ prose: 'Part without id' }] }] } }).status).toBe('success');
  });

  it.each([
    null,
    { catalog: { controls: [null] } },
    { catalog: { controls: [{ id: '' }] } },
    { catalog: { controls: [{ id: 'a', parts: [{ id: '' }] }] } },
    { catalog: { controls: [{ id: 'a', parts: [{ id: 'same', parts: [{ id: 'same' }] }] }] } },
  ])('handles optional part identities and malformed structural fields', (source) => {
    const result = buildWorkspaceCatalog(source);
    expect(result.status).toBe('failure');
  });
});
