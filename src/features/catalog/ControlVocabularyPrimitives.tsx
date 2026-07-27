import type { ReactNode } from 'react';
import { IconInfo } from '@/components/icons';
import type { VocabularyResolution } from '@/domain/vocabulary';

export interface RenderVocabularyCardOptions {
  /** Spalten, die in diesem Kontext bereits sichtbar und deshalb redundant sind. */
  hiddenColumns?: string[];
}

export type RenderVocabularyCard = (
  resolution: VocabularyResolution,
  options?: RenderVocabularyCardOptions,
) => ReactNode;

export const outlineBadgeClass =
  'max-w-full whitespace-normal break-words py-1 text-left leading-snug [overflow-wrap:anywhere]';

export const detailLinkRowClass =
  'group block w-full rounded px-2 py-2 -mx-2 text-left transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

export function SubSectionHeading({ children }: { children: ReactNode }) {
  return (
    <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
      {children}
    </h4>
  );
}

const AFFORDANCE_PLACEMENT_CLASS = {
  badge: 'self-center',
  inline: 'mt-0.5',
  /** Führendes Icon: die Zentrierung übernimmt der Zeilenkasten des Wrappers. */
  leading: '',
} as const;

export function VocabularyAffordanceIcon({
  active = false,
  placement = 'inline',
}: {
  active?: boolean;
  placement?: keyof typeof AFFORDANCE_PLACEMENT_CLASS;
}) {
  const icon = (
    <IconInfo
      aria-hidden="true"
      className={`catalog-vocabulary-affordance h-3 w-3 shrink-0 transition-colors ${
        AFFORDANCE_PLACEMENT_CLASS[placement]
      } ${active ? 'text-primary-main' : 'text-slate-400'}`}
    />
  );

  if (placement !== 'leading') {
    return icon;
  }

  // Der Wrapper ist exakt eine Zeile hoch (text-sm/leading-relaxed), damit das
  // Icon optisch auf der ersten Textzeile sitzt statt am Blockanfang.
  return (
    <span className="flex h-[1.625em] shrink-0 items-center">
      {icon}
    </span>
  );
}

/**
 * Einzug für Einträge ohne Trigger, damit ihr Text auf der Textkante der
 * Trigger mit führendem Icon steht (Icon 0.75rem + Gap 0.375rem).
 */
export const leadingAffordanceIndentClass = 'pl-[1.125rem]';

/** Trigger mit führendem Affordanz-Icon und hängendem Einzug der Folgezeilen. */
export function leadingTriggerClass(active: boolean) {
  return `flex w-full items-start gap-1.5 rounded text-left text-sm leading-relaxed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${
    active
      ? 'font-medium text-primary-main underline decoration-primary-main/40 underline-offset-4'
      : 'text-slate-700'
  }`;
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

export function findResolutionByValue(
  resolutions: readonly VocabularyResolution[],
  value: string,
) {
  return resolutions.find((resolution) => resolution.entry.value === value) ?? null;
}
