import type { CSSProperties, ReactNode } from 'react';
import type { Control } from '@/domain/models';
import { rowTouchTargetClass } from './ControlVocabularyPrimitives';

/**
 * Breite der Kennungsspalte in Link-Listen (GSPP-447): Ein Vorfahr setzt sie
 * über `controlIdColumnStyle`; ohne Angabe richtet sich die Kennung nach ihrem
 * Inhalt.
 */
const CONTROL_ID_COLUMN_VAR = '--control-id-column';

/**
 * Setzt die gemeinsame Kennungsspalte für alle Link-Listen darunter, bemessen
 * an der längsten sichtbaren Kennung. Kennungen stehen in Monospace; `ch` ist
 * dort die Breite jedes Zeichens, weil die Spalte im selben Schriftbild
 * aufgelöst wird (Kennung und Einrückung der Zusatztexte).
 */
export function controlIdColumnStyle(ids: readonly string[]): CSSProperties | undefined {
  const longest = ids.reduce((max, id) => Math.max(max, id.length), 0);
  return longest === 0 ? undefined : { [CONTROL_ID_COLUMN_VAR]: `${longest}ch` } as CSSProperties;
}

/** Kennungsspalte (auch als leerer Einzug unter dem Titel): Monospace 12 px in gemeinsamer Breite. */
const controlIdColumnClass = 'w-[var(--control-id-column,auto)] shrink-0 font-mono text-xs';

/**
 * Link-Zeile in einer `detailListClass`-Liste: Kennung in der gemeinsamen
 * Spalte, Titel bündig daneben; ein mehrzeiliger Titel bricht an seiner
 * eigenen Kante um. Zeile 24 px hoch, die Touch-Fläche wächst unsichtbar per
 * `::after` (36 px mobil, 28 px ab lg), ohne das Layout zu verschieben.
 */
export const detailListLinkClass =
  `group inline-flex min-h-6 max-w-full items-baseline gap-2 rounded text-left ${rowTouchTargetClass} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-[var(--color-focus-ring)]`;

/** Kennung und Titel einer anderen Anforderung als Link-Zeile in einer Detail-Liste. */
export function ControlListLink({
  control,
  ariaLabel,
  describedById,
  onNavigateToControl,
}: {
  readonly control: Control;
  readonly ariaLabel: string;
  /** Zusatztext zur Zeile (`ControlListNote`), etwa die Gegenrichtung. */
  readonly describedById?: string;
  readonly onNavigateToControl?: (control: Control) => void;
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-describedby={describedById}
      className={detailListLinkClass}
      onClick={() => onNavigateToControl?.(control)}
    >
      <span className={`${controlIdColumnClass} text-slate-500 group-hover:text-primary-main`}>{control.id}</span>
      <span className="min-w-0 [overflow-wrap:anywhere] group-hover:underline">{control.title}</span>
    </button>
  );
}

/**
 * Zusatztext unter einer `ControlListLink`-Zeile: kleinere Metaschrift, an der
 * Titelkante ausgerichtet. Der leere Einzug hat die Breite der Kennungsspalte.
 */
export function ControlListNote({
  id,
  children,
}: {
  readonly id: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <p id={id} className="flex gap-2 text-xs leading-snug text-slate-500">
      <span aria-hidden="true" className={controlIdColumnClass} />
      <span className="min-w-0 [overflow-wrap:anywhere]">{children}</span>
    </p>
  );
}
