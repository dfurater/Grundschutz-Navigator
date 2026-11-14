import { useId, useState } from 'react';
import { Button } from '@/components/Button';
import { isVerbundName } from '@/domain/workspaceModel';
import { FOCUS_RING } from '@/features/workspace/DocumentMarks';

const INPUT = `min-h-touch w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-3 py-2 text-base text-[var(--color-text-primary)] shadow-sm placeholder:text-[var(--color-text-muted)] focus-visible:border-[var(--color-focus-ring)] sm:text-sm desktop:min-h-0 ${FOCUS_RING}`;
export const ROW_BUTTON = 'min-h-touch desktop:min-h-0';
/** Namensfeld für Anlegen und Umbenennen; `onCancel` macht daraus ein Umbenennen-Formular. */
export function NameForm({ label, submitLabel, initial = '', disabled, onSubmit, onCancel, onChange }: Readonly<{
  label: string;
  submitLabel: string;
  initial?: string;
  disabled: boolean;
  onSubmit: (name: string) => Promise<boolean>;
  onCancel?: () => void;
  /** Meldet jede Eingabe, etwa um sie über einen Routenwechsel zu erhalten. */
  onChange?: (name: string) => void;
}>) {
  const inputId = useId();
  const [name, setName] = useState(initial);
  // Während des Speicherns ist das Formular gesperrt: ein Doppelklick legt keinen zweiten Verbund an.
  const [saving, setSaving] = useState(false);
  const handleSubmit = (event: React.SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !isVerbundName(name)) return;
    setSaving(true);
    const submitted = name.trim();
    void onSubmit(submitted).then((saved) => {
      setSaving(false);
      // Ein während des Speicherns getippter Name bleibt stehen.
      if (saved && !onCancel) setName((current) => (current.trim() === submitted ? '' : current));
    });
  };
  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="min-w-0 flex-1">
        <label htmlFor={inputId} className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</label>
        <input
          id={inputId}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={name}
          disabled={disabled}
          autoFocus={onCancel !== undefined}
          onChange={(event) => { setName(event.target.value); onChange?.(event.target.value); }}
          onKeyDown={(event) => { if (event.key === 'Escape' && onCancel) { event.preventDefault(); onCancel(); } }}
          className={`mt-1 ${INPUT}`}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" className={ROW_BUTTON} disabled={disabled || saving || !isVerbundName(name)}>{submitLabel}</Button>
        {onCancel && <Button variant="secondary" className={ROW_BUTTON} onClick={onCancel}>Abbrechen</Button>}
      </div>
    </form>
  );
}

/** Formularfehler nach einem gescheiterten lokalen Schreibvorgang; die Diagnose steht in den Speichermeldungen. */
export function SaveFailed() {
  return <p role="alert" className="text-sm text-[var(--color-danger-text)]">Lokal speichern fehlgeschlagen. Der Name bleibt erhalten.</p>;
}

/** Abschnittskopf mit Überschrift und Zählung in Tabellenziffern. */
export function SectionHead({ id, title, count }: Readonly<{ id: string; title: string; count: number | null }>) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-2">
      <h2 id={id} className="text-base font-semibold leading-snug text-[var(--color-text-primary)]">{title}</h2>
      {count !== null && <span className="text-xs font-medium tabular-nums text-[var(--color-text-secondary)]">{count}</span>}
    </div>
  );
}
