import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { IconChevronDown } from '@/components/icons';
import { isJsonObject, readArray, readString } from '@/domain/jsonGuards';
import { isOscalUuid } from '@/domain/identifierQuery';
import { BUSINESS_PROCESS_COMPONENT_TYPE } from '@/domain/projectProps';
import { addSspItem, readSspValue, removeSspComponent, type SspPath } from '@/domain/sspAuthoring';
import { PROCESS_GOALS, PROCESS_GOAL_KEYS, readProcessDraft, SSP_COMPONENT_PATH, writeProcessDraft, type ProcessDraft } from '@/domain/sspProcessEditing';
import { deriveSspProcessProtection, processProtectionFailure, type ProcessProtection, type SspProcessProtection } from '@/domain/sspProcessProtection';
import { targetProps } from '@/domain/sspTargetObjects';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { FormSection } from '@/features/workspace/ssp/SspFormSections';
import { hasIncompleteProcessInput, ProcessFields } from '@/features/workspace/ssp/SspProcessFields';
import { SspTargetFields } from '@/features/workspace/ssp/SspTargetFields';
import type { SspEditor } from '@/features/workspace/ssp/useSspEditor';

const STATUS_TONES = {
  open: 'border-[var(--color-warning)] text-[var(--color-warning-text)]',
  error: 'border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]',
  complete: 'border-[var(--color-success)] text-[var(--color-success-text)]',
  neutral: 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]',
};

function protectionCount(protection: ProcessProtection): number {
  return Object.values(protection.objectives).filter(({ value }) => value === 'normal' || value === 'hoch').length;
}

function StatusChip({ text, tone }: Readonly<{ text: string; tone: keyof typeof STATUS_TONES }>) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONES[tone]}`}>{text}</span>;
}

function ProcessStatus({ protection }: Readonly<{ protection: ProcessProtection }>) {
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
  return <span className="flex flex-wrap gap-1.5">
    <StatusChip text={contextLabels[context]} tone={contextTone[context]} />
    <StatusChip text={goals} tone={goalTone[cia]} />
    <StatusChip text={risk} tone={riskConsideration === 'no-high-trigger' ? 'neutral' : 'open'} />
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

function reasonLines(draft: ProcessDraft, protection: ProcessProtection): string[] {
  const missing = [
    !draft.id.trim() && 'Prozess-ID fehlt',
    !draft.title.trim() && 'Name fehlt',
    !draft.description.trim() && 'Kurzbeschreibung fehlt',
    !draft.purpose.trim() && 'Zweck fehlt',
    draft.owners.length === 0 && 'Fachliche Verantwortung fehlt',
    draft.applications.length === 0 && !draft.noApplications && 'Wesentliche Anwendungen oder begründeter Nullfall fehlen',
  ].filter(reason => reason !== false);
  if (protection.context === 'invalid') missing.push('Prozess-ID, Quelldaten oder lokale Verweise prüfen');
  if (protection.context === 'context-open' && !missing.length) missing.push('Kategoriedefinition prüfen');
  return [...missing, ...objectiveReasons(draft, protection)];
}

function referenceOptions(value: unknown, name: string, include: (item: Record<string, unknown>) => boolean) {
  return readArray(value).flatMap(item => {
    if (!isJsonObject(item) || !include(item)) return [];
    const uuid = readString(item.uuid);
    const label = readString(item[name]);
    return uuid && isOscalUuid(uuid) && label?.trim() ? [{ value: uuid, label }] : [];
  });
}

function ProcessRow({ editor, path, protection, autoOpen, parties, applications }: Readonly<{
  editor: SspEditor;
  path: SspPath;
  protection: ProcessProtection;
  autoOpen: boolean;
  parties: ReturnType<typeof referenceOptions>;
  applications: ReturnType<typeof referenceOptions>;
}>) {
  const summary = useRef<HTMLElement>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const base = readProcessDraft(editor.working, path);
  const [pending, setPending] = useState<{ before: ProcessDraft; value: ProcessDraft }>();
  const [confirming, setConfirming] = useState(false);
  const [checking, setChecking] = useState(false);
  const [uses, setUses] = useState<readonly string[]>([]);
  const { setTargetFormPending } = editor;
  const id = useId();
  const uuid = protection.uuid;
  useEffect(() => () => setTargetFormPending(id, false), [id, setTargetFormPending]);
  useEffect(() => {
    if (!autoOpen || !details.current) return;
    details.current.open = true;
    summary.current?.focus();
  }, [autoOpen]);
  const draft = pending?.value ?? base;
  const before = pending?.before ?? base;
  const preview = pending ? deriveSspProcessProtection(writeProcessDraft(editor.working, path, draft, before))
    .processes.find(process => process.path === protection.path) ?? protection : protection;
  const errors = reasonLines(draft, preview);
  const incompleteInput = hasIncompleteProcessInput(draft, before);
  const invalid = processProtectionFailure({ ...preview, processes: [preview] }) !== undefined;
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
  const requestRemoval = async () => {
    setChecking(true);
    const found = await editor.checkTargetRemoval(path);
    setChecking(false);
    setUses(found);
    if (!found.length) setConfirming(true);
  };
  const legacy = targetProps(readSspValue(editor.working, path), 'protection-need-level')[0];
  return <details ref={details} className="group/process border-b border-[var(--color-border-subtle)] last:border-0">
    <summary ref={summary} className={`flex min-h-touch cursor-pointer flex-wrap items-center gap-2 px-3 py-2 ${FOCUS_RING}`}>
      <IconChevronDown aria-hidden="true" className="size-4 shrink-0 -rotate-90 group-open/process:rotate-0" />
      {base.id && <span className="break-all font-mono text-xs">{base.id}</span>}
      <span className="min-w-0 flex-1 break-words text-sm font-medium">{base.title || 'Geschäftsprozess ohne Namen'}</span>
      <span className="w-full group-open/process:hidden desktop:w-auto"><ProcessStatus protection={protection} /></span>
    </summary>
    <div className="space-y-4 border-t border-[var(--color-border-subtle)] p-3">
      <output className="block space-y-2">
        <ProcessStatus protection={preview} />
        {errors.length > 0 && <span className="block text-sm text-[var(--color-text-secondary)]">{errors.join(' · ')}</span>}
      </output>
      <ProcessFields draft={draft} update={update} parties={parties} applications={applications} protection={preview} />
      {pending && (invalid || incompleteInput) && <p role="alert" className="text-sm text-[var(--color-danger-text)]">Prozess kann noch nicht übernommen werden. Angaben und Zuordnungen prüfen.</p>}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button variant="secondary" className="min-h-touch" disabled={!pending || invalid || incompleteInput} onClick={() => {
          if (editor.apply(source => writeProcessDraft(source, path, draft, before))) reset();
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

export function SspProcessSection({ editor, protection }: Readonly<{ editor: SspEditor; protection: SspProcessProtection }>) {
  const [added, setAdded] = useState<string>();
  const parties = referenceOptions(readSspValue(editor.working, ['metadata', 'parties']), 'name',
    item => item.type === 'person' || item.type === 'organization');
  const applications = referenceOptions(readSspValue(editor.working, SSP_COMPONENT_PATH), 'title',
    item => item.type !== BUSINESS_PROCESS_COMPONENT_TYPE);
  return <FormSection title="Geschäftsprozesse">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm tabular-nums text-[var(--color-text-secondary)]">{protection.processes.length} erfasst</span>
      <Button variant="secondary" className="min-h-touch" onClick={() => {
        const uuid = crypto.randomUUID();
        if (editor.apply(source => addSspItem(source, SSP_COMPONENT_PATH, {
          uuid, type: BUSINESS_PROCESS_COMPONENT_TYPE, status: { state: 'under-development' },
        }))) setAdded(uuid);
      }}>Geschäftsprozess hinzufügen</Button>
    </div>
    {protection.processes.length === 0
      ? <p className="rounded-md border border-dashed border-[var(--color-border-default)] p-4 text-sm">Noch kein Geschäftsprozess erfasst</p>
      : <div className="rounded-md border border-[var(--color-border-default)]">
        {protection.processes.map(process => (
          <ProcessRow key={process.uuid ?? process.path} editor={editor} path={[...SSP_COMPONENT_PATH, Number(process.path.split('/').at(-1))]}
            protection={process} autoOpen={process.uuid !== undefined && process.uuid === added} parties={parties} applications={applications} />
        ))}
      </div>}
  </FormSection>;
}
