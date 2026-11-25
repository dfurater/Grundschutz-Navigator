import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconChevronDown } from '@/components/icons';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import { isOscalUuid } from '@/domain/identifierQuery';
import { BUSINESS_PROCESS_COMPONENT_TYPE } from '@/domain/projectProps';
import { addSspItem, readSspValue, removeSspComponent, SspPatchError } from '@/domain/sspAuthoring';
import { PROCESS_GOALS, PROCESS_GOAL_KEYS, PROCESS_OWNER_ROLE, readProcessDraft, rebaseProcessCategories, SSP_COMPONENT_PATH, writeProcessDraft, type ProcessDraft } from '@/domain/sspProcessEditing';
import { deriveSspProcessProtection, isProcessProtectionBlocker, type ProcessProtection, type SspProcessProtection } from '@/domain/sspProcessProtection';
import { targetProps } from '@/domain/sspTargetObjects';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { FormSection } from '@/features/workspace/ssp/SspFormSections';
import { hasIncompleteProcessInput, ProcessFields, StatusChip } from '@/features/workspace/ssp/SspProcessFields';
import { SspProtocolFields } from '@/features/workspace/ssp/SspFormControls';
import { SspTargetFields, TargetResponsibility } from '@/features/workspace/ssp/SspTargetFields';
import { ApprovalChip, decisionGate, ProcessApprovalBlock, type DecisionGate, useProcessApprovals, type ProcessApprovalView } from '@/features/workspace/ssp/SspProcessApproval';
import { SspProcessApprovalDialog, type ProcessDecisionMode } from '@/features/workspace/ssp/SspProcessApprovalDialog';
import type { ProcessDecisionInput } from '@/domain/sspProcessApproval';
import type { SspEditor } from '@/features/workspace/ssp/useSspEditor';

function protectionCount(protection: ProcessProtection): number {
  return Object.values(protection.objectives).filter(({ value }) => value === 'normal' || value === 'hoch').length;
}

function ProcessStatus({ protection, labelled }: Readonly<{ protection: ProcessProtection; labelled?: boolean }>) {
  const { context, cia, riskConsideration } = protection;
  const risk = {
    required: 'Explizite Risikobetrachtung erforderlich',
    'no-high-trigger': 'Kein hoher Schutzbedarf',
    unknown: 'Risikoanlass offen',
  }[riskConsideration];
  const invalidLabel = protection.diagnostics.some(({ code }) => code === 'SSP_PROCESS_ID_DUPLICATE') ? 'Prozess-ID doppelt' : 'Kontext ungültig';
  const contextLabels = {
    invalid: invalidLabel, 'context-complete': 'Kontext vollständig',
    'context-open': 'Kontext offen', unclassified: 'Kontext offen',
  };
  const contextTone = { invalid: 'error', 'context-complete': 'complete', 'context-open': 'open', unclassified: 'open' } as const;
  const goalTone = { conflict: 'error', complete: 'complete', partial: 'open', unknown: 'open' } as const;
  const goals = cia === 'conflict' ? 'Schutzziele im Konflikt' : `Schutzziele ${protectionCount(protection)} von 3`;
  const statuses = [
    { label: 'Kontext', text: contextLabels[context], tone: contextTone[context] },
    { label: 'Schutzziele', text: goals, tone: goalTone[cia] },
    { label: 'Risikoanlass', text: risk, tone: riskConsideration === 'no-high-trigger' ? 'neutral' : 'open' },
  ] as const;
  return <span className={`flex flex-wrap gap-2 ${labelled ? 'max-sm:flex-col max-sm:items-start' : ''}`}>
    {statuses.map(({ label, text, tone }) => <span key={label} className="inline-flex items-center gap-1.5">
      {labelled && <span className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</span>}
      <StatusChip text={text} tone={tone} />
    </span>)}
  </span>;
}

function objectiveReasons(draft: ProcessDraft, protection: ProcessProtection): string[] {
  return PROCESS_GOAL_KEYS.flatMap(goal => {
    const value = protection.objectives[goal].value;
    if (value === 'normal' || value === 'hoch') return [];
    const categoryId = draft.objectives[goal].category;
    const category = draft.categories.find(item => item.id === categoryId);
    if (categoryId && !category?.level) return [`${PROCESS_GOALS[goal]} · GS++-Zuordnung fehlt, effektiver Wert unbekannt`];
    const reason = value === 'conflict' ? 'Wert, Begründung oder GS++-Zuordnung widersprüchlich' : 'Bewertung offen';
    return [`${PROCESS_GOALS[goal]} · ${reason}`];
  });
}

function contextReasons(draft: ProcessDraft, protection: ProcessProtection): string[] {
  const missing = [
    !draft.id.trim() && 'Prozess-ID fehlt',
    !draft.title.trim() && 'Name fehlt',
    !draft.description.trim() && 'Kurzbeschreibung fehlt',
    !draft.purpose.trim() && 'Zweck fehlt',
    draft.owners.length === 0 && 'Fachliche Verantwortung fehlt',
    draft.applications.length === 0 && !draft.noApplications && 'Anwendungen fehlen',
  ].filter(reason => reason !== false);
  if (protection.context === 'invalid') missing.push('Prozess-ID, Quelldaten oder lokale Verweise prüfen');
  if (protection.context === 'context-open' && !missing.length) missing.push('Kategoriedefinition prüfen');
  return missing;
}

function componentPath(process: ProcessProtection) {
  return [...SSP_COMPONENT_PATH, Number(process.path.split('/').at(-1))];
}

function processLabel(draft: ProcessDraft, process: ProcessProtection): string {
  return draft.id.trim() || draft.title.trim() || `in Zeile ${Number(process.path.split('/').at(-1)) + 1}`;
}

export function openProcessStructure(source: unknown, { processes }: SspProcessProtection) {
  if (processes.length === 0) return [{ key: 'no-processes', text: 'Prozess-Schutzbedarf: kein Geschäftsprozess erfasst' }];
  return processes.flatMap(process => {
    const remaining = PROCESS_GOAL_KEYS.length - protectionCount(process);
    if (process.context === 'context-complete' && remaining === 0) return [];
    const draft = readProcessDraft(source, componentPath(process));
    const label = processLabel(draft, process);
    const reasons = contextReasons(draft, process);
    if (remaining) reasons.push(remaining === 1 ? '1 Schutzziel nicht bewertet' : `${remaining} Schutzziele nicht bewertet`);
    return reasons.map(reason => ({ key: `${process.path}:${reason}`, text: `Prozess ${label}: ${reason}` }));
  });
}

function affectedProcesses(before: SspProcessProtection, after: SspProcessProtection, editedPath: string) {
  const originals = new Map(before.processes.map(process => [process.path, process]));
  return after.processes.filter(process => process.path !== editedPath && process.diagnostics.some(diagnostic =>
    isProcessProtectionBlocker(diagnostic) && !originals.get(process.path)?.diagnostics.some(previous =>
      previous.code === diagnostic.code && previous.path === diagnostic.path && previous.objective === diagnostic.objective)));
}

function referenceOptions(value: unknown, name: string, include: (item: Record<string, unknown>) => boolean) {
  return readArray(value).flatMap(item => {
    if (!isJsonObject(item) || !include(item)) return [];
    const uuid = readString(item.uuid);
    const label = readString(item[name]);
    return uuid && isOscalUuid(uuid) && label?.trim() ? [{ value: uuid, label }] : [];
  });
}

interface DecisionContext extends DecisionGate {
  readonly approval?: ProcessApprovalView;
  readonly parties: ReturnType<typeof referenceOptions>;
}

function ProcessRow({ editor, protection, allProtection, autoOpen, parties, applications, decision }: Readonly<{
  editor: SspEditor;
  protection: ProcessProtection;
  allProtection: SspProcessProtection;
  autoOpen: boolean;
  parties: ReturnType<typeof referenceOptions>;
  applications: ReturnType<typeof referenceOptions>;
  decision: DecisionContext;
}>) {
  const summary = useRef<HTMLElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const path = componentPath(protection);
  const base = readProcessDraft(editor.working, path);
  const [pending, setPending] = useState<{ before: ProcessDraft; value: ProcessDraft }>();
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uses, setUses] = useState<readonly string[]>([]);
  const [deciding, setDeciding] = useState<ProcessDecisionMode>();
  const [notice, setNotice] = useState<string>();
  const { setTargetFormPending } = editor;
  const id = useId();
  const uuid = protection.uuid;
  useEffect(() => () => setTargetFormPending(id, false), [id, setTargetFormPending]);
  // Nach einer geschriebenen Entscheidung wird der Freigabestand neu gelesen und der auslösende Knopf entfällt;
  // der Fokus geht an die Prozesszeile statt auf `body`.
  const decided = useRef(false);
  useEffect(() => {
    if (deciding || !decided.current) return;
    decided.current = false;
    summary.current?.focus();
  }, [deciding]);
  useEffect(() => {
    if (!autoOpen || !details.current) return;
    details.current.open = true;
    summary.current?.focus();
  }, [autoOpen]);
  const categories = pending ? rebaseProcessCategories(base.categories, pending.before.categories, pending.value.categories) : base.categories;
  const categoryConflict = categories === undefined;
  const draft = pending ? { ...pending.value, categories: categories ?? pending.value.categories } : base;
  const before = pending ? { ...pending.before, categories: categoryConflict ? pending.before.categories : base.categories } : base;
  const patched = pending && !categoryConflict ? writeProcessDraft(editor.working, path, draft, before) : editor.working;
  const projected = patched === editor.working ? allProtection : deriveSspProcessProtection(patched);
  const preview = projected === allProtection ? protection : projected.processes.find(process => process.path === protection.path) ?? protection;
  const affected = projected === allProtection ? [] : affectedProcesses(allProtection, projected, protection.path);
  const errors = [...contextReasons(draft, preview), ...objectiveReasons(draft, preview)];
  const incompleteInput = hasIncompleteProcessInput(draft, before);
  const invalid = preview.diagnostics.some(isProcessProtectionBlocker);
  const reset = () => {
    setPending(undefined);
    setTargetFormPending(id, false);
  };
  const update = (value: ProcessDraft) => {
    // Eine verworfene Zuordnung darf keinen unsichtbaren Kategorienentwurf hinterlassen.
    const categories = value.categories.flatMap(category => {
      if (PROCESS_GOAL_KEYS.some(goal => value.objectives[goal].category === category.id)) return [category];
      return before.categories.filter(item => item.id === category.id);
    });
    const next = { ...value, categories };
    if (JSON.stringify(before) === JSON.stringify(next)) reset();
    else {
      setPending({ before, value: next });
      setTargetFormPending(id, true);
    }
  };
  const outcome = (code: string | undefined) => {
    const notices: Record<string, string> = {
      SSP_PROCESS_DECISION_NOT_ADOPTED: 'Die Entscheidung ist gespeichert. Der neue Stand wurde nicht geladen; bitte die Seite neu laden, bevor weitere Änderungen gespeichert werden.',
    };
    // Eine gehaltene Entscheidung ist sichtbar; die Sperrmeldung des Blocks nennt den Grund.
    if (code === 'SSP_PROCESS_DECISION_NOT_SHOWN') return undefined;
    if (code && code in notices) {
      setNotice(notices[code]);
      return undefined;
    }
    return code;
  };
  const decide = async (input: ProcessDecisionInput) => {
    const code = outcome(await editor.decideProcess(input));
    // Ohne Befund schließt der Dialog nach dem Schreiben.
    decided.current = code === undefined;
    return code;
  };
  const label = [base.id.trim(), base.title.trim()].filter(Boolean).join(' ') || 'Geschäftsprozess ohne Namen';
  const { approval } = decision;
  const requestRemoval = async () => {
    setChecking(true);
    const found = await editor.checkTargetRemoval(path);
    setChecking(false);
    setUses(found);
    if (!found.length) setConfirming(true);
  };
  const legacy = targetProps(readSspValue(editor.working, path), 'protection-need-level')[0];
  const hasProtocols = readArray(readSspValue(editor.working, [...path, 'protocols'])).length > 0;
  const hasOtherRoles = readArray(readSspValue(editor.working, [...path, 'responsible-roles']))
    .some(role => !isJsonObject(role) || role['role-id'] !== PROCESS_OWNER_ROLE);
  return <details ref={details} className="group/process border-b border-[var(--color-border-subtle)] last:border-0">
    <summary ref={summary} className={`flex min-h-touch cursor-pointer flex-wrap items-center gap-2 px-3 py-2 ${FOCUS_RING}`}>
      <IconChevronDown aria-hidden="true" className="size-4 shrink-0 -rotate-90 group-open/process:rotate-0" />
      {base.id && <span className="break-all font-mono text-xs">{base.id}</span>}
      <span className="min-w-0 flex-1 break-words text-sm font-medium">{base.title || 'Geschäftsprozess ohne Namen'}</span>
      <span className="flex w-full flex-wrap gap-2 group-open/process:hidden desktop:w-auto">
        <ProcessStatus protection={protection} />
        {uuid && approval && <ApprovalChip approval={approval} possible={errors.length === 0 && decision.reasons.length === 0} />}
      </span>
    </summary>
    <div className="space-y-4 border-t border-[var(--color-border-subtle)] p-3">
      {uuid && <ProcessApprovalBlock approval={approval} processReasons={errors} decisionReasons={decision.reasons} blocked={decision.blocked}
        risk={protection.riskConsideration === 'required'} notice={notice} onAddRole={decision.onAddRole}
        onApprove={() => { setNotice(undefined); setDeciding('approved'); }} onWithdraw={() => { setNotice(undefined); setDeciding('withdrawn'); }} />}
      {uuid && deciding && <SspProcessApprovalDialog localId={editor.localId} mode={deciding} label={label} processUuid={uuid} source={editor.envelope?.source}
        protection={protection} parties={decision.parties} affected={deciding === 'withdrawn' ? approval?.withdrawable : approval?.last}
        onDecide={decide} onAddParty={editor.addDecisionParty} onClose={() => setDeciding(undefined)} />}
      <output className="block space-y-2">
        <ProcessStatus protection={preview} labelled />
        {errors.length > 0 && <span className="block text-sm text-[var(--color-text-secondary)]">{errors.join(' · ')}</span>}
      </output>
      <ProcessFields draft={draft} update={update} parties={parties} applications={applications} protection={preview} />
      {categoryConflict && <p role="alert" className="text-sm text-[var(--color-danger-text)]">Eine andere Prozesszeile hat die Kategorie geändert. Eingaben prüfen oder zurücksetzen.</p>}
      {pending && !categoryConflict && (invalid || incompleteInput) && <p role="alert" className="text-sm text-[var(--color-danger-text)]">Prozess kann noch nicht übernommen werden. Angaben und Zuordnungen prüfen.</p>}
      {affected.length > 0 && <p role="alert" className="text-sm text-[var(--color-danger-text)]">
        Die Änderung erzeugt einen neuen Sperrbefund bei {affected.map(process => `Prozess ${processLabel(readProcessDraft(patched, componentPath(process)), process)}`).join(', ')}.
      </p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="secondary" className="min-h-touch" disabled={!pending || categoryConflict || invalid || incompleteInput || affected.length > 0} onClick={() => {
          if (editor.apply(source => {
            if (source !== editor.working) throw new SspPatchError('SSP_PROCESS_CATEGORY_EDIT_CONFLICT');
            return patched;
          })) reset();
        }}>Prozess übernehmen</Button>
        <Button variant="ghost" className="min-h-touch" disabled={!pending} onClick={reset}>Eingaben zurücksetzen</Button>
        <Button variant="ghost" className="min-h-touch" disabled={checking || !uuid} onClick={() => { void requestRemoval(); }}>Prozess entfernen…</Button>
      </div>
      {uses.length > 0 && <div className="text-sm">
        <output>Der Prozess bleibt. Vorhandene oder nicht vollständig prüfbare Verwendungen.</output>
        <ul>{uses.map(use => <li key={use} className="break-all font-mono text-xs">{use}</li>)}</ul>
      </div>}
      <details className="space-y-2">
        <summary className={`min-h-touch cursor-pointer py-2 text-sm font-medium ${FOCUS_RING}`}>
          Objektbewertung (bisher){legacy && ` · ${legacy.value}`}
        </summary>
        <SspTargetFields editor={editor} path={path} />
      </details>
      {(hasProtocols || hasOtherRoles) && <details className="space-y-2">
        <summary className={`min-h-touch cursor-pointer py-2 text-sm font-medium ${FOCUS_RING}`}>Technische Angaben</summary>
        {hasProtocols && <SspProtocolFields editor={editor} path={path} />}
        {hasOtherRoles && <TargetResponsibility editor={editor} path={path} excludeRole={PROCESS_OWNER_ROLE} />}
      </details>}
      <ConfirmDialog open={confirming} title="Geschäftsprozess entfernen?" confirmLabel="Prozess entfernen" onCancel={() => setConfirming(false)} onConfirm={() => {
        const index = Number(path.at(-1));
        editor.apply(source => {
          const item = readSspValue(source, path);
          return isJsonObject(item) && item.uuid === uuid ? removeSspComponent(source, index) : source;
        });
        setConfirming(false);
      }}>Der Prozess wird mit dem SSP gespeichert oder entfernt. Außerhalb gespeicherte Kopien können weiterhin auf ihn verweisen.</ConfirmDialog>
    </div>
  </details>;
}

export function SspProcessSection({ editor, protection, decisionLock }: Readonly<{ editor: SspEditor; protection: SspProcessProtection; decisionLock?: string }>) {
  const [added, setAdded] = useState<string>();
  // Eine gespeicherte, noch nicht übernommene Entscheidung bestimmt die Anzeige, damit kein veralteter Freigabestand erscheint.
  const saved = editor.unadoptedDecision?.source ?? editor.envelope?.source;
  const approvals = useProcessApprovals(saved, protection.processes.flatMap(process => process.uuid ? [process.uuid] : []));
  const decisionParties = referenceOptions(readSspValue(saved, ['metadata', 'parties']), 'name',
    item => item.type === 'person' || item.type === 'organization');
  const gate = decisionGate(editor, decisionLock);
  const parties = referenceOptions(readSspValue(editor.working, ['metadata', 'parties']), 'name',
    item => item.type === 'person' || item.type === 'organization');
  const applications = referenceOptions(readSspValue(editor.working, SSP_COMPONENT_PATH), 'title',
    item => item.type !== BUSINESS_PROCESS_COMPONENT_TYPE);
  return <FormSection title="Geschäftsprozesse" count={protection.processes.length} action={
      <Button variant="secondary" className="min-h-touch" onClick={() => {
        const uuid = crypto.randomUUID();
        if (editor.apply(source => addSspItem(source, SSP_COMPONENT_PATH, {
          uuid, type: BUSINESS_PROCESS_COMPONENT_TYPE, status: { state: 'under-development' },
        }))) setAdded(uuid);
      }}>Geschäftsprozess hinzufügen</Button>
    }>
    {protection.processes.length === 0
      ? <p className="rounded-md border border-dashed border-[var(--color-border-default)] p-4 text-sm">Noch kein Geschäftsprozess erfasst</p>
      : <div className="rounded-md border border-[var(--color-border-default)]">
        {protection.processes.map(process => (
          <ProcessRow key={process.uuid ?? process.path} editor={editor} allProtection={protection}
            protection={process} autoOpen={process.uuid !== undefined && process.uuid === added} parties={parties} applications={applications}
            decision={{ ...gate, approval: process.uuid ? approvals?.get(process.uuid.toLowerCase()) : undefined, parties: decisionParties }} />
        ))}
      </div>}
  </FormSection>;
}
