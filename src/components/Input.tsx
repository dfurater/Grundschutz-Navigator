import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ComponentType<{ className?: string }>;
  label?: string;
}

export function Input({ icon: Icon, label, className = '', id, ...props }: InputProps) {
  const inputEl = (
    <div className="relative">
      {Icon && (
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
      )}
      <input
        type="text"
        id={id}
        className={`w-full bg-[var(--color-surface-base)] border border-[var(--color-border-strong)] text-[var(--color-text-primary)] text-sm rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-surface-base)] focus-visible:border-[var(--color-focus-ring)] block ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2 shadow-[var(--shadow-sm)] placeholder:text-[var(--color-text-muted)] disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-[var(--color-surface-subtle)] ${className}`}
        {...props}
      />
    </div>
  );

  if (label) {
    return (
      <div>
        <label htmlFor={id} className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
          {label}
        </label>
        {inputEl}
      </div>
    );
  }

  return inputEl;
}
