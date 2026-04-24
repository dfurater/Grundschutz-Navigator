import { useState } from 'react';
import type { ReactNode } from 'react';
import { IconChevronRight, IconChevronDown } from './icons';

export interface FilterSectionProps {
  title: string;
  children: ReactNode;
  defaultExpanded?: boolean;
  /** Number of active filter selections in this section */
  activeCount?: number;
}

export function FilterSection({
  title,
  children,
  defaultExpanded = true,
  activeCount = 0,
}: FilterSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <div className="border-b border-[var(--color-border-subtle)] py-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between rounded-md text-left transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-focus-ring)] group"
        aria-expanded={expanded}
      >
        <span className="text-xs font-semibold text-[var(--color-text-secondary)] group-hover:text-[var(--color-text-primary)]">
          {title}
        </span>
        <div className="flex items-center gap-1.5">
          {!expanded && activeCount > 0 && (
            <span className="filter-count-badge bg-[var(--color-text-primary)]">
              {activeCount}
            </span>
          )}
          {expanded ? (
            <IconChevronDown className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          ) : (
            <IconChevronRight className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
          )}
        </div>
      </button>
      {expanded && <div className="mt-2 space-y-0.5">{children}</div>}
    </div>
  );
}
