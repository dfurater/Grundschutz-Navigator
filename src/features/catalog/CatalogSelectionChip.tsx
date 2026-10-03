import { IconX } from '@/components/icons';

interface CatalogSelectionChipProps {
  readonly count: number;
  readonly isDesktop: boolean;
  readonly mobileSelectMode: boolean;
  readonly onClear: () => void;
}

/**
 * Zähler-Chip „n ausgewählt“ mit Aufheben-Kreuz, gemeinsam für Katalog und
 * Suchergebnisse. Er entfällt im mobilen Auswahlmodus, weil dort die
 * Auswahlleiste die Zahl zeigt (GSPP-471). Ohne Auswahlmodus bleibt eine
 * erhaltene Auswahl auf jeder Breite sichtbar und aufhebbar.
 */
export function CatalogSelectionChip({
  count,
  isDesktop,
  mobileSelectMode,
  onClear,
}: CatalogSelectionChipProps) {
  if (count === 0 || (!isDesktop && mobileSelectMode)) return null;
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--color-accent-default)] bg-[var(--color-accent-soft)] px-2 py-1 rounded">
      {count} ausgewählt
      <button
        type="button"
        onClick={onClear}
        className="hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-subtle)] px-2 py-1 rounded transition-colors"
        aria-label="Auswahl aufheben"
      >
        <IconX className="w-3 h-3" />
      </button>
    </span>
  );
}
