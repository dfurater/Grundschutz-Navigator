import { Link, useParams } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildVerbundUrl, buildWorkspaceDocumentUrl } from '@/app/routes';
import { EDGE_STATE_LABELS, ROOT_TYPE_LABELS, referenceRequirement } from '@/domain/workspaceStations';
import type { VerbundView, WorkspaceDocumentView, WorkspaceEdgeView } from '@/state/workspaceVerbundView';
import { FOCUS_RING, OriginLabel, ValidityBadge } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { WorkspaceStatePage, useRoutedVerbund } from '@/features/workspace/WorkspaceStatePage';

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
          {edge.class1Unavailable ? 'BSI-Katalog in dieser Sitzung nicht geladen' : EDGE_STATE_LABELS[edge.state]}
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

function DocumentDetail({ view, document }: Readonly<{ view: VerbundView; document: WorkspaceDocumentView }>) {
  const edges = view.edges.get(document.localId) ?? [];
  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <Link
          to={buildVerbundUrl(view.verbund.verbundId)}
          className={`inline-flex min-h-touch items-center rounded text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] desktop:min-h-0 ${FOCUS_RING}`}
        >
          ‹ {view.verbund.name}
        </Link>
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">{ROOT_TYPE_LABELS[document.rootType]}</p>
        <h1 className="type-page-title break-words">{document.title ?? ROOT_TYPE_LABELS[document.rootType]}</h1>
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="font-mono text-xs text-[var(--color-text-secondary)]">{document.oscalVersion}</span>
          <OriginLabel />
          <ValidityBadge state={document.documentState} />
        </div>
      </header>
      <WorkspaceNotices />
      <section aria-labelledby="dokument-referenzen" className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
        <div className="flex min-h-panel-head items-center justify-between gap-2 border-b border-[var(--color-border-subtle)] px-4">
          <h2 id="dokument-referenzen" className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Referenzkanten</h2>
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
    </div>
  );
}

/** Referenzkanten eines lokalen Dokuments mit Feld, Pflicht und Zustand (GSPP-300). */
export function DocumentReferenceDetailPage() {
  const { localId } = useParams();
  const routed = useRoutedVerbund();
  if (routed.status !== 'ready') return <WorkspaceStatePage state={routed.status} />;
  const document = routed.view.documents.find((entry) => entry.localId === localId);
  if (!document) return <WorkspaceStatePage state="document-not-found" />;
  return (
    <>
      <PageTitle title={PAGE_TITLES.workspaceDocument} />
      <DocumentDetail view={routed.view} document={document} />
    </>
  );
}
