import { describe, expect, it } from 'vitest';
import {
  createProfileResolutionBudget,
  PROFILE_RESOLUTION_WORK_UNITS,
} from './profileResolutionBudget';
import { copyOwnDataMembers, safeArrayMember } from './profileResolutionMembers';

describe('safeArrayMember', () => {
  it('liefert nur eigene Array-Data-Properties', () => {
    const parts = [{ name: 'statement' }];
    const node: Record<string, unknown> = { parts, title: 'x' };
    Object.defineProperty(node, 'links', { enumerable: true, get: () => [] });

    expect(safeArrayMember(node, 'parts')).toBe(parts);
    expect(safeArrayMember(node, 'title')).toBeUndefined();
    expect(safeArrayMember(node, 'links')).toBeUndefined();
    expect(safeArrayMember(node, 'props')).toBeUndefined();
  });
});

describe('copyOwnDataMembers', () => {
  it.each([
    PROFILE_RESOLUTION_WORK_UNITS.MERGE_STEP,
    PROFILE_RESOLUTION_WORK_UNITS.ALTER_CANDIDATE,
  ])('bucht %s je eigenem Schlüssel und belegt einen Arbeitsknoten', (workUnit) => {
    const budget = createProfileResolutionBudget();
    let getterCalls = 0;
    const node: Record<string | symbol, unknown> = { id: 'C.1', title: 'Titel' };
    Object.defineProperty(node, 'links', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return [];
      },
    });
    node[Symbol('s')] = 'symbol';

    const copy = copyOwnDataMembers(node, budget, workUnit);

    expect(copy).toEqual({ id: 'C.1', title: 'Titel' });
    expect(Object.keys(copy)).toEqual(['id', 'title']);
    expect(getterCalls).toBe(0);
    const usage = budget.usage();
    expect(usage.nodes).toBe(1);
    expect(usage.workUnits).toBe(4);
    expect(usage.workUnitsByCategory[workUnit]).toBe(4);
  });
});
