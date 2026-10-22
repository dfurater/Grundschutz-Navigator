import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildVerbundUrl } from '@/app/routes';
import { ROOT_TYPE_LABELS } from '@/domain/workspaceStations';
import type { LocalId } from '@/domain/workspaceModel';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { ReferenceEdges } from '@/features/workspace/ReferenceEdges';
import { FOCUS_RING, OriginLabel, ValidityBadge } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { WorkspaceStatePage, useRoutedVerbund } from '@/features/workspace/WorkspaceStatePage';
import { ProfileEditorPage } from '@/features/workspace/profile/ProfileEditorPage';
import { ReviewTab } from '@/features/workspace/review/ReviewTab';
import { SspEditorPage } from '@/features/workspace/ssp/SspEditorPage';

/** Prüfspur schreibgeschützter Roots; der Worker startet erst beim Aufklappen. */
function ReviewSection({ localId }: Readonly<{ localId: LocalId }>) {
  const [open, setOpen] = useState(false);
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <summary className={`min-h-touch cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] ${FOCUS_RING} focus-visible:ring-inset desktop:min-h-0`}>
        Prüfung und Freigabe
      </summary>
      {open && <div className="border-t border-[var(--color-border-default)] p-4"><ReviewTab key={localId} localId={localId} /></div>}
    </details>
  );
}

function DocumentDetail({ view, document }: Readonly<{ view: VerbundView; document: WorkspaceDocumentView }>) {
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
      <ReferenceEdges view={view} document={document} />
      <ReviewSection localId={document.localId} />
    </div>
  );
}

/** Referenzkanten eines lokalen Dokuments (GSPP-300); Profile und SSP öffnen ihre Bearbeitungsansicht (GSPP-292, GSPP-609). */
export function DocumentReferenceDetailPage() {
  const { localId } = useParams();
  const routed = useRoutedVerbund();
  if (routed.status !== 'ready') return <WorkspaceStatePage state={routed.status} />;
  const document = routed.view.documents.find((entry) => entry.localId === localId);
  if (!document) return <WorkspaceStatePage state="document-not-found" />;
  return (
    <>
      <PageTitle title={PAGE_TITLES.workspaceDocument} />
      {document.rootType === 'profile' && <ProfileEditorPage key={document.localId} view={routed.view} document={document} />}
      {document.rootType === 'system-security-plan' && (
        <SspEditorPage key={document.localId} view={routed.view} document={document}>
          <ReferenceEdges view={routed.view} document={document} />
          <ReviewSection localId={document.localId} />
        </SspEditorPage>
      )}
      {document.rootType !== 'profile' && document.rootType !== 'system-security-plan' && <DocumentDetail key={document.localId} view={routed.view} document={document} />}
    </>
  );
}
