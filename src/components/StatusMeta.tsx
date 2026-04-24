import type { ReactNode } from 'react';
import { Badge } from './Badge';
import type { BadgeVariant } from './Badge';

export function modalverbVariant(value?: string): BadgeVariant {
  switch (value) {
    case 'MUSS':
      return 'muss';
    case 'SOLLTE':
      return 'soll';
    case 'KANN':
      return 'kann';
    default:
      return 'default';
  }
}

export interface StatusBadgeProps {
  value?: string | null;
  className?: string;
  trailingIcon?: ReactNode;
}

export interface SecurityLevelBadgeProps extends StatusBadgeProps {
  /**
   * Classification surfaces use Deniz's quieter rollback mapping; SearchPage uses
   * namespace to preserve the vocabulary metadata color outside classification UI.
   */
  appearance?: 'classification' | 'namespace';
}

export function ModalverbBadge({ value, className = '', trailingIcon }: StatusBadgeProps) {
  if (!value) return null;

  return (
    <Badge variant={modalverbVariant(value)} className={className} trailingIcon={trailingIcon}>
      {value}
    </Badge>
  );
}

export function SecurityLevelBadge({
  value,
  className = '',
  trailingIcon,
  appearance = 'classification',
}: SecurityLevelBadgeProps) {
  if (!value) return null;

  const variant =
    appearance === 'namespace'
      ? 'sec_level'
      : value === 'normal-SdT'
        ? 'outline'
        : 'soll';

  return (
    <Badge variant={variant} className={className} trailingIcon={trailingIcon}>
      {value}
    </Badge>
  );
}

const EFFORT_DOT_VARS = [
  'var(--color-effort-dot-1)',
  'var(--color-effort-dot-2)',
  'var(--color-effort-dot-3)',
  'var(--color-effort-dot-4)',
  'var(--color-effort-dot-5)',
];

export function EffortBadge({ value, className = '', trailingIcon }: StatusBadgeProps) {
  if (value == null || value === '') return null;

  const filled = Number.parseInt(value, 10);

  return (
    <Badge
      variant="aufwand"
      className={`gap-0.5 ${className}`}
      trailingIcon={trailingIcon}
      title={`Aufwand ${value}`}
    >
      <span className="mr-1">Aufwand</span>
      {Array.from({ length: 5 }, (_, i) => {
        const color = i < filled ? EFFORT_DOT_VARS[i] : 'var(--color-effort-track)';

        return (
          <span
            key={i}
            aria-hidden="true"
            className="inline-block h-2 w-2 rounded-full border border-slate-200"
            style={{ backgroundColor: color }}
          />
        );
      })}
    </Badge>
  );
}
