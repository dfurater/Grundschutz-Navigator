import { useId, useState, type ReactNode } from 'react';
import { IconCheck, IconChevronDown, IconInfo, IconX } from '@/components/icons';
import { PROFILE_HINT_CODES, type ProfileHintCode } from '@/domain/profileHints';
import { EDGE_STATE_LABELS } from '@/domain/workspaceStations';
import type { ProfileAnalysis } from '@/state/workspaceProfileAnalysis';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { formatCount } from '@/features/workspace/profile/ProfileMarks';

const HINT_LABELS: Readonly<Record<ProfileHintCode, string>> = {
  [PROFILE_HINT_CODES.selectionEmpty]: 'Auswahl ohne Kriterium',
  [PROFILE_HINT_CODES.matchingWithoutPattern]: 'Muster ohne pattern',
  [PROFILE_HINT_CODES.modifyEmpty]: 'modify ohne Inhalt',
  [PROFILE_HINT_CODES.alterWithoutEffect]: 'alter ohne Wirkung',
  [PROFILE_HINT_CODES.removeWithoutCriteria]: 'remove ohne Kriterium',
};

type Outcome = 'passed' | 'hint' | 'failed' | 'open';

interface DiagnosticRow {
  readonly key: string;
  readonly outcome: Outcome;
  readonly result: string;
  readonly stage: string;
  readonly path: string;
}

const OUTCOME_ICON: Readonly<Record<Outcome, ReactNode>> = {
  passed: <IconCheck className="h-4 w-4 text-[var(--color-document-valid-text)]" />,
  hint: <IconInfo className="h-4 w-4 text-[var(--color-warning-text)]" />,
  failed: <IconX className="h-4 w-4 text-[var(--color-danger-text)]" />,
  open: <span className="block h-0.5 w-3 rounded-full bg-[var(--color-text-muted)]" />,
};

function edgeOutcome(state: ProfileAnalysis['imports'][number]['state']): Outcome {
  if (state === 'resolved') return 'passed';
  return state === 'error' || state === 'missing-source' ? 'failed' : 'open';
}

function edgeResult(edge: ProfileAnalysis['imports'][number]): string {
  if (edge.state === 'resolved') return 'Import gebunden';
  return edge.diagnosticCode ? `${EDGE_STATE_LABELS[edge.state]} · ${edge.diagnosticCode}` : EDGE_STATE_LABELS[edge.state];
}

function resolutionSummary(resolution: ProfileAnalysis['resolution']): string {
  if (resolution.status === 'resolved') return formatCount(resolution.index.ids.length);
  return resolution.status === 'error' ? 'Fehler' : 'offen';
}

function rows(analysis: ProfileAnalysis, oscalVersion: string): DiagnosticRow[] {
  const result: DiagnosticRow[] = analysis.hints.map((hint, index) => ({
    key: `hint-${index}`, outcome: 'hint', result: HINT_LABELS[hint.code], stage: 'Hinweis', path: hint.path,
  }));
  result.push(analysis.schema.status === 'passed'
    ? { key: 'schema', outcome: 'passed', result: 'Schema bestanden', stage: 'Schema', path: `oscal_profile_schema.json · ${oscalVersion}` }
    : { key: 'schema', outcome: 'failed', result: analysis.schema.code, stage: 'Schema', path: analysis.schema.path });
  for (const edge of analysis.imports) {
    result.push({
      key: `edge-${edge.path}`,
      outcome: edgeOutcome(edge.state),
      result: edgeResult(edge),
      stage: 'Referenzen',
      path: edge.path,
    });
  }
  const resolution = analysis.resolution;
  if (resolution.status === 'resolved') {
    result.push({ key: 'resolution', outcome: 'passed', result: `${formatCount(resolution.index.ids.length)} Anforderungen aufgelöst`, stage: 'Resolution', path: 'profile → catalog' });
  } else if (resolution.status === 'error') {
    result.push({ key: 'resolution', outcome: 'failed', result: resolution.code, stage: 'Resolution', path: resolution.path });
  } else {
    result.push({ key: 'resolution', outcome: 'open', result: 'Nicht auswertbar', stage: 'Resolution', path: 'profile → catalog' });
  }
  result.push({ key: 'constraints', outcome: 'open', result: 'Nicht geprüft', stage: 'Constraints', path: 'Stufe 4' });
  return result;
}

function Summary({ analysis }: Readonly<{ analysis: ProfileAnalysis }>) {
  const resolved = analysis.imports.filter((edge) => edge.state === 'resolved').length;
  const resolution = analysis.resolution;
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[var(--color-text-secondary)]">
      {analysis.hints.length > 0 && <span>Hinweise <strong className="tabular-nums text-[var(--color-text-primary)]">{analysis.hints.length}</strong></span>}
      <span>Schema <strong className="text-[var(--color-text-primary)]">{analysis.schema.status === 'passed' ? 'bestanden' : 'nicht bestanden'}</strong></span>
      <span className="hidden sm:inline">Referenzen <strong className="tabular-nums text-[var(--color-text-primary)]">{resolved}/{analysis.imports.length}</strong></span>
      <span className="hidden sm:inline">Resolution <strong className="tabular-nums text-[var(--color-text-primary)]">{resolutionSummary(resolution)}</strong></span>
      <span className="hidden sm:inline">Constraints <strong className="text-[var(--color-text-primary)]">nicht geprüft</strong></span>
    </span>
  );
}

/**
 * Diagnosen des Arbeitsstands als aufklappbare Leiste am Fuß der Hauptspalte
 * (Skizze 001, Mockup 6): je Zeile Ergebnis, Stufe und OSCAL-Pfad, nie ein
 * Dokumentwert.
 */
export function ProfileDiagnostics({ analysis, current, failed, oscalVersion }: Readonly<{ analysis: ProfileAnalysis | null; current: boolean; failed: boolean; oscalVersion: string }>) {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const schemaIssues = analysis?.schema.status === 'failed' ? 1 : 0;
  const issues = (analysis?.hints.length ?? 0) + schemaIssues;
  return (
    <section aria-label="Diagnosen" aria-busy={!current} className="border-t border-[var(--color-border-default)] bg-[var(--color-surface-base)]">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        className={`flex min-h-panel-head w-full items-center gap-3 px-4 text-left hover:bg-[var(--color-surface-subtle)] ${FOCUS_RING} focus-visible:ring-inset`}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">Diagnosen</span>
        {issues > 0 && <span className="inline-flex min-w-4.5 items-center justify-center rounded-full bg-[var(--color-text-primary)] px-1 text-2xs font-semibold tabular-nums text-[var(--color-text-inverse)]">{issues}</span>}
        {analysis ? <Summary analysis={analysis} /> : <span className="text-sm text-[var(--color-text-secondary)]">{failed ? 'nicht ableitbar' : 'werden abgeleitet'}</span>}
        <IconChevronDown className={`ml-auto h-4 w-4 shrink-0 text-[var(--color-text-muted)] ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && analysis && (
        <ul id={panelId} className="max-h-64 divide-y divide-[var(--color-border-subtle)] overflow-y-auto px-4 pb-2">
          {rows(analysis, oscalVersion).map((row) => (
            <li key={row.key} data-outcome={row.outcome} className="grid grid-cols-[1.25rem_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 py-2 sm:grid-cols-[1.25rem_minmax(0,2fr)_8rem_minmax(0,2fr)]">
              <span aria-hidden="true" className="flex justify-center">{OUTCOME_ICON[row.outcome]}</span>
              <span className="text-sm text-[var(--color-text-primary)]">{row.result}</span>
              <span className="col-start-2 font-mono text-xs text-[var(--color-text-secondary)] sm:col-start-auto">{row.stage}</span>
              <span className="col-start-2 break-all font-mono text-xs text-[var(--color-text-secondary)] sm:col-start-auto">{row.path}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
