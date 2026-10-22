import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { buildStationUrl } from '@/app/routes';
import { Button } from '@/components/Button';
import { IconChevronLeft } from '@/components/icons';
import type { WorkspaceStation } from '@/domain/workspaceStations';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING, OriginLabel, ValidityBadge } from '@/features/workspace/DocumentMarks';

/** Werkzeugleiste einer Bearbeitungsansicht: Rückweg zur Station, Titel, Zustand, Version und Löschen. */
export function EditorToolbar({ view, document, station, backLabel, deleteLabel, title, state, desktop, onDelete }: Readonly<{
  view: VerbundView;
  document: WorkspaceDocumentView;
  station: WorkspaceStation;
  backLabel: string;
  deleteLabel: string;
  title: string;
  state: 'draft' | 'export-ready';
  desktop: boolean;
  onDelete: () => void;
}>) {
  const remove = <Button variant="ghost" size="sm" className="min-h-touch desktop:min-h-0" onClick={onDelete}>{deleteLabel}</Button>;
  const back = (
    <Link to={buildStationUrl(view.verbund.verbundId, station)} className={`inline-flex min-h-touch items-center gap-1 rounded text-sm catalog-link-color desktop:min-h-0 ${FOCUS_RING}`}>
      <IconChevronLeft className="h-3.5 w-3.5" />{backLabel}
    </Link>
  );
  if (desktop) {
    return (
      <div className="flex h-panel-head shrink-0 items-center gap-3 border-b border-[var(--color-border-default)] px-4">
        {back}
        <span aria-hidden="true" className="text-[var(--color-border-strong)]">/</span>
        <h1 className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">{title}</h1>
        <ValidityBadge state={state} />
        <span className="font-mono text-xs text-[var(--color-text-secondary)]">OSCAL {document.oscalVersion}</span>
        <span className="ml-auto">{remove}</span>
      </div>
    );
  }
  return (
    <header className="space-y-2 px-4 pb-3 pt-2">
      {back}
      <h1 className="type-page-title break-words">{title}</h1>
      <div className="flex flex-wrap items-center gap-1.5">
        <ValidityBadge state={state} />
        <OriginLabel />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs text-[var(--color-text-secondary)]">OSCAL {document.oscalVersion}</p>
        {remove}
      </div>
    </header>
  );
}

/** Rechtes Panel einer Bearbeitungsansicht (Desktop) mit festem Fuß für Speichern und Export. */
export function EditorPanel({ label, children, footer }: Readonly<{ label: string; children: ReactNode; footer: ReactNode }>) {
  return (
    <aside aria-label={label} className="flex w-90 shrink-0 flex-col border-l border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <h2 className="flex h-panel-head shrink-0 items-center border-b border-[var(--color-border-default)] px-4 text-sm font-semibold">{label}</h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      <div className="shrink-0 border-t border-[var(--color-border-default)] p-4">{footer}</div>
    </aside>
  );
}
