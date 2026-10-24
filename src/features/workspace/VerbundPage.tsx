import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router';
import { PageTitle } from '@/app/PageTitle';
import { PAGE_TITLES } from '@/app/pageTitles';
import { buildWorkspaceDocumentUrl, buildWorkspaceIndexUrl } from '@/app/routes';
import {
  ROOT_TYPE_LABELS, STATION_DEFINITIONS, isWorkspaceStation, type WorkspaceStation,
} from '@/domain/workspaceStations';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING, OriginLabel, ValidityBadge } from '@/features/workspace/DocumentMarks';
import { WorkspaceNotices } from '@/features/workspace/WorkspaceNotices';
import { StationCards, latestSavedAt, relativeTime } from '@/features/workspace/StationCards';
import { NameForm } from '@/features/workspace/VerbundOverviewPage';
import { WorkspaceStatePage, useRoutedVerbund } from '@/features/workspace/WorkspaceStatePage';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { VerbundId } from '@/domain/workspaceModel';
import { useWorkspace } from '@/hooks/useWorkspace';
import { NewProfileForm } from '@/features/workspace/profile/NewProfileForm';
import { NewSspForm } from '@/features/workspace/ssp/NewSspForm';
import { WorkspaceFileImport } from '@/features/workspace/WorkspaceFileImport';
import { PoamProgressList } from '@/features/workspace/poam/PoamProgressList';

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

function DiagnosticList({ diagnostics }: Readonly<{ diagnostics: VerbundView['diagnostics'] }>) {
  return diagnostics.length === 0 ? (
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
      );
}

function Diagnostics({ diagnostics }: Readonly<{ diagnostics: VerbundView['diagnostics'] }>) {
  return (
    <section aria-labelledby="verbund-diagnosen" className={PANEL}>
      <h2 id="verbund-diagnosen" className={PANEL_LABEL}>Diagnosen</h2>
      <DiagnosticList diagnostics={diagnostics} />
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
      <WorkspaceFileImport verbundId={view.verbund.verbundId as VerbundId} rootType="profile" rejectionCode="OSCAL_ROOT_NOT_PROFILE" label="Profil" />
    </div>
  );
}

/** Aktionen der Station SSP: Neuanlage mit Baseline-Wahl und Aufnahme einer SSP-Datei. */
function SspStationActions({ view }: Readonly<{ view: VerbundView }>) {
  const { writable } = useWorkspace();
  const [creating, setCreating] = useState(false);
  if (creating) return <NewSspForm view={view} onCancel={() => setCreating(false)} />;
  return (
    <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
      <Button className="min-h-touch desktop:min-h-0" disabled={!writable} onClick={() => setCreating(true)}>Neues SSP</Button>
      <WorkspaceFileImport verbundId={view.verbund.verbundId as VerbundId} rootType="system-security-plan" rejectionCode="OSCAL_ROOT_NOT_SSP" label="SSP" />
    </div>
  );
}

/** Einklappbare Zeile unter den Stationskarten, standardmäßig zu. */
function Disclosure({ title, count, children }: Readonly<{ title: string; count: number; children: ReactNode }>) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId}>
      <details className={`group ${PANEL}`}>
        <summary className={`flex min-h-touch cursor-pointer list-none items-center [&::-webkit-details-marker]:hidden gap-2 rounded-md px-4 text-sm font-semibold text-[var(--color-text-primary)] desktop:min-h-11 ${FOCUS_RING}`}>
          <span aria-hidden="true" className="text-[var(--color-text-muted)] transition-[rotate] group-open:rotate-90">›</span>
          <span id={titleId}>{title}</span>
          <span className="font-normal tabular-nums text-[var(--color-text-secondary)]">· {count}</span>
        </summary>
        <div className="border-t border-[var(--color-border-subtle)] pb-2">{children}</div>
      </details>
    </section>
  );
}

function DocumentList({ verbundId, documents, empty }: Readonly<{ verbundId: string; documents: readonly WorkspaceDocumentView[]; empty: string }>) {
  return documents.length === 0 ? (
    <p className="px-4 pb-3 pt-2 text-sm text-[var(--color-text-secondary)]">{empty}</p>
  ) : (
    <ul className="mt-2 divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">
      {documents.map((document) => <DocumentRow key={document.localId} verbundId={verbundId} document={document} />)}
    </ul>
  );
}

/** Kopf der Verbund-Übersicht (Bild 2): Name, Umbenennen, Löschen mit Bestätigung, Herkunft und Speicherstand. */
function VerbundHeader({ view, now }: Readonly<{ view: VerbundView; now: number }>) {
  // Eine offene Umbenennung überdauert Stations- und Verbundwechsel (`renameDrafts` im Provider).
  const { writable, renameVerbund, deleteVerbund, renameDrafts } = useWorkspace();
  const navigate = useNavigate();
  const { verbund, documents } = view;
  const [renaming, setRenaming] = useState(() => renameDrafts.has(verbund.verbundId));
  const [confirming, setConfirming] = useState(false);
  const stopRenaming = () => {
    renameDrafts.delete(verbund.verbundId);
    setRenaming(false);
  };
  const saved = relativeTime(latestSavedAt([verbund.savedAt, ...documents.map((document) => document.savedAt)]), now);
  return (
    <header className="space-y-3 border-b border-[var(--color-border-default)] pb-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Informationsverbund</p>
          <h1 className="type-page-title break-words">{verbund.name}</h1>
        </div>
        {!renaming && (
          <div className="flex gap-2">
            <Button
              variant="secondary"
              className="min-h-touch desktop:min-h-0"
              disabled={!writable}
              onClick={() => {
                if (!renameDrafts.has(verbund.verbundId)) renameDrafts.set(verbund.verbundId, verbund.name);
                setRenaming(true);
              }}
            >
              Umbenennen
            </Button>
            <button
              type="button"
              disabled={!writable}
              onClick={() => setConfirming(true)}
              className={`inline-flex min-h-touch items-center justify-center rounded-md px-3 py-2 text-sm font-medium text-[var(--color-danger-text)] transition-colors hover:bg-[var(--color-danger-surface)] disabled:cursor-not-allowed disabled:opacity-50 desktop:min-h-0 ${FOCUS_RING}`}
            >
              Löschen…
            </button>
          </div>
        )}
      </div>
      {renaming && (
        <NameForm
          label="Neuer Name"
          submitLabel="Speichern"
          initial={renameDrafts.get(verbund.verbundId) ?? verbund.name}
          disabled={!writable}
          onChange={(name) => renameDrafts.set(verbund.verbundId, name)}
          onSubmit={async (name) => {
            const result = await renameVerbund(verbund.verbundId as VerbundId, name);
            if (!result.ok) return false;
            // Wurde während des Speicherns weitergetippt, bleibt das Formular mit dieser Eingabe offen.
            if (renameDrafts.get(verbund.verbundId)?.trim() !== name) return true;
            stopRenaming();
            return true;
          }}
          onCancel={stopRenaming}
        />
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <OriginLabel />
        <span aria-live="polite" className="flex items-center gap-1.5 text-xs tabular-nums text-[var(--color-text-secondary)]">
          {saved && (
            <>
              Automatisch gespeichert · {saved}
            </>
          )}
        </span>
      </div>
      <ConfirmDialog
        open={confirming}
        title="Informationsverbund endgültig löschen?"
        confirmLabel="Endgültig löschen"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void deleteVerbund(verbund.verbundId as VerbundId).then((result) => {
            if (result.ok) void navigate(buildWorkspaceIndexUrl(), { replace: true });
          });
        }}
      >
        <p>
          „{verbund.name}“ wird mit allen Dokumenten, Entwürfen und Verknüpfungen aus diesem Browser gelöscht. Das lässt sich nicht rückgängig machen. Bereits exportierte Dateien bleiben erhalten.
        </p>
      </ConfirmDialog>
    </header>
  );
}

/** Verbund-Übersicht nach Bild 2: Kopf, Stationskarten, darunter alle Dokumente und Diagnosen. */
function VerbundOverview({ view }: Readonly<{ view: VerbundView }>) {
  const catalogHref = useOutletContext<{ catalogHref?: string } | undefined>()?.catalogHref ?? '/';
  // Bezugszeit der relativen Zeitangaben; eine neue Route setzt sie neu.
  const [now] = useState(Date.now);
  const { verbund, documents, diagnostics } = view;
  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4 p-4 desktop:px-7 desktop:py-6">
      <VerbundHeader view={view} now={now} />
      <WorkspaceNotices />
      <section aria-labelledby="verbund-stationen" className="space-y-3">
        <h2 id="verbund-stationen" className="sr-only">Stationen</h2>
        <p className="max-w-prose text-sm text-[var(--color-text-secondary)]">
          Die fünf Stationen sind unabhängig voneinander betretbar. Eine leere oder unvollständige Station blockiert die übrigen nicht — Lücken werden angezeigt, nicht verhindert.
        </p>
        <StationCards view={view} catalogHref={catalogHref} now={now} />
      </section>
      <Disclosure title="Alle Dokumente" count={documents.length}>
        <DocumentList verbundId={verbund.verbundId} documents={documents} empty="Dieser Informationsverbund enthält noch kein Dokument." />
      </Disclosure>
      <Disclosure title="Diagnosen" count={diagnostics.length}>
        <DiagnosticList diagnostics={diagnostics} />
      </Disclosure>
    </div>
  );
}

/** Stationsroute: Stationsaktionen, gefilterte Dokumentliste und Diagnosen. */
function StationContent({ view, station }: Readonly<{ view: VerbundView; station: WorkspaceStation }>) {
  const { verbund, documents, diagnostics } = view;
  const shown = documents.filter((document) => STATION_DEFINITIONS[station].rootTypes.includes(document.rootType));

  return (
    <div className="space-y-4 p-4">
      <header className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Informationsverbund</p>
        <h1 className="type-page-title break-words">{verbund.name}</h1>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <OriginLabel />
          <span aria-live="polite" className="text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">
            {`${shown.length} von ${plural(documents.length, 'Dokument', 'Dokumenten')}`}
          </span>
        </div>
      </header>
      <WorkspaceNotices />
      <section aria-labelledby="verbund-dokumente" className={PANEL}>
        <h2 id="verbund-dokumente" className={PANEL_LABEL}>{`Station ${STATION_DEFINITIONS[station].title}`}</h2>
        <p className="px-4 text-xs text-[var(--color-text-secondary)]">{STATION_DEFINITIONS[station].explanation}</p>
        {station === 'profile' && <ProfileStationActions key={verbund.verbundId} view={view} />}
        {station === 'ssp' && <SspStationActions key={verbund.verbundId} view={view} />}
        {station === 'assessment' && <div className="px-4 pt-3"><WorkspaceFileImport key={verbund.verbundId} verbundId={verbund.verbundId} rootType="assessment-results" rejectionCode="OSCAL_ROOT_NOT_ASSESSMENT_RESULTS" label="Prüfergebnisse" /></div>}
        <DocumentList verbundId={verbund.verbundId} documents={shown} empty="An dieser Station liegt noch kein Dokument." />
        {station === 'poam' && <PoamProgressList verbundId={verbund.verbundId} documents={documents} />}
      </section>
      <Diagnostics diagnostics={diagnostics} />
    </div>
  );
}

/** Verbund-Übersicht ohne Station, sonst die Stationsroute. */
export function VerbundPage() {
  const { station } = useParams();
  const routed = useRoutedVerbund();
  const validStation = station === undefined || isWorkspaceStation(station);
  if (!validStation) return <WorkspaceStatePage state="not-found" />;
  if (routed.status !== 'ready') return <WorkspaceStatePage state={routed.status} />;
  return (
    <>
      <PageTitle title={PAGE_TITLES.verbund} />
      {station === undefined
        ? <VerbundOverview view={routed.view} />
        : <StationContent view={routed.view} station={station as WorkspaceStation} />}
    </>
  );
}
