import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { REVIEW_ACTIONS_SYSTEM } from '@/domain/reviewTrail';
import type { DocumentSnapshot, LocalId, ReviewCheckpoint, ReviewDecision, ReviewTrailRow } from '@/domain/workspaceModel';
import { ReviewPanel } from '@/features/workspace/review/ReviewPanel';
import { buildReviewView } from '@/features/workspace/review/reviewView';

function snapshot(hash: string): DocumentSnapshot {
  return {
    rootType: 'catalog',
    uuid: 'doc-1',
    lastModified: '2026-10-20T10:00:00Z',
    version: '1.0',
    oscalVersion: '1.1.3',
    contentHash: { version: 1, algorithm: 'sha-256', value: hash },
  };
}

const checkpoint: ReviewCheckpoint = {
  localId: 'checkpoint-1' as LocalId,
  sequence: 1,
  kind: 'checkpoint',
  createdAt: '2026-10-20T10:00:00Z',
  documentState: 'export-ready',
  stand: snapshot('baseline'),
  diff: {
    version: 1,
    baseSequence: null,
    entries: [
      { path: '/catalog/metadata/title', kind: 'changed', valueKind: 'string', marker: false },
      { path: '/catalog/metadata/last-modified', kind: 'changed', valueKind: 'string', marker: true },
    ],
    truncated: true,
  },
};

const approval: ReviewDecision = {
  localId: 'decision-1' as LocalId,
  sequence: 2,
  kind: 'decision',
  createdAt: '2026-10-20T11:00:00Z',
  decision: 'approved',
  actionUuid: 'action-1',
  stand: snapshot('stand'),
  roleId: 'role-approver',
  partyUuids: ['party-1'],
};

const metadata = {
  revisions: [
    { version: '2.0', title: 'Zweite Fassung' },
    { version: '1.0' },
    { version: '2.0' },
  ],
  roles: [{ id: 'role-approver', title: 'Freigabe' }],
  parties: [{ uuid: 'party-1', name: 'Alice Beispiel' }],
  actions: [{
    uuid: 'action-1',
    type: 'approved',
    system: REVIEW_ACTIONS_SYSTEM,
    date: '2026-10-20T11:00:00Z',
    'responsible-parties': [{ 'role-id': 'role-approver', 'party-uuids': ['party-1', 'party-missing'] }],
  }],
};

function renderPanel(trail: readonly ReviewTrailRow[] = [checkpoint, approval]) {
  const view = buildReviewView({
    trail,
    stand: snapshot('stand'),
    editorDirty: false,
    metadata,
    nativeActionUuids: ['action-1'],
  });
  render(<ReviewPanel view={view} metadata={metadata} rootType="catalog" />);
  return {
    documentLayer: screen.getByRole('region', { name: 'Im Dokument' }),
    workspaceLayer: screen.getByRole('region', { name: 'Nur im Workspace' }),
  };
}

describe('ReviewPanel', () => {
  it('trennt Dokumentlage und Workspace-Lage sichtbar', () => {
    const { documentLayer, workspaceLayer } = renderPanel();
    expect(within(documentLayer).getByRole('heading', { name: 'Im Dokument' })).toBeInTheDocument();
    expect(within(workspaceLayer).getByRole('heading', { name: 'Nur im Workspace' })).toBeInTheDocument();
    expect(within(workspaceLayer).getByText(/keine elektronische Signatur/)).toBeInTheDocument();
    expect(within(documentLayer).queryByText(/keine elektronische Signatur/)).not.toBeInTheDocument();
    expect(workspaceLayer.querySelector('[data-review-badge]')).toHaveTextContent('Freigegeben');
  });

  it('zeigt Revisionen in Dokumentreihenfolge und behält Duplikate', () => {
    const { documentLayer } = renderPanel();
    const list = within(documentLayer).getByRole('list', { name: 'Revisionen im Dokument' });
    expect(within(list).getAllByRole('listitem').map((item) => item.getAttribute('data-revision'))).toEqual(['2.0', '1.0', '2.0']);
    expect(within(documentLayer).getByText(/keine Rücksetzfunktion/)).toBeInTheDocument();
  });

  it('zeigt einen fehlenden Parteiverweis als Befund', () => {
    const { documentLayer } = renderPanel();
    expect(within(documentLayer).getByText(/Partei party-missing fehlt in metadata\.parties\./)).toBeInTheDocument();
  });

  it('zeigt Schreibmarker und ein gekürztes Diff', () => {
    const { workspaceLayer } = renderPanel();
    expect(within(workspaceLayer).getByText('Schreibmarker')).toBeInTheDocument();
    expect(within(workspaceLayer).getByText(/Diff-Ergebnis ist gekürzt/)).toBeInTheDocument();
  });
});
