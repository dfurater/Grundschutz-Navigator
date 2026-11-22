import { useId, useState } from 'react';
import { Button } from '@/components/Button';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { PROCESS_GOALS, PROCESS_GOAL_KEYS, type ProcessCategoryDraft, type ProcessDraft, type ProcessGoal } from '@/domain/sspProcessEditing';
import { SSP_COMPONENT_STATES } from '@/domain/sspAuthoring';
import type { ProcessProtection } from '@/domain/sspProcessProtection';
import { INPUT } from '@/features/workspace/profile/ProfileMarks';

const GRID = 'grid gap-3 desktop:grid-cols-2';
const FIELD_LABEL = 'block text-sm font-medium';
const EFFECTIVE_VALUES = { normal: 'normal', hoch: 'hoch', unknown: 'unbekannt', conflict: 'widersprüchlich' };
const COMPONENT_STATES = SSP_COMPONENT_STATES.map(value => ({ value, label: value }));
const LEVELS = [{ value: 'normal', label: 'normal' }, { value: 'hoch', label: 'hoch' }];
const ERROR = 'text-sm text-[var(--color-danger-text)]';
const STATUS_TONES = {
  open: 'border-[var(--color-warning)] text-[var(--color-warning-text)]',
  error: 'border-[var(--color-danger-border)] bg-[var(--color-danger-surface)] text-[var(--color-danger-text)]',
  complete: 'border-[var(--color-success)] text-[var(--color-success-text)]',
  neutral: 'border-[var(--color-border-default)] text-[var(--color-text-secondary)]',
};
const OBJECTIVE_STATUS = {
  normal: { text: 'Bewertet', tone: 'complete' },
  hoch: { text: 'Bewertet', tone: 'complete' },
  unknown: { text: 'Bewertung offen', tone: 'open' },
  conflict: { text: 'Konflikt', tone: 'error' },
} as const;

export function StatusChip({ text, tone }: Readonly<{ text: string; tone: keyof typeof STATUS_TONES }>) {
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_TONES[tone]}`}>{text}</span>;
}

type Option = { readonly value: string; readonly label: string };
type TextFieldProps = {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error?: string;
};

function ProcessText({ label, value, onChange, error, multiline, mono }: TextFieldProps & { readonly multiline?: boolean; readonly mono?: boolean }) {
  const id = useId();
  const accessibility = { 'aria-invalid': Boolean(error), 'aria-describedby': error ? `${id}-error` : undefined };
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className={FIELD_LABEL}>{label}</label>
    {multiline
      ? <textarea id={id} className={`${INPUT} min-h-20`} value={value} onChange={event => onChange(event.target.value)} {...accessibility} />
      : <input id={id} className={`${INPUT} ${mono ? 'font-mono' : ''}`} autoComplete="off" value={value} onChange={event => onChange(event.target.value)} {...accessibility} />}
    {error && <p className={ERROR} id={`${id}-error`}>{error}</p>}
  </div>;
}

function ProcessSelect({ label, value, onChange, error, options, emptyLabel = 'Bitte wählen' }: TextFieldProps & { readonly options: readonly Option[]; readonly emptyLabel?: string }) {
  const id = useId();
  return <div className="min-w-0 space-y-1">
    <label htmlFor={id} className={FIELD_LABEL}>{label}</label>
    <select id={id} className={INPUT} value={value} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)}>
      <option value="">{emptyLabel}</option>
      {value && !options.some(option => option.value === value) && <option value={value}>{value}</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
    {error && <p className={ERROR} id={`${id}-error`}>{error}</p>}
  </div>;
}

function ReferenceChoices({ label, options, current, update }: Readonly<{ label: string; options: readonly Option[]; current: readonly string[]; update: (next: readonly string[]) => void }>) {
  const matched = new Set(options.map(option => option.value.toLowerCase()));
  const choices = [...options, ...current.filter(value => !matched.has(value.toLowerCase())).map(value => ({ value, label: `${value} · nicht auflösbar` }))];
  return <div>
    {choices.map(({ value, label: name }) => {
      const selected = current.find(existing => existing.toLowerCase() === value.toLowerCase());
      return <CheckboxLabel key={value} label={name} ariaLabel={`${label} – ${name}`} checked={selected !== undefined} onChange={checked =>
        update(checked ? [...current, value] : current.filter(existing => existing !== selected))} />;
    })}
  </div>;
}

function goalError(draft: ProcessDraft, goal: ProcessGoal): string | undefined {
  const { level, category } = draft.objectives[goal];
  if (!category) return undefined;
  const mapping = draft.categories.find(item => item.id === category)?.level;
  if (!mapping) return 'GS++-Zuordnung fehlt. Effektiver Wert unbekannt.';
  if (level && mapping !== level) return `Konflikt mit der GS++-Zuordnung (${mapping}).`;
  return undefined;
}

export function hasIncompleteProcessInput(draft: ProcessDraft, before: ProcessDraft): boolean {
  if (draft.noApplications && !draft.noApplicationsReason.trim()) return true;
  return PROCESS_GOAL_KEYS.some(goal => {
    const { level, reason } = draft.objectives[goal];
    return Boolean(level) !== Boolean(reason.trim()) || goalError(draft, goal) !== undefined;
  }) || draft.categories.some(category => {
    const initial = before.categories.find(item => item.id === category.id);
    return JSON.stringify(initial) !== JSON.stringify(category)
      && (!category.label.trim() || !category.definition.trim() || !category.level || !category.reason.trim());
  });
}

function CategoryFields({ category, update }: Readonly<{ category: ProcessCategoryDraft; update: (category: ProcessCategoryDraft) => void }>) {
  return <div className={`${GRID} rounded-md border border-[var(--color-border-subtle)] p-3`}>
    <ProcessText label="Kategoriename" value={category.label} onChange={label => update({ ...category, label })} />
    <p className="text-sm">Kategorie-ID <span className="block break-all font-mono">{category.id}</span></p>
    <div className="desktop:col-span-2"><ProcessText label="Definition" multiline value={category.definition} onChange={definition => update({ ...category, definition })} /></div>
    <ProcessSelect label="GS++-Zuordnung" value={category.level} options={LEVELS} onChange={level => update({ ...category, level })} error={category.level ? undefined : 'GS++-Zuordnung fehlt.'} />
    <ProcessText label="Begründung der Zuordnung" multiline value={category.reason} onChange={reason => update({ ...category, reason })} error={category.level && !category.reason.trim() ? 'Begründung fehlt.' : undefined} />
  </div>;
}

export function ProcessFields({ draft, update, parties, applications, protection }: Readonly<{
  draft: ProcessDraft;
  update: (draft: ProcessDraft) => void;
  parties: readonly Option[];
  applications: readonly Option[];
  protection: ProcessProtection;
}>) {
  const [categoryInitiallyOpen] = useState(() => PROCESS_GOAL_KEYS.some(goal => Boolean(draft.objectives[goal].category)));
  const setGoal = (goal: ProcessGoal, next: ProcessDraft['objectives'][ProcessGoal]) =>
    update({ ...draft, objectives: { ...draft.objectives, [goal]: next } });
  const categories = draft.categories.map(category => ({ value: category.id, label: category.label || category.id }));
  const availableParties = parties.filter(party => !draft.owners.some(owner => owner.toLowerCase() === party.value.toLowerCase()));
  const ownerFields = [
    { key: 'primary', owner: draft.owners[0] ?? '' },
    ...draft.owners.slice(1).map(owner => ({ key: owner, owner })),
  ];
  return <>
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-semibold">Prozess</legend>
      <div className={GRID}>
        <ProcessText label="Prozess-ID" mono value={draft.id} onChange={id => update({ ...draft, id })} />
        <ProcessText label="Name" value={draft.title} onChange={title => update({ ...draft, title })} />
      </div>
      <ProcessText label="Kurzbeschreibung" multiline value={draft.description} onChange={description => update({ ...draft, description })} />
      <ProcessText label="Zweck" value={draft.purpose} onChange={purpose => update({ ...draft, purpose })} />
      <ProcessSelect label="Status" value={draft.status} options={COMPONENT_STATES} onChange={status => update({ ...draft, status })} />
    </fieldset>
    <fieldset className="space-y-1">
      <legend className="text-sm font-semibold">Fachliche Verantwortung</legend>
      <p className="text-sm text-[var(--color-text-secondary)]">Rolle <span className="font-mono">process-owner</span></p>
      {parties.length === 0 && <p className="text-sm">Verantwortliche zuerst unter Metadaten als Partei erfassen.</p>}
      {ownerFields.map(({ key, owner }, index) => {
        const selected = parties.find(party => party.value.toLowerCase() === owner.toLowerCase());
        return <ProcessSelect key={key} label={index === 0 ? 'Partei' : `Partei ${index + 1}`} value={selected?.value ?? owner}
          options={selected ? [selected, ...availableParties] : availableParties}
          onChange={value => update({ ...draft, owners: draft.owners.toSpliced(index, 1, value).filter(Boolean) })} />;
      })}
      {draft.owners.length > 0 && availableParties.length > 0 && <ProcessSelect label="Weitere Partei" value="" options={availableParties}
        onChange={owner => { if (owner) update({ ...draft, owners: [...draft.owners, owner] }); }} />}
    </fieldset>
    <fieldset className="space-y-1">
      <legend className="text-sm font-semibold">Wesentliche Anwendungen</legend>
      {applications.length === 0 && <p className="text-sm">Anwendungen können aus den vorhandenen Komponenten gewählt werden.</p>}
      <ReferenceChoices label="Anwendung" options={applications} current={draft.applications} update={selected => update({ ...draft, applications: selected, noApplications: false })} />
      <CheckboxLabel label="Keine wesentliche Anwendung" checked={draft.noApplications} onChange={noApplications =>
        update({ ...draft, noApplications, applications: noApplications ? [] : draft.applications })} />
      {draft.noApplications && <ProcessText label="Begründung für keine wesentliche Anwendung" multiline value={draft.noApplicationsReason}
        onChange={noApplicationsReason => update({ ...draft, noApplicationsReason })}
        error={draft.noApplicationsReason.trim() ? undefined : 'Begründung fehlt.'} />}
    </fieldset>
    <fieldset className="space-y-2">
      <legend className="mb-2 text-sm font-semibold">Schutzbedarf</legend>
      {PROCESS_GOAL_KEYS.map(goal => {
        const name = PROCESS_GOALS[goal];
        const row = draft.objectives[goal];
        const effective = protection.objectives[goal].value;
        const mappingMissing = Boolean(row.category && !draft.categories.find(category => category.id === row.category)?.level);
        const status = OBJECTIVE_STATUS[effective];
        const statusText = effective === 'unknown' && mappingMissing ? 'Mapping fehlt' : status.text;
        return <div key={goal} className={`${GRID} items-start rounded-md border border-[var(--color-border-subtle)] p-3`}>
          <ProcessSelect label={name} options={LEVELS} value={row.level} onChange={level => setGoal(goal, { ...row, level })}
            error={!row.level && row.reason.trim() ? 'Schutzbedarf wählen.' : undefined} />
          <ProcessText label={`Begründung für ${name}`} multiline value={row.reason} onChange={reason => setGoal(goal, { ...row, reason })}
            error={row.level && !row.reason.trim() ? 'Begründung fehlt.' : undefined} />
          <div className="flex flex-wrap items-center gap-2 desktop:col-span-2">
            <StatusChip text={statusText} tone={status.tone} />
            <p className="text-sm text-[var(--color-text-secondary)]">Effektiver Wert {EFFECTIVE_VALUES[effective]}</p>
          </div>
        </div>;
      })}
    </fieldset>
    <details className="group/categories space-y-2" open={categoryInitiallyOpen}>
      <summary className={`min-h-touch cursor-pointer py-2 text-sm font-semibold ${FOCUS_RING}`}>
        <span>Eigene Schutzbedarfskategorie</span>
        <span className="ml-2 font-medium text-[var(--color-text-secondary)] group-open/categories:hidden">Kategorie zuordnen…</span>
      </summary>
      {PROCESS_GOAL_KEYS.map(goal => {
        const row = draft.objectives[goal];
        return <div className="flex flex-wrap items-end gap-2" key={goal}>
          <div className="min-w-0 flex-1 basis-44">
            <ProcessSelect label={`Kategorie (${PROCESS_GOALS[goal]})`} options={categories} emptyLabel="Keine" value={row.category}
              error={goalError(draft, goal)} onChange={category => setGoal(goal, { ...row, category })} />
          </div>
          <Button variant="secondary" className="min-h-touch desktop:min-h-0" onClick={() => {
            const id = `cat-${crypto.randomUUID()}`;
            update({ ...draft, objectives: { ...draft.objectives, [goal]: { ...row, category: id } },
              categories: [...draft.categories, { id, label: '', definition: '', level: '', reason: '' }] });
          }}>Kategorie anlegen</Button>
        </div>;
      })}
      {draft.categories.filter(category => PROCESS_GOAL_KEYS.some(goal => draft.objectives[goal].category === category.id))
        .map(category => <CategoryFields key={category.id} category={category}
          update={updated => update({ ...draft, categories: draft.categories.map(item => item.id === category.id ? updated : item) })} />)}
    </details>
  </>;
}
