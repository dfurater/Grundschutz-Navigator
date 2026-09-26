import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Tooltip } from '@/components/Tooltip';
import {
  legendCardClass,
  legendLinkClass,
  legendTermClass,
  tightStackClass,
} from '@/components/legendStyles';
import type { Control, VocabularyNamespace } from '@/domain/models';
import type { VocabularyResolution } from '@/domain/vocabulary';

export interface RenderVocabularyCardOptions {
  /** Spalten, die in diesem Kontext bereits sichtbar und deshalb redundant sind. */
  hiddenColumns?: string[];
}

export type RenderVocabularyCard = (
  resolution: VocabularyResolution,
  options?: RenderVocabularyCardOptions,
) => ReactNode;

/**
 * Touch-Fläche einer Zeile mit 24 px Höhe (Listen, Begriffe außerhalb des
 * Satzes): Das Pseudo-Element wächst unsichtbar auf 36 px mobil bzw. 28 px ab
 * lg; die Zeile selbst bleibt bei jeder Breite 24 px hoch, damit am
 * Breakpoint nichts springt (Owner 26.09.2026). Benachbarte Flächen
 * überlappen dabei um 6 px.
 */
export const rowTouchTargetClass =
  "relative after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] lg:after:-inset-y-0.5";

/**
 * Textaktion in 12 px (Legende, Mehr anzeigen): unterstreicht beim Hover wie
 * jeder Link; die Trefferfläche wächst unsichtbar auf 40 px mobil bzw. 24 px ab lg.
 */
export const textActionClass =
  "relative shrink-0 cursor-pointer rounded text-xs font-medium leading-4 text-primary-main after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)] lg:after:-inset-y-1";

/**
 * Aufzählung der Detailansicht (Gefährdungen, Erweiterungen, Verknüpfungen):
 * echte Liste mit dezentem Punkt, feste Zeilenhöhe und 6 px Abstand. Eine
 * aufgeklappte Karte hält 12 px zum nächsten Eintrag (`tightStackClass`).
 */
export const detailListMarkerClass =
  'list-disc pl-4 text-sm leading-relaxed text-slate-700 marker:text-slate-400';

export const detailListClass = `${detailListMarkerClass} space-y-1.5 ${tightStackClass}`;

/**
 * Link-Zeile in einer `detailListClass`-Liste: Kennung und Titel auf einer
 * Grundlinie, Zeile 24 px hoch. Die Touch-Fläche wächst unsichtbar per
 * `::after` (36 px mobil, 28 px ab lg), ohne das Layout zu verschieben.
 */
export const detailListLinkClass =
  `group inline-flex min-h-6 max-w-full items-baseline gap-2 rounded text-left ${rowTouchTargetClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]`;

/** Kennung und Titel einer anderen Anforderung als Link-Zeile in einer Detail-Liste. */
export function ControlListLink({
  control,
  ariaLabel,
  onNavigateToControl,
}: {
  readonly control: Control;
  readonly ariaLabel: string;
  readonly onNavigateToControl?: (control: Control) => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className={detailListLinkClass}
      onClick={() => onNavigateToControl?.(control)}
    >
      <span className="shrink-0 font-mono text-xs text-slate-500 group-hover:text-primary-main">{control.id}</span>
      <span className="group-hover:underline">{control.title}</span>
    </button>
  );
}

/** Fließtext der Detailansicht: Anforderung, Umsetzungshinweise und Dokumentation in einer Größe. */
export const detailProseClass = 'w-full break-words text-sm leading-relaxed whitespace-pre-line text-slate-700 [hyphens:auto]';

/** Gruppenbeschriftung unter einer Blockleiste (Schutzziele, Tags, Dokumentation …). */
export const subSectionHeadingClass = 'mb-1.5 text-sm font-semibold leading-snug text-slate-700';

export function SubSectionHeading({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <h4 className={subSectionHeadingClass}>
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
  /**
   * Ersetzt die Layout-Klassen außerhalb des Satzes, z. B. im Schutzziel-Raster
   * mit fester Zeilenhöhe und Touch-Fläche über ein Pseudo-Element.
   */
  readonly className?: string;
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
  className,
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
        // Außerhalb des Satzes: Zeile 24 px bei jeder Breite, Touch-Fläche per
        // Pseudo-Element (`rowTouchTargetClass`), damit am Breakpoint nichts springt.
        inline ? 'inline' : (className ?? `inline-flex min-h-6 max-w-full items-center text-left [overflow-wrap:anywhere] ${rowTouchTargetClass}`)
      } ${
        active ? 'font-medium text-primary-main' : ''
      }`}
    >
      {/*
        Außerhalb des Satzes reserviert eine unsichtbare, halbfette Kopie per
        `::after` die Breite des aktiven Zustands: Das Öffnen der Karte
        verschiebt dann nichts daneben (Owner 26.09.2026).
      */}
      <span
        data-label={inline ? undefined : label}
        className={`underline decoration-dotted decoration-slate-400 underline-offset-4 ${
          inline ? '' : "inline-flex flex-col after:invisible after:h-0 after:overflow-hidden after:font-medium after:content-[attr(data-label)]"
        }`}
      >
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
   * Erklärtext zum Term, steht unter dem Term. Leer erlaubt — dann rendert
   * die Legende nur Term + Link (GSPP-303 T9).
   *
   * Einträge einer Legende müssen je Begriff eindeutig sein.
   */
  readonly definition: string;
  readonly href?: string;
  /**
   * Sichtbare Form des Begriffs, wie sie im Block steht (z. B. die Punkte-Skala
   * der Schutzziel-Relevanz), damit niemand Ziffern in Symbole übersetzen muss.
   * Der Begriff bleibt dann als Screenreader-Text erhalten.
   */
  readonly visual?: ReactNode;
  /**
   * Merkmal, zu dem der Wert gehört (z. B. „Modalverb“ für „SOLLTE“); die
   * Legende zeigt dann „Merkmal: Wert“ über der Erklärung.
   */
  readonly category?: string;
}

export interface SectionLegendProps {
  readonly legendId: string;
  readonly label?: string;
  readonly entries: LegendEntry[];
}

/** Textlink „Legende“ (12 px); die Trefferfläche wächst unsichtbar per `::after` auf Touch-Größe. */
export function LegendToggle({
  legendId,
  label = 'Legende',
  open,
  onToggle,
}: {
  readonly legendId: string;
  readonly label?: string;
  readonly open: boolean;
  readonly onToggle: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={legendId}
      onClick={onToggle}
      className={textActionClass}
    >
      {label}
    </button>
  );
}

export function LegendPanel({
  legendId,
  open,
  entries,
  className = 'mt-2',
}: {
  readonly legendId: string;
  readonly open: boolean;
  readonly entries: LegendEntry[];
  readonly className?: string;
}): ReactNode {
  return (
    // Eigene Karte, damit die Erklärung nicht als Inhalt des Blocks gelesen wird.
    // Je Eintrag erst „Merkmal: Wert“, darunter die Erklärung (Legendenschema).
    <dl id={legendId} hidden={!open} className={`${legendCardClass} ${className}`}>
      {entries.map((entry) => {
        const label = entry.visual === undefined ? entry.term : (
          <>
            <span aria-hidden="true" className="inline-flex align-middle">{entry.visual}</span>
            <span className="sr-only">{entry.term}</span>
          </>
        );
        return (
          <div key={`${entry.category ?? ''}:${entry.term}`}>
            <dt className={legendTermClass}>
              {entry.category === undefined ? null : `${entry.category}: `}
              {entry.href ? (
                <Link to={entry.href} className={legendLinkClass}>
                  {label}
                </Link>
              ) : label}
            </dt>
            {entry.definition ? <dd>{entry.definition}</dd> : null}
          </div>
        );
      })}
    </dl>
  );
}

/**
 * Sektions-Legende (GSPP-303 T4): Textlink ohne Icon; toggelt ein Panel mit
 * allen Einträgen (Begriff als Link auf die Vokabular-Route + Definition).
 * In Blöcken mit Leiste steht der Textlink in der Leiste
 * (`ControlDetailSection`, Prop `legend`); dort nutzt die Leiste
 * `LegendToggle` und `LegendPanel` direkt.
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
      <LegendToggle
        legendId={legendId}
        label={label}
        open={open}
        onToggle={() => {
          setOpen((current) => !current);
        }}
      />
      <LegendPanel legendId={legendId} open={open} entries={entries} />
    </div>
  );
}
