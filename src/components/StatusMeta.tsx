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
  readonly value?: string | null;
  readonly className?: string;
  readonly trailingIcon?: ReactNode;
}

export interface SecurityLevelBadgeProps extends StatusBadgeProps {
  /**
   * Classification surfaces use Deniz's quieter rollback mapping; SearchPage uses
   * namespace to preserve the vocabulary metadata color outside classification UI.
   */
  readonly appearance?: 'classification' | 'namespace';
}

function securityLevelVariant(
  value: string,
  appearance: SecurityLevelBadgeProps['appearance'],
): BadgeVariant {
  if (appearance === 'namespace') return 'sec_level';
  return value === 'normal-SdT' ? 'outline' : 'soll';
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

  const variant = securityLevelVariant(value, appearance);

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

/** Höchste Relevanzstufe eines Schutzziels laut `security_targets_levels.csv`. */
export const RELEVANCE_SCALE_MAX = 2;

export interface RelevanceScaleProps {
  readonly value: number;
}

/**
 * Punkte-Skala für die Schutzziel-Relevanz. Die Punkte sind rein visuell; die
 * fachliche Bedeutung trägt der umgebende Trigger über `aria-label` und `title`.
 */
export function RelevanceScale({ value }: RelevanceScaleProps) {
  return (
    <span className="flex h-[1.625em] items-center gap-0.5">
      {Array.from({ length: RELEVANCE_SCALE_MAX }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full border border-slate-200"
          style={{
            backgroundColor:
              index < value
                ? 'var(--color-relevance-dot)'
                : 'var(--color-relevance-track)',
          }}
        />
      ))}
    </span>
  );
}

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
