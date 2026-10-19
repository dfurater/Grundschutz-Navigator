import { Link } from 'react-router';
import { buildStationUrl, buildVerbundUrl } from '@/app/routes';
import { STATION_DEFINITIONS, WORKSPACE_STATIONS, type WorkspaceStation } from '@/domain/workspaceStations';
import type { WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';

const CHIP = `flex min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-3 text-sm transition-colors ${FOCUS_RING}`;

/**
 * Stationswahl außerhalb des Desktops (GSPP-307, Bild 6): eine waagerecht
 * scrollende Zeile über dem Inhalt. Die Schublade trägt dieselben Stationen.
 */
export function StationStrip({ verbundId, station, documents }: Readonly<{
  verbundId: string;
  station: WorkspaceStation | undefined;
  documents: readonly WorkspaceDocumentView[];
}>) {
  const entries = [
    { key: 'all', title: 'Übersicht', to: buildVerbundUrl(verbundId), count: documents.length, current: station === undefined },
    ...WORKSPACE_STATIONS.map((entry) => ({
      key: entry,
      title: STATION_DEFINITIONS[entry].title,
      to: buildStationUrl(verbundId, entry),
      count: documents.filter((document) => STATION_DEFINITIONS[entry].rootTypes.includes(document.rootType)).length,
      current: station === entry,
    })),
  ];
  return (
    <nav aria-label="Stationswahl" className="scrollbar-hidden -mx-4 overflow-x-auto px-4 py-1 desktop:hidden">
      <ul className="flex gap-2">
        {entries.map(({ key, title, to, count, current }) => (
          <li key={key} className="flex">
            <Link
              to={to}
              aria-current={current ? 'page' : undefined}
              className={`${CHIP} ${current
                ? 'border-[var(--color-accent-soft)] bg-[var(--color-accent-soft)] font-semibold text-[var(--color-accent-default)]'
                : 'border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)]'}`}
            >
              {title}
              <span className="text-xs tabular-nums">
                {count}
                <span className="sr-only">{count === 1 ? ' Dokument' : ' Dokumente'}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
