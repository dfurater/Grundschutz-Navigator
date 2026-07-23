import type { ReactNode } from 'react';
import { IconInfo } from '@/components/icons';
import type { VocabularyResolution } from '@/domain/vocabulary';

export type RenderVocabularyCard = (resolution: VocabularyResolution) => ReactNode;

export const outlineBadgeClass =
  'max-w-full whitespace-normal break-words py-1 text-left leading-snug [overflow-wrap:anywhere]';

export function VocabularyAffordanceIcon({
  active = false,
  placement = 'inline',
}: {
  active?: boolean;
  placement?: 'badge' | 'inline';
}) {
  const placementClass = placement === 'badge' ? 'self-center' : 'mt-0.5';

  return (
    <IconInfo
      aria-hidden="true"
      className={`catalog-vocabulary-affordance h-3 w-3 shrink-0 transition-colors ${placementClass} ${
        active ? 'text-primary-main' : 'text-slate-400'
      }`}
    />
  );
}

export function toVocabCardId(key: string) {
  return `vocab-card-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

export function vocabButtonClass(active: boolean) {
  return `inline-flex cursor-pointer rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${
    active
      ? 'ring-2 ring-offset-1 ring-primary-main/40'
      : ''
  }`;
}
