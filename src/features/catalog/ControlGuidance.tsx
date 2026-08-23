import type { RefObject } from 'react';
import type { Control } from '@/domain/models';
import { ControlDetailSection } from './ControlDetailSection';

export interface ControlGuidanceProps {
  readonly guidance: Control['guidance'];
  readonly guidanceRef: RefObject<HTMLParagraphElement | null>;
  readonly expanded: boolean;
  readonly hasOverflow: boolean;
  readonly onToggleExpanded: () => void;
}

export function ControlGuidance({
  guidance,
  guidanceRef,
  expanded,
  hasOverflow,
  onToggleExpanded,
}: ControlGuidanceProps) {
  if (!guidance) {
    return null;
  }

  return (
    <ControlDetailSection heading="Umsetzungshinweise">
      <p
        id="guidance-text"
        ref={guidanceRef}
        className={`w-full break-words text-sm text-slate-700 leading-relaxed whitespace-pre-line [hyphens:auto] ${!expanded ? 'line-clamp-5' : ''}`}
      >
        {guidance}
      </p>
      {hasOverflow && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="guidance-text"
          onClick={onToggleExpanded}
          className="mt-2 rounded text-xs font-medium text-primary-main hover:text-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
        >
          {expanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}
        </button>
      )}
    </ControlDetailSection>
  );
}
