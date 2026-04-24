import { describe, expect, it } from 'vitest';
import type { Control } from '@/domain/models';
import {
  buildChildControlMap,
  buildIncomingLinkMap,
  getControlHierarchyDepth,
  getControlLinkSearchText,
  getControlLinkTargetsByRelation,
  getLinkRelationLabel,
} from './controlRelationships';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    statement: 'Governance MUSS verankert werden.',
    statementRaw: 'Governance MUSS verankert werden.',
    guidance: '',
    statementProps: {
      zielobjektKategorien: [],
      ...overrides.statementProps,
    },
    links: [],
    params: {},
    ...overrides,
  };
}

describe('controlRelationships', () => {
  it('builds reverse-link lookups sorted by source control id', () => {
    const controls = [
      makeControl({
        id: 'GC.2.2',
        links: [{ targetId: 'GC.2.3', relation: 'related' }],
      }),
      makeControl({
        id: 'GC.2.1',
        links: [{ targetId: 'GC.2.3', relation: 'required' }],
      }),
    ];

    const incoming = buildIncomingLinkMap(controls).get('GC.2.3');

    expect(incoming).toEqual([
      { control: controls[1], relation: 'required' },
      { control: controls[0], relation: 'related' },
    ]);
  });

  it('collects link targets by relation for structured export columns', () => {
    const grouped = getControlLinkTargetsByRelation([
      { targetId: 'GC.2.2', relation: 'required' },
      { targetId: 'GC.2.3', relation: 'related' },
      { targetId: 'GC.2.4', relation: 'required' },
    ]);

    expect(grouped).toEqual({
      required: ['GC.2.2', 'GC.2.4'],
      related: ['GC.2.3'],
    });
  });

  it('includes relation ids and labels in link search text', () => {
    expect(
      getControlLinkSearchText([
        { targetId: 'GC.2.2', relation: 'required' },
        { targetId: 'GC.2.3', relation: 'related' },
      ]),
    ).toContain('erforderlich');
    expect(getLinkRelationLabel('related')).toBe('verwandt');
  });

  it('builds child lookups and calculates nesting depth', () => {
    const parent = makeControl({ id: 'GC.5.1' });
    const child = makeControl({ id: 'GC.5.1.1', parentId: 'GC.5.1' });
    const grandChild = makeControl({ id: 'GC.5.1.1.1', parentId: 'GC.5.1.1' });
    const controls = [parent, child, grandChild];
    const controlsById = new Map(controls.map((control) => [control.id, control]));

    expect(buildChildControlMap(controls).get('GC.5.1')).toEqual([child]);
    expect(getControlHierarchyDepth(parent, controlsById)).toBe(0);
    expect(getControlHierarchyDepth(child, controlsById)).toBe(1);
    expect(getControlHierarchyDepth(grandChild, controlsById)).toBe(2);
  });
});
