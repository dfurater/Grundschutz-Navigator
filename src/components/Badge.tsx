import type { ReactNode } from 'react';

export type BadgeVariant =
  | 'muss'
  | 'soll'
  | 'kann'
  | 'sec_level'
  | 'aufwand'
  | 'default'
  | 'outline';

export interface BadgeProps {
  readonly children: ReactNode;
  readonly variant?: BadgeVariant;
  readonly className?: string;
  readonly title?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  muss: 'bg-status-muss-bg text-status-muss-text border-status-muss-border min-w-16 justify-center',
  soll: 'bg-status-soll-bg text-status-soll-text border-status-soll-border min-w-16 justify-center',
  kann: 'bg-status-kann-bg text-status-kann-text border-status-kann-border min-w-16 justify-center',
  sec_level: 'bg-status-sec-bg text-status-sec-text border-status-sec-border min-w-16 justify-center',
  aufwand:
    'bg-status-aufwand-bg text-status-aufwand-text border-status-aufwand-border min-w-16 justify-center',
  default: 'bg-[var(--color-surface-subtle)] text-[var(--color-text-secondary)] border-[var(--color-border-default)]',
  outline: 'bg-transparent text-[var(--color-text-secondary)] border-[var(--color-border-strong)]',
};

export function Badge({
  children,
  variant = 'default',
  className = '',
  title,
}: BadgeProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs leading-4 font-medium border ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
