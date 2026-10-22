import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ProfileImportView } from '@/domain/profileAuthoring';
import type { LocalId, WorkspaceBinding, WorkspaceEnvelope } from '@/domain/workspaceModel';
import { hasOpenAssignment, useProfileEditor } from '@/features/workspace/profile/useProfileEditor';
import type { PendingImportTarget } from '@/state/workspaceDocuments';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';

const workspace = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/hooks/useWorkspace', () => ({ useWorkspace: () => workspace.current }));

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

describe('Übernahme eines neueren Stands', () => {
  it('übernimmt trotz erhaltener, von der gespeicherten Bindung überholter Zuordnung', async () => {
    const localId = 'p' as LocalId;
    const source = makeSchemaValidOscalDocument('profile', '1.1.3') as { profile: { imports: { href: string }[] } };
    source.profile.imports[0].href = '#a';
    const envelope = { localId, rootType: 'profile', oscalVersion: '1.1.3', documentState: 'export-ready', savedAt: '2026-10-22T10:00:00.000Z', source } as unknown as WorkspaceEnvelope;
    const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value });
    const targets = new Map<string, PendingImportTarget>([[POINTER, { href: '#a', target: { kind: 'local', localId: 'a' as LocalId } }]]);
    workspace.current = {
      documents: { getDocument: () => ok(envelope), getDraft: () => ok(undefined), listBindings: () => ok(stored('#a')), importTargets: () => targets },
      registerAutosave: () => () => {},
    };
    const { result } = renderHook(() => useProfileEditor(localId));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.dirty).toBe(false);
    let adoption: string | undefined;
    await act(async () => { adoption = await result.current.adopt({ ...envelope, savedAt: '2026-10-22T11:00:00.000Z' }); });
    expect(adoption).toBe('adopted');
  });
});
