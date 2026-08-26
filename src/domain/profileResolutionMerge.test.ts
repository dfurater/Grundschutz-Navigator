import { describe, expect, it } from 'vitest';
import type { ProfileControlSelector, ProfileInsertControls } from './profileModel';
import {
  applyCombine,
  buildAsIsGroups,
  buildCustomGroups,
  buildFlatControls,
  type ControlInclusion,
} from './profileResolutionMerge';

function includeAllDirective(order?: string): ProfileInsertControls {
  return {
    ...(order !== undefined && { order }),
    selection: { kind: 'include-all' },
    excludeControls: [],
    path: '/profile/merge/custom/insert-controls',
  };
}

function withIdsSelector(withIds: string[], extra: Partial<ProfileControlSelector> = {}): ProfileControlSelector {
  return { withIds, matching: [], path: '/selector', ...extra };
}

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
    expect(result.controls.get('ac-1')).toEqual([first]);
    expect(result.order).toEqual([first]);
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
    // Beide Definitionen bleiben als Liste je ID erhalten:
    expect(result.controls.get('ac-1')).toHaveLength(2);
    expect(result.order).toHaveLength(2);
  });

  it('ohne Kollision bleiben alle Controls in Erscheinungsreihenfolge', () => {
    const result = applyCombine([inclusion('doc-a', 'b-1', 'a-1')], 'use-first');

    expect(result.order.map((n) => n['id'])).toEqual(['b-1', 'a-1']);
    expect(result.clashes).toEqual([]);
  });
});

describe('flat-Struktur', () => {
  it('gibt die kombinierten Controls flach aus', () => {
    const combined = applyCombine([inclusion('doc-a', 'ac-1', 'bc-1')], 'use-first');
    const body = buildFlatControls(combined);

    const controls = body['controls'] as Record<string, unknown>[];
    expect(controls.map((c) => c['id'])).toEqual(['ac-1', 'bc-1']);
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

describe('custom-Struktur', () => {
  function rawGroup(extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: 'g-1',
      class: 'family',
      title: 'Gruppe 1',
      params: [{ id: 'p1', values: ['v'] }],
      parts: [{ id: 'g-1_part', name: 'overview', prose: 'Text' }],
      ...extra,
    };
  }

  it('include-all ohne order erhält die Pool-Erscheinungsreihenfolge', () => {
    const combined = applyCombine([inclusion('doc-a', 'b-1', 'a-1')], 'use-first');
    const result = buildCustomGroups(
      { rawGroups: [], insertControls: [includeAllDirective()] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toEqual([]);
    expect(result.controls.map((c) => c['id'])).toEqual(['b-1', 'a-1']);
  });

  it.each([
    ['ascending', ['a-1', 'b-1', 'c-1']],
    ['descending', ['c-1', 'b-1', 'a-1']],
  ] as const)('order=%s sortiert nach Control-ID', (order, expected) => {
    const combined = applyCombine([inclusion('doc-a', 'b-1', 'c-1', 'a-1')], 'use-first');
    const result = buildCustomGroups(
      { rawGroups: [], insertControls: [includeAllDirective(order)] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['id'])).toEqual(expected);
  });

  it('kopiert Gruppen exakt, führt ihr insert-controls nicht aus und trägt es nicht fort', () => {
    const group = rawGroup({
      'unbekanntes-mitglied': { tief: [1, 2] },
      'insert-controls': [{ 'include-all': {} }],
      groups: [
        {
          id: 'g-1-1',
          title: 'Kind',
          controls: [],
          'insert-controls': [{ 'include-controls': { 'with-ids': ['a-1'] } }],
        },
      ],
    });
    const combined = applyCombine([inclusion('doc-a', 'a-1')], 'use-first');
    const result = buildCustomGroups({ rawGroups: [group], insertControls: [] }, combined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toEqual({
      id: 'g-1',
      class: 'family',
      title: 'Gruppe 1',
      params: [{ id: 'p1', values: ['v'] }],
      parts: [{ id: 'g-1_part', name: 'overview', prose: 'Text' }],
      'unbekanntes-mitglied': { tief: [1, 2] },
      groups: [{ id: 'g-1-1', title: 'Kind', controls: [] }],
    });
    // Nicht ausgeführte Direktiven erscheinen weder in den Gruppen noch
    // als Root-Controls.
    expect(JSON.stringify(result.groups)).not.toContain('insert-controls');
    expect(result.controls).toEqual([]);
  });

  it('with-ids trifft nur im Pool vorhandene IDs; Ungetroffenes bleibt außen', () => {
    const combined = applyCombine([inclusion('doc-a', 'a-1', 'b-1')], 'use-first');
    const directive: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['a-1', 'zz-9'])],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls',
    };
    const result = buildCustomGroups({ rawGroups: [], insertControls: [directive] }, combined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['id'])).toEqual(['a-1']);
  });

  it('exclude-controls der Anweisung schlagen die Inklusion', () => {
    const combined = applyCombine([inclusion('doc-a', 'a-1', 'b-1')], 'use-first');
    const directive: ProfileInsertControls = {
      selection: { kind: 'include-all' },
      excludeControls: [withIdsSelector(['b-1'])],
      path: '/profile/merge/custom/insert-controls',
    };
    const result = buildCustomGroups({ rawGroups: [], insertControls: [directive] }, combined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['id'])).toEqual(['a-1']);
  });

  it('with-child-controls: yes zieht Nachfahren aus der Pool-Struktur nach', () => {
    const parent = control('p-1', { controls: [control('p-1.1')] });
    const child = control('p-1.1');
    const combined = applyCombine([{ documentKey: 'doc-a', controls: [parent, child] }], 'use-first');
    const directive: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['p-1'], { withChildControls: 'yes' })],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls',
    };
    const result = buildCustomGroups({ rawGroups: [], insertControls: [directive] }, combined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['id'])).toEqual(['p-1', 'p-1.1']);
  });

  it('mehrere Anweisungen wirken kumulativ ohne Doppel-Ausgabe derselben Definition', () => {
    const combined = applyCombine([inclusion('doc-a', 'a-1', 'b-1')], 'use-first');
    const first: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['a-1'])],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls[1]',
    };
    const second: ProfileInsertControls = includeAllDirective();
    const result = buildCustomGroups(
      { rawGroups: [], insertControls: [first, second] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['id'])).toEqual(['a-1', 'b-1']);
  });

  it('combine=keep gibt alle Definitionen einer kollidierenden ID hintereinander aus', () => {
    const combined = applyCombine([inclusion('doc-a', 'ac-1'), inclusion('doc-b', 'ac-1')], 'keep');
    const result = buildCustomGroups(
      { rawGroups: [], insertControls: [includeAllDirective()] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['title'])).toEqual(['AC-1', 'AC-1']);
  });

  it('ein invalider with-child-controls-Wert scheitert fail-closed mit stabiler Diagnose', () => {
    const combined = applyCombine([inclusion('doc-a', 'a-1')], 'use-first');
    const directive: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['a-1'], { withChildControls: 'vielleicht' })],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls',
    };
    const result = buildCustomGroups({ rawGroups: [], insertControls: [directive] }, combined);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.diagnostic.code).toBe('PROFILE_RESOLUTION_WITH_CHILD_CONTROLS_INVALID');
  });

  it('liest Pool und Gruppen ausschließlich über Data-Property-Deskriptoren', () => {
    let poolGetterCalls = 0;
    let groupGetterCalls = 0;
    const pooled = new Proxy(control('a-1'), {
      get(target, key) {
        if (key === 'title') poolGetterCalls += 1;
        return Reflect.get(target, key);
      },
    });
    const group = new Proxy(rawGroup(), {
      get(target, key) {
        if (key === 'title') groupGetterCalls += 1;
        return Reflect.get(target, key);
      },
    });
    const combined = applyCombine([{ documentKey: 'doc-a', controls: [pooled] }], 'use-first');
    const result = buildCustomGroups(
      { rawGroups: [group], insertControls: [includeAllDirective()] },
      combined,
    );

    expect(result.ok).toBe(true);
    expect(poolGetterCalls).toBe(0);
    expect(groupGetterCalls).toBe(0);
    if (!result.ok) return;
    expect(result.controls[0]!['id']).toBe('a-1');
  });
});
