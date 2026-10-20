import { useEffect, useRef } from 'react';
import { IconCheck, IconShield } from '@/components/icons';
import { FOCUS_RING, LOCAL_ORIGIN_LABEL } from '@/features/workspace/DocumentMarks';

/** Herkunft eines BSI-Katalogs mit bestandener Hashprüfung. */
export const CLASS_1_ORIGIN_LABEL = 'BSI-geprüft';

const MARK = 'inline-flex items-center gap-1 whitespace-nowrap rounded border px-2 py-0.5 text-xs font-medium leading-4';

export function OriginMark({ origin }: Readonly<{ origin: 'class-1' | 'local' }>) {
  if (origin === 'local') {
    return <span className={`${MARK} border-[var(--color-border-strong)] bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)]`}>{LOCAL_ORIGIN_LABEL}</span>;
  }
  return (
    <span className={`${MARK} border-[var(--color-border-strong)] bg-[var(--color-surface-base)] text-[var(--color-text-secondary)]`}>
      <IconShield className="h-3 w-3" />
      {CLASS_1_ORIGIN_LABEL}
    </span>
  );
}

/** OSCAL-Schlüssel neben einer Feldbeschriftung. */
export function OscalKey({ children }: Readonly<{ children: string }>) {
  return <span className="font-mono text-xs font-normal normal-case tracking-normal text-[var(--color-text-muted)]">{children}</span>;
}

export const INPUT = `min-h-touch w-full rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface-base)] px-3 py-2 text-base text-[var(--color-text-primary)] shadow-sm placeholder:text-[var(--color-text-muted)] focus-visible:border-[var(--color-focus-ring)] sm:text-sm desktop:min-h-0 ${FOCUS_RING}`;

export const SECTION_LABEL = 'text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]';

/** Checkbox mit unbestimmtem Zustand für Tabellen; Touchziel 44 px außerhalb des Desktops. */
export function TableCheckbox({ checked, indeterminate = false, label, onChange, disabled = false }: Readonly<{
  checked: boolean;
  indeterminate?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}>) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [checked, indeterminate]);
  const box = indeterminate
    ? 'bg-[var(--color-primary-main)] border-[var(--color-primary-main)]'
    : 'border-[var(--color-border-strong)] bg-[var(--color-surface-base)] peer-checked:bg-[var(--color-primary-main)] peer-checked:border-[var(--color-primary-main)]';
  return (
    <label className="relative flex min-h-touch min-w-touch cursor-pointer items-center justify-center desktop:min-h-0 desktop:min-w-0">
      <input
        ref={ref}
        type="checkbox"
        className="peer sr-only"
        aria-label={label}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span aria-hidden="true" className={`h-4 w-4 rounded border transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-focus-ring)] peer-focus-visible:ring-offset-1 peer-disabled:opacity-50 ${box}`} />
      {indeterminate
        ? <span aria-hidden="true" className="pointer-events-none absolute h-0.5 w-2 rounded-full bg-white" />
        : <IconCheck className="pointer-events-none absolute h-3 w-3 text-white opacity-0 peer-checked:opacity-100" />}
    </label>
  );
}

/** Zahl in Tabellenziffern mit deutschem Tausenderpunkt. */
export function formatCount(value: number): string {
  return value.toLocaleString('de-DE');
}

/** Aufwand als Punkt-Skala (Signature Component); die Ziffer trägt `title` und Screenreader-Text. */
export function EffortScale({ value }: Readonly<{ value?: string }>) {
  if (value === undefined || value === '') return null;
  const filled = Number.parseInt(value, 10);
  return (
    <span title={`Aufwand ${value}`} className="inline-flex items-center gap-0.5 rounded bg-[var(--color-status-aufwand-bg)] px-1.5 py-1">
      <span className="sr-only">Aufwand {value}</span>
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full border border-[var(--color-border-default)]"
          style={{ backgroundColor: index < filled ? `var(--color-effort-dot-${index + 1})` : 'var(--color-effort-track)' }}
        />
      ))}
    </span>
  );
}
