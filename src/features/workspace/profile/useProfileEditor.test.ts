import { describe, expect, it } from 'vitest';
import type { ProfileImportView } from '@/domain/profileAuthoring';
import type { LocalId, WorkspaceBinding } from '@/domain/workspaceModel';
import { hasOpenAssignment } from '@/features/workspace/profile/useProfileEditor';
import type { PendingImportTarget } from '@/state/workspaceDocuments';

const POINTER = '/profile/imports/0/href';
const imported = (href: string) => [{ index: 0, href } as ProfileImportView];
const pending = (href: string) => new Map<string, PendingImportTarget>([[POINTER, { href, target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }]]);
const stored = (href: string): WorkspaceBinding[] => [{ fromLocalId: 'p' as LocalId, pointer: POINTER, href, target: { kind: 'class-1', artifactKey: 'catalog-gspp' } }];

describe('Offene Importzuordnung', () => {
  it('zählt eine Zuordnung, die targetOf() für den aktuellen Import verwendet', () => {
    expect(hasOpenAssignment(imported('#a'), [], pending('#a'))).toBe(true);
  });

  it('zählt eine von einer gespeicherten Bindung überholte Zuordnung nicht', () => {
    expect(hasOpenAssignment(imported('#a'), stored('#a'), pending('#a'))).toBe(false);
  });

  it('zählt eine Zuordnung zu einem href nicht, den der Import nicht mehr trägt', () => {
    expect(hasOpenAssignment(imported('#b'), [], pending('#a'))).toBe(false);
  });
});
