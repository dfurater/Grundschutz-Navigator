import { useState } from 'react';
import type { AssessmentFinding, AssessmentObservation, AssessmentResult, AssessmentRisk } from '@/domain/assessmentResultsModel';
import { DOCUMENTED_LIFECYCLES } from '@/domain/poamProgress';
import { Button } from '@/components/Button';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';

export type AssessmentSection = 'findings' | 'observations' | 'risks';
export const SECTION_NAMES = { findings: 'Findings', observations: 'Observations', risks: 'Risks' } as const;
export type AssessmentEntry = AssessmentFinding | AssessmentObservation | AssessmentRisk;
const RISK_STATUSES = ['open', 'investigating', 'remediating', 'deviation-requested', 'deviation-approved', 'closed'];

export function Vocabulary({ value, kind }: Readonly<{ value: string | undefined; kind: 'risk' | 'lifecycle' }>) {
  if (value === undefined) return <span>—</span>;
  const documented = (kind === 'risk' ? RISK_STATUSES : DOCUMENTED_LIFECYCLES) as readonly string[];
  return <span className="break-words font-mono text-xs">{!documented.includes(value) && 'unbekannt: '}{value}</span>;
}

function ObservationUses({ result, observation }: Readonly<{ result: AssessmentResult; observation: AssessmentObservation }>) {
  const id = observation.uuid?.toLowerCase();
  const references = (entity: AssessmentFinding | AssessmentRisk) => entity.relatedObservations.some(ref => ref.observationUuid?.toLowerCase() === id);
  const findings = id ? result.findings.filter(references).length : 0;
  const risks = id ? result.risks.filter(references).length : 0;
  return <span className="text-xs tabular-nums">{findings || risks ? `${findings} Findings · ${risks} Risks` : 'ohne Verwendung'}</span>;
}

function RowCells({ section, entry, result }: Readonly<{ section: AssessmentSection; entry: AssessmentEntry; result: AssessmentResult }>) {
  if (section === 'findings') {
    const finding = entry as AssessmentFinding;
    return <>
      <span className="break-words font-mono text-xs">{finding.target?.targetId ?? '—'}</span>
      <span className="col-span-2 row-start-2 break-words desktop:col-span-1 desktop:row-auto">{finding.title ?? finding.uuid ?? 'Finding'}<span className="mt-1 block font-mono text-xs text-[var(--color-text-secondary)]">{finding.uuid}</span></span>
      <span className="col-start-2 row-start-1 break-words text-right font-mono text-xs desktop:col-auto desktop:row-auto desktop:text-left">{finding.target?.status?.state ?? '—'}</span>
      <span className="col-span-2 text-xs tabular-nums text-[var(--color-text-secondary)] desktop:col-span-1">{finding.hasLinkedEvidence ? `${finding.relatedObservations.length} Observations · ${finding.relatedRisks.length} Risks` : 'ohne verknüpften Beleg'}</span>
    </>;
  }
  if (section === 'observations') {
    const observation = entry as AssessmentObservation;
    return <>
      <span className="break-words font-mono text-xs">{observation.evidence?.collected ?? '—'}</span>
      <span className="break-words">{observation.title ?? observation.uuid ?? 'Observation'}</span>
      <span className="break-words font-mono text-xs">{observation.evidence?.methods.map(method => method.value).join(', ') || '—'}</span>
      <span className="break-words text-xs">{observation.evidence?.validity}</span>
      <ObservationUses result={result} observation={observation} />
    </>;
  }
  const risk = entry as AssessmentRisk;
  return <>
    <span className="break-words font-mono text-xs">{risk.deadline ?? '—'}</span>
    <span className="break-words">{risk.title ?? risk.uuid ?? 'Risiko'}<span className="mt-1 block font-mono text-xs text-[var(--color-text-secondary)]">{risk.uuid}</span></span>
    <Vocabulary kind="risk" value={risk.status} />
    <span className="space-y-1">{risk.remediations.length ? risk.remediations.map(remediation => <span key={remediation.path} className="block"><Vocabulary kind="lifecycle" value={remediation.lifecycle} /></span>) : <span className="text-xs">ohne Maßnahme</span>}</span>
    <span className="text-xs tabular-nums text-[var(--color-text-secondary)]">{result.findings.filter(finding => finding.relatedRisks.some(reference => reference.riskUuid?.toLowerCase() === risk.uuid?.toLowerCase())).length} Findings</span>
  </>;
}

const HEADERS = { findings: ['Anforderung', 'Finding', 'Zielstatus', 'Belege'], observations: ['Erhoben', 'Observation', 'Methode', 'Gültigkeit', 'Verwendet in'], risks: ['Frist', 'Risiko', 'Status', 'Maßnahme', 'Findings'] } as const;

export function AssessmentResultList({ result, section, selected, onSelect }: Readonly<{
  result: AssessmentResult;
  section: AssessmentSection;
  selected?: string;
  onSelect: (entry: AssessmentEntry) => void;
}>) {
  const [visible, setVisible] = useState(50);
  const entries = result[section];
  const columns = section === 'findings' ? 'grid-cols-2 desktop:grid-cols-[1fr_3fr_1.5fr_1.5fr]' : 'grid-cols-1 desktop:grid-cols-[1fr_3fr_1fr_1.5fr_1fr]';
  return <section aria-label={SECTION_NAMES[section]} className="min-h-0 flex-1 overflow-y-auto">
    <div aria-hidden="true" className={`hidden gap-4 border-y border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] px-4 py-2 text-xs text-[var(--color-text-secondary)] desktop:grid ${columns}`}>
      {HEADERS[section].map(label => <span key={label}>{label}</span>)}
    </div>
    {entries.length === 0 ? <p className="p-4 text-sm text-[var(--color-text-secondary)]">Keine {SECTION_NAMES[section]}.</p> : <ul className="divide-y divide-[var(--color-border-subtle)]">
      {entries.slice(0, visible).map(entry => <li key={entry.path}>
        <button type="button" data-assessment-entry={entry.path} aria-pressed={selected === entry.path} onClick={() => onSelect(entry)} className={`grid min-h-touch w-full gap-x-4 gap-y-1 px-4 py-3 text-left text-sm text-[var(--color-text-primary)] ${columns} ${selected === entry.path ? 'bg-[var(--color-primary-light)]' : 'hover:bg-[var(--color-surface-subtle)]'} ${FOCUS_RING} focus-visible:ring-inset`}>
          <RowCells entry={entry} section={section} result={result} />
        </button>
      </li>)}
    </ul>}
    {entries.length > visible && <Button variant="secondary" className="m-4 min-h-touch tabular-nums" onClick={() => setVisible(count => count + 50)}>Weitere {SECTION_NAMES[section]} · {visible} von {entries.length}</Button>}
  </section>;
}
