import { describe, expect, it } from 'vitest';
import { applyAlteration as applyAlterationResult } from './profileResolutionModify';
import { createProfileResolutionBudget } from './profileResolutionBudget';

function applyAlteration(...args: Parameters<typeof applyAlterationResult>): Record<string, unknown> {
  const result = applyAlterationResult(...args);
  if (!result.ok) throw new Error('Unerwartet unplatzierbar');
  return result.value;
}

const budget = () => createProfileResolutionBudget();

function nestedControl(): Record<string, unknown> {
  return {
    id: 'ac-2',
    title: 'Konten',
    parts: [
      {
        id: 'ac-2_smt',
        name: 'statement',
        parts: [
          { id: 'ac-2_smt.a', name: 'item', prose: 'A' },
          { id: 'ac-2_smt.b', name: 'item', prose: 'B' },
        ],
      },
      { id: 'ac-2_gdn', name: 'guidance', prose: 'Hinweis' },
    ],
  };
}

const NEW_PART = { id: 'ac-2_neu', name: 'item', prose: 'Neu' };

function partIds(value: unknown): unknown[] {
  return (value as Record<string, unknown>[]).map((part) => part['id']);
}

function statementOf(result: Record<string, unknown>): Record<string, unknown> {
  return (result['parts'] as Record<string, unknown>[])[0]!;
}

describe('alter — explizite Bindung (by-id)', () => {
  it('position before und after setzen neben den Ziel-Part', () => {
    const before = applyAlteration(nestedControl(), {
      adds: [{ byId: 'ac-2_gdn', position: 'before', parts: [NEW_PART] }],
    }, budget());
    const after = applyAlteration(nestedControl(), {
      adds: [{ byId: 'ac-2_smt', position: 'after', parts: [NEW_PART] }],
    }, budget());

    expect(partIds(before['parts'])).toEqual(['ac-2_smt', 'ac-2_neu', 'ac-2_gdn']);
    expect(partIds(after['parts'])).toEqual(['ac-2_smt', 'ac-2_neu', 'ac-2_gdn']);
  });

  it('position starting setzt in den Ziel-Part an den Anfang und behält die Geschwister', () => {
    const control = nestedControl();
    const result = applyAlteration(control, {
      adds: [{ byId: 'ac-2_gdn', position: 'starting', parts: [NEW_PART] }],
    }, budget());

    const parts = result['parts'] as Record<string, unknown>[];
    expect(partIds(parts)).toEqual(['ac-2_smt', 'ac-2_gdn']);
    expect(parts[0]).toBe((control['parts'] as unknown[])[0]);
    expect(parts[1]).toMatchObject({ id: 'ac-2_gdn', name: 'guidance', prose: 'Hinweis' });
    expect(partIds(parts[1]!['parts'])).toEqual(['ac-2_neu']);
    expect((control['parts'] as Record<string, unknown>[])[1]).not.toHaveProperty('parts');
  });

  it('position starting an einem verschachtelten Ziel-Part erhält dessen Geschwister', () => {
    const result = applyAlteration(nestedControl(), {
      adds: [{ byId: 'ac-2_smt.b', position: 'starting', parts: [NEW_PART] }],
    }, budget());

    const items = statementOf(result)['parts'] as Record<string, unknown>[];
    expect(partIds(items)).toEqual(['ac-2_smt.a', 'ac-2_smt.b']);
    expect(partIds(items[1]!['parts'])).toEqual(['ac-2_neu']);
  });

  it('position after an einem verschachtelten Ziel-Part setzt dahinter', () => {
    const result = applyAlteration(nestedControl(), {
      adds: [{ byId: 'ac-2_smt.a', position: 'after', parts: [NEW_PART] }],
    }, budget());

    expect(partIds(statementOf(result)['parts'])).toEqual(['ac-2_smt.a', 'ac-2_neu', 'ac-2_smt.b']);
  });

  it.each(['before', 'after'])('position %s verwirft Einträge, die kein Objekt sind', (position) => {
    const result = applyAlteration(nestedControl(), {
      adds: [{ byId: 'ac-2_gdn', position, parts: ['kein Objekt', NEW_PART, 7, null] }],
    }, budget());

    const ids = partIds(result['parts']);
    expect(ids).toEqual(position === 'before'
      ? ['ac-2_smt', 'ac-2_neu', 'ac-2_gdn']
      : ['ac-2_smt', 'ac-2_gdn', 'ac-2_neu']);
  });

  it.each([
    ['position ending', { position: 'ending' }],
    ['fehlende position', {}],
  ])('%s hängt in den Ziel-Part ans Ende und behält die Geschwister', (_label, position) => {
    const control = nestedControl();
    const result = applyAlteration(control, {
      adds: [{ byId: 'ac-2_smt', ...position, parts: [NEW_PART] }],
    }, budget());

    const parts = result['parts'] as Record<string, unknown>[];
    expect(partIds(parts)).toEqual(['ac-2_smt', 'ac-2_gdn']);
    expect(partIds(parts[0]!['parts'])).toEqual(['ac-2_smt.a', 'ac-2_smt.b', 'ac-2_neu']);
    expect(parts[1]).toBe((control['parts'] as unknown[])[1]);
    expect(partIds(statementOf(control)['parts'])).toEqual(['ac-2_smt.a', 'ac-2_smt.b']);
  });

  it('fehlende position an einem verschachtelten Ziel-Part fügt in diesen ein', () => {
    const result = applyAlteration(nestedControl(), {
      adds: [{ byId: 'ac-2_smt.a', parts: [NEW_PART] }],
    }, budget());

    const items = statementOf(result)['parts'] as Record<string, unknown>[];
    expect(partIds(items)).toEqual(['ac-2_smt.a', 'ac-2_smt.b']);
    expect(partIds(items[0]!['parts'])).toEqual(['ac-2_neu']);
  });

  it('legt für eine leere Kategorie keine Liste am Ziel-Part an', () => {
    const control = nestedControl();
    const result = applyAlteration(control, {
      adds: [{ byId: 'ac-2_gdn', parts: [], props: [{ name: 'neu', value: '1' }] }],
    }, budget());
    const withExistingParts = applyAlteration(control, {
      adds: [{ byId: 'ac-2_smt', parts: [] }],
    }, budget());

    const guidance = (result['parts'] as Record<string, unknown>[])[1]!;
    expect(guidance).not.toHaveProperty('parts');
    expect(guidance['props']).toEqual([{ name: 'neu', value: '1' }]);
    expect(partIds(statementOf(withExistingParts)['parts'])).toEqual(['ac-2_smt.a', 'ac-2_smt.b']);
  });

  it('setzt jede Kategorie in die gleichnamige Liste des Ziel-Parts', () => {
    const control = {
      id: 'ac-5',
      parts: [{ id: 'ac-5_smt', name: 'statement', props: [{ name: 'alt', value: '1' }] }],
    };
    const ending = applyAlteration(control, {
      adds: [{ byId: 'ac-5_smt', props: [{ name: 'neu', value: '2' }], links: [{ href: '#x' }] }],
    }, budget());
    const starting = applyAlteration(control, {
      adds: [{ byId: 'ac-5_smt', position: 'starting', props: [{ name: 'neu', value: '2' }] }],
    }, budget());

    expect((ending['parts'] as unknown[])[0]).toEqual({
      id: 'ac-5_smt',
      name: 'statement',
      props: [{ name: 'alt', value: '1' }, { name: 'neu', value: '2' }],
      links: [{ href: '#x' }],
    });
    expect(((starting['parts'] as Record<string, unknown>[])[0]!)['props']).toEqual([
      { name: 'neu', value: '2' },
      { name: 'alt', value: '1' },
    ]);
  });

  it('lässt die Control unverändert, wenn der Ziel-Part fehlt oder parts kein Array ist', () => {
    const control = nestedControl();
    const withoutParts = { id: 'ac-3', parts: { id: 'x' } };

    expect(applyAlteration(control, {
      adds: [{ byId: 'fehlt', position: 'before', parts: [NEW_PART] }],
    }, budget())).toEqual(control);
    expect(applyAlteration(withoutParts, {
      adds: [{ byId: 'x', parts: [NEW_PART] }],
    }, budget())).toEqual(withoutParts);
  });

  it('fügt in einen parts-Baum jenseits der Tiefengrenze nicht ein', () => {
    let innermost: Record<string, unknown> = { id: 'tief', name: 'item' };
    for (let depth = 0; depth < 80; depth += 1) {
      innermost = { id: `ebene-${depth}`, name: 'item', parts: [innermost] };
    }
    const control = { id: 'ac-4', parts: [innermost] };

    const result = applyAlteration(control, {
      adds: [{ byId: 'tief', position: 'before', parts: [NEW_PART] }],
    }, budget());

    expect(result['parts']).toBe(control['parts']);
  });
});


describe('by-id — Platzierung je Zieltyp', () => {
  const prop = { name: 'neu', value: 'secret-value' };
  const link = { href: '#neu' };
  const param = { id: 'neu-param', label: 'Neu' };
  const target = { id: 'ziel', props: [{ name: 'alt', value: '1' }], links: [{ href: '#alt' }] };

  it.each(['starting', 'ending', undefined])('setzt props/links %s in einen Parameter', (position) => {
    const control = { id: 'c', params: [target] };
    const result = applyAlteration(control, { adds: [{ byId: 'ziel', position, props: [prop], links: [link] }] }, budget());
    const changed = (result['params'] as Record<string, unknown>[])[0]!;
    expect(changed['props']).toEqual(position === 'starting' ? [prop, ...target.props] : [...target.props, prop]);
    expect(changed['links']).toEqual(position === 'starting' ? [link, ...target.links] : [...target.links, link]);
    expect(control.params[0]).toBe(target);
    expect(target.props).toHaveLength(1);
  });

  it.each(['before', 'after'])('setzt params %s neben einen Parameter', (position) => {
    const result = applyAlteration({ id: 'c', params: [target] }, { adds: [{ byId: 'ziel', position, params: [param] }] }, budget());
    expect(result['params']).toEqual(position === 'before' ? [param, target] : [target, param]);
  });

  it.each(['starting', 'ending', undefined])('setzt alle Kategorien %s in eine Kind-Control', (position) => {
    const child = { ...target, title: 'Kind', params: [param], parts: [NEW_PART] };
    const result = applyAlteration({ id: 'c', controls: [child] }, {
      adds: [{ byId: 'ziel', position, params: [param], props: [prop], links: [link], parts: [NEW_PART], title: 'ignoriert' }],
    }, budget());
    const changed = (result['controls'] as Record<string, unknown>[])[0]!;
    expect(changed['title']).toBe('Kind');
    expect(changed['params']).toEqual([param, param]);
    expect(changed['parts']).toEqual([NEW_PART, NEW_PART]);
    expect(changed['props']).toEqual(position === 'starting' ? [prop, ...target.props] : [...target.props, prop]);
    expect(changed['links']).toEqual(position === 'starting' ? [link, ...target.links] : [...target.links, link]);
  });

  const invalid = [
    ...['before', 'after'].flatMap(position => ['props', 'params', 'links'].map(category => ['parts', position, category])),
    ...['starting', 'ending', undefined].map(position => ['parts', position, 'params']),
    ...['before', 'after'].flatMap(position => ['props', 'parts', 'links'].map(category => ['params', position, category])),
    ...['starting', 'ending', undefined].flatMap(position => ['parts', 'params'].map(category => ['params', position, category])),
    ...['before', 'after'].flatMap(position => ['params', 'props', 'links', 'parts'].map(category => ['controls', position, category])),
  ];
  it.each(invalid)('lehnt Ziel %s, Position %s, Kategorie %s ohne Teilergebnis ab', (list, position, category) => {
    const control = { id: 'c', [list!]: [{ id: 'ziel', name: 'item' }] };
    const before = structuredClone(control);
    const result = applyAlterationResult(control, { adds: [
      { props: [prop] },
      { byId: 'ziel', position, ...(list === 'parts' ? { parts: [NEW_PART] } : { params: [param] }), [category!]: [prop] },
    ] }, budget());
    expect(result).toEqual({ ok: false, additionIndex: 1 });
    expect(control).toEqual(before);
  });

  it('sucht kanonisch und tiefenfirst bis in Kind-Controls', () => {
    const control = { id: 'c', controls: [{ id: 'kind', controls: [{ id: 'enkel', params: [target] }] }] };
    const result = applyAlteration(control, { adds: [{ byId: 'ziel', props: [prop] }] }, budget());
    expect(result).toMatchObject({ controls: [{ controls: [{ params: [{ props: [...target.props, prop] }] }] }] });
    const duplicate = { id: 'c', parts: [{ id: 'ziel', name: 'item' }], params: [target], controls: [{ id: 'ziel' }] };
    const first = applyAlteration(duplicate, { adds: [{ byId: 'ziel', props: [prop] }] }, budget());
    expect(first['parts']).toBe(duplicate.parts);
    expect(first['controls']).toBe(duplicate.controls);
    expect(first['params']).toEqual([{ ...target, props: [...target.props, prop] }]);
  });

  it('ignoriert fehlende und eigene IDs auch bei unplatzierbaren Kategorien', () => {
    const control = nestedControl();
    for (const byId of ['fehlt', 'ac-2']) {
      expect(applyAlteration(control, { adds: [{ byId, position: 'before', props: [prop] }] }, budget())).toBe(control);
    }
  });
});


describe('by-id — Suchgrenzen', () => {
  it('sucht Parts tiefenfirst vor Geschwistern und Kind-Controls', () => {
    const leaf = { id: 'ziel', name: 'item' };
    const control = { id: 'c', parts: [{ name: 'statement', parts: [leaf] }, leaf], controls: [{ id: 'ziel' }] };
    const result = applyAlteration(control, { adds: [{ byId: 'ziel', props: [{ name: 'x', value: '1' }] }] }, budget());
    expect(result).toMatchObject({ parts: [{ parts: [{ props: [{ name: 'x', value: '1' }] }] }, leaf] });
    expect((result['parts'] as unknown[])[1]).toBe(leaf);
    expect(result['controls']).toBe(control.controls);
  });

  it('prüft die gesamte Kind-Control-Tiefe auch vor einem frühen Treffer', () => {
    let child: Record<string, unknown> = { id: 'tief' };
    for (let i = 0; i < 80; i++) child = { id: 'kind', controls: [child] };
    const control = { id: 'c', params: [{ id: 'ziel' }], controls: [child] };
    expect(applyAlteration(control, { adds: [{ byId: 'ziel', props: [{ name: 'x', value: '1' }] }] }, budget())).toBe(control);
  });

  it.each(['before', 'after'])('lehnt auch leere Ergänzungen %s an Kind-Controls ab', position => {
    expect(applyAlterationResult({ id: 'c', controls: [{ id: 'ziel' }] }, {
      adds: [{ byId: 'ziel', position, parts: [] }],
    }, budget())).toEqual({ ok: false, additionIndex: 0 });
  });
});
