import { describe, expect, it } from 'vitest';
import { applyAlteration } from './profileResolutionModify';
import { createProfileResolutionBudget } from './profileResolutionBudget';

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
