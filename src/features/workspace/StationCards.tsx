import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { buildStationUrl } from '@/app/routes';
import type { DocumentMetric } from '@/domain/verbundStationMetrics';
import type { OscalRootKey } from '@/domain/oscalVersionMatrix';
import { CATALOG_STATION, STATION_DEFINITIONS, type DocumentValidity, type WorkspaceStation } from '@/domain/workspaceStations';
import type { VerbundView, WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { stationDocuments, stationValidity } from '@/features/workspace/StationStrip';

const RELATIVE = new Intl.RelativeTimeFormat('de', { numeric: 'auto' });
const count = new Intl.NumberFormat('de-DE');

/** „gerade eben“, „vor 2 Minuten“ aus einem ISO-Zeitpunkt; unlesbare Werte ergeben `undefined`. */
export function relativeTime(iso: string | undefined, now: number): string | undefined {
  const at = iso === undefined ? Number.NaN : Date.parse(iso);
  if (Number.isNaN(at)) return undefined;
  const seconds = Math.round((at - now) / 1000);
  // Unter einer Minute keine Sekundenzählung: Sie veraltete sofort.
  if (seconds > -60) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes > -60) return RELATIVE.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours > -24) return RELATIVE.format(hours, 'hour');
  return RELATIVE.format(Math.round(hours / 24), 'day');
}

export function latestSavedAt(values: readonly string[]): string | undefined {
  return values.reduce<string | undefined>((latest, value) => (latest === undefined || Date.parse(value) > Date.parse(latest) ? value : latest), undefined);
}

const MARK = 'inline-flex items-center whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium leading-4';
const VALIDITY_TONE: Readonly<Record<DocumentValidity, string>> = {
  Entwurf: 'border-document-draft-border bg-document-draft-bg text-document-draft-text',
  Gültig: 'border-document-valid-border bg-document-valid-bg text-document-valid-text',
};

function Validity({ value }: Readonly<{ value: DocumentValidity }>) {
  return <span data-validity={value} className={`${MARK} ${VALIDITY_TONE[value]}`}>{value}</span>;
}

/** Die Kennzahl der Station; mehrere Dokumente desselben Typs ergeben die Dokumentanzahl. */
function metricOf(documents: readonly WorkspaceDocumentView[], rootType: OscalRootKey): DocumentMetric | number | undefined {
  const matching = documents.filter((document) => document.rootType === rootType);
  if (matching.length > 1) return matching.length;
  return matching[0]?.metric;
}

function metricText(metric: DocumentMetric | number | undefined): string | undefined {
  if (typeof metric === 'number') return `${count.format(metric)} Dokumente`;
  switch (metric?.kind) {
    case 'profile': return `${count.format(metric.included)} von ${count.format(metric.available)} aufgenommen`;
    case 'ssp': return `${count.format(metric.documented)} von ${count.format(metric.baseline)} dokumentiert`;
    case 'assessment-results': return `${count.format(metric.assessed)} geprüft · ${count.format(metric.notSatisfied)} nicht erfüllt`;
    case 'poam': return `${count.format(metric.open)} offene ${metric.open === 1 ? 'Maßnahme' : 'Maßnahmen'}`;
    default: return undefined;
  }
}

const CARD = 'flex flex-col gap-1 rounded-md border bg-[var(--color-surface-base)] p-4';
const FIGURE = 'text-base font-semibold tabular-nums text-[var(--color-text-primary)]';
const META = 'text-xs tabular-nums text-[var(--color-text-secondary)]';
const GAP = 'text-sm text-[var(--color-text-secondary)]';

function StationCard({ eyebrow, title, explanation, validity, children, action, to, label, dashed = false }: Readonly<{
  eyebrow: string;
  title: string;
  explanation: string;
  validity?: DocumentValidity;
  children: ReactNode;
  action: string;
  to: string;
  /** Zugänglicher Name des Aktionslinks: Aktion, Titel, Status und Kennzahl in einem Satz. */
  label: string;
  dashed?: boolean;
}>) {
  return (
    <li className={`${CARD} ${dashed ? 'border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)]' : 'border-[var(--color-border-default)]'}`}>
      <span className="font-mono text-xs text-[var(--color-text-muted)]">{eyebrow}</span>
      <span className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold leading-snug text-[var(--color-text-primary)]">{title}</h3>
        {validity && <Validity value={validity} />}
      </span>
      <p className="text-sm text-[var(--color-text-secondary)]">{explanation}</p>
      <div className="mt-auto space-y-1 pt-3">{children}</div>
      <Link to={to} aria-label={label} className={`mt-2 inline-flex min-h-touch items-center self-start rounded text-sm font-semibold text-[var(--color-accent-default)] hover:underline desktop:min-h-0 ${FOCUS_RING}`}>
        {action} <span aria-hidden="true">&nbsp;→</span>
      </Link>
    </li>
  );
}

function changed(documents: readonly WorkspaceDocumentView[], now: number): string | undefined {
  const time = relativeTime(latestSavedAt(documents.map((document) => document.savedAt)), now);
  return time && `zuletzt geändert ${time}`;
}

function label(action: string, title: string, parts: readonly (string | undefined)[]): string {
  return [action, title, ...parts].filter(Boolean).join(', ');
}

const NO_DOCUMENT = 'Noch kein Dokument';

function DocumentStationCard({ verbundId, station, documents, action, now, extra }: Readonly<{
  verbundId: string;
  station: Exclude<WorkspaceStation, 'assessment'>;
  documents: readonly WorkspaceDocumentView[];
  action: string;
  now: number;
  extra?: ReactNode;
}>) {
  const { title, explanation, rootTypes } = STATION_DEFINITIONS[station];
  const members = stationDocuments(documents, station);
  const validity = stationValidity(members);
  const figure = members.length === 0 ? undefined : metricText(metricOf(members, rootTypes[0]));
  const time = changed(members, now);
  return (
    <StationCard
      eyebrow={rootTypes[0]}
      title={title}
      explanation={explanation}
      validity={validity}
      action={action}
      to={buildStationUrl(verbundId, station)}
      label={label(action, title, [validity ?? NO_DOCUMENT, figure])}
    >
      {members.length === 0 ? <p className={GAP}>{NO_DOCUMENT}</p> : (
        <>
          {figure && <p className={FIGURE}>{figure}</p>}
          {time && <p className={META}>{time}</p>}
        </>
      )}
      {extra}
    </StationCard>
  );
}

function AssessmentRow({ title, documents, metric }: Readonly<{ title: string; documents: readonly WorkspaceDocumentView[]; metric?: string }>) {
  const validity = stationValidity(documents);
  return (
    <div className="border-t border-[var(--color-border-subtle)] pt-2">
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-[var(--color-text-primary)]">{title}</span>
        {validity ? <Validity value={validity} /> : <span className={META}>{NO_DOCUMENT}</span>}
      </span>
      {metric && <p className={META}>{metric}</p>}
    </div>
  );
}

/**
 * Die fünf Stationskarten der Verbund-Übersicht (GSPP-307, Bild 2): Catalog,
 * Profile, SSP, Assessment, POA&M. Keine Karte ist gesperrt; eine leere
 * Station zeigt die Lücke.
 */
export function StationCards({ view, catalogHref, now }: Readonly<{ view: VerbundView; catalogHref: string; now: number }>) {
  const { verbund, documents } = view;
  const verbundId = verbund.verbundId;
  const plans = documents.filter((document) => document.rootType === 'assessment-plan');
  const results = documents.filter((document) => document.rootType === 'assessment-results');
  const resultsMetric = results.length === 0 ? undefined : metricText(metricOf(results, 'assessment-results'));
  const assessment = STATION_DEFINITIONS.assessment;
  const resultsIncomplete = results.length === 0 || stationValidity(results) === 'Entwurf';
  const catalogFigure = view.catalogControls === undefined ? undefined : `${count.format(view.catalogControls)} Anforderungen`;
  const poamMetric = metricOf(stationDocuments(documents, 'poam'), 'plan-of-action-and-milestones');
  const overdue = typeof poamMetric === 'object' && poamMetric.kind === 'poam' ? poamMetric.overdue : 0;

  return (
    <ul className="grid gap-4 md:grid-cols-2 desktop:grid-cols-5">
      <StationCard
        eyebrow="catalog"
        title={CATALOG_STATION.title}
        explanation={CATALOG_STATION.explanation}
        action="Katalog öffnen"
        to={catalogHref}
        label={label('Katalog öffnen', CATALOG_STATION.title, [catalogFigure])}
        dashed
      >
        {catalogFigure && <p className={FIGURE}>{catalogFigure}</p>}
      </StationCard>
      <DocumentStationCard verbundId={verbundId} station="profile" documents={documents} action="Anforderungspaket bearbeiten" now={now} />
      <DocumentStationCard verbundId={verbundId} station="ssp" documents={documents} action="Umsetzung bearbeiten" now={now} />
      <StationCard
        eyebrow={assessment.rootTypes.join(' / ')}
        title={assessment.title}
        explanation={assessment.explanation}
        action="Prüfung öffnen"
        to={buildStationUrl(verbundId, 'assessment')}
        label={label('Prüfung öffnen', assessment.title, [
          `Prüfplan ${stationValidity(plans) ?? NO_DOCUMENT}`,
          `Prüfergebnisse ${stationValidity(results) ?? NO_DOCUMENT}`,
          resultsMetric,
        ])}
      >
        <AssessmentRow title="Prüfplan" documents={plans} />
        <AssessmentRow title="Prüfergebnisse" documents={results} metric={resultsMetric} />
      </StationCard>
      <DocumentStationCard
        verbundId={verbundId}
        station="poam"
        documents={documents}
        action="Umsetzungsplanung öffnen"
        now={now}
        extra={(
          <>
            {overdue > 0 && (
              <p className={META}>
                <span className={`${MARK} border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]`}>{count.format(overdue)} überfällig</span>
                {' '}· berechnet aus Frist und Systemzeit
              </p>
            )}
            {resultsIncomplete && (
              <p className={`rounded border px-2 py-1.5 text-xs ${VALIDITY_TONE.Entwurf}`}>
                Bereits aktiv, obwohl die Prüfergebnisse noch nicht vollständig sind — keine erzwungene Reihenfolge.
              </p>
            )}
          </>
        )}
      />
    </ul>
  );
}
