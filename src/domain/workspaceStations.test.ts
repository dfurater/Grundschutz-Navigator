import { describe, expect, it } from 'vitest';
import { documentValidity, isWorkspaceStation, referenceRequirement, WORKSPACE_STATIONS } from '@/domain/workspaceStations';

describe('isWorkspaceStation', () => {
  it.each(WORKSPACE_STATIONS)('nimmt die Station %s an', (station) => {
    expect(isWorkspaceStation(station)).toBe(true);
  });

  it.each([['catalog'], ['Profile'], [''], [undefined], [null], [1], [['profile']]])('weist %j ab', (value) => {
    expect(isWorkspaceStation(value)).toBe(false);
  });
});

describe('referenceRequirement', () => {
  it.each([
    ['profile-import', 'Pflicht'],
    ['ar-import-ap', 'Pflicht'],
    ['ssp-leveraged-authorization', 'optional'],
    ['poam-import-ssp', 'optional'],
  ] as const)('stuft %s als %s ein', (kind, requirement) => {
    expect(referenceRequirement(kind)).toBe(requirement);
  });

  it.each(['document-internal', 'ssp-control', 'component-incorporates'] as const)('macht für %s keine Angabe', (kind) => {
    expect(referenceRequirement(kind)).toBeUndefined();
  });
});

describe('documentValidity', () => {
  it('zeigt nur den Zustand draft als Entwurf', () => {
    expect(documentValidity('draft')).toBe('Entwurf');
    expect(documentValidity('imported')).toBe('Gültig');
    expect(documentValidity('export-ready')).toBe('Gültig');
  });
});
