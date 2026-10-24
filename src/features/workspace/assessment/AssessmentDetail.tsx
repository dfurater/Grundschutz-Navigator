import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/Button';
import type { ArOrigin, ArReference, ArRelatedObservation, AssessmentFinding, AssessmentObservation, AssessmentResult, AssessmentRisk } from '@/domain/assessmentResultsModel';
import type { AssessmentResultsContent } from '@/features/workspace/assessment/loadAssessmentResults';
import { EvidenceResourcePreview } from '@/features/workspace/assessment/EvidenceResourcePreview';
import { Vocabulary, type AssessmentEntry, type AssessmentSection } from '@/features/workspace/assessment/AssessmentResultList';

function Group({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return <section className="space-y-2 border-t border-[var(--color-border-default)] pt-3">
    <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{title}</h3>
    {children}
  </section>;
}
function Field({ name, children }: Readonly<{ name: string; children: ReactNode }>) {
  return <div className="grid grid-cols-1 gap-1 sm:grid-cols-2"><dt className="text-[var(--color-text-secondary)]">{name}</dt><dd className="min-w-0 break-words">{children ?? '—'}</dd></div>;
}
function referenceLabel(reference: ArReference | null) {
  if (!reference) return 'nicht auflösbar';
  if (reference.status === 'resolved') return 'aufgelöst';
  return reference.status === 'not-resolvable-in-context' ? 'nicht auflösbar im aktuellen Kontext' : 'nicht auflösbar';
}
function Origins({ origins, content }: Readonly<{ origins: readonly ArOrigin[]; content: AssessmentResultsContent }>) {
  const actors = origins.flatMap(origin => origin.actors);
  return <Group title="Urheberangabe">
    {actors.length ? <ul className="space-y-2">{actors.map(actor => <li key={actor.path} className="break-words">
      <span>{content.actorNames.get(actor.path) ?? actor.actorUuid ?? 'Urheber ohne Kennung'}</span>
      <span className="block text-xs text-[var(--color-text-secondary)]">{actor.type} · Rolle: {actor.roleId ?? 'nicht angegeben'} · {referenceLabel(actor.reference)}</span>
    </li>)}</ul> : <p className="text-[var(--color-text-secondary)]">Keine Urheberangabe.</p>}
  </Group>;
}
function ObservationReferences({ references, content }: Readonly<{ references: readonly ArRelatedObservation[]; content: AssessmentResultsContent }>) {
  return <>{references.map(reference => {
    const target = reference.reference?.state === 'resolved' ? content.model.results.flatMap(result => result.observations).find(observation => observation.uuid?.toLowerCase() === reference.observationUuid?.toLowerCase()) : undefined;
    return <li key={reference.path} className="space-y-1 break-words py-2">
      <p className="text-xs text-[var(--color-text-secondary)]">related-observations</p>
      <p>{target?.title ?? reference.observationUuid ?? 'Observation ohne Kennung'}</p>
      <p className="text-xs">{reference.reference?.state === 'resolved' ? 'aufgelöst' : 'nicht auflösbar'}{target?.evidence && ` · ${target.evidence.validity} · ${target.evidence.collected ?? '—'}`}</p>
    </li>;
  })}</>;
}
function Evidence({ observations, content }: Readonly<{ observations: readonly AssessmentObservation[]; content: AssessmentResultsContent }>) {
  const entries = observations.flatMap(observation => observation.evidence?.evidence ?? []);
  return <Group title="Evidenz">
    {entries.length ? entries.map(entry => {
      const reference = entry.href;
      const resource = reference?.kind === 'resource' ? content.resources.get(reference.resource.uuid.toLowerCase()) : undefined;
      return <div key={entry.path} className="space-y-2 break-words">
        {content.evidenceDescriptions.get(entry.path) && <p className="whitespace-pre-wrap">{content.evidenceDescriptions.get(entry.path)}</p>}
        {resource ? <EvidenceResourcePreview resource={resource.resource} resolved={resource.resolved} /> : <p className="text-[var(--color-text-secondary)]">{reference ? `${reference.href} · nicht als lokale Ressource auflösbar` : 'Beschreibende Evidenz ohne Ressourcenverweis.'}</p>}
      </div>;
    }) : <p className="text-[var(--color-text-secondary)]">Keine Evidenzressourcen verknüpft.</p>}
  </Group>;
}
function Finding({ finding, content }: Readonly<{ finding: AssessmentFinding; content: AssessmentResultsContent }>) {
  const observations = content.model.results.flatMap(item => item.observations).filter(observation => finding.relatedObservations.some(ref => ref.reference?.state === 'resolved' && ref.observationUuid?.toLowerCase() === observation.uuid?.toLowerCase()));
  return <>
    <dl className="space-y-2"><Field name="Anforderung"><span className="font-mono text-xs">{finding.target?.targetId ?? '—'}</span></Field><Field name="Zielstatus"><span className="font-mono text-xs">{finding.target?.status?.state ?? '—'}</span></Field></dl>
    <p className="whitespace-pre-wrap break-words">{finding.description}</p>
    <Origins origins={finding.origins} content={content} />
    <Group title="Rückverfolgung">
      {!finding.hasLinkedEvidence && <p>ohne verknüpften Beleg</p>}
      <ul className="divide-y divide-[var(--color-border-subtle)]">
        <ObservationReferences references={finding.relatedObservations} content={content} />
        {finding.relatedRisks.map(reference => {
          const risk = reference.reference.status === 'resolved' ? content.model.results.flatMap(item => item.risks).find(item => item.uuid?.toLowerCase() === reference.riskUuid?.toLowerCase()) : undefined;
          return <li key={reference.path} className="break-words py-2"><p className="text-xs text-[var(--color-text-secondary)]">related-risks</p><p>{risk?.title ?? reference.riskUuid}</p><p className="text-xs">{referenceLabel(reference.reference)} · {risk?.status}</p></li>;
        })}
        {finding.implementationStatement && <li className="break-words py-2"><p className="text-xs text-[var(--color-text-secondary)]">implementation-statement-uuid · SSP-Aussage</p><p className="font-mono text-xs">{finding.implementationStatementUuid}</p><p>{referenceLabel(finding.implementationStatement)}</p>{content.sspStatements.get(finding.path) && <p className="whitespace-pre-wrap">{content.sspStatements.get(finding.path)}</p>}</li>}
      </ul>
    </Group>
    <Evidence observations={observations} content={content} />
  </>;
}
function Observation({ observation, result, content }: Readonly<{ observation: AssessmentObservation; result: AssessmentResult; content: AssessmentResultsContent }>) {
  const evidence = observation.evidence;
  const users = [...result.findings, ...result.risks].filter(entry => entry.relatedObservations.some(ref => ref.observationUuid?.toLowerCase() === observation.uuid?.toLowerCase()));
  return <>
    <p className="whitespace-pre-wrap break-words">{observation.description}</p>
    <dl className="space-y-2"><Field name="Methode">{evidence?.methods.map(method => method.value).join(', ')}</Field><Field name="Typ">{evidence?.types.map(type => type.value).join(', ')}</Field><Field name="Erhoben">{evidence?.collected}</Field><Field name="Läuft ab">{evidence?.expires}</Field><Field name="Gültigkeit">{evidence?.validity}</Field></dl>
    <Origins origins={observation.origins} content={content} />
    <Group title="Gegenstand">
      {observation.subjects.length ? <ul className="space-y-2">{observation.subjects.map(subject => <li key={subject.path} className="break-words">{subject.title ?? subject.subjectUuid} · {subject.type} · {referenceLabel(subject.reference)}</li>)}</ul> : <p>Keine Gegenstände angegeben.</p>}
    </Group>
    <Group title="Verwendet in">{users.length ? <ul className="space-y-2">{users.map(entry => <li key={entry.path} className="break-words">{entry.title ?? entry.uuid}</li>)}</ul> : <p>ohne Verwendung</p>}</Group>
    <Evidence observations={[observation]} content={content} />
  </>;
}
function Risk({ risk, result, content }: Readonly<{ risk: AssessmentRisk; result: AssessmentResult; content: AssessmentResultsContent }>) {
  const findings = result.findings.filter(finding => finding.relatedRisks.some(ref => ref.riskUuid?.toLowerCase() === risk.uuid?.toLowerCase()));
  return <>
    <dl className="space-y-2"><Field name="Status"><Vocabulary kind="risk" value={risk.status} /></Field><Field name="Frist">{risk.deadline}</Field></dl>
    <p className="whitespace-pre-wrap break-words">{risk.description}</p><p className="whitespace-pre-wrap break-words">{risk.statement}</p>
    <Origins origins={risk.origins} content={content} />
    <Group title="Maßnahmen">
      {risk.remediations.length ? <ul className="space-y-3">{risk.remediations.map(remediation => <li key={remediation.path} id={remediation.uuid} className="space-y-2 break-words">
        <p className="font-semibold">{remediation.title}</p><Vocabulary kind="lifecycle" value={remediation.lifecycle} /><p className="font-mono text-xs">{remediation.uuid}</p><p className="whitespace-pre-wrap">{remediation.description}</p><Origins origins={remediation.origins} content={content} />
      </li>)}</ul> : <p>ohne Maßnahme</p>}
    </Group>
    <Group title="Rückverfolgung"><ul className="divide-y divide-[var(--color-border-subtle)]">
      {findings.map(finding => <li key={finding.path} className="break-words py-2"><p className="text-xs text-[var(--color-text-secondary)]">finding.related-risks</p>{finding.title}</li>)}
      <ObservationReferences references={risk.relatedObservations} content={content} />
    </ul>{!findings.length && !risk.relatedObservations.length && <p>Keine Verweise.</p>}</Group>
    <Group title="Bedrohungskennung">{risk.threatIds.length ? <ul className="space-y-2">{risk.threatIds.map(threat => <li key={threat.path} className="break-words"><p>{threat.id}</p><p className="text-xs text-[var(--color-text-secondary)]">{threat.system}</p><p className="font-mono text-xs">{threat.href}</p></li>)}</ul> : <p>Keine Bedrohungskennung.</p>}</Group>
  </>;
}

export function AssessmentDetail({ section, entry, result, content, onClose, mobile }: Readonly<{
  section: AssessmentSection; entry: AssessmentEntry; result: AssessmentResult; content: AssessmentResultsContent; onClose: () => void; mobile: boolean;
}>) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (mobile) heading.current?.focus(); }, [entry.path, mobile]);
  const label = { findings: 'Finding', observations: 'Observation', risks: 'Risiko' }[section];
  return <aside aria-label={`${label}-Detail`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--color-surface-base)] md:w-96 md:flex-none md:border-l md:border-[var(--color-border-default)] desktop:w-110">
    <div className="flex min-h-panel-head shrink-0 items-center justify-between gap-2 border-b border-[var(--color-border-default)] px-4">
      <h2 className="text-sm font-semibold">{label}</h2><Button variant="ghost" size="sm" className="min-h-touch" onClick={onClose}>{mobile ? 'Zur Liste' : 'Detail schließen'}</Button>
    </div>
    <div className="min-h-0 space-y-4 overflow-y-auto p-4 text-sm text-[var(--color-text-primary)]" id={entry.uuid}>
      <h3 ref={heading} tabIndex={-1} className="break-words text-base font-semibold leading-snug">{entry.title ?? label}</h3>
      <p className="break-all font-mono text-xs text-[var(--color-text-secondary)]">{entry.uuid}</p>
      {section === 'findings' && <Finding finding={entry as AssessmentFinding} content={content} />}
      {section === 'observations' && <Observation observation={entry as AssessmentObservation} result={result} content={content} />}
      {section === 'risks' && <Risk risk={entry as AssessmentRisk} result={result} content={content} />}
    </div>
  </aside>;
}
