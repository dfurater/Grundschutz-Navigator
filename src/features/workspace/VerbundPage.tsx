import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildStationUrl, buildWorkspaceDocumentUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import {
  ROOT_TYPE_LABELS, STATION_DEFINITIONS, WORKSPACE_STATIONS, isWorkspaceStation, type WorkspaceStation,
} from '@/domain/workspaceStations';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING, OriginLabel, ValidityBadge } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { StationStrip } from '@/features/workspace/StationStrip';
import { WorkspaceStatePage, useRoutedVerbund } from '@/features/workspace/WorkspaceStatePage';
import { Button } from '@/components/Button';
import type { VerbundId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { NewProfileForm } from '@/features/workspace/profile/NewProfileForm';
import { ProfileFileImport } from '@/features/workspace/profile/ProfileFileImport';
import { SspFileImport } from '@/features/workspace/ssp/SspFileImport';

const PANEL = 'rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-base)]';
const PANEL_LABEL = 'px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]';

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function DocumentRow({ verbundId, document }: Readonly<{ verbundId: string; document: WorkspaceDocumentView }>) {
  return (
    <li>
      <Link
        to={buildWorkspaceDocumentUrl(verbundId, document.localId)}
        className={`flex min-h-touch flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-[var(--color-surface-subtle)] ${FOCUS_RING} focus-visible:ring-inset focus-visible:ring-offset-0`}
      >
        <span className="text-sm font-semibold text-[var(--color-text-primary)]">{ROOT_TYPE_LABELS[document.rootType]}</span>
        <span className="min-w-0 flex-1 basis-40 truncate text-sm text-[var(--color-text-secondary)]">{document.title}</span>
        <span className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs text-[var(--color-text-secondary)]">{document.oscalVersion}</span>
          <OriginLabel />
          <ValidityBadge state={document.documentState} />
        </span>
      </Link>
    </li>
  );
}

function Orientation({ verbundId, gaps }: Readonly<{ verbundId: string; gaps: readonly WorkspaceStation[] }>) {
  return (
    <section aria-labelledby="verbund-orientierung" className={PANEL}>
      <h2 id="verbund-orientierung" className={PANEL_LABEL}>Orientierung</h2>
      <div className="space-y-2 px-4 pb-3 pt-1 text-sm text-[var(--color-text-secondary)]">
        <p>Alle Stationen stehen offen, eine Reihenfolge ist nicht nötig.</p>
        {gaps.length > 0 && (
          <p>
            Noch ohne Dokument:{' '}
            {gaps.map((station, index) => (
              <span key={station}>
                {index > 0 && ', '}
                <Link to={buildStationUrl(verbundId, station)} className={`rounded catalog-prose-link ${FOCUS_RING}`}>
                  {STATION_DEFINITIONS[station].title}
                </Link>
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

function Diagnostics({ diagnostics }: Readonly<{ diagnostics: VerbundView['diagnostics'] }>) {
  return (
    <section aria-labelledby="verbund-diagnosen" className={PANEL}>
      <h2 id="verbund-diagnosen" className={PANEL_LABEL}>Diagnosen</h2>
      {diagnostics.length === 0 ? (
        <p className="px-4 pb-3 pt-1 text-sm text-[var(--color-text-secondary)]">Keine Diagnosen.</p>
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {diagnostics.map((diagnostic, index) => (
            <li key={`${diagnostic.code}${diagnostic.path}${index}`} className="flex flex-wrap gap-x-3 px-4 py-2 font-mono text-xs">
              <span className="text-[var(--color-text-primary)]">{diagnostic.code}</span>
              <span className="break-all text-[var(--color-text-secondary)]">{diagnostic.path}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Aktionen der Station Profile: Neuanlage über das Importziel und Aufnahme einer Profil-Datei. */
function ProfileStationActions({ view }: Readonly<{ view: VerbundView }>) {
  const { writable } = useWorkspace();
  const [creating, setCreating] = useState(false);
  if (creating) return <NewProfileForm view={view} onCancel={() => setCreating(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
      <Button className="min-h-touch desktop:min-h-0" disabled={!writable} onClick={() => setCreating(true)}>Neues Profil</Button>
      <ProfileFileImport verbundId={view.verbund.verbundId as VerbundId} />
    </div>
  );
}

function VerbundContent({ view, station }: Readonly<{ view: VerbundView; station: WorkspaceStation | undefined }>) {
  const { verbund, documents, diagnostics } = view;
  const shown = station
    ? documents.filter((document) => STATION_DEFINITIONS[station].rootTypes.includes(document.rootType))
    : documents;
  const drafts = documents.filter((document) => document.documentState === 'draft').length;
  const gaps = WORKSPACE_STATIONS.filter((entry) =>
    !documents.some((document) => STATION_DEFINITIONS[entry].rootTypes.includes(document.rootType)));
  const counts = station
    ? `${shown.length} von ${plural(documents.length, 'Dokument', 'Dokumenten')}`
    : [plural(documents.length, 'Dokument', 'Dokumente'), plural(drafts, 'Entwurf', 'Entwürfe'), plural(diagnostics.length, 'Diagnose', 'Diagnosen')].join(' · ');

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <Link to={buildWorkspaceIndexUrl()} className={`inline-flex min-h-touch items-center rounded text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] desktop:min-h-0 ${FOCUS_RING}`}>
          ‹ Informationsverbünde
        </Link>
        <StationStrip verbundId={verbund.verbundId} station={station} documents={documents} />
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Informationsverbund</p>
        <h1 className="type-page-title break-words">{verbund.name}</h1>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <OriginLabel />
          <span aria-live="polite" className="text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">{counts}</span>
        </div>
      </header>
      <WorkspaceNotices />
      <Orientation verbundId={verbund.verbundId} gaps={gaps} />
      <section aria-labelledby="verbund-dokumente" className={PANEL}>
        <h2 id="verbund-dokumente" className={PANEL_LABEL}>
          {station ? `Station ${STATION_DEFINITIONS[station].title}` : 'Alle Dokumente'}
        </h2>
        {station && <p className="px-4 text-xs text-[var(--color-text-secondary)]">{STATION_DEFINITIONS[station].explanation}</p>}
        {station === 'profile' && <ProfileStationActions view={view} />}
        {station === 'ssp' && <SspFileImport key={verbund.verbundId} verbundId={verbund.verbundId} />}
        {shown.length === 0 ? (
          <p className="px-4 pb-3 pt-2 text-sm text-[var(--color-text-secondary)]">
            {station ? 'An dieser Station liegt noch kein Dokument.' : 'Dieser Informationsverbund enthält noch kein Dokument.'}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
            {shown.map((document) => <DocumentRow key={document.localId} verbundId={verbund.verbundId} document={document} />)}
          </ul>
        )}
      </section>
      <Diagnostics diagnostics={diagnostics} />
    </div>
  );
}

/** Verbundseite und Stationsfilter: Orientierung, Dokumentliste und Diagnosen (Skizze 001). */
export function VerbundPage() {
  const { station } = useParams();
  const routed = useRoutedVerbund();
  const validStation = station === undefined || isWorkspaceStation(station);
  if (!validStation) return <WorkspaceStatePage state="not-found" />;
  if (routed.status !== 'ready') return <WorkspaceStatePage state={routed.status} />;
  return (
    <>
      <PageTitle title={PAGE_TITLES.verbund} />
      <VerbundContent view={routed.view} station={station as WorkspaceStation | undefined} />
    </>
  );
}
