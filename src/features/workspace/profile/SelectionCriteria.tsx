import { useId, useState, type FormEvent } from 'react';
import { CheckboxLabel } from '@/components/CheckboxLabel';
import { IconInfo, IconX } from '@/components/icons';
import type { ProfilePatternView, ProfileSelectorView } from '@/domain/profileAuthoring';
import { countGlobMatches } from '@/domain/profileResolutionSelection';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';
import { INPUT, OscalKey, SECTION_LABEL, formatCount } from '@/features/workspace/profile/ProfileMarks';

const ICON_BUTTON = `inline-flex min-h-touch min-w-touch items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] desktop:min-h-8 desktop:min-w-8 ${FOCUS_RING}`;
const ADD_BUTTON = `inline-flex min-h-touch items-center gap-1 rounded-md px-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)] desktop:min-h-8 ${FOCUS_RING}`;

export interface SelectionCriteriaActions {
  readonly setId: (id: string, selected: boolean) => void;
  readonly addPattern: () => void;
  readonly setPattern: (ref: ProfilePatternView, pattern: string) => void;
  readonly removePattern: (ref: ProfilePatternView) => void;
  readonly setWithChildControls?: (value: 'yes' | 'no') => void;
}

function PatternRow({ pattern, ids, actions, index }: Readonly<{
  pattern: ProfilePatternView;
  ids: readonly string[];
  actions: SelectionCriteriaActions;
  index: number;
}>) {
  const inputId = useId();
  const matches = pattern.pattern === undefined ? undefined : countGlobMatches(pattern.pattern, ids);
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={inputId} className="sr-only">Muster {index + 1}</label>
      <input
        id={inputId}
        className={`${INPUT} max-w-xs font-mono`}
        placeholder="Muster"
        value={pattern.pattern ?? ''}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => actions.setPattern(pattern, event.target.value)}
      />
      <span className="min-w-20 text-xs tabular-nums text-[var(--color-text-secondary)]">
        {matches === undefined || matches === null ? '–' : `${formatCount(matches)} Treffer`}
      </span>
      {pattern.pattern === undefined && (
        <span className="inline-flex items-center gap-1 text-xs text-[var(--color-warning-text)]">
          <IconInfo className="h-3.5 w-3.5" />
          <span className="font-mono">matching</span> ohne <span className="font-mono">pattern</span>
        </span>
      )}
      <button type="button" className={`${ICON_BUTTON} ml-auto`} aria-label={`Muster ${index + 1} entfernen`} onClick={() => actions.removePattern(pattern)}>
        <IconX className="h-4 w-4" />
      </button>
    </li>
  );
}

function AddId({ onAdd }: Readonly<{ onAdd: (id: string) => void }>) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  if (!open) {
    return <button type="button" className={ADD_BUTTON} onClick={() => setOpen(true)}>+ Anforderung</button>;
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (value.trim() === '') return;
    onAdd(value.trim());
    setValue('');
    setOpen(false);
  };
  return (
    <form onSubmit={submit} className="flex items-center gap-2">
      <label htmlFor={inputId} className="sr-only">ID der Anforderung</label>
      <input id={inputId} className={`${INPUT} w-40 font-mono`} value={value} autoComplete="off" spellCheck={false} onChange={(event) => setValue(event.target.value)} />
      <button type="submit" className={ADD_BUTTON}>Hinzufügen</button>
    </form>
  );
}

/**
 * Einzel-IDs und Glob-Muster eines Selektorbereichs (Mockup 3). `pattern` wird
 * als Glob gegen `control/@id` genau dieses Importziels gezählt, nie als
 * regulärer Ausdruck.
 */
export function SelectionCriteria({ title, oscalKey, view, ids, actions, showIds = true, childLabel }: Readonly<{
  title: string;
  oscalKey: string;
  view: ProfileSelectorView;
  ids: readonly string[];
  actions: SelectionCriteriaActions;
  showIds?: boolean;
  childLabel?: string;
}>) {
  return (
    <section aria-label={title} className="space-y-3">
      <h3 className={`${SECTION_LABEL} flex items-baseline gap-2`}>{title} <OscalKey>{oscalKey}</OscalKey></h3>
      {showIds && (
        <div className="space-y-1.5">
          <p className="flex items-baseline gap-2 text-sm text-[var(--color-text-primary)]">Einzelne Anforderungen <OscalKey>with-ids</OscalKey></p>
          <ul className="flex flex-wrap items-center gap-1.5">
            {view.withIds.map((id) => (
              <li key={id} className="inline-flex items-center gap-1 rounded border border-[var(--color-border-default)] bg-[var(--color-surface-subtle)] pl-2 font-mono text-xs text-[var(--color-text-primary)]">
                {id}
                <button type="button" className={ICON_BUTTON} aria-label={`${id} entfernen`} onClick={() => actions.setId(id, false)}>
                  <IconX className="h-3 w-3" />
                </button>
              </li>
            ))}
            <li><AddId onAdd={(id) => actions.setId(id, true)} /></li>
          </ul>
        </div>
      )}
      <div className="space-y-1.5">
        <p className="flex items-baseline gap-2 text-sm text-[var(--color-text-primary)]">Muster <OscalKey>matching</OscalKey></p>
        <ul className="space-y-2">
          {view.patterns.map((pattern, index) => (
            <PatternRow key={`${pattern.selector}-${pattern.item}`} pattern={pattern} ids={ids} actions={actions} index={index} />
          ))}
        </ul>
        <button type="button" className={ADD_BUTTON} onClick={actions.addPattern}>+ Muster</button>
      </div>
      {actions.setWithChildControls && childLabel && (
        <CheckboxLabel
          label={childLabel}
          checked={view.withChildControls === 'yes'}
          onChange={(checked) => actions.setWithChildControls?.(checked ? 'yes' : 'no')}
        />
      )}
    </section>
  );
}
