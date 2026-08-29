import { describe, expect, it } from 'vitest';
import type {
  ProfileControlSelector,
  ProfileGroup,
  ProfileInsertControls,
} from './profileModel';
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
  it('ignoriert Accessor-Slots und Accessor-IDs in den Inklusionen', () => {
    const controls: Record<string, unknown>[] = [];
    Object.defineProperty(controls, 0, {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('controls-slot getter must not run');
      },
    });

    const accessorId = control('ignored');
    Object.defineProperty(accessorId, 'id', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('id getter must not run');
      },
    });
    controls.push(accessorId);

    expect(() => applyCombine([{ documentKey: 'doc-a', controls }], 'use-first')).not.toThrow();
    expect(applyCombine([{ documentKey: 'doc-a', controls }], 'use-first').order).toEqual([]);
  });

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

  it('kopiert nur eigene Data-Properties und führt keine Control-Getter aus', () => {
    const source = control('ac-1');
    Object.defineProperty(source, 'title', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('title getter must not run');
      },
    });
    const combined = applyCombine([{ documentKey: 'doc-a', controls: [source] }], 'use-first');

    expect(() => buildFlatControls(combined)).not.toThrow();
    expect((buildFlatControls(combined)['controls'] as Record<string, unknown>[])[0]).toEqual({
      id: 'ac-1',
      class: 'SP800-53',
    });
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

  it('hält hochgelevelte Controls an der Quellposition ihres Ahnen', () => {
    const body = buildAsIsGroups(
      {
        controls: [
          control('direct-before'),
          {
            ...control('excluded-parent'),
            controls: [control('promoted-child')],
          },
          control('direct-after'),
        ],
      },
      new Set(['direct-before', 'promoted-child', 'direct-after']),
    );

    const controls = body['controls'] as Record<string, unknown>[];
    expect(controls.map((candidate) => candidate['id'])).toEqual([
      'direct-before',
      'promoted-child',
      'direct-after',
    ]);
  });

  it('führt beim Kopieren inkludierter Controls keine Getter aus', () => {
    const selected = control('ac-1');
    Object.defineProperty(selected, 'title', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('title getter must not run');
      },
    });

    expect(() => buildAsIsGroups(
      { groups: [], controls: [selected] },
      new Set(['ac-1']),
    )).not.toThrow();
  });

  it('bricht zyklische Control-Kanten kontrolliert ab', () => {
    const selected = control('cycle-1');
    selected['controls'] = [selected];

    const body = buildAsIsGroups(
      { groups: [], controls: [selected] },
      new Set(['cycle-1']),
    );

    expect(body).toEqual({
      groups: [],
      controls: [control('cycle-1')],
    });
  });

  it('läuft bei einem zyklischen ausgeschlossenen Control-Zweig nicht über', () => {
    const excluded = control('cycle-drop');
    excluded['controls'] = [excluded];

    expect(buildAsIsGroups(
      { groups: [], controls: [excluded] },
      new Set(['nicht-vorhanden']),
    )).toEqual({ groups: [], controls: [] });
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
      { rawGroups: [], typedGroups: [], insertControls: [includeAllDirective()] },
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
      { rawGroups: [], typedGroups: [], insertControls: [includeAllDirective(order)] },
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
    const result = buildCustomGroups({ rawGroups: [group], typedGroups: [], insertControls: [] }, combined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.groups).toHaveLength(1);
    // Gruppen ohne eigenes props-Mitglied erhalten den Label-Träger aus
    // ihrer ID — auch verschachtelt.
    expect(result.groups[0]).toEqual({
      id: 'g-1',
      class: 'family',
      title: 'Gruppe 1',
      params: [{ id: 'p1', values: ['v'] }],
      parts: [{ id: 'g-1_part', name: 'overview', prose: 'Text' }],
      'unbekanntes-mitglied': { tief: [1, 2] },
      props: [{ name: 'label', value: 'g-1' }],
      groups: [{
        id: 'g-1-1',
        title: 'Kind',
        controls: [],
        props: [{ name: 'label', value: 'g-1-1' }],
      }],
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
    const result = buildCustomGroups({ rawGroups: [], typedGroups: [], insertControls: [directive] }, combined);

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
    const result = buildCustomGroups({ rawGroups: [], typedGroups: [], insertControls: [directive] }, combined);

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
    const result = buildCustomGroups({ rawGroups: [], typedGroups: [], insertControls: [directive] }, combined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['id'])).toEqual(['p-1', 'p-1.1']);
  });

  it('Nachfahren ohne eigenen Pool-Bucket stecken im Vorfahren und werden nicht doppelt ausgegeben', () => {
    // Das Kind existiert nur innerhalb der Parent-Definition (Phase 1 hat
    // es nicht einzeln selektiert); die Erweiterung auf p-1.1 darf den
    // Inhalt deshalb nicht ein zweites Mal ausgeben.
    const parent = control('q-1', { controls: [control('q-1.1')] });
    const combined = applyCombine([{ documentKey: 'doc-a', controls: [parent] }], 'use-first');
    const directive: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['q-1'], { withChildControls: 'yes' })],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls',
    };
    const result = buildCustomGroups({ rawGroups: [], typedGroups: [], insertControls: [directive] }, combined);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls).toHaveLength(1);
    expect(result.controls[0]!['id']).toBe('q-1');
  });

  it('gibt eine direkt selektierte, nur verschachtelt vorhandene Control eigenständig aus', () => {
    const child = control('q-2.1');
    const parent = control('q-2', { controls: [child] });
    const combined = applyCombine([{ documentKey: 'doc-a', controls: [parent] }], 'use-first');
    const directive: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['q-2.1'])],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls',
    };

    const result = buildCustomGroups(
      { rawGroups: [], typedGroups: [], insertControls: [directive] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls).toEqual([child]);
  });

  it('ersetzt ein zuerst einzeln ausgegebenes Nested-only-Kind durch den späteren Vorfahren', () => {
    const child = control('q-3.1');
    const parent = control('q-3', { controls: [child] });
    const combined = applyCombine([{ documentKey: 'doc-a', controls: [parent] }], 'use-first');
    const childDirective: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['q-3.1'])],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls[0]',
    };
    const parentDirective: ProfileInsertControls = {
      selection: {
        kind: 'include-controls',
        includeControls: [withIdsSelector(['q-3'])],
      },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls[1]',
    };

    const result = buildCustomGroups(
      {
        rawGroups: [],
        typedGroups: [],
        insertControls: [childDirective, parentDirective],
      },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls).toEqual([parent]);
  });

  it.each([
    ['Kind vor Vorfahr', ['q-4.1.1', 'q-4.1']],
    ['Vorfahr vor Kind', ['q-4.1', 'q-4.1.1']],
  ] as const)(
    'gibt bei einem nur verschachtelt vorhandenen Vorfahren keine doppelten Nachfahren aus: %s',
    (_label, selectedIds) => {
      const leaf = control('q-4.1.1');
      const middle = control('q-4.1', { controls: [leaf] });
      const parent = control('q-4', { controls: [middle] });
      const combined = applyCombine([{ documentKey: 'doc-a', controls: [parent] }], 'use-first');
      const directives = selectedIds.map((id, index): ProfileInsertControls => ({
        selection: {
          kind: 'include-controls',
          includeControls: [withIdsSelector([id])],
        },
        excludeControls: [],
        path: `/profile/merge/custom/insert-controls[${index}]`,
      }));

      const result = buildCustomGroups(
        { rawGroups: [], typedGroups: [], insertControls: directives },
        combined,
      );

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.controls).toEqual([middle]);
    },
  );

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
      { rawGroups: [], typedGroups: [], insertControls: [first, second] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.controls.map((c) => c['id'])).toEqual(['a-1', 'b-1']);
  });

  it('combine=keep gibt alle Definitionen einer kollidierenden ID hintereinander aus', () => {
    const combined = applyCombine([inclusion('doc-a', 'ac-1'), inclusion('doc-b', 'ac-1')], 'keep');
    const result = buildCustomGroups(
      { rawGroups: [], typedGroups: [], insertControls: [includeAllDirective()] },
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
    const result = buildCustomGroups({ rawGroups: [], typedGroups: [], insertControls: [directive] }, combined);

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
      { rawGroups: [group], typedGroups: [], insertControls: [includeAllDirective()] },
      combined,
    );

    expect(result.ok).toBe(true);
    expect(poolGetterCalls).toBe(0);
    expect(groupGetterCalls).toBe(0);
    if (!result.ok) return;
    expect(result.controls[0]!['id']).toBe('a-1');
  });

  it('führt Accessoren in projizierten Custom-Gruppen nicht aus', () => {
    const combined = applyCombine([inclusion('doc-a', 'a-1')], 'use-first');
    const idAccessorGroup = {} as Record<string, unknown>;
    Object.defineProperty(idAccessorGroup, 'id', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('typed group id getter must not run');
      },
    });
    const directiveAccessorGroup = { id: 'g-1' } as Record<string, unknown>;
    Object.defineProperty(directiveAccessorGroup, 'insertControls', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('typed group insertControls getter must not run');
      },
    });

    for (const typedGroup of [idAccessorGroup, directiveAccessorGroup]) {
      expect(() => buildCustomGroups(
        {
          rawGroups: [rawGroup()],
          typedGroups: [typedGroup as unknown as ProfileGroup],
          insertControls: [],
        },
        combined,
      )).not.toThrow();
    }
  });

  it('führt Accessoren in Root-insert-controls nicht aus', () => {
    const combined = applyCombine([inclusion('doc-a', 'a-1')], 'use-first');
    const selectionAccessor = { excludeControls: [] } as Record<string, unknown>;
    Object.defineProperty(selectionAccessor, 'selection', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('directive selection getter must not run');
      },
    });
    const excludeAccessor = { selection: { kind: 'include-all' } } as Record<string, unknown>;
    Object.defineProperty(excludeAccessor, 'excludeControls', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('directive excludeControls getter must not run');
      },
    });

    const invalidSelection = buildCustomGroups(
      {
        rawGroups: [],
        typedGroups: [],
        insertControls: [selectionAccessor as unknown as ProfileInsertControls],
      },
      combined,
    );
    expect(invalidSelection.ok).toBe(false);
    if (!invalidSelection.ok) {
      expect(invalidSelection.diagnostic.code).toBe('PROFILE_RESOLUTION_SELECTION_INVALID');
    }
    const excluded = buildCustomGroups(
      {
        rawGroups: [],
        typedGroups: [],
        insertControls: [excludeAccessor as unknown as ProfileInsertControls],
      },
      combined,
    );
    expect(excluded.ok).toBe(true);
    if (!excluded.ok) return;
    expect(excluded.controls.map((node) => node['id'])).toEqual(['a-1']);
  });
});

describe('custom-Struktur: Pruning nicht selektierter Nachfahren (GSPP-377)', () => {
  function withIdsDirective(ids: string[]): ProfileInsertControls {
    return {
      selection: { kind: 'include-controls', includeControls: [withIdsSelector(ids)] },
      excludeControls: [],
      path: '/profile/merge/custom/insert-controls',
    };
  }

  /** IDs der verschachtelten Kinder, mit denen `a-1` platziert wurde. */
  function placedChildIdsOf(
    inclusionControls: Record<string, unknown>[],
    selectedIds: string[],
  ): string[] {
    const combined = applyCombine(
      [{ documentKey: 'doc-a', controls: inclusionControls }],
      'use-first',
    );
    const result = buildCustomGroups(
      { rawGroups: [], typedGroups: [], insertControls: [withIdsDirective(selectedIds)] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return [];
    const placed = result.controls.find((c) => c['id'] === 'a-1');
    return ((placed?.['controls'] ?? []) as Record<string, unknown>[])
      .map((c) => String(c['id']));
  }

  function separatedPlacementChildIds(
    rootIds: string[],
    groupIds: string[][],
  ): { root: unknown[]; groups: unknown[][] } {
    const parent = control('a-1', { controls: [control('a-1-1'), control('a-1-2')] });
    const combined = applyCombine([{ documentKey: 'doc-a', controls: [parent] }], 'use-first');
    const result = buildCustomGroups(
      {
        rawGroups: groupIds.map((_, index) => ({
          id: `g-${index + 1}`,
          title: `Gruppe ${index + 1}`,
        })),
        typedGroups: groupIds.map((ids, index) => ({
          id: `g-${index + 1}`,
          insertControls: [withIdsDirective(ids)],
          groups: [], params: [], props: [], links: [], parts: [],
          path: `/profile/merge/custom/groups[${index}]`,
        })),
        insertControls: rootIds.length > 0 ? [withIdsDirective(rootIds)] : [],
      },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return { root: [], groups: [] };
    const childIdsOf = (controls: readonly Record<string, unknown>[]) => {
      const placed = controls.find((candidate) => candidate['id'] === 'a-1');
      return ((placed?.['controls'] ?? []) as Record<string, unknown>[])
        .map((child) => child['id']);
    };
    return {
      root: childIdsOf(result.controls),
      groups: result.groups.map((group) => childIdsOf(
        ((group as Record<string, unknown>)['controls'] ?? []) as Record<string, unknown>[],
      )),
    };
  }

  it('entfernt ein nicht selektiertes verschachteltes Kind aus der Definition', () => {
    // Der reale BSI-Fall: Das WLAN-Profil führt ARCH.2.2 und elf seiner zwölf
    // Kernel-Kinder einzeln in with-ids, ARCH.2.2.12 aber nicht. Bis GSPP-377
    // übernahm die Assemblierung die Elterndefinition unverändert und lieferte
    // das zwölfte Kind mit — der aufgelöste Katalog hatte eine Control zu viel.
    const parent = control('a-1', { controls: [control('a-1-1'), control('a-1-2')] });

    expect(placedChildIdsOf([parent, control('a-1-1')], ['a-1', 'a-1-1']))
      .toEqual(['a-1-1']);
  });

  it('zieht den selektierten Enkel hoch, wenn die Zwischenebene nicht selektiert ist', () => {
    const parent = control('a-1', {
      controls: [control('a-1-1', { controls: [control('a-1-1-1')] })],
    });

    expect(placedChildIdsOf([parent], ['a-1', 'a-1-1-1'])).toEqual(['a-1-1-1']);
  });

  it('bindet die Auswahl an die gewinnende Importinstanz, wenn derselbe Knoten mehrfach importiert wird', () => {
    // Importiert ein Profil denselben href zweimal mit unterschiedlichen
    // include-controls, liefert Phase 1 in beiden Inklusionen DASSELBE
    // Knotenobjekt; als Map-Schlüssel fällt es zusammen. Bei use-first gewinnt
    // die erste Instanz — ihre Auswahl prunt, nicht die der zweiten und auch
    // nicht deren Vereinigung. Das nur später selektierte Kind geht dabei
    // nicht verloren: Es ist dort als eigener Knoten registriert und erscheint
    // eigenständig.
    const parent = control('a-1', { controls: [control('a-1-1'), control('a-1-2')] });
    const combined = applyCombine(
      [
        { documentKey: 'doc-a', controls: [parent, control('a-1-1')] },
        { documentKey: 'doc-a', controls: [parent, control('a-1-2')] },
      ],
      'use-first',
    );

    // Nur das Elternteil per Direktive, damit allein die Inklusionsbindung wirkt.
    const result = buildCustomGroups(
      { rawGroups: [], typedGroups: [], insertControls: [withIdsDirective(['a-1'])] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const placed = result.controls.find((c) => c['id'] === 'a-1');
    const children = (placed?.['controls'] ?? []) as Record<string, unknown>[];
    expect(children.map((c) => c['id'])).toEqual(['a-1-1']);
  });

  it('behält ein nur später importiertes Kind, sobald eine Direktive es selektiert', () => {
    // Gegenstück zum vorigen Fall: Die Bindung an die erste Importinstanz
    // verwirft nichts ausdrücklich Selektiertes — die Direktiven-Selektion
    // bleibt die zweite Quelle der Prune-Menge.
    const parent = control('a-1', { controls: [control('a-1-1'), control('a-1-2')] });
    const combined = applyCombine(
      [
        { documentKey: 'doc-a', controls: [parent, control('a-1-1')] },
        { documentKey: 'doc-a', controls: [parent, control('a-1-2')] },
      ],
      'use-first',
    );

    const result = buildCustomGroups(
      { rawGroups: [], typedGroups: [], insertControls: [withIdsDirective(['a-1', 'a-1-2'])] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const placed = result.controls.find((c) => c['id'] === 'a-1');
    const children = (placed?.['controls'] ?? []) as Record<string, unknown>[];
    expect(children.map((c) => c['id'])).toEqual(['a-1-1', 'a-1-2']);
  });

  it('prunt quellenscharf, wenn zwei Importe dieselbe Control-ID tragen', () => {
    // combine=keep hält beide Definitionen. Nur Import B hat das Kind
    // eigenständig inkludiert; gegen eine globale ID-Menge geprunt bliebe es
    // auch in der Definition von Import A stehen und brächte eine dort nie
    // inkludierte Control in den aufgelösten Katalog.
    const fromA = control('shared', { controls: [control('child')] });
    const fromB = control('shared', { controls: [control('child')] });
    const combined = applyCombine(
      [
        { documentKey: 'doc-a', controls: [fromA] },
        { documentKey: 'doc-b', controls: [fromB, control('child')] },
      ],
      'keep',
    );

    const result = buildCustomGroups(
      { rawGroups: [], typedGroups: [], insertControls: [withIdsDirective(['shared'])] },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shared = result.controls.filter((c) => c['id'] === 'shared');
    expect(shared).toHaveLength(2);
    const childCounts = shared.map(
      (definition) => ((definition['controls'] ?? []) as unknown[]).length,
    );
    expect(childCounts.toSorted()).toEqual([0, 1]);
  });

  it('prunt ID-lose verschachtelte Kinder auch neben einem ID-losen Wurzelknoten', () => {
    // Wird die Prune-Menge aus ALLEN Knoten der Inklusion gebildet, landet für
    // ID-lose Knoten ein leerer String darin — ein ID-loses verschachteltes
    // Kind bliebe dann erhalten statt geprunt zu werden.
    const parent = control('a-1', { controls: [{ title: 'ohne id' }] });

    expect(placedChildIdsOf(
      [parent, { title: 'auch ohne id' } as Record<string, unknown>],
      ['a-1'],
    )).toEqual([]);
  });

  it('hält die Auswahl zweier Gruppen auseinander', () => {
    // Wird derselbe Parent in zwei Gruppen mit unterschiedlichen
    // Kindselektionen eingefügt, darf jede Gruppe nur ihre eigenen Kinder
    // zeigen. Eine global vereinigte Selektionsmenge liesse in beiden Gruppen
    // beide Kinder stehen (Greptile-Befund).
    const childIds = separatedPlacementChildIds(
      [],
      [['a-1', 'a-1-1'], ['a-1', 'a-1-2']],
    );

    expect(childIds.groups).toEqual([['a-1-1'], ['a-1-2']]);
  });

  it('hält Root- und Gruppenauswahl auseinander', () => {
    const childIds = separatedPlacementChildIds(
      ['a-1', 'a-1-1'],
      [['a-1', 'a-1-2']],
    );

    expect(childIds.root).toEqual(['a-1-1']);
    expect(childIds.groups).toEqual([['a-1-2']]);
  });

  it('prunt in einer Custom-Gruppe genauso wie auf Catalog-Ebene', () => {
    // Der reale BSI-Pfad: Das WLAN-Profil platziert seine Controls über
    // insert-controls IN Gruppen, nicht auf Catalog-Ebene.
    const parent = control('a-1', { controls: [control('a-1-1'), control('a-1-2')] });
    const combined = applyCombine(
      [{ documentKey: 'doc-a', controls: [parent, control('a-1-1')] }],
      'use-first',
    );

    const result = buildCustomGroups(
      {
        rawGroups: [{ id: 'g-1', title: 'Gruppe 1' }],
        typedGroups: [{
          id: 'g-1',
          insertControls: [withIdsDirective(['a-1', 'a-1-1'])],
          groups: [],
          params: [],
          props: [],
          links: [],
          parts: [],
          path: '/profile/merge/custom/groups[0]',
        }],
        insertControls: [],
      },
      combined,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const group = result.groups[0] as Record<string, unknown>;
    const placed = ((group['controls'] ?? []) as Record<string, unknown>[])
      .find((c) => c['id'] === 'a-1');
    const children = (placed?.['controls'] ?? []) as Record<string, unknown>[];
    expect(children.map((c) => c['id'])).toEqual(['a-1-1']);
  });
});
