import { describe, expect, it } from 'vitest';
import {
  applySetParametersToControl,
  applyAlteration,
  canonicalizeControlKeys,
} from './profileResolutionModify';

function baseControl(): Record<string, unknown> {
  return {
    id: 'ac-1',
    class: 'SP800-53',
    title: 'Policy',
    params: [
      {
        id: 'ac-1_prm_1',
        label: 'organization-defined parameter',
        props: [{ name: 'alt', value: 'old' }],
      },
    ],
    props: [{ name: 'status', value: 'ready' }],
    links: [{ href: '#ref', rel: 'related' }],
    parts: [{ id: 'ac-1_stmt', name: 'statement', prose: 'Alt.' }],
  };
}

describe('set-parameter', () => {
  it('führt weder Accessor-Slots noch Accessor-Member aus', () => {
    const params: Record<string, unknown>[] = [];
    Object.defineProperty(params, 0, {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('params-slot getter must not run');
      },
    });
    const control = { ...baseControl(), params };

    const directives: Array<Parameters<typeof applySetParametersToControl>[1][number]> = [];
    Object.defineProperty(directives, 0, {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('directive-slot getter must not run');
      },
    });
    directives.push({
      paramId: 'ac-1_prm_1',
      values: ['safe'],
      props: [],
      links: [],
      path: '/modify/safe',
    });

    expect(() => applySetParametersToControl(control, directives)).not.toThrow();
  });

  it('ersetzt Skalarfelder und reichert props/links an', () => {
    const control = baseControl();
    const result = applySetParametersToControl(control, [
      {
        paramId: 'ac-1_prm_1',
        label: 'NEU',
        values: ['v1'],
        props: [{ name: 'basis', value: 'enumerated' }],
        links: [{ href: '#neu', rel: 'reference' }],
        path: '/modify/sp0',
      },
    ]);

    const params = result['params'] as Record<string, unknown>[];
    expect(params[0]!['label']).toBe('NEU');
    expect(params[0]!['values']).toEqual(['v1']);
    // Anreicherung statt Ersetzung bei props/links:
    expect(params[0]!['props'] as unknown[]).toHaveLength(2);
    // Der Parameter trug selbst keine links — die Addition erscheint allein:
    expect((params[0]!['links'] as unknown[]).map((l) => (l as Record<string, unknown>)['href'])).toEqual(['#neu']);
    // Control selbst unverändert außerhalb von params:
    expect(result['title']).toBe('Policy');
  });

  it('lässt Controls ohne passenden Parameter unverändert', () => {
    const control = baseControl();
    const result = applySetParametersToControl(control, [
      { paramId: 'unbekannt', values: [], props: [], links: [], path: '/modify/sp1' },
    ]);

    expect(result['params'] as unknown[]).toHaveLength(1);
    expect(
      ((result['params'] as Record<string, unknown>[])[0] as Record<string, unknown>)['id'],
    ).toBe('ac-1_prm_1');
  });

  it('wendet mehrere set-parameter für denselben Parameter in Profilreihenfolge an', () => {
    const control = baseControl();
    const result = applySetParametersToControl(control, [
      { paramId: 'ac-1_prm_1', label: 'ERSTE', values: [], props: [], links: [], path: '/a' },
      { paramId: 'ac-1_prm_1', label: 'ZWEITE', values: [], props: [], links: [], path: '/b' },
    ]);

    const params = result['params'] as Record<string, unknown>[];
    expect(params[0]!['label']).toBe('ZWEITE');
  });
});

describe('alter — implizite Bindung', () => {
  it('position starting fügt props vor bestehende Props ein und ordnet kanonisch', () => {
    const control = baseControl();
    const result = applyAlteration(control, {
      controlId: 'ac-1',
      adds: [
        {
          position: 'starting',
          params: [],
          links: [],
          props: [{ name: 'basis', value: 'enumerated' }],
          parts: [{ id: 'caution', name: 'caution', prose: '', props: [], links: [], parts: [] }],
          title: '',
        },
      ],
      removes: undefined,
    });

    // Kanonische Schlüsselordnung: title, params, props, link(s), parts.
    // starting stellt die neuen Elemente an den Anfang ihrer Kategorie.
    const keys = Object.keys(result);
    expect(keys.indexOf('props')).toBeLessThan(keys.indexOf('parts'));
    const props = result['props'] as Record<string, unknown>[];
    expect(props.map((p) => p['name'])).toEqual(['basis', 'status']);
    const parts = result['parts'] as Record<string, unknown>[];
    expect(parts.map((p) => p['name'])).toEqual(['caution', 'statement']);
  });

  it('position ending hängt am Ende an; before/after gelten wie starting/ending', () => {
    const control = baseControl();
    const withEnding = applyAlteration(control, {
      controlId: 'ac-1',
      adds: [{ position: 'ending', props: [{ name: 'zuletzt', value: '1' }] }],
      removes: undefined,
    });
    const propsEnding = withEnding['props'] as Record<string, unknown>[];
    expect(propsEnding.map((p) => p['name']).at(-1)).toBe('zuletzt');

    const withBefore = applyAlteration(control, {
      controlId: 'ac-1',
      adds: [{ position: 'before', props: [{ name: 'zuerst', value: '1' }] }],
      removes: undefined,
    });
    const propsBefore = withBefore['props'] as Record<string, unknown>[];
    expect(propsBefore.map((p) => p['name'])[0]).toBe('zuerst');
  });
});

describe('alter — removes', () => {
  it('entfernt nach Name, Klasse und ID aus den Mitgliedslisten', () => {
    const control = baseControl();
    const result = applyAlteration(control, {
      controlId: 'ac-1',
      adds: [],
      removes: [
        { byName: 'status' },
        { byId: 'ac-1_stmt' },
      ],
    });

    expect(result['props']).toEqual([]);
    expect(result['parts']).toEqual([]);
    expect(result['links']).toHaveLength(1); // unverändert
  });

  it('führt keine Getter auf Alteration, Removal oder Mitgliedern aus', () => {
    const alteration = {
      controlId: 'ac-1',
      adds: [],
    } as Record<string, unknown>;
    Object.defineProperty(alteration, 'removes', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('removes getter must not run');
      },
    });

    expect(() => applyAlteration(
      baseControl(),
      alteration as Parameters<typeof applyAlteration>[1],
    )).not.toThrow();

    const addsAccessor = { controlId: 'ac-1', removes: [] } as Record<string, unknown>;
    Object.defineProperty(addsAccessor, 'adds', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('adds getter must not run');
      },
    });
    expect(() => applyAlteration(
      baseControl(),
      addsAccessor as Parameters<typeof applyAlteration>[1],
    )).not.toThrow();

    const removal = {} as Record<string, unknown>;
    Object.defineProperty(removal, 'byName', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('byName getter must not run');
      },
    });
    const member = { name: 'status', value: 'ready' };
    Object.defineProperty(member, 'name', {
      enumerable: true,
      configurable: true,
      get: () => {
        throw new Error('member name getter must not run');
      },
    });

    expect(() => applyAlteration(
      { ...baseControl(), props: [member] },
      { controlId: 'ac-1', adds: [], removes: [removal] } as Parameters<typeof applyAlteration>[1],
    )).not.toThrow();
  });
});

describe('kanonische Schlüsselordnung', () => {
  it('ordnet die Control-Member title, params, props, links, parts, controls', () => {
    const scrambled = {
      parts: [],
      links: [],
      controls: [{ id: 'kind' }],
      title: 'T',
      id: 'c1',
      props: [],
      params: [],
    };
    const ordered = canonicalizeControlKeys(scrambled);

    expect(Object.keys(ordered)).toEqual([
      'id',
      'title',
      'params',
      'props',
      'links',
      'parts',
      'controls',
    ]);
  });
});
