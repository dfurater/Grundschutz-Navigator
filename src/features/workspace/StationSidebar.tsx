import type { MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { buildStationUrl, buildVerbundUrl } from '@/app/routes';
import {
  CATALOG_STATION, STATION_DEFINITIONS, WORKSPACE_STATIONS, type WorkspaceStation,
} from '@/domain/workspaceStations';
import type { WorkspaceDocumentView } from '@/state/workspaceVerbundView';

export type StationSelection = WorkspaceStation | 'all';

export interface StationSidebarProps {
  readonly verbundId: string;
  readonly active: StationSelection | null;
  /** Dokumente des Verbunds; ohne geladene Ansicht entfallen die Zählungen. */
  readonly documents?: readonly WorkspaceDocumentView[];
  readonly catalogHref: string;
  /** Die Station Catalog wechselt den Bereich; die Shell speichert vorher offene Entwürfe. */
  readonly onSelectCatalog: (href: string) => void;
  /** Element rechts im Kopf, etwa Einklappen oder Schließen. */
  readonly trailing?: ReactNode;
  readonly onItemActivate?: () => void;
}

const ITEM = 'flex min-h-touch w-full items-start gap-2 rounded px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] desktop:min-h-0';

function StationLink({ to, title, explanation, count, current, onClick }: Readonly<{
  to: string;
  title: string;
  explanation: string;
  count?: number;
  current: boolean;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
}>) {
  return (
    <li>
      <Link
        to={to}
        aria-current={current ? 'page' : undefined}
        onClick={onClick}
        className={`${ITEM} ${current ? 'bg-[var(--color-accent-soft)]' : 'hover:bg-[var(--color-surface-subtle)]'}`}
      >
        <span className="min-w-0 flex-1">
          <span className={`block text-sm ${current ? 'font-semibold text-[var(--color-accent-default)]' : 'font-medium text-[var(--color-text-primary)]'}`}>{title}</span>
          <span className="block text-xs text-[var(--color-text-secondary)]">{explanation}</span>
        </span>
        {count !== undefined && (
          <span className="mt-0.5 shrink-0 text-xs tabular-nums text-[var(--color-text-secondary)]">
            {count}
            <span className="sr-only">{count === 1 ? ' Dokument' : ' Dokumente'}</span>
          </span>
        )}
      </Link>
    </li>
  );
}

/** Arbeitsnavigation eines Informationsverbunds: Stationen ohne Reihenfolge, Lücken ohne Sperre (ADR-11). */
export function StationSidebar({
  verbundId, active, documents, catalogHref, onSelectCatalog, trailing, onItemActivate,
}: StationSidebarProps) {
  const countFor = (station: WorkspaceStation) => documents?.filter(
    (document) => STATION_DEFINITIONS[station].rootTypes.includes(document.rootType),
  ).length;

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="flex h-panel-head shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border-default)] pl-4 pr-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Stationen</span>
        {trailing}
      </div>
      <nav aria-label="Stationen" className="min-h-0 flex-1 overflow-y-auto p-2">
        <ul className="space-y-0.5">
          <StationLink
            to={buildVerbundUrl(verbundId)}
            title="Übersicht"
            explanation="Alle Dokumente"
            count={documents?.length}
            current={active === 'all'}
            onClick={onItemActivate}
          />
          <StationLink
            to={catalogHref}
            title={CATALOG_STATION.title}
            explanation={CATALOG_STATION.explanation}
            current={false}
            onClick={(event) => {
              if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              onSelectCatalog(catalogHref);
            }}
          />
          {WORKSPACE_STATIONS.map((station) => (
            <StationLink
              key={station}
              to={buildStationUrl(verbundId, station)}
              title={STATION_DEFINITIONS[station].title}
              explanation={STATION_DEFINITIONS[station].explanation}
              count={countFor(station)}
              current={active === station}
              onClick={onItemActivate}
            />
          ))}
        </ul>
      </nav>
    </div>
  );
}
