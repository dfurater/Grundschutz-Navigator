import { IconCheck } from './icons';

export interface CheckboxLabelProps {
  label: string;
  count?: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
  title?: string;
}

export function CheckboxLabel({
  label,
  count,
  checked,
  onChange,
  title,
}: CheckboxLabelProps) {
  return (
    <label
      className="flex items-center space-x-2 cursor-pointer group hover:bg-[var(--color-surface-subtle)] px-1 py-0.5 -ml-1 rounded select-none"
      title={title}
    >
      <div className="relative flex items-center justify-center w-4 h-4">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className="w-4 h-4 border border-[var(--color-border-strong)] rounded bg-[var(--color-surface-base)] peer-checked:bg-[var(--color-primary-main)] peer-checked:border-[var(--color-primary-main)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-focus-ring)] peer-focus-visible:ring-offset-1 transition-colors" />
        <IconCheck className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" />
      </div>
      <span className="text-sm text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)] flex-1">
        {label}
      </span>
      {count !== undefined && (
        <span className="text-xs text-[var(--color-text-muted)] tabular-nums">{count}</span>
      )}
    </label>
  );
}
