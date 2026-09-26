import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Tooltip } from '@/components/Tooltip';
import type { VocabularyNamespace } from '@/domain/models';
import type { VocabularyResolution } from '@/domain/vocabulary';

export interface RenderVocabularyCardOptions {
  /** Spalten, die in diesem Kontext bereits sichtbar und deshalb redundant sind. */
  hiddenColumns?: string[];
}

export type RenderVocabularyCard = (
  resolution: VocabularyResolution,
  options?: RenderVocabularyCardOptions,
) => ReactNode;

export const detailLinkRowClass =
  'group block w-full rounded px-2 py-2 -mx-2 text-left transition-colors hover:bg-[var(--color-surface-subtle)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]';

export function SubSectionHeading({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <h4 className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
      {children}
    </h4>
  );
}

export function toVocabCardId(key: string) {
  return `vocab-card-${key.replace(/[^a-zA-Z0-9-]/g, '-')}`;
}

export function findResolutionByValue(
  resolutions: readonly VocabularyResolution[],
  value: string,
) {
  return resolutions.find((resolution) => resolution.entry.value === value) ?? null;
}

/**
 * Vokabular-Link für einen Eintragswert (GSPP-303 T7): `/vokabular/<routeId>?wert=<kodierter Wert>`.
 * Präzedenz `buildEntryHref` (`VocabularyEntryCard.tsx`); T6-Callers bleiben
 * unverändert (T10-Dedup ist vermerkt) — nur T7-Neucode nutzt den Helfer.
 */
export function vocabularyEntryHref(
  namespace: VocabularyNamespace,
  value: string,
) {
  return `/vokabular/${namespace.source.routeId}?wert=${encodeURIComponent(value)}`;
}

export interface TermTriggerProps {
  readonly vocabKey: string;
  readonly active: boolean;
  readonly onToggle: (key: string) => void;
  readonly label: string;
  readonly ariaLabel: string;
  readonly tooltip?: ReactNode;
  /** Nur im Fließsatz greift die WCAG-Ausnahme für Inline-Touchziele. */
  readonly inline?: boolean;
}

/**
 * Begriffs-Trigger im Abkürzungs-Stil (GSPP-303 T4): gepunktet unterstrichenes
 * Label statt Icon-Affordanz; schaltet die Vokabelkarte
 * `toVocabCardId(vocabKey)` um. Mit `tooltip` läuft der Button in
 * `Tooltip mode='hover'`; das `aria-describedby` trägt der Button selbst
 * (T3-`describeTarget`-Vertrag).
 */
export function TermTrigger({
  vocabKey,
  active,
  onToggle,
  label,
  ariaLabel,
  tooltip,
  inline = false,
}: TermTriggerProps): ReactNode {
  const cardId = toVocabCardId(vocabKey);
  const renderButton = (describedById?: string) => (
    <button
      type="button"
      aria-pressed={active}
      aria-expanded={active}
      aria-controls={cardId}
      aria-label={ariaLabel}
      aria-describedby={describedById}
      onClick={() => {
        onToggle(vocabKey);
      }}
      className={`cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] ${
        inline ? 'inline' : 'inline-flex min-h-11 min-w-11 max-w-full items-center text-left [overflow-wrap:anywhere] lg:min-h-10 lg:min-w-10'
      } ${
        active ? 'font-medium text-primary-main' : ''
      }`}
    >
      <span className="underline decoration-dotted underline-offset-4">
        {label}
      </span>
    </button>
  );

  if (tooltip === undefined) {
    return renderButton();
  }
  return (
    <Tooltip
      id={`${cardId}-tooltip`}
      mode="hover"
      content={tooltip}
      describeTarget={(id) => renderButton(id)}
    />
  );
}

export interface LegendEntry {
  readonly term: string;
  /**
   * Erklärtext zum Term. Leer erlaubt — dann rendert die Legende nur Term +
   * Link ohne `: `-Anstrich (GSPP-303 T9).
   *
   * Einträge einer Legende müssen je Begriff eindeutig sein.
   */
  readonly definition: string;
  readonly href?: string;
}

export interface SectionLegendProps {
  readonly legendId: string;
  readonly label?: string;
  readonly entries: LegendEntry[];
}

/**
 * Sektions-Legende (GSPP-303 T4): Textlink ohne Icon; toggelt ein Panel mit
 * allen Einträgen (Begriff als Link auf die Vokabular-Route + Definition).
 *
 * Ein Vokabular-Link erscheint nur für Begriffe mit echter Zielseite.
 */
export function SectionLegend({
  legendId,
  label = 'Legende',
  entries,
}: SectionLegendProps): ReactNode {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={legendId}
        onClick={() => {
          setOpen((current) => !current);
        }}
        className="cursor-pointer rounded text-primary-main hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
      >
        {label}
      </button>
      <div id={legendId} hidden={!open}>
        {entries.map((entry) => (
          <p
            key={entry.term}
            className="text-sm leading-relaxed text-slate-700"
          >
            {entry.href ? (
              <Link
                to={entry.href}
                className="rounded font-bold text-primary-main hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]"
              >
                {entry.term}
              </Link>
            ) : <strong>{entry.term}</strong>}
            {entry.definition ? `: ${entry.definition}` : null}
          </p>
        ))}
      </div>
    </div>
  );
}
