import { describe, expect, it } from 'vitest';
import { buildTargetControlIndex } from '@/domain/profileTargetControls';

describe('Anforderungen eines Importziels', () => {
  it('ordnet Praktik, Gruppe, Unteranforderungen, tiefere Gruppen und Wurzel-Controls', () => {
    const index = buildTargetControlIndex({
      catalog: {
        controls: [{ id: 'ROOT.1', title: 'Wurzel' }],
        groups: [42, {
          id: 'GC', title: 'Governance',
          controls: [{ id: 'GC.0', title: 'Direkt' }],
          groups: [{
            id: 'GC.1', title: 'Grundlagen',
            controls: [{ id: 'GC.1.1', title: 'Eins', controls: [{ id: 'GC.1.1.1', title: 'Kind' }] }],
            groups: [{ id: 'GC.1.X', controls: [{ id: 'GC.1.9', title: 'Tief' }, { title: 'ohne id' }] }, 'kein Objekt', null],
          }],
        }],
      },
    });
    expect(index?.ids).toEqual(['ROOT.1', 'GC.0', 'GC.1.1', 'GC.1.1.1', 'GC.1.9']);
    expect(index?.practices.map((practice) => [practice.id, practice.controlCount])).toEqual([[undefined, 1], ['GC', 4]]);
    const [direct, grundlagen] = index!.practices[1].groups;
    expect(direct).toMatchObject({ id: 'GC', controls: [{ id: 'GC.0', depth: 0 }] });
    expect(grundlagen.controls).toEqual([
      { id: 'GC.1.1', title: 'Eins', parentId: undefined, depth: 0 },
      { id: 'GC.1.1.1', title: 'Kind', parentId: 'GC.1.1', depth: 1 },
      { id: 'GC.1.9', title: 'Tief', parentId: undefined, depth: 0 },
    ]);
  });

  it('liefert für eine Quelle, die kein Katalog ist, keinen Index', () => {
    expect(buildTargetControlIndex({ profile: {} })).toBeNull();
    expect(buildTargetControlIndex(undefined)).toBeNull();
  });
});
