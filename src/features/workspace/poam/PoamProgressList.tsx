import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { parsePoamDocument } from '@/adapters/oscalPoamDocument';
import { buildWorkspaceDocumentUrl } from '@/app/routes';
import {
  derivePoamProgress, readRoleTitles, sortPoamProgress, type DeadlineState, type PoamProgressRow, type PoamProgressSort,
} from '@/domain/poamProgress';
import type { WorkspaceDocumentView } from '@/state/workspaceVerbundView';
import { useWorkspace } from '@/hooks/useWorkspace';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';

interface ProgressRow extends PoamProgressRow {
  readonly localId: WorkspaceDocumentView['localId'];
  readonly documentTitle?: string;
}

const MARK_BASE = 'inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium leading-4';
const MARK = `${MARK_BASE} whitespace-nowrap`;
const UNKNOWN_TONE = 'border-[var(--color-border-strong)] bg-transparent text-[var(--color-text-secondary)]';
const STATE_TONE: Readonly<Record<DeadlineState, string>> = {
  'noch nicht fällig': 'border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]',
  überschritten: 'border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] font-semibold text-[var(--color-danger-text)]',
  'Fristlage unbekannt': UNKNOWN_TONE,
};
const LIFECYCLE_LABELS: Readonly<Record<string, string>> = {
  recommendation: 'Empfehlung', planned: 'Geplant', completed: 'Umsetzung erklärt',
};
const SORTS: readonly { readonly value: PoamProgressSort; readonly label: string }[] = [
  { value: 'frist', label: 'Frist' }, { value: 'verantwortlich', label: 'Verantwortlich' }, { value: 'stand', label: 'Stand' },
];
const SELECT = `min-h-touch rounded-md bg-transparent py-1 pr-1 text-sm font-semibold text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] desktop:min-h-0 ${FOCUS_RING}`;
const COMPUTED_AT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });

function Stand({ row }: Readonly<{ row: ProgressRow }>) {
  if (row.completed) {
    return (
      <span className="flex flex-wrap gap-1">
        <span className={`${MARK} border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] text-[var(--color-text-primary)]`}>Umsetzung erklärt</span>
        <span className={`${MARK} border-dashed ${UNKNOWN_TONE}`}>Wirksamkeit nicht belegt</span>
      </span>
    );
  }
  if (row.lifecycles.length === 0) return <span className="text-xs text-[var(--color-text-muted)]">ohne Maßnahme</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {row.lifecycles.map((entry, index) => (
        <span key={`${entry.value}${index}`} className={`${MARK_BASE} max-w-full border-[var(--color-border-default)] text-[var(--color-text-secondary)]`}>
          {entry.documented ? LIFECYCLE_LABELS[entry.value] : <span className="min-w-0 break-all">unbekannt: <span className="font-mono">{entry.value || '—'}</span></span>}
        </span>
      ))}
    </span>
  );
}

/** Erklärte Umsetzung belegt keine Einhaltung eines abgelaufenen Termins; sie zählt auch nicht als überschritten. */
function DeadlineMark({ row }: Readonly<{ row: ProgressRow }>) {
  if (row.completed && row.deadlineState === 'überschritten') {
    return <span data-deadline-state="Einhaltung nicht belegt" className={`${MARK} ${UNKNOWN_TONE}`}>Einhaltung nicht belegt</span>;
  }
  return <span data-deadline-state={row.deadlineState} className={`${MARK} ${STATE_TONE[row.deadlineState]}`}>{row.deadlineState}</span>;
}

function Gaps({ row }: Readonly<{ row: ProgressRow }>) {
  if (row.deadlineGaps.length === 0) return null;
  return (
    <span className="basis-full break-words text-xs text-[var(--color-text-secondary)]">
      {row.deadlineState === 'überschritten' && 'Grundlage unvollständig: '}
      {row.deadlineGaps.map((gap, index) => (
        <span key={gap.path}>
          {index > 0 && ' · '}{gap.reason}{gap.value !== undefined && <> <span className="break-all font-mono">{gap.value || '—'}</span></>}
        </span>
      ))}
    </span>
  );
}

function Sources({ row }: Readonly<{ row: ProgressRow }>) {
  if (row.sources.length === 0) return null;
  return (
    <details className="basis-full">
      <summary className={`inline-flex min-h-touch cursor-pointer items-center rounded text-xs font-medium text-[var(--color-primary-main)] desktop:min-h-0 ${FOCUS_RING}`}>Quellen</summary>
      <dl className="mt-1.5 divide-y divide-[var(--color-border-subtle)] rounded-md border border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] text-xs">
        {row.sources.map((source) => (
          <div key={`${source.label}${source.path}`} className="grid gap-x-3 gap-y-0.5 px-2.5 py-1.5 desktop:grid-cols-[12rem_minmax(0,1fr)_auto]">
            <dt className="text-[var(--color-text-secondary)]">{source.label}</dt>
            <dd className="break-all font-mono text-[var(--color-text-secondary)]">{source.path}</dd>
            <dd className="break-all font-mono text-[var(--color-text-primary)]">{source.value || '—'}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function Row({ verbundId, row }: Readonly<{ verbundId: string; row: ProgressRow }>) {
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-1 px-4 py-2.5">
      <span className="flex w-60 shrink-0 flex-wrap items-center gap-1.5">
        <span className="font-mono text-xs tabular-nums text-[var(--color-text-primary)]">{row.deadline ?? '—'}</span>
        <DeadlineMark row={row} />
      </span>
      <span className="min-w-0 flex-1 basis-56 space-y-0.5">
        <Link to={buildWorkspaceDocumentUrl(verbundId, row.localId)} className={`flex min-h-touch items-center rounded text-sm text-[var(--color-text-primary)] hover:underline desktop:min-h-0 ${FOCUS_RING}`}>
          {row.title ?? 'Ohne Titel'}
        </Link>
        <span className="block truncate text-xs text-[var(--color-text-secondary)]">
          {row.requirementIds.length > 0 && <span className="font-mono">{row.requirementIds.join(', ')} · </span>}
          {row.documentTitle}
        </span>
      </span>
      <span className="w-40 shrink-0 text-sm text-[var(--color-text-secondary)]">{row.responsible.join(', ') || '—'}</span>
      <span className="w-48 shrink-0 space-y-1">
        <Stand row={row} />
        {row.riskStatuses.length > 0 && <span className="block font-mono text-xs text-[var(--color-text-muted)]">risk.status {row.riskStatuses.join(', ')}</span>}
      </span>
      <Gaps row={row} />
      <Sources row={row} />
    </li>
  );
}

function Section({ title, verbundId, rows }: Readonly<{ title: string; verbundId: string; rows: readonly ProgressRow[] }>) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="px-4 pt-3 text-sm font-semibold text-[var(--color-text-primary)]">
        {title} <span className="font-normal tabular-nums text-[var(--color-text-secondary)]">{rows.length}</span>
      </h3>
      {rows.length === 0
        ? <p className="px-4 pb-3 pt-1 text-sm text-[var(--color-text-secondary)]">Keine.</p>
        : <ul className="mt-2 divide-y divide-[var(--color-border-subtle)] border-t border-[var(--color-border-subtle)]">{rows.map((row) => <Row key={`${row.localId}${row.key}`} verbundId={verbundId} row={row} />)}</ul>}
    </section>
  );
}

/** Fristenzentrierte, rein lesende Liste über alle POA&Ms eines Verbunds (Story 12). */
export function PoamProgressList({ verbundId, documents: members }: Readonly<{ verbundId: string; documents: readonly WorkspaceDocumentView[] }>) {
  const { documents } = useWorkspace();
  const [result, setResult] = useState<{ rows: ProgressRow[]; at: Date } | 'failed' | null>(null);
  const [sort, setSort] = useState<PoamProgressSort>('frist');
  const sortId = useId();

  useEffect(() => {
    let current = true;
    const at = new Date();
    const poams = members.filter((member) => member.rootType === 'plan-of-action-and-milestones');
    void Promise.all(poams.map(async (member) => {
      const loaded = await documents.getDocument(member.localId);
      if (!loaded.ok || loaded.value?.rootType !== 'plan-of-action-and-milestones') throw new Error('POAM_PROGRESS_LOAD_FAILED');
      const view = parsePoamDocument(loaded.value.source, { trustClass: loaded.value.trustClass }).view;
      return derivePoamProgress(view, at, readRoleTitles(loaded.value.source))
        .map((row) => ({ ...row, localId: member.localId, documentTitle: member.title }));
    })).then((rows) => { if (current) setResult({ rows: rows.flat(), at }); })
      .catch(() => { if (current) setResult('failed'); });
    return () => { current = false; };
  }, [documents, members]);

  if (!result) return <output className="block px-4 pb-3 pt-2 text-sm text-[var(--color-text-secondary)]">Umsetzungsfortschritt wird geladen…</output>;
  if (result === 'failed') return <p role="alert" className="px-4 pb-3 pt-2 text-sm text-[var(--color-danger-text)]">Umsetzungsfortschritt konnte nicht geladen werden.</p>;
  const sorted = sortPoamProgress(result.rows, sort);
  return (
    <div className="border-t border-[var(--color-border-subtle)] pb-2">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Umsetzungsfortschritt</h2>
        <span className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
          <label htmlFor={sortId}>Sortierung</label>
          <select id={sortId} className={SELECT} value={sort} onChange={(event) => setSort(event.target.value as PoamProgressSort)}>
            {SORTS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        </span>
      </div>
      <p className="px-4 pt-1 text-xs text-[var(--color-text-secondary)]">
        Frist wie im Dokument, mit dessen Zeitzonenangabe. Fristlage berechnet aus Frist und Systemzeit am <time dateTime={result.at.toISOString()}>{COMPUTED_AT.format(result.at)}</time>.
      </p>
      <Section title="Umsetzung nicht erklärt" verbundId={verbundId} rows={sorted.filter((row) => !row.completed)} />
      <Section title="Umsetzung erklärt" verbundId={verbundId} rows={sorted.filter((row) => row.completed)} />
    </div>
  );
}
