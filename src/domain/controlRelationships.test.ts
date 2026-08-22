import { describe, expect, it } from 'vitest';
import type { Control, ControlLink } from '@/domain/models';
import {
  buildChildControlMap,
  buildIncomingLinkMap,
  getControlHierarchyDepth,
  getControlLinkSearchText,
  getControlLinkTargetsByRelation,
  getLinkRelationDescription,
  getLinkRelationLabel,
  toFilterableLinkRelation,
} from './controlRelationships';

function makeControl(overrides: Partial<Control> = {}): Control {
  return {
    id: 'GC.1.1',
    title: 'Errichtung und Aufrechterhaltung eines ISMS',
    groupId: 'GC.1',
    practiceId: 'GC',
    tags: [],
    threats: [],
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

function makeLink(targetId: string, rel: 'required' | 'related'): ControlLink {
  return {
    targetId,
    href: `#${targetId}`,
    rel,
    relStatus: 'custom',
  };
}

describe('controlRelationships', () => {
  it('keeps legacy filters narrow while describing documented, custom, and missing rel values', () => {
    expect(toFilterableLinkRelation('required')).toBe('required');
    expect(toFilterableLinkRelation('related')).toBe('related');
    expect(toFilterableLinkRelation('reference')).toBeUndefined();
    expect(toFilterableLinkRelation('maps-to')).toBeUndefined();
    expect(toFilterableLinkRelation(undefined)).toBeUndefined();

    expect(getLinkRelationDescription('reference', 'documented'))
      .toBe('Referenz · OSCAL-dokumentiert');
    expect(getLinkRelationDescription('required', 'custom'))
      .toBe('erforderlich · benutzerdefinierte OSCAL-Relation');
    expect(getLinkRelationDescription('related', 'custom'))
      .toBe('verwandt · benutzerdefinierte OSCAL-Relation');
    expect(getLinkRelationDescription('maps-to', 'custom'))
      .toBe('benutzerdefinierte OSCAL-Relation „maps-to“');
    expect(getLinkRelationDescription(undefined, 'missing')).toBe('ohne Relationsangabe');
  });

  it('builds reverse-link lookups sorted by source control id', () => {
    const controls = [
      makeControl({
        id: 'GC.2.2',
        links: [makeLink('GC.2.3', 'related')],
      }),
      makeControl({
        id: 'GC.2.1',
        links: [makeLink('GC.2.3', 'required')],
      }),
    ];

    const incoming = buildIncomingLinkMap(controls).get('GC.2.3');

    expect(incoming).toEqual([
      { control: controls[1], link: controls[1]!.links[0] },
      { control: controls[0], link: controls[0]!.links[0] },
    ]);
  });

  it('collects link targets by relation for structured export columns', () => {
    const grouped = getControlLinkTargetsByRelation([
      makeLink('GC.2.2', 'required'),
      makeLink('GC.2.3', 'related'),
      makeLink('GC.2.4', 'required'),
    ]);

    expect(grouped).toEqual({
      required: ['GC.2.2', 'GC.2.4'],
      related: ['GC.2.3'],
    });
  });

  it('includes relation ids and labels in link search text', () => {
    expect(
      getControlLinkSearchText([
        makeLink('GC.2.2', 'required'),
        makeLink('GC.2.3', 'related'),
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
