// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DOCUMENT_AUTOSAVE_DELAY_MS, useDocumentEditor } from '@/features/workspace/useDocumentEditor';
import type { LocalId, WorkspaceEnvelope } from '@/domain/workspaceModel';

const workspace = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('@/hooks/useWorkspace', () => ({ useWorkspace: () => workspace.current }));

it('prüft offene Formulareingaben nach dem asynchronen Lesen erneut vor der Übernahme', async () => {
  const localId = 'ssp' as LocalId;
  const envelope = { localId, rootType: 'system-security-plan', savedAt: '2026-10-23T00:00:00Z', source: {} } as WorkspaceEnvelope;
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const getDraft = vi.fn(async () => ok(undefined));
  workspace.current = { documents: { getDocument: async () => ok(envelope), getDraft, listBindings: async () => ok([]) }, registerAutosave: () => () => {} };
  let pending = false;
  const { result } = renderHook(() => useDocumentEditor({ localId, rootType: 'system-security-plan', sameContent: (a, b) => a === b, hasPendingBindings: () => pending }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  let release!: () => void;
  getDraft.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(ok(undefined)); }));
  let adoption!: Promise<string>;
  act(() => { adoption = result.current.adopt({ ...envelope, savedAt: '2026-10-23T01:00:00Z', source: { changed: true } }); });
  pending = true;
  await act(async () => { release(); expect(await adoption).toBe('blocked'); });
  expect(result.current.envelope).toBe(envelope);
});

it('übernimmt nach einem Unmount während des Lesens nichts und plant keinen Autosave', async () => {
  const localId = 'ssp' as LocalId;
  const envelope = { localId, rootType: 'system-security-plan', savedAt: '2026-10-23T00:00:00Z', source: {} } as WorkspaceEnvelope;
  const ok = <T,>(value: T) => ({ ok: true as const, value });
  const getDraft = vi.fn(async () => ok(undefined));
  const autosaveDraft = vi.fn(async () => ok({ savedAt: '2026-10-23T02:00:00Z' }));
  workspace.current = { documents: { getDocument: async () => ok(envelope), getDraft, listBindings: async () => ok([]), autosaveDraft }, registerAutosave: () => () => {} };
  const { result, unmount } = renderHook(() => useDocumentEditor({ localId, rootType: 'system-security-plan', sameContent: (a, b) => a === b, hasPendingBindings: () => true }));
  await waitFor(() => expect(result.current.status).toBe('ready'));
  let release!: () => void;
  getDraft.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve(ok(undefined)); }));
  let adoption!: Promise<string>;
  act(() => { adoption = result.current.adopt({ ...envelope, savedAt: '2026-10-23T01:00:00Z', source: { merged: true } }, (_previous, next) => next); });
  unmount();
  await act(async () => { release(); expect(await adoption).toBe('blocked'); });
  await new Promise(resolve => setTimeout(resolve, DOCUMENT_AUTOSAVE_DELAY_MS + 50));
  expect(autosaveDraft).not.toHaveBeenCalled();
});
