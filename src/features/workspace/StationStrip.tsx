import { Link } from 'react-router';
import { buildStationUrl, buildVerbundUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import {
  STATION_DEFINITIONS, WORKSPACE_STATIONS, documentValidity, type DocumentValidity, type WorkspaceStation,
} from '@/domain/workspaceStations';
import type { WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';

export type StationSelection = WorkspaceStation | 'all';

/** Entwurf, sobald ein Dokument der Station Entwurf ist; ohne Dokument eine Lücke (`undefined`). */
export function stationValidity(documents: readonly WorkspaceDocumentView[]): DocumentValidity | undefined {
  if (documents.length === 0) return undefined;
  return documents.some((document) => documentValidity(document.documentState) === 'Entwurf') ? 'Entwurf' : 'Gültig';
}

export function stationDocuments(documents: readonly WorkspaceDocumentView[], station: WorkspaceStation) {
  return documents.filter((document) => STATION_DEFINITIONS[station].rootTypes.includes(document.rootType));
}

const DOT: Readonly<Record<DocumentValidity, string>> = {
  Entwurf: 'bg-document-draft-border',
  Gültig: 'bg-document-valid-border',
};

const TAB = `flex min-h-touch shrink-0 items-center gap-1.5 whitespace-nowrap text-sm transition-colors ${FOCUS_RING}
  compact:rounded-md compact:border compact:px-3
  desktop:-mb-px desktop:border-b-2 desktop:px-3`;
const CURRENT = `font-semibold text-[var(--color-accent-default)]
  compact:border-[var(--color-accent-soft)] compact:bg-[var(--color-accent-soft)]
  desktop:border-[var(--color-accent-default)]`;
const IDLE = `text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]
  compact:border-[var(--color-border-strong)] compact:bg-[var(--color-surface-base)] compact:hover:bg-[var(--color-surface-subtle)]
  desktop:border-transparent`;

/**
 * Stationsreiter eines Informationsverbunds unter der Kopfzeile (GSPP-307,
 * Bild 2 und 6): auf dem Desktop unterstrichene Reiter, sonst waagerecht
 * scrollende Pillen. Der Punkt fasst die Statuswörter der Station zusammen; der
 * zugängliche Name nennt denselben Zustand. Keine Station ist gesperrt.
 */
export function StationStrip({ verbundId, active, documents }: Readonly<{
  verbundId: string;
  active: StationSelection | null;
  /** Ohne geladene Ansicht entfallen die Statuspunkte. */
  documents?: readonly WorkspaceDocumentView[];
}>) {
  const entries = [
    { key: 'all', title: 'Übersicht', to: buildVerbundUrl(verbundId), current: active === 'all', validity: undefined, gap: false },
    ...WORKSPACE_STATIONS.map((station) => {
      const validity = documents && stationValidity(stationDocuments(documents, station));
      return {
        key: station,
        title: STATION_DEFINITIONS[station].title,
        to: buildStationUrl(verbundId, station),
        current: active === station,
        validity,
        gap: documents !== undefined && validity === undefined,
      };
    }),
  ];
  return (
    <div className="border-b border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <Link
        to={buildWorkspaceIndexUrl()}
        className={`flex min-h-touch items-center gap-1 px-4 text-sm font-semibold text-[var(--color-text-primary)] desktop:hidden ${FOCUS_RING} focus-visible:ring-inset focus-visible:ring-offset-0`}
      >
        <span aria-hidden="true">‹</span> Informationsverbünde
      </Link>
      <nav aria-label="Stationen" className="scrollbar-hidden overflow-x-auto px-4 pb-2 compact:pt-1 desktop:px-7 desktop:pb-0">
        <ul className="flex gap-2 desktop:gap-4">
          {entries.map(({ key, title, to, current, validity, gap }) => (
            <li key={key} className="flex">
              <Link to={to} aria-current={current ? 'page' : undefined} className={`${TAB} ${current ? CURRENT : IDLE}`}>
                {validity && <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[validity]}`} />}
                {title}
                {validity && <span className="sr-only">, {validity}</span>}
                {gap && <span className="sr-only">, noch kein Dokument</span>}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
