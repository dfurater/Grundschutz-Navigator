import type { RefObject } from 'react';
import type { Control } from '@/domain/models';
import { ControlDetailSection } from './ControlDetailSection';
import { detailProseClass, textActionClass } from './ControlVocabularyPrimitives';

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
        className={`${detailProseClass} ${!expanded ? 'line-clamp-5' : ''}`}
      >
        {guidance}
      </p>
      {hasOverflow && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls="guidance-text"
          onClick={onToggleExpanded}
          className={`mt-2 ${textActionClass}`}
        >
          {expanded ? 'Weniger anzeigen' : 'Mehr anzeigen'}
        </button>
      )}
    </ControlDetailSection>
  );
}
