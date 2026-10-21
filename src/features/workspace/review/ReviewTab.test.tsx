import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentSnapshot, LocalId, ReviewTrailView, VerbundId } from '@/domain/workspaceModel';
import { makeSchemaValidOscalDocument } from '@/test/fixtures/oscalSchemaFixtures';
import { ReviewTab } from '@/features/workspace/review/ReviewTab';
import type { ReviewTrailState } from '@/features/workspace/review/useReviewTrail';

const state: { current?: ReviewTrailState } = {};
vi.mock('@/features/workspace/review/useReviewTrail', () => ({ useReviewTrail: () => state.current }));

const localId = '22222222-2222-4222-8222-222222222222' as LocalId;
const savedAt = '2026-10-21T10:00:00.000Z';
const stand: DocumentSnapshot = {
  rootType: 'catalog', uuid: 'doc-1', lastModified: savedAt, version: '1.0', oscalVersion: '1.1.3',
  contentHash: { version: 1, algorithm: 'sha-256', value: 'a'.repeat(64) },
};
const view: ReviewTrailView = {
  trail: [],
  stand,
  draftSavedAt: null,
  document: {
    localId, verbundId: '11111111-1111-4111-8111-111111111111' as VerbundId, storageSchemaVersion: 2, rootType: 'catalog', oscalVersion: '1.1.3',
    trustClass: 'class-2-local-user', documentState: 'export-ready', createdAt: savedAt, savedAt, source: makeSchemaValidOscalDocument('catalog', '1.1.3'),
  },
};

let finish: (ok: boolean) => void;
beforeEach(() => {
  state.current = {
    status: 'ready', view, busy: false, refreshing: false,
    reload: vi.fn(async () => {}),
    checkpoint: vi.fn(async () => true),
    decide: vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; })),
  };
});

describe('ReviewTab', () => {
  it('erhält eine während des Schreibens getippte Begründung', async () => {
    render(<ReviewTab localId={localId} documentSavedAt={savedAt} />);
    const reason = screen.getByLabelText(/Begründung/);
    fireEvent.change(reason, { target: { value: 'Original' } });
    fireEvent.click(screen.getByRole('button', { name: 'Als geprüft markieren' }));
    expect(state.current?.decide).toHaveBeenCalledWith({ decision: 'reviewed', reason: 'Original' });
    fireEvent.change(reason, { target: { value: 'Neue noch offene Eingabe' } });
    await act(async () => { finish(true); });
    expect(reason).toHaveValue('Neue noch offene Eingabe');
  });

  it('leert die unveränderte Begründung nach erfolgreichem Schreiben', async () => {
    render(<ReviewTab localId={localId} documentSavedAt={savedAt} />);
    const reason = screen.getByLabelText(/Begründung/);
    fireEvent.change(reason, { target: { value: 'Original' } });
    fireEvent.click(screen.getByRole('button', { name: 'Als geprüft markieren' }));
    await act(async () => { finish(true); });
    expect(reason).toHaveValue('');
  });
});
