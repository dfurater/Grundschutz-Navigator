import { describe, expect, it } from 'vitest';
import { closeTargetCategories } from '@/domain/targetObjectCategories';
import type { VocabularyNamespaceData } from '@/domain/models';

const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, '0')}`;
const namespace = (parents: number[]) => ({ entries: parents.map((parent, index) => ({ value: `Kategorie ${index}`, columns: { UUID: id(index), ChildOfUUID: parent < 0 ? '' : id(parent), Typ: '' } })) }) as unknown as VocabularyNamespaceData;

describe('Kategorienabschluss', () => {
  it('schließt Eltern ein und dokumentiert direkte und zusätzliche Herkunft sortiert', () => {
    expect(closeTargetCategories(namespace([-1, 0, 0, 1]), [id(3), id(2), id(0)], 'object', 'a'.repeat(40))).toEqual({
      status: 'ready', catalogKey: 'gspp', commit: 'a'.repeat(40), objectId: 'object',
      direct: [id(0), id(2), id(3)], effective: [id(0), id(1), id(2), id(3)],
      entries: [
        { uuid: id(0), direct: true, derivedFrom: [id(2), id(3)] },
        { uuid: id(1), direct: false, derivedFrom: [id(3)] },
        { uuid: id(2), direct: true, derivedFrom: [] },
        { uuid: id(3), direct: true, derivedFrom: [] },
      ],
    });
    expect(closeTargetCategories(namespace([-1, 0, 0]), [id(2)], 'o', 'a'.repeat(40))).toMatchObject({ effective: [id(0), id(2)] });
  });
  it.each([[1, 0], [-1, 5], [-1, 2, 1]])('weist den gesamten defekten Graphen ab: %j', (...parents) => {
    expect(closeTargetCategories(namespace(parents), [], 'o', 'a'.repeat(40))).toEqual({ status: 'invalid', code: 'SSP_CATEGORY_GRAPH_INVALID' });
  });
  it('weist unbekannte Auswahl und doppelte UUIDs ohne Teilmenge ab', () => {
    expect(closeTargetCategories(namespace([-1]), [id(9)], 'o', 'a'.repeat(40))).toEqual({ status: 'invalid', code: 'SSP_CATEGORY_UNKNOWN' });
    const data = namespace([-1, -1]);
    data.entries[1].columns.UUID = id(0).toUpperCase();
    expect(closeTargetCategories(data, [], 'o', 'a'.repeat(40))).toEqual({ status: 'invalid', code: 'SSP_CATEGORY_GRAPH_INVALID' });
  });
});
