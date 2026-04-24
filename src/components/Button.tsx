import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ComponentType<{ className?: string }>;
  children?: ReactNode;
}

const baseStyle =
  'inline-flex items-center justify-center font-medium transition-colors transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-[var(--color-surface-base)] rounded-md cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 active:brightness-95';

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-[var(--color-primary-main)] text-[var(--color-text-inverse)] hover:bg-[var(--color-primary-hover)] shadow-sm',
  secondary:
    'bg-[var(--color-surface-base)] border border-[var(--color-border-strong)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] shadow-sm',
  ghost:
    'bg-transparent text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-subtle)] hover:text-[var(--color-text-primary)]',
  danger:
    'bg-[var(--color-danger-surface)] text-[var(--color-danger-text)] hover:bg-[var(--color-danger-surface-hover)] border border-[var(--color-danger-border)]',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'text-xs px-2.5 py-1.5 gap-1.5',
  md: 'text-sm px-4 py-2 gap-2',
  lg: 'text-base px-6 py-3 gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon: Icon,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <button
      className={`${baseStyle} ${variantClasses[variant]} ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {Icon && <Icon className={iconSize} />}
      {children}
    </button>
  );
}
