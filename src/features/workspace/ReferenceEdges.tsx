import { Link } from 'react-router';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import { EDGE_STATE_LABELS, ROOT_TYPE_LABELS, referenceRequirement } from '@/domain/workspaceStations';
import type { VerbundView, WorkspaceDocumentView, WorkspaceEdgeView } from '@/state/workspaceVerbundView';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';

const TERM = 'text-xs font-medium text-[var(--color-text-muted)]';

function Target({ view, edge }: Readonly<{ view: VerbundView; edge: WorkspaceEdgeView }>) {
  if (edge.state === 'external') {
    // Ein externer Verweis bleibt Text: kein Link, kein Netzbezug.
    return <span className="break-all font-mono text-xs">{edge.href}</span>;
  }
  const target = edge.targetLocalId === undefined
    ? undefined
    : view.documents.find((document) => document.localId === edge.targetLocalId);
  return (
    <span className="flex flex-col gap-0.5">
      {edge.href !== undefined && <span className="break-all font-mono text-xs">{edge.href}</span>}
      {target && (
        <Link
          to={buildWorkspaceDocumentUrl(view.verbund.verbundId, target.localId)}
          className={`w-fit rounded catalog-prose-link text-sm ${FOCUS_RING}`}
        >
          {ROOT_TYPE_LABELS[target.rootType]}{target.title ? `: ${target.title}` : ''}
        </Link>
      )}
    </span>
  );
}

function EdgeRow({ view, edge }: Readonly<{ view: VerbundView; edge: WorkspaceEdgeView }>) {
  return (
    <li data-edge-state={edge.state} className="px-4 py-3">
      <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <dt className={TERM}>Feld</dt>
        <dd className="break-all font-mono text-xs text-[var(--color-text-primary)]">{edge.path}</dd>
        <dt className={TERM}>Pflicht</dt>
        <dd className="text-sm">{referenceRequirement(edge.kind) ?? 'keine Angabe'}</dd>
        <dt className={TERM}>Zustand</dt>
        <dd className="text-sm">
          {edge.catalogWithheld ? 'Gebundener Katalogstand gesperrt' : edge.class1Unavailable ? 'BSI-Katalog in dieser Sitzung nicht geladen' : EDGE_STATE_LABELS[edge.state]}
          {edge.diagnosticCode && <span className="ml-2 font-mono text-xs text-[var(--color-text-secondary)]">{edge.diagnosticCode}</span>}
        </dd>
        {(edge.href !== undefined || edge.targetLocalId !== undefined) && (
          <>
            <dt className={TERM}>Verweis</dt>
            <dd className="min-w-0 text-[var(--color-text-secondary)]"><Target view={view} edge={edge} /></dd>
          </>
        )}
      </dl>
    </li>
  );
}

/** Referenzkanten eines Dokuments mit Feld, Pflicht, Zustand und Verweis. */
export function ReferenceEdges({ view, document }: Readonly<{ view: VerbundView; document: WorkspaceDocumentView }>) {
  const edges = view.edges.get(document.localId) ?? [];
  return (
    <section aria-labelledby={`dokument-referenzen-${document.localId}`} className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <div className="flex min-h-panel-head items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4">
        <h2 id={`dokument-referenzen-${document.localId}`} className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Referenzkanten</h2>
        <span className="text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">{edges.length}</span>
      </div>
      {edges.length === 0 ? (
        <p className="px-4 py-3 text-sm text-[var(--color-text-secondary)]">Dieses Dokument verweist auf kein anderes Objekt.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {edges.map((edge, index) => <EdgeRow key={`${edge.path}|${edge.kind}|${index}`} view={view} edge={edge} />)}
        </ul>
      )}
    </section>
  );
}
