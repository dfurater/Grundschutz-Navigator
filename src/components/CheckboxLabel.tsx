import { useEffect, useRef } from 'react';
import { IconCheck } from './icons';

export interface CheckboxLabelProps {
  readonly label: string;
  readonly count?: number;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly title?: string;
  /**
   * Zugänglicher Name, wenn der sichtbare `label` allein nicht eindeutig ist.
   *
   * Nötig, sobald mehrere Optionen dieselben Namen tragen — die vier
   * Schutzziele bieten alle die Stufen `1` und `2` an, und ohne die Dimension
   * im Namen wäre per Screenreader nicht unterscheidbar, welches Schutzziel
   * gemeint ist. Die übergeordnete Zeile ist mit der Checkbox nicht
   * programmatisch verbunden und trägt diese Zuordnung nicht.
   */
  readonly ariaLabel?: string;
  /**
   * Dritter Kontrollzustand: Die Option steht für eine Gruppe, von der nur ein
   * Teil gewählt ist.
   *
   * Das ist `HTMLInputElement.indeterminate` — eine DOM-Eigenschaft ohne
   * Attributform, die deshalb über ein Ref gesetzt werden muss. Sie trägt den
   * Zustand in den Accessibility-Baum (`mixed`); die sichtbare Unterscheidung
   * steuert diese Komponente zusätzlich selbst, weil CSS den Zustand eines
   * `sr-only`-Inputs sonst nicht erreicht.
   *
   * `checked` bleibt dabei `false`: Ein gemischter Zustand ist kein gesetzter
   * Haken.
   */
  readonly indeterminate?: boolean;
}

/** Rahmen, Radius und Fokusring der Box — in jedem Zustand gleich. */
const BOX_BASE =
  'w-4 h-4 border rounded peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--color-focus-ring)] peer-focus-visible:ring-offset-1 transition-colors';

/** An und aus: leere Box, die `peer-checked` füllt. */
const BOX_PLAIN =
  'border-[var(--color-border-strong)] bg-[var(--color-surface-base)] peer-checked:bg-[var(--color-primary-main)] peer-checked:border-[var(--color-primary-main)]';

/** Gemischt: gefüllte Box, unabhängig von `checked`. */
const BOX_MIXED = 'bg-[var(--color-primary-main)] border-[var(--color-primary-main)]';

export function CheckboxLabel({
  label,
  count,
  checked,
  onChange,
  title,
  ariaLabel,
  indeterminate = false,
}: CheckboxLabelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // Ein Klick setzt `indeterminate` im DOM von sich aus zurück. Der Effekt
  // hängt deshalb auch an `checked`: Jeder Zustandswechsel der Zeile schreibt
  // die Eigenschaft neu, statt sich auf den Browserzustand zu verlassen.
  useEffect(() => {
    const input = inputRef.current;
    if (input) input.indeterminate = indeterminate;
  }, [checked, indeterminate]);

  return (
    <label
      className="flex items-center space-x-2 cursor-pointer group hover:bg-[var(--color-surface-subtle)] px-1 py-0.5 -ml-1 rounded select-none"
      title={title}
    >
      <div className="relative flex items-center justify-center w-4 h-4">
        <input
          ref={inputRef}
          type="checkbox"
          className="peer sr-only"
          aria-label={ariaLabel}
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <div className={`${BOX_BASE} ${indeterminate ? BOX_MIXED : BOX_PLAIN}`} />
        {indeterminate ? (
          // Kein eigenes Glyph: Der Balken ist die übliche Form des gemischten
          // Zustands und hält das Icon-Set bei seinen 22 Zeichen.
          <span
            aria-hidden="true"
            className="absolute w-2 h-0.5 rounded-full bg-white pointer-events-none"
          />
        ) : (
          <IconCheck className="absolute w-3 h-3 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" />
        )}
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
