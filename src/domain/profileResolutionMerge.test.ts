import { describe, expect, it } from 'vitest';
import {
  applyCombine,
  buildAsIsGroups,
  buildFlatControls,
  type ControlInclusion,
} from './profileResolutionMerge';

function control(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, class: 'SP800-53', title: id.toUpperCase(), ...extra };
}

function inclusion(
  documentKey: string,
  ...ids: string[]
): ControlInclusion {
  return {
    documentKey,
    controls: ids.map((id) => control(id)),
  };
}

describe('combine', () => {
  it('use-first behält die erste Definition und verwirft spätere Kollisionen', () => {
    const first = control('ac-1', { title: 'ERSTE' });
    const second = control('ac-1', { title: 'ZWEITE' });
    const result = applyCombine(
      [
        { documentKey: 'doc-a', controls: [first] },
        { documentKey: 'doc-b', controls: [second] },
      ],
      'use-first',
    );

    expect([...result.clashes].sort()).toEqual([]);
    expect(result.controls.get('ac-1')).toBe(first);
    expect(result.order).toEqual(['ac-1']);
  });

  it('keep behält beide Kollisionen und meldet sie', () => {
    const result = applyCombine(
      [
        inclusion('doc-a', 'ac-1'),
        inclusion('doc-b', 'ac-1'),
      ],
      'keep',
    );

    expect(result.clashes).toEqual(['ac-1']);
    expect(result.order).toEqual(['ac-1', 'ac-1']);
  });

  it('ohne Kollision bleiben alle Controls in Erscheinungsreihenfolge', () => {
    const result = applyCombine([inclusion('doc-a', 'b-1', 'a-1')], 'use-first');

    expect(result.order).toEqual(['b-1', 'a-1']);
    expect(result.clashes).toEqual([]);
  });
});

describe('flat-Struktur', () => {
  it('gibt die kombinierten Controls flach aus', () => {
    const combined = applyCombine([inclusion('doc-a', 'ac-1', 'bc-1')], 'use-first');
    const body = buildFlatControls(combined);

    expect(body['controls']).toHaveLength(2);
    expect((body['controls'] as unknown[]).map((c) => (c as Record<string, unknown>)['id'])).toEqual([
      'ac-1',
      'bc-1',
    ]);
  });
});

describe('as-is-Struktur', () => {
  const sourceGroup = {
    id: 'group-a',
    class: 'family',
    title: 'Gruppe A',
    props: [{ name: 'status', value: 'ready' }],
    controls: [control('ac-1'), control('ac-drop')],
    groups: [],
  };

  it('hält Gruppen mit inkludierten Controls samt Non-Control-Kindern, wirft Ausgeschlossene', () => {
    const body = buildAsIsGroups(
      { groups: [sourceGroup], controls: [] },
      new Set(['ac-1']),
    );

    const groups = body['groups'] as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0]!['id']).toBe('group-a');
    expect(groups[0]!['props']).toEqual([{ name: 'status', value: 'ready' }]);
    const controls = groups[0]!['controls'] as Record<string, unknown>[];
    expect(controls.map((c) => c['id'])).toEqual(['ac-1']);
  });

  it('levelt inkludierte Kinder nicht inkludierter Parents hoch', () => {
    const parentWithHiddenChild = {
      id: 'parent-x',
      class: 'family',
      title: 'Parent',
      controls: [
        control('x-drop'),
        {
          ...control('x-keep'),
          controls: [control('x-keep.1')],
        },
      ],
      groups: [],
    };

    const body = buildAsIsGroups(
      { groups: [parentWithHiddenChild], controls: [] },
      new Set(['x-keep.1']),
    );

    // Die Gruppe hält die inkludierte (hochgelevelte) Enkel-Control und
    // erscheint deshalb; das nicht inkludierte Geschwister bleibt weg.
    const groups = body['groups'] as Record<string, unknown>[];
    expect(groups).toHaveLength(1);
    expect(groups[0]!['id']).toBe('parent-x');
    const controls = groups[0]!['controls'] as Record<string, unknown>[];
    expect(controls.map((c) => c['id'])).toEqual(['x-keep.1']);
    expect(body['controls']).toEqual([]);
  });
});
